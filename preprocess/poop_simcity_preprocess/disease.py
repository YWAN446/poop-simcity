"""Collapse disease snapshots into compact per-agent timelines."""

from .constants import STATE_CODES, TICK_INTERVAL_SEC
from .timeutil import time_to_tick


def build_transitions(disease_df, start_time):
    """Return {agent_id: [[tick, state_code], ...]} of state *changes* only."""
    df = disease_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["code"] = df["disease_status"].map(STATE_CODES).astype(int)
    df = df.sort_values(["agent_id", "tick"], kind="stable")

    result = {}
    for agent_id, g in df.groupby("agent_id"):
        trans = []
        prev = None
        for tick, code in zip(g["tick"], g["code"]):
            if code != prev:
                trans.append([int(tick), int(code)])
                prev = code
        result[int(agent_id)] = trans
    return result


def build_pathogen_samples(disease_df, start_time, cadence_sec=86400):
    """Return {agent_id: [[tick, level], ...]}, one sample per cadence bin."""
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    df = disease_df[disease_df["pathogen_level"] > 0].copy()
    if df.empty:
        return {}
    df["tick"] = time_to_tick(df["time"], start_time)
    df["bin"] = (df["tick"] // bin_ticks).astype(int)
    df = df.sort_values(["agent_id", "tick"], kind="stable")
    df = df.groupby(["agent_id", "bin"], as_index=False).first()

    result = {}
    for agent_id, g in df.groupby("agent_id"):
        result[int(agent_id)] = [
            [int(t), float(p)] for t, p in zip(g["tick"], g["pathogen_level"])
        ]
    return result


def build_transmissions(disease_df, start_time):
    """Return [[tick, source_agent_id, target_agent_id], ...].

    One per agent that entered Exposed with a known source; tick comes from the
    first Exposed snapshot's `time` (exposed_started_time is mostly null).
    """
    df = disease_df[
        (disease_df["disease_status"] == "Exposed")
        & (disease_df["source_agent_id"] != -1)
    ].copy()
    if df.empty:
        return []
    df["tick"] = time_to_tick(df["time"], start_time)
    df = df.sort_values("tick", kind="stable").groupby("agent_id", as_index=False).first()
    df = df.sort_values("tick", kind="stable")
    return [
        [int(t), int(src), int(aid)]
        for t, src, aid in zip(df["tick"], df["source_agent_id"], df["agent_id"])
    ]


def build_disease(disease_df, start_time):
    """Assemble the full disease.json structure."""
    transitions = build_transitions(disease_df, start_time)
    samples = build_pathogen_samples(disease_df, start_time)
    transmissions = build_transmissions(disease_df, start_time)
    agents = [
        {
            "agentId": aid,
            "transitions": transitions[aid],
            "pathogenSamples": samples.get(aid, []),
        }
        for aid in sorted(transitions)
    ]
    return {
        "stateCodes": {"S": 0, "E": 1, "I": 2, "R": 3},
        "agents": agents,
        "transmissions": transmissions,
    }
