"""Build per-agent movement tracks from check-in events."""

import numpy as np

from .constants import VENUE_TYPE_TO_ID
from .encoding import AGENT_WAYPOINT_DTYPE, records_to_bytes
from .timeutil import time_to_tick


def build_agent_tracks(check_in_df, start_time):
    """Return (bytes, index) for agent waypoints.

    bytes: AGENT_WAYPOINT_DTYPE records sorted by (agent_id, tick).
    index: list of {"agentId", "offset", "count"} in record units.
    """
    df = check_in_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["vtype"] = df["venue_type"].map(VENUE_TYPE_TO_ID).astype("uint8")
    df = df.sort_values(["agent_id", "tick"], kind="stable").reset_index(drop=True)

    arr = np.zeros(len(df), dtype=AGENT_WAYPOINT_DTYPE)
    arr["tick"] = df["tick"].to_numpy()
    arr["lon"] = df["longitude"].to_numpy()
    arr["lat"] = df["latitude"].to_numpy()
    arr["vtype"] = df["vtype"].to_numpy()

    index = []
    offset = 0
    for agent_id, count in df.groupby("agent_id").size().items():
        index.append({"agentId": int(agent_id), "offset": offset, "count": int(count)})
        offset += int(count)

    return records_to_bytes(arr), index
