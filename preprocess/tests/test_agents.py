import numpy as np
import pandas as pd
from poop_simcity_preprocess.agents import build_agent_tracks
from poop_simcity_preprocess.encoding import AGENT_WAYPOINT_DTYPE


def _check_in(rows):
    return pd.DataFrame(
        rows,
        columns=["agent_id", "time", "venue_id", "venue_type", "latitude", "longitude"],
    ).assign(time=lambda d: pd.to_datetime(d["time"]))


def test_tracks_are_sorted_and_indexed():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _check_in([
        (2, "2024-01-01 00:10:00", 10, "Pub", 33.7, -84.4),
        (1, "2024-01-01 00:10:00", 11, "Workplace", 33.8, -84.3),
        (1, "2024-01-01 00:05:00", 12, "Apartment", 33.9, -84.2),
    ])
    raw, index = build_agent_tracks(df, start)
    arr = np.frombuffer(raw, dtype=AGENT_WAYPOINT_DTYPE)

    # Index covers both agents, in ascending agent_id order.
    assert [e["agentId"] for e in index] == [1, 2]
    a1 = next(e for e in index if e["agentId"] == 1)
    assert a1["offset"] == 0 and a1["count"] == 2

    # Agent 1's first waypoint is the earlier (Apartment) one.
    first = arr[a1["offset"]]
    assert first["tick"] == 0
    assert first["vtype"] == 0  # Apartment
    second = arr[a1["offset"] + 1]
    assert second["tick"] == 1
    assert second["vtype"] == 1  # Workplace

    a2 = next(e for e in index if e["agentId"] == 2)
    assert a2["offset"] == 2 and a2["count"] == 1
    assert arr[a2["offset"]]["vtype"] == 3  # Pub
