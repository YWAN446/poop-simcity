import os
import random

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.constants import STATE_CODES, TICK_INTERVAL_SEC
from poop_simcity_preprocess.disease_v2 import DiseaseScan, encode_disease, scan_disease
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.window import make_window, mask_in_window, ticks_of

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-08 23:55:00")   # 2304 ticks


def _write_disease(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "time", "agent_id", "exposed_started_time", "infectious_started_time",
        "pathogen_level", "disease_status", "SourceAgentId",
        "latitude", "longitude",
    ])
    for c in ["time", "exposed_started_time", "infectious_started_time"]:
        df[c] = pd.to_datetime(df[c])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "DiseasesStatus.parquet")


def test_transitions_use_exact_onset_times_not_snapshot_times(tmp_path):
    # Snapshots are daily, but exposure happened at 09:25 on Jan 1 (tick 113).
    _write_disease(tmp_path, [
        ("2024-01-01", 0, None, None, 0.0, "Susceptible", -1, 32.5, -117.0),
        ("2024-01-02", 0, "2024-01-01 09:25:00", None, 0.0, "Exposed", 7, 32.5, -117.0),
        ("2024-01-03", 0, "2024-01-01 09:25:00", "2024-01-02 12:00:00",
         5.0, "Infectious", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert scan.transitions[0] == [(113, 1), (432, 2)]


def test_recovery_comes_from_the_first_recovered_snapshot(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-02", 0, "2024-01-01 00:00:00", "2024-01-01 00:00:00",
         5.0, "Infectious", 7, 32.5, -117.0),
        ("2024-01-04", 0, "2024-01-01 00:00:00", "2024-01-01 00:00:00",
         1.0, "Recovered", 7, 32.5, -117.0),
        ("2024-01-05", 0, "2024-01-01 00:00:00", "2024-01-01 00:00:00",
         1.0, "Recovered", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    # Jan 4 00:00 is tick 864; the later Recovered snapshot must not override it.
    assert scan.transitions[0][-1] == (864, 3)


def test_seed_agent_collapses_to_a_single_infectious_transition_at_tick_zero(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-01", 0, "2024-01-01", "2024-01-01", 0.0, "Infectious", -1, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert scan.transitions[0] == [(0, 2)]


def test_never_infected_agents_are_absent_from_the_scan(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-01", 4, None, None, 0.0, "Susceptible", -1, 32.5, -117.0),
        ("2024-01-02", 4, None, None, 0.0, "Susceptible", -1, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert 4 not in scan.transitions


def test_transmissions_are_exact_and_sorted_by_tick(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-03", 2, "2024-01-02 00:00:00", None, 0.0, "Exposed", 9, 32.5, -117.0),
        ("2024-01-02", 1, "2024-01-01 00:30:00", None, 0.0, "Exposed", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert scan.transmissions == [(6, 7, 1), (288, 9, 2)]


def test_pathogen_samples_are_one_per_cadence_bin(tmp_path):
    rows = [
        ("2024-01-01", 0, "2024-01-01", "2024-01-01", 10.0, "Infectious", -1, 32.5, -117.0),
        ("2024-01-02", 0, "2024-01-01", "2024-01-01", 20.0, "Infectious", -1, 32.5, -117.0),
        ("2024-01-08", 0, "2024-01-01", "2024-01-01", 30.0, "Infectious", -1, 32.5, -117.0),
    ]
    _write_disease(tmp_path, rows)
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW, sample_cadence_sec=604800)
    # Week 0 keeps its first sample (10.0); Jan 8 falls in week 1.
    assert scan.samples[0] == [(0, 10.0), (2016, 30.0)]


def test_encode_disease_lays_out_both_sections_with_matching_offsets(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-02", 1, "2024-01-01 00:00:00", None, 4.0, "Exposed", 7, 32.5, -117.0),
        ("2024-01-02", 2, "2024-01-01 00:05:00", None, 0.0, "Exposed", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    disease_bin, trans_bin, index = encode_disease(scan)

    trans_dtype = np.dtype([("tick", "<u2"), ("code", "<u1")])
    sample_dtype = np.dtype([("tick", "<u2"), ("level", "<f4")])
    total_trans = sum(e["transCount"] for e in index)
    total_samples = sum(e["sampleCount"] for e in index)
    assert len(disease_bin) == total_trans * 3 + total_samples * 6

    trans = np.frombuffer(disease_bin[: total_trans * 3], dtype=trans_dtype)
    a1 = next(e for e in index if e["agentId"] == 1)
    assert trans[a1["transOffset"]]["tick"] == 0
    assert trans[a1["transOffset"]]["code"] == 1

    samples = np.frombuffer(disease_bin[total_trans * 3:], dtype=sample_dtype)
    assert samples[a1["sampleOffset"]]["level"] == np.float32(4.0)

    tx = np.frombuffer(trans_bin, dtype=np.dtype(
        [("tick", "<u2"), ("source", "<u2"), ("target", "<u2")]))
    assert len(tx) == 2
    assert tx[0]["source"] == 7


# ---------------------------------------------------------------------------
# Equivalence test: vectorized scan_disease vs. a per-row reference.
#
# scan_disease is written as a vectorized batch reduction (pandas groupby)
# instead of the natural-but-slow per-row Python loop, because the production
# file has 43.8M rows and a per-row `.iat[]` loop measures at ~70,000 rows/sec
# there (over 10 minutes of pure accessor overhead). This test pins the
# vectorized implementation to a straightforward, obviously-correct per-row
# reference over a richer synthetic fixture, run with a small batch_size so
# the multi-batch code path is exercised.
# ---------------------------------------------------------------------------

def _tick_of_scalar(ts, window):
    delta = (pd.Timestamp(ts) - window.start).total_seconds()
    return max(0, int(delta // TICK_INTERVAL_SEC))


def _reference_scan_disease(dataset_dir, profile, window, sample_cadence_sec=604800,
                            batch_size=2_000_000):
    """Straightforward per-row reduction; ground truth for the equivalence test."""
    path = os.path.join(dataset_dir, f"{profile.disease_file}.parquet")
    columns = ["time", "agent_id", "exposed_started_time",
               "infectious_started_time", "pathogen_level", "disease_status",
               profile.source_agent_col]
    bin_ticks = sample_cadence_sec // TICK_INTERVAL_SEC

    exposed_at, infectious_at, recovered_at, source_of = {}, {}, {}, {}
    samples = {}

    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=columns):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        if df.empty:
            continue
        tick = ticks_of(df["time"], window)

        for i, agent in enumerate(df["agent_id"].to_numpy(dtype="int64")):
            agent = int(agent)
            row_exp = df["exposed_started_time"].iat[i]
            if pd.notna(row_exp):
                t = _tick_of_scalar(row_exp, window)
                if agent not in exposed_at or t < exposed_at[agent]:
                    exposed_at[agent] = t
                    source_of[agent] = int(df[profile.source_agent_col].iat[i])
            row_inf = df["infectious_started_time"].iat[i]
            if pd.notna(row_inf):
                t = _tick_of_scalar(row_inf, window)
                if agent not in infectious_at or t < infectious_at[agent]:
                    infectious_at[agent] = t
            if df["disease_status"].iat[i] == "Recovered":
                t = int(tick[i])
                if agent not in recovered_at or t < recovered_at[agent]:
                    recovered_at[agent] = t

            level = float(df["pathogen_level"].iat[i])
            if level > 0:
                key = int(tick[i]) // bin_ticks
                per_agent = samples.setdefault(agent, {})
                if key not in per_agent:
                    per_agent[key] = (int(tick[i]), level)

    scan = DiseaseScan()
    for agent in sorted(set(exposed_at) | set(infectious_at) | set(recovered_at)):
        by_tick = {}
        if agent in exposed_at:
            by_tick[exposed_at[agent]] = STATE_CODES["Exposed"]
        if agent in infectious_at:
            by_tick[infectious_at[agent]] = STATE_CODES["Infectious"]
        if agent in recovered_at:
            by_tick[recovered_at[agent]] = STATE_CODES["Recovered"]
        merged = {}
        for t, code in sorted(by_tick.items()):
            merged[t] = max(code, merged.get(t, code))
        scan.transitions[agent] = sorted(merged.items())

    for agent in sorted(samples):
        scan.samples[agent] = [samples[agent][k] for k in sorted(samples[agent])]

    scan.transmissions = sorted(
        (exposed_at[a], source_of[a], a)
        for a in exposed_at if source_of.get(a, -1) >= 0
    )
    return scan


def _build_equivalence_fixture_rows():
    """~240 rows over 8 days x 30 agents, cycling through agent "types" that
    each stress a different part of the reduction:

      type 0 (regular):   sticky exposed/infectious onset, then Recovered,
                           repeated Recovered snapshots afterwards, positive
                           pathogen levels on several distinct days (bins).
      type 1 (seed):      exposed_started_time == infectious_started_time ==
                           the window start for every snapshot -> same-tick
                           E/I collision, source == -1 (no transmission).
      type 2 (never):     Susceptible throughout, all onset times null ->
                           must be absent from transitions and samples.
      type 3 (tie/flip):  exposed_started_time is non-monotonic across days
                           (a later snapshot reports an *earlier* onset than
                           a prior one) and the source id changes on rows
                           that tie the eventual minimum -> stresses the
                           idxmin tie-break (first file-order occurrence
                           wins) both within and across batches.
      type 4 (dupe-bin):  two positive-pathogen rows land in the same day
                           (bin) for the same agent, far apart in file order,
                           with different levels -> only the earlier one may
                           survive.

    Rows are emitted day-major (all agents for day 0, then all agents for
    day 1, ...), matching the real dataset's on-disk order and guaranteeing
    that every agent's rows are spread across many pyarrow batches when the
    test uses a small batch_size.
    """
    rng = random.Random(20260729)
    days = [f"2024-01-{d:02d}" for d in range(1, 9)]  # 8 days, matches WINDOW
    num_agents = 30
    agent_type = {a: a % 5 for a in range(num_agents)}

    # Per-agent fixed attributes so "sticky" columns stay sticky across days.
    exposed_time = {}
    infectious_time = {}
    source = {}
    for a in range(num_agents):
        t = agent_type[a]
        if t == 0:
            exposed_time[a] = f"2024-01-0{rng.randint(1, 2)} {rng.randint(0,23):02d}:00:00"
            infectious_time[a] = f"2024-01-0{rng.randint(3, 4)} {rng.randint(0,23):02d}:00:00"
            source[a] = rng.randint(50, 99)
        elif t == 1:
            exposed_time[a] = "2024-01-01 00:00:00"
            infectious_time[a] = "2024-01-01 00:00:00"
            source[a] = -1
        elif t == 2:
            exposed_time[a] = None
            infectious_time[a] = None
            source[a] = -1
        elif t == 3:
            # Rows will override this per-day (non-monotonic), see below.
            source[a] = rng.randint(50, 99)
        elif t == 4:
            exposed_time[a] = f"2024-01-0{rng.randint(1, 2)} {rng.randint(0,23):02d}:00:00"
            infectious_time[a] = f"2024-01-0{rng.randint(3, 4)} {rng.randint(0,23):02d}:00:00"
            source[a] = rng.randint(50, 99)

    rows = []
    for day_idx, day in enumerate(days):
        for a in range(num_agents):
            t = agent_type[a]
            if t == 0:
                status = ("Susceptible" if day_idx < 1 else
                          "Exposed" if day_idx < 3 else
                          "Infectious" if day_idx < 4 else "Recovered")
                exp = exposed_time[a] if day_idx >= 1 else None
                inf = infectious_time[a] if day_idx >= 3 else None
                level = rng.uniform(1.0, 9.0) if status == "Infectious" else 0.0
                rows.append((day, a, exp, inf, level, status, source[a], 32.5, -117.0))
            elif t == 1:
                status = "Infectious" if day_idx < 6 else "Recovered"
                level = rng.uniform(1.0, 9.0) if status == "Infectious" else 0.0
                rows.append((day, a, exposed_time[a], infectious_time[a], level,
                            status, source[a], 32.5, -117.0))
            elif t == 2:
                rows.append((day, a, None, None, 0.0, "Susceptible", -1, 32.5, -117.0))
            elif t == 3:
                # Day 0: reports a *late* onset (Jan 5). Day 1: reports an
                # *earlier* onset (Jan 2) with a different source - this
                # becomes the true minimum. Day 2 (a different batch) ties
                # that same Jan 2 minimum with yet another source, which
                # must NOT win. Later days keep the tied (winning) value.
                if day_idx == 0:
                    exp, src = "2024-01-05 00:00:00", source[a]
                elif day_idx == 1:
                    exp, src = "2024-01-02 00:00:00", source[a] + 1
                else:
                    exp, src = "2024-01-02 00:00:00", source[a] + 2
                status = "Exposed" if day_idx < 5 else "Infectious"
                inf = "2024-01-06 00:00:00" if day_idx >= 5 else None
                level = rng.uniform(1.0, 9.0) if status == "Infectious" else 0.0
                rows.append((day, a, exp, inf, level, status, src, 32.5, -117.0))
            elif t == 4:
                status = "Infectious" if day_idx >= 1 else "Susceptible"
                exp = exposed_time[a] if day_idx >= 1 else None
                inf = infectious_time[a] if day_idx >= 3 else None
                # Every agent of this type gets a duplicate same-day (bin)
                # pathogen reading late in the file for day 2, with a much
                # higher level than the original - the original must win.
                level = 2.0 if (status == "Infectious" and day_idx == 2) else (
                    rng.uniform(1.0, 9.0) if status == "Infectious" else 0.0)
                rows.append((day, a, exp, inf, level, status, source[a], 32.5, -117.0))

    # Duplicate, later-in-file readings for the type-4 agents' day-2 bin. Same
    # calendar day as the original (so it lands in the same bin), but appended
    # after the whole day-major loop so it is strictly later in file order.
    # Kept as a bare date (no time-of-day) to match the format of every other
    # "time" entry above - pandas' to_datetime format inference otherwise
    # chokes on a mix of "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS" strings.
    for a in range(num_agents):
        if agent_type[a] == 4:
            rows.append(("2024-01-03", a, exposed_time[a], infectious_time[a],
                        99.0, "Infectious", source[a], 32.5, -117.0))

    return rows


def test_vectorized_scan_disease_matches_per_row_reference(tmp_path):
    rows = _build_equivalence_fixture_rows()
    assert len(rows) >= 200
    _write_disease(tmp_path, rows)

    vectorized = scan_disease(str(tmp_path), SDC_10K, WINDOW,
                              sample_cadence_sec=86400, batch_size=37)
    reference = _reference_scan_disease(str(tmp_path), SDC_10K, WINDOW,
                                        sample_cadence_sec=86400, batch_size=37)

    assert vectorized.transitions == reference.transitions
    assert vectorized.samples == reference.samples
    assert vectorized.transmissions == reference.transmissions
    # Sanity: the fixture actually exercises multiple agents with transitions
    # and samples, not a degenerate empty case.
    assert len(vectorized.transitions) >= 20
    assert len(vectorized.samples) >= 10
