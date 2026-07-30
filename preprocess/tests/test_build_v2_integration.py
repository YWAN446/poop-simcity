import json

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from poop_simcity_preprocess.build_v2 import build_bundle_v2
from poop_simcity_preprocess.profiles import SDC_10K

WINDOW_START = "2024-01-01 00:00:00"
WINDOW_END = "2024-01-02 23:55:00"


def _write_synthetic(dataset_dir):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    checkin = pd.DataFrame({
        "agent_id": [0, 0, 1],
        "time": pd.to_datetime(["2024-01-01 00:00:00", "2024-01-01 06:00:00",
                                "2024-01-01 00:00:00"]),
        "CheckoutTime": ["2024-01-01T05:00:00", "2024-01-01T12:00:00",
                         "2024-01-01T08:00:00"],
        "venue_id": [10, 11, 11],
        "venue_type": ["Apartment", "Workplace", "Workplace"],
        "latitude": [32.70, 32.75, 32.75],
        "longitude": [-117.20, -117.10, -117.10],
    })
    disease = pd.DataFrame({
        "time": pd.to_datetime(["2024-01-01 00:00:00", "2024-01-02 00:00:00",
                                "2024-01-01 00:00:00"]),
        "agent_id": [0, 0, 1],
        "exposed_started_time": pd.to_datetime(
            [None, "2024-01-01 09:00:00", None]),
        "infectious_started_time": pd.to_datetime([None, None, None]),
        "pathogen_level": [0.0, 12.0, 0.0],
        "disease_status": ["Susceptible", "Exposed", "Susceptible"],
        "SourceAgentId": [-1, 1, -1],
        "latitude": [32.70, 32.75, 32.75],
        "longitude": [-117.20, -117.10, -117.10],
    })
    poops = pd.DataFrame({
        "agent_id": [0, 1],
        "time": pd.to_datetime(["2024-01-01 10:00:00", "2024-01-01 02:00:00"]),
        "latitude": [32.75, 32.70],
        "longitude": [-117.10, -117.20],
        "venue_type": ["Workplace", "Apartment"],
        "pathogen_level": [50.0, 0.0],
        "disease_status": ["Exposed", "Susceptible"],
        "infectious_started_time": pd.to_datetime([None, None]),
    })
    for name, df in [("Checkin", checkin), ("DiseasesStatus", disease),
                     ("Poopin", poops)]:
        pq.write_table(pa.Table.from_pandas(df), dataset_dir / f"{name}.parquet")


def test_build_v2_writes_a_self_consistent_bundle(tmp_path):
    dataset_dir = tmp_path / "src"
    out_dir = tmp_path / "bundle"
    _write_synthetic(dataset_dir)

    manifest = build_bundle_v2(
        str(dataset_dir), str(out_dir), run_id="test-run",
        window_start=WINDOW_START, window_end=WINDOW_END, profile=SDC_10K,
        clean_keep_fraction=1.0,
    )

    assert manifest["schemaVersion"] == 2
    assert manifest["numTicks"] == 576              # 2 days
    assert manifest["numAgents"] == 2
    assert manifest["numVenues"] == 2
    assert manifest["coverage"]["cleanPoopKeepFraction"] == 1.0
    assert manifest["coverage"]["recoveryTimeResolution"] == "daily"

    on_disk = json.loads((out_dir / "manifest.json").read_text())
    assert on_disk == manifest

    # Every declared artifact exists.
    for name in manifest["artifacts"].values():
        assert (out_dir / name).exists(), name

    # Stays: 3 records, index sums to 3, venue indices in range.
    tick = np.frombuffer((out_dir / "stays_tick.u16").read_bytes(), dtype="<u2")
    dwell = np.frombuffer((out_dir / "stays_dwell.u16").read_bytes(), dtype="<u2")
    venue = np.frombuffer((out_dir / "stays_venue.u16").read_bytes(), dtype="<u2")
    assert len(tick) == len(dwell) == len(venue) == 3
    assert venue.max() < manifest["numVenues"]
    index = json.loads((out_dir / "stays_index.json").read_text())
    assert sum(e["count"] for e in index) == 3

    # Agent 0's first stay: tick 0, dwell 60 ticks (00:00 -> 05:00).
    a0 = next(e for e in index if e["agentId"] == 0)
    assert tick[a0["offset"]] == 0
    assert dwell[a0["offset"]] == 60

    # Venue table is index-aligned with venue ids ascending.
    vid = np.frombuffer((out_dir / "venues_id.i32").read_bytes(), dtype="<i4")
    assert vid.tolist() == [10, 11]

    # Poops sorted by tick, both kept at keep_fraction 1.0.
    ptick = np.frombuffer((out_dir / "poops_tick.u16").read_bytes(), dtype="<u2")
    assert ptick.tolist() == sorted(ptick.tolist())
    assert len(ptick) == 2

    # Wastewater matrix shape matches the regions sidecar.
    regions = json.loads((out_dir / "wastewater_regions.json").read_text())
    values = np.frombuffer((out_dir / "wastewater.bin").read_bytes(), dtype="<f4")
    assert len(values) == len(regions["regions"]) * regions["numBins"]

    # Aggregates cover the window at hourly cadence.
    agg = json.loads((out_dir / "aggregates.json").read_text())
    assert len(agg["gridTicks"]) == 48
    assert len(agg["pathogenInflow"]) == 48
    assert all(len(agg["seir"][k]) == 48 for k in "SEIR")

    # Every bin's SEIR counts sum to numAgents - the invariant that a
    # stays/disease agent-id mismatch would silently break (negative S).
    for i in range(48):
        assert sum(agg["seir"][k][i] for k in "SEIR") == manifest["numAgents"]


def test_downsampling_does_not_change_aggregates_or_wastewater(tmp_path):
    dataset_dir = tmp_path / "src"
    _write_synthetic(dataset_dir)

    full = tmp_path / "full"
    thin = tmp_path / "thin"
    for out, keep in [(full, 1.0), (thin, 0.01)]:
        build_bundle_v2(str(dataset_dir), str(out), run_id="r",
                        window_start=WINDOW_START, window_end=WINDOW_END,
                        profile=SDC_10K, clean_keep_fraction=keep)

    assert (json.loads((full / "aggregates.json").read_text())["pathogenInflow"]
            == json.loads((thin / "aggregates.json").read_text())["pathogenInflow"])
    assert ((full / "wastewater.bin").read_bytes()
            == (thin / "wastewater.bin").read_bytes())
    # The render stream, however, did shrink.
    assert len((thin / "poops_tick.u16").read_bytes()) \
        < len((full / "poops_tick.u16").read_bytes())


def test_window_too_wide_for_uint16_raises(tmp_path):
    dataset_dir = tmp_path / "src"
    _write_synthetic(dataset_dir)
    with pytest.raises(ValueError, match="uint16"):
        build_bundle_v2(str(dataset_dir), str(tmp_path / "out"), run_id="r",
                        window_start="2024-01-01 00:00:00",
                        window_end="2024-12-31 23:55:00", profile=SDC_10K)


def test_agent_with_in_window_disease_but_no_in_window_stay_raises(tmp_path):
    # Agent 7's only check-in predates the window (so it has no in-window
    # stay), but its DiseasesStatus row falls inside the window and carries
    # an exposed_started_time - stays.py and disease_v2.py mask against the
    # window independently on different tables, so nothing else catches this
    # disagreement. Without the guard, seir_hourly's `num_agents -
    # len(transitions)` would go negative for this agent's population.
    dataset_dir = tmp_path / "src"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    checkin = pd.DataFrame({
        "agent_id": [7],
        "time": pd.to_datetime(["2023-12-31 00:00:00"]),   # before the window
        "CheckoutTime": ["2023-12-31T23:00:00"],
        "venue_id": [10],
        "venue_type": ["Apartment"],
        "latitude": [32.70],
        "longitude": [-117.20],
    })
    disease = pd.DataFrame({
        "time": pd.to_datetime(["2024-01-01 00:00:00"]),   # inside the window
        "agent_id": [7],
        "exposed_started_time": pd.to_datetime(["2024-01-01 00:00:00"]),
        "infectious_started_time": pd.to_datetime([None]),
        "pathogen_level": [5.0],
        "disease_status": ["Exposed"],
        "SourceAgentId": [-1],
        "latitude": [32.70],
        "longitude": [-117.20],
    })
    poops = pd.DataFrame({
        "agent_id": [7],
        "time": pd.to_datetime(["2024-01-01 01:00:00"]),
        "latitude": [32.70],
        "longitude": [-117.20],
        "venue_type": ["Apartment"],
        "pathogen_level": [0.0],
        "disease_status": ["Susceptible"],
        "infectious_started_time": pd.to_datetime([None]),
    })
    for name, df in [("Checkin", checkin), ("DiseasesStatus", disease),
                     ("Poopin", poops)]:
        pq.write_table(pa.Table.from_pandas(df), dataset_dir / f"{name}.parquet")

    with pytest.raises(ValueError, match=r"\b7\b"):
        build_bundle_v2(str(dataset_dir), str(tmp_path / "out"), run_id="r",
                        window_start=WINDOW_START, window_end=WINDOW_END,
                        profile=SDC_10K)
