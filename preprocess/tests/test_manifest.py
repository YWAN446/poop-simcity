import pandas as pd
from poop_simcity_preprocess.manifest import build_manifest


def test_manifest_fields():
    start = pd.Timestamp("2024-01-01 00:05:00")
    end = pd.Timestamp("2024-01-01 01:05:00")  # 12 ticks later
    m = build_manifest(
        run_id="dataset_00",
        start_time=start,
        end_time=end,
        num_agents=1000,
        bbox=[-84.78, 33.51, -84.16, 34.19],
        outbreak_window=(0, 12),
    )
    assert m["schemaVersion"] == 1
    assert m["runId"] == "dataset_00"
    assert m["tickIntervalSec"] == 300
    assert m["numTicks"] == 13           # ticks 0..12 inclusive
    assert m["numAgents"] == 1000
    assert m["outbreakWindow"] == {"startTick": 0, "endTick": 12}
    assert m["venueTypes"] == ["Apartment", "Workplace", "Restaurant", "Pub"]
    assert m["artifacts"]["agents"] == "agents.bin"
    assert m["artifacts"]["agentsIndex"] == "agents_index.json"
