import json
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.build import build_bundle
from poop_simcity_preprocess.encoding import AGENT_WAYPOINT_DTYPE, POOP_EVENT_DTYPE


def _write_synthetic(dataset_dir):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    check_in = pd.DataFrame({
        "agent_id": [0, 0, 1],
        "time": pd.to_datetime(["2024-01-01 00:05:00", "2024-01-01 01:05:00",
                                "2024-01-01 00:05:00"]),
        "venue_id": [10, 11, 12],
        "venue_type": ["Apartment", "Workplace", "Pub"],
        "latitude": [33.70, 33.71, 33.72],
        "longitude": [-84.40, -84.39, -84.38],
    })
    disease = pd.DataFrame({
        "time": pd.to_datetime(["2024-01-01 00:05:00", "2024-01-01 01:05:00",
                                "2024-01-01 00:05:00"]),
        "agent_id": [0, 0, 1],
        "exposed_started_time": pd.to_datetime([None, None, None]),
        "infectious_started_time": pd.to_datetime([None, None, None]),
        "pathogen_level": [0.0, 8.0, 0.0],
        "disease_status": ["Susceptible", "Infectious", "Susceptible"],
        "source_agent_id": [-1, -1, -1],
        "latitude": [33.70, 33.71, 33.72],
        "longitude": [-84.40, -84.39, -84.38],
    })
    poops = pd.DataFrame({
        "agent_id": [0, 1],
        "time": pd.to_datetime(["2024-01-01 01:10:00", "2024-01-01 00:10:00"]),
        "latitude": [33.71, 33.72],
        "longitude": [-84.39, -84.38],
        "venue_type": ["Workplace", "Pub"],
        "pathogen_level": [100.0, 0.0],
        "disease_status": ["Infectious", "Susceptible"],
        "infectious_started_time": pd.to_datetime([None, None]),
    })
    social = pd.DataFrame({"time": pd.to_datetime(["2024-01-01"]), "from": [0], "to": [1]})
    for name, df in [("check_in", check_in), ("disease_status", disease),
                     ("poop_in", poops), ("social_links", social)]:
        pq.write_table(pa.Table.from_pandas(df), dataset_dir / f"{name}.parquet")


def test_build_bundle_writes_consistent_artifacts(tmp_path):
    dataset_dir = tmp_path / "dataset_00"
    out_dir = tmp_path / "bundle"
    _write_synthetic(dataset_dir)

    build_bundle(str(dataset_dir), str(out_dir), run_id="dataset_00")

    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["numAgents"] == 2
    assert manifest["schemaVersion"] == 1

    index = json.loads((out_dir / "agents_index.json").read_text())
    agents_bin = np.frombuffer((out_dir / "agents.bin").read_bytes(),
                               dtype=AGENT_WAYPOINT_DTYPE)
    assert sum(e["count"] for e in index) == len(agents_bin) == 3

    poops_bin = np.frombuffer((out_dir / "poops.bin").read_bytes(),
                              dtype=POOP_EVENT_DTYPE)
    assert len(poops_bin) == 2
    assert (poops_bin["infected"] == 1).sum() == 1

    disease = json.loads((out_dir / "disease.json").read_text())
    agent0 = next(a for a in disease["agents"] if a["agentId"] == 0)
    assert agent0["transitions"][0] == [0, 0]      # starts Susceptible

    agg = json.loads((out_dir / "aggregates.json").read_text())
    assert agg["seir"]["I"][-1] == 1               # agent 0 infectious by last hour

    ww = json.loads((out_dir / "wastewater.json").read_text())
    assert ww["kind"] == "grid"
    assert len(ww["regions"]) >= 1
