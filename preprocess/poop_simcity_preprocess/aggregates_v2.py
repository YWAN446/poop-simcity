"""Hourly SEIR counts and pathogen inflow for bundle v2.

Inflow streams the poop parquet rather than the render stream, so clean-event
downsampling can never distort it.
"""

import numpy as np

from .constants import TICK_INTERVAL_SEC
from .poop_stream import iter_poop_batches
from .window import ticks_of

STATE_NAMES = ["S", "E", "I", "R"]


def _grid(window, cadence_sec):
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    num_bins = (window.num_ticks + bin_ticks - 1) // bin_ticks
    return [i * bin_ticks for i in range(num_bins)], bin_ticks


def seir_hourly(transitions, num_agents, window, cadence_sec=3600):
    """Count agents in each SEIR state at each hourly bin.

    Bin `gi` covers ticks `[gi*bin_ticks, (gi+1)*bin_ticks)`, truncated to the
    window's last valid tick index (`window.num_ticks - 1`) for a short final
    bin. `gridTicks[gi]` (see `build_aggregates_v2`) is that bin's OPENING
    tick, but `seir[state][gi]` describes the population at the bin's
    CLOSING tick - an agent's state for bin `gi` is its last transition at or
    before that bin's last tick, not the tick the bin opens on, so a
    transition partway through an hour already describes that agent for the
    rest of the hour. This is a deliberate difference from v1's
    `aggregates.py::seir_counts_over_time`, which samples at each bin's
    opening tick; v2 samples at bin close instead so SEIR describes the same
    closed hourly interval that `pathogenInflow` sums over. Agents with no
    transitions, and agents before their first transition, are Susceptible.
    Every bin's four counts sum to `num_agents`.

    Vectorized per agent: at real scale there are ~5,490 agents and ~5,112
    hourly bins, so a naive "for agent: for bin: bisect" loop is ~28M scalar
    bisects. Instead, `np.searchsorted` locates every bin's transition index
    for one agent in a single call, turning the inner loop into one vectorized
    lookup per agent (~5,490 calls total).
    """
    grid_ticks, bin_ticks = _grid(window, cadence_sec)
    num_bins = len(grid_ticks)
    # Last valid tick index covered by each bin, capped at the window's last
    # valid tick (num_ticks - 1) so a short final bin doesn't claim ticks
    # beyond the window.
    last_tick_in_bin = np.minimum(
        (np.arange(num_bins, dtype=np.int64) + 1) * bin_ticks - 1,
        window.num_ticks - 1,
    )
    col = np.arange(num_bins)
    counts = np.zeros((len(STATE_NAMES), num_bins), dtype=np.int64)

    for trans in transitions.values():
        if not trans:
            counts[0] += 1
            continue
        arr = np.array(trans, dtype=np.int64)
        ticks, codes = arr[:, 0], arr[:, 1]
        # Count of transitions at-or-before each bin's last tick;
        # idx - 1 is that bin's last transition at-or-before it, or -1 (S).
        idx = np.searchsorted(ticks, last_tick_in_bin, side="right") - 1
        state = np.zeros(num_bins, dtype=np.int64)
        has_transition = idx >= 0
        state[has_transition] = codes[idx[has_transition]]
        counts[state, col] += 1

    missing = num_agents - len(transitions)
    if missing:
        counts[0] += missing

    return {name: counts[i].tolist() for i, name in enumerate(STATE_NAMES)}


def pathogen_inflow_hourly(dataset_dir, profile, window, cadence_sec=3600,
                           batch_size=2_000_000):
    grid_ticks, bin_ticks = _grid(window, cadence_sec)
    totals = np.zeros(len(grid_ticks), dtype="float64")
    for df in iter_poop_batches(dataset_dir, profile, window,
                                ["time", "pathogen_level"], batch_size):
        bins = ticks_of(df["time"], window) // bin_ticks
        np.add.at(totals, bins, df["pathogen_level"].to_numpy(dtype="float64"))
    return [float(v) for v in totals]


def build_aggregates_v2(dataset_dir, profile, window, transitions, num_agents,
                        cadence_sec=3600, batch_size=2_000_000):
    """Bundle hourly SEIR counts and pathogen inflow.

    `gridTicks[i]` is bin `i`'s OPENING tick (bin `i` spans
    `[gridTicks[i], gridTicks[i] + bin_ticks)`), but `seir[state][i]`
    describes the population at that bin's CLOSING tick - see `seir_hourly`'s
    docstring. `seirSampledAt: "binEnd"` records this explicitly so a
    downstream consumer never has to infer it from the numbers (and so it
    doesn't get confused with v1's `aggregates.py`, which samples SEIR at
    bin open).
    """
    grid_ticks, _ = _grid(window, cadence_sec)
    return {
        "cadenceSec": cadence_sec,
        "seirSampledAt": "binEnd",
        "startTime": window.start.isoformat(),
        "gridTicks": grid_ticks,
        "seir": seir_hourly(transitions, num_agents, window, cadence_sec),
        "pathogenInflow": pathogen_inflow_hourly(dataset_dir, profile, window,
                                                 cadence_sec, batch_size),
    }
