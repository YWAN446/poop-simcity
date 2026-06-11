import pandas as pd
from poop_simcity_preprocess.disease import (
    build_transitions,
    build_transmissions,
    build_disease,
)


def _disease(rows):
    cols = ["time", "agent_id", "exposed_started_time", "infectious_started_time",
            "pathogen_level", "disease_status", "source_agent_id",
            "latitude", "longitude"]
    df = pd.DataFrame(rows, columns=cols)
    df["time"] = pd.to_datetime(df["time"])
    df["exposed_started_time"] = pd.to_datetime(df["exposed_started_time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    return df


def test_transitions_collapse_repeated_status():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _disease([
        ("2024-01-01 00:05:00", 7, None, None, 0.0, "Susceptible", -1, 33.7, -84.4),
        ("2024-01-01 02:05:00", 7, None, None, 0.0, "Susceptible", -1, 33.7, -84.4),
        ("2024-01-01 04:05:00", 7, None, None, 0.0, "Exposed", 3, 33.7, -84.4),
        ("2024-01-01 06:05:00", 7, None, None, 5.0, "Infectious", 3, 33.7, -84.4),
    ])
    trans = build_transitions(df, start)
    # Only the *changes* are recorded: S at tick 0, E at tick 48, I at tick 72.
    assert trans[7] == [[0, 0], [48, 1], [72, 2]]


def test_transmissions_use_first_exposed_snapshot_time():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _disease([
        ("2024-01-01 04:05:00", 7, None, None, 0.0, "Exposed", 3, 33.7, -84.4),
        ("2024-01-01 06:05:00", 7, None, None, 0.0, "Exposed", 3, 33.7, -84.4),
        ("2024-01-01 02:05:00", 9, None, None, 0.0, "Infectious", -1, 33.7, -84.4),
    ])
    out = build_transmissions(df, start)
    # Agent 7 exposed by source 3 at tick 48; agent 9 has no source (-1).
    assert out == [[48, 3, 7]]


def test_build_disease_assembles_agents_and_codes():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _disease([
        ("2024-01-01 00:05:00", 7, None, None, 0.0, "Susceptible", -1, 33.7, -84.4),
        ("2024-01-01 04:05:00", 7, None, None, 9.0, "Infectious", 3, 33.7, -84.4),
    ])
    out = build_disease(df, start)
    assert out["stateCodes"] == {"S": 0, "E": 1, "I": 2, "R": 3}
    agent = next(a for a in out["agents"] if a["agentId"] == 7)
    assert agent["transitions"] == [[0, 0], [48, 2]]
    assert agent["pathogenSamples"] == [[48, 9.0]]
