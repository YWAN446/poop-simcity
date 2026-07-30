"""Per-agent disease timelines for bundle v2.

This run records exact `exposed_started_time` and `infectious_started_time`, so
S->E and E->I come from those rather than from the ~hourly-per-day snapshot grid.
Recovery has no timestamp anywhere in the data and is therefore only resolvable to
the first snapshot showing Recovered - a limitation the manifest advertises.

The natural way to express the reduction is a per-row loop: for every row, fold
it into per-agent running minimums (exposed/infectious/recovered onset tick) and
into a first-sample-per-cadence-bin pathogen map. At 43.8M rows, a Python loop
using `.iat[i]` accessors runs at roughly 70,000 rows/sec - over ten minutes of
pure accessor overhead, before any bookkeeping. So each streamed batch is instead
reduced with vectorized pandas groupby operations, and only the small per-batch
results (bounded by the number of distinct agents, not rows) are combined across
batches in a second pass.

This is safe because both reductions are associative and composable:
  - "minimum tick" composes because min-of-mins is a min.
  - "source of the row achieving the minimum, ties broken by first file-order
    occurrence" composes because `groupby(...).idxmin()` breaks ties by first
    occurrence in traversal order, at both the intra-batch and inter-batch
    level, as long as batches are concatenated in file order. Each per-batch
    reduction already contributes at most one row per agent, so a tie between
    two batches for the same agent always resolves to whichever batch was
    appended first - i.e. file order is preserved through both levels.
  - "first sample per (agent, cadence bin), in file order" composes the same
    way: `drop_duplicates(keep="first")` preserves row order, so applying it
    once per batch and then again across the batches' concatenated results
    (in batch order) yields the same answer as applying it once across the
    whole file.
"""

import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from .constants import STATE_CODES, TICK_INTERVAL_SEC
from .window import mask_in_window, ticks_of, to_u16

TRANS_DTYPE = np.dtype([("tick", "<u2"), ("code", "<u1")])
SAMPLE_DTYPE = np.dtype([("tick", "<u2"), ("level", "<f4")])
TRANSMISSION_DTYPE = np.dtype([("tick", "<u2"), ("source", "<u2"), ("target", "<u2")])


@dataclass
class DiseaseScan:
    transitions: dict = field(default_factory=dict)
    samples: dict = field(default_factory=dict)
    transmissions: list = field(default_factory=list)


def _clamped_ticks(times, window) -> np.ndarray:
    """Vectorized, clamped equivalent of a per-scalar `(ts - start) // TICK`.

    Floors toward -infinity (matching Python's `//` on floats) and clamps at 0,
    because seed agents carry a midnight onset time that can precede the window
    start.
    """
    delta = (pd.to_datetime(times) - window.start).dt.total_seconds().to_numpy()
    ticks = np.floor_divide(delta, float(TICK_INTERVAL_SEC)).astype("int64")
    return np.clip(ticks, 0, None)


def _reduce_min_with_source(blocks):
    """Combine per-batch (agent, tick, source) frames into global minimums.

    Each block already holds at most one row per agent - the row achieving that
    batch's minimum tick, tie-broken to the first occurrence in the batch. Since
    blocks are appended in batch (i.e. file) order, concatenating them preserves
    file order across batches too, so a second `idxmin` here reproduces the
    "first row in file order achieving the global minimum" rule exactly.
    """
    if not blocks:
        return {}, {}
    all_rows = pd.concat(blocks, ignore_index=True)
    final = all_rows.loc[all_rows.groupby("agent")["tick"].idxmin()]
    return (dict(zip(final["agent"].tolist(), final["tick"].tolist())),
            dict(zip(final["agent"].tolist(), final["source"].tolist())))


def _reduce_min(blocks):
    if not blocks:
        return {}
    all_rows = pd.concat(blocks, ignore_index=True)
    final = all_rows.groupby("agent", as_index=False)["tick"].min()
    return dict(zip(final["agent"].tolist(), final["tick"].tolist()))


def _reduce_first_per_bin(blocks):
    if not blocks:
        return {}
    all_rows = pd.concat(blocks, ignore_index=True)
    final = all_rows.drop_duplicates(subset=["agent", "bin"], keep="first")
    result = {}
    for agent, g in final.sort_values("bin", kind="stable").groupby("agent", sort=True):
        result[int(agent)] = list(zip(g["tick"].tolist(), g["level"].tolist()))
    return result


def scan_disease(dataset_dir, profile, window, sample_cadence_sec=604800,
                 batch_size=2_000_000):
    path = os.path.join(dataset_dir, f"{profile.disease_file}.parquet")
    columns = ["time", "agent_id", "exposed_started_time",
               "infectious_started_time", "pathogen_level", "disease_status",
               profile.source_agent_col]
    bin_ticks = sample_cadence_sec // TICK_INTERVAL_SEC

    exposed_blocks, infectious_blocks = [], []
    recovered_blocks, sample_blocks = [], []

    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=columns):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        if df.empty:
            continue

        tick = ticks_of(df["time"], window)
        agent = df["agent_id"].to_numpy(dtype="int64")

        exp_mask = df["exposed_started_time"].notna().to_numpy()
        if exp_mask.any():
            exp_tick = _clamped_ticks(df["exposed_started_time"][exp_mask], window)
            source = df[profile.source_agent_col].to_numpy(dtype="int64")[exp_mask]
            tmp = pd.DataFrame({"agent": agent[exp_mask], "tick": exp_tick,
                                 "source": source})
            exposed_blocks.append(tmp.loc[tmp.groupby("agent")["tick"].idxmin()])

        inf_mask = df["infectious_started_time"].notna().to_numpy()
        if inf_mask.any():
            inf_tick = _clamped_ticks(df["infectious_started_time"][inf_mask], window)
            tmp = pd.DataFrame({"agent": agent[inf_mask], "tick": inf_tick})
            infectious_blocks.append(tmp.groupby("agent", as_index=False)["tick"].min())

        rec_mask = (df["disease_status"] == "Recovered").to_numpy()
        if rec_mask.any():
            tmp = pd.DataFrame({"agent": agent[rec_mask], "tick": tick[rec_mask]})
            recovered_blocks.append(tmp.groupby("agent", as_index=False)["tick"].min())

        level = df["pathogen_level"].to_numpy(dtype="float64")
        pos_mask = level > 0
        if pos_mask.any():
            binned = tick[pos_mask] // bin_ticks
            tmp = pd.DataFrame({"agent": agent[pos_mask], "bin": binned,
                                 "tick": tick[pos_mask], "level": level[pos_mask]})
            sample_blocks.append(tmp.drop_duplicates(subset=["agent", "bin"],
                                                       keep="first"))

    exposed_at, source_of = _reduce_min_with_source(exposed_blocks)
    infectious_at = _reduce_min(infectious_blocks)
    recovered_at = _reduce_min(recovered_blocks)
    samples = _reduce_first_per_bin(sample_blocks)

    scan = DiseaseScan()
    for agent in sorted(set(exposed_at) | set(infectious_at) | set(recovered_at)):
        by_tick = {}
        if agent in exposed_at:
            by_tick[exposed_at[agent]] = STATE_CODES["Exposed"]
        if agent in infectious_at:
            by_tick[infectious_at[agent]] = STATE_CODES["Infectious"]
        if agent in recovered_at:
            by_tick[recovered_at[agent]] = STATE_CODES["Recovered"]
        # Same tick -> later state wins, which collapses seed agents to Infectious.
        merged = {}
        for t, code in sorted(by_tick.items()):
            merged[t] = max(code, merged.get(t, code))
        scan.transitions[agent] = sorted(merged.items())

    for agent in sorted(samples):
        scan.samples[agent] = samples[agent]

    scan.transmissions = sorted(
        (exposed_at[a], source_of[a], a)
        for a in exposed_at if source_of.get(a, -1) >= 0
    )
    return scan


def encode_disease(scan: DiseaseScan):
    agents = sorted(set(scan.transitions) | set(scan.samples))

    index, trans_rows, sample_rows = [], [], []
    for agent in agents:
        trans = scan.transitions.get(agent, [])
        samples = scan.samples.get(agent, [])
        index.append({
            "agentId": agent,
            "transOffset": len(trans_rows), "transCount": len(trans),
            "sampleOffset": len(sample_rows), "sampleCount": len(samples),
        })
        trans_rows.extend(trans)
        sample_rows.extend(samples)

    trans_arr = np.zeros(len(trans_rows), dtype=TRANS_DTYPE)
    if trans_rows:
        trans_arr["tick"] = to_u16(np.array([t for t, _ in trans_rows]),
                                   "transition tick")
        trans_arr["code"] = np.array([c for _, c in trans_rows], dtype=np.uint8)

    sample_arr = np.zeros(len(sample_rows), dtype=SAMPLE_DTYPE)
    if sample_rows:
        sample_arr["tick"] = to_u16(np.array([t for t, _ in sample_rows]),
                                    "pathogen sample tick")
        sample_arr["level"] = np.array([v for _, v in sample_rows], dtype=np.float32)

    tx = np.zeros(len(scan.transmissions), dtype=TRANSMISSION_DTYPE)
    if scan.transmissions:
        tx["tick"] = to_u16(np.array([t for t, _, _ in scan.transmissions]),
                            "transmission tick")
        tx["source"] = to_u16(np.array([s for _, s, _ in scan.transmissions]),
                              "transmission source")
        tx["target"] = to_u16(np.array([g for _, _, g in scan.transmissions]),
                              "transmission target")

    return trans_arr.tobytes() + sample_arr.tobytes(), tx.tobytes(), index
