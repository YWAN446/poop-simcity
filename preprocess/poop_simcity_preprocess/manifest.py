"""Assemble manifest.json describing the bundle."""

import pandas as pd

from .constants import TICK_INTERVAL_SEC, VENUE_TYPES
from .timeutil import time_to_tick

ARTIFACTS = {
    "agents": "agents.bin",
    "agentsIndex": "agents_index.json",
    "disease": "disease.json",
    "poops": "poops.bin",
    "aggregates": "aggregates.json",
    "wastewater": "wastewater.json",
}


def build_manifest(run_id, start_time, end_time, num_agents, bbox, outbreak_window):
    start = pd.Timestamp(start_time)
    end = pd.Timestamp(end_time)
    return {
        "schemaVersion": 1,
        "runId": run_id,
        "tickIntervalSec": TICK_INTERVAL_SEC,
        "startTime": start.isoformat(),
        "endTime": end.isoformat(),
        "numTicks": int(time_to_tick(end, start)) + 1,
        "numAgents": int(num_agents),
        "bbox": [float(x) for x in bbox],
        "outbreakWindow": {
            "startTick": int(outbreak_window[0]),
            "endTick": int(outbreak_window[1]),
        },
        "venueTypes": list(VENUE_TYPES),
        "artifacts": dict(ARTIFACTS),
    }
