"""Hourly SEIR counts and pathogen inflow aggregates."""

import bisect

from .constants import TICK_INTERVAL_SEC
from .disease import build_transitions
from .timeutil import time_to_tick

STATE_NAMES = ["S", "E", "I", "R"]


def seir_counts_over_time(transitions_by_agent, num_agents, grid_ticks):
    """Count agents in each state at each grid tick.

    transitions_by_agent: {agent_id: [[tick, code], ...]} (may omit agents).
    Agents absent from the dict, or before their first transition, count as S.
    """
    counts = {name: [0] * len(grid_ticks) for name in STATE_NAMES}
    present = transitions_by_agent

    for trans in present.values():
        ticks = [t for t, _ in trans]
        for gi, gt in enumerate(grid_ticks):
            idx = bisect.bisect_right(ticks, gt) - 1
            code = trans[idx][1] if idx >= 0 else 0
            counts[STATE_NAMES[code]][gi] += 1

    # Agents with no transition entry are Susceptible at every grid tick.
    missing = num_agents - len(present)
    if missing:
        for gi in range(len(grid_ticks)):
            counts["S"][gi] += missing
    return counts


def _hourly_grid(start_time, end_time, cadence_sec=3600):
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    max_tick = time_to_tick(end_time, start_time)
    num_bins = int(max_tick // bin_ticks) + 1
    return [i * bin_ticks for i in range(num_bins)], bin_ticks


def pathogen_inflow_over_time(poop_df, start_time, num_bins, bin_ticks):
    df = poop_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["bin"] = (df["tick"] // bin_ticks).astype(int)
    sums = df.groupby("bin")["pathogen_level"].sum()
    return [float(sums.get(i, 0.0)) for i in range(num_bins)]


def build_aggregates(disease_df, poop_df, start_time, end_time, num_agents,
                     cadence_sec=3600):
    grid_ticks, bin_ticks = _hourly_grid(start_time, end_time, cadence_sec)
    transitions = build_transitions(disease_df, start_time)
    seir = seir_counts_over_time(transitions, num_agents, grid_ticks)
    inflow = pathogen_inflow_over_time(poop_df, start_time, len(grid_ticks), bin_ticks)
    return {
        "cadenceSec": cadence_sec,
        "startTime": str(start_time),
        "gridTicks": grid_ticks,
        "seir": seir,
        "pathogenInflow": inflow,
    }
