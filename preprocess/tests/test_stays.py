# preprocess/tests/test_stays.py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.stays import build_stays
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 23:55:00")   # 288 ticks


def _write_checkin(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "CheckoutTime", "venue_id", "venue_type",
        "latitude", "longitude",
    ])
    df["time"] = pd.to_datetime(df["time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Checkin.parquet")


def test_dwell_is_the_checkout_minus_checkin_in_ticks(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, index = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    assert arrays["stays_tick.u16"].tolist() == [0]
    assert arrays["stays_dwell.u16"].tolist() == [12]        # 60 min / 5 min
    assert arrays["stays_venue.u16"].tolist() == [0]
    assert index == [{"agentId": 0, "offset": 0, "count": 1}]


def test_records_are_sorted_by_agent_then_tick_with_matching_index(tmp_path):
    _write_checkin(tmp_path, [
        (1, "2024-01-01 02:00:00", "2024-01-01 02:30:00", 7, "Pub", 32.7, -117.1),
        (0, "2024-01-01 01:00:00", "2024-01-01 01:30:00", 5, "Apartment", 32.8, -117.2),
        (0, "2024-01-01 00:00:00", "2024-01-01 00:30:00", 7, "Pub", 32.7, -117.1),
    ])
    arrays, index = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0, 7: 1}, batch_size=2)
    assert arrays["stays_tick.u16"].tolist() == [0, 12, 24]
    assert arrays["stays_venue.u16"].tolist() == [1, 0, 1]
    assert index == [
        {"agentId": 0, "offset": 0, "count": 2},
        {"agentId": 1, "offset": 2, "count": 1},
    ]


def test_stay_running_past_the_window_end_is_clipped(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 23:00:00", "2024-01-03 00:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, _ = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    # check-in at tick 276; window's last tick is 287, so dwell clips to 12.
    assert arrays["stays_tick.u16"].tolist() == [276]
    assert arrays["stays_dwell.u16"].tolist() == [12]


def test_stays_outside_the_window_are_dropped_and_agents_may_vanish(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-02-01 00:00:00", "2024-02-01 01:00:00", 5, "Apartment", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, index = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    assert [e["agentId"] for e in index] == [1]
    assert len(arrays["stays_tick.u16"]) == 1


def test_dwell_is_at_least_one_tick(tmp_path):
    # A checkout in the same tick as the check-in must still occupy the venue.
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:02:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, _ = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    assert arrays["stays_dwell.u16"].tolist() == [1]


def test_unknown_venue_id_raises(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 999, "Pub", 32.7, -117.1),
    ])
    with pytest.raises(ValueError, match="999"):
        build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})


def test_missing_checkout_column_raises(tmp_path):
    from poop_simcity_preprocess.profiles import DATASET_00
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    with pytest.raises(ValueError, match="check-out"):
        build_stays(str(tmp_path), DATASET_00, WINDOW, {5: 0})
