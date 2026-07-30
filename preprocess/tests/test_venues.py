import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.venues import (
    build_venue_table, venue_arrays, venue_index_map,
)


def _write_checkin(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "CheckoutTime", "venue_id", "venue_type",
        "latitude", "longitude",
    ])
    df["time"] = pd.to_datetime(df["time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Checkin.parquet")


def test_venue_table_is_deduped_and_sorted_by_venue_id(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 7, "Pub", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 3, "Apartment", 32.8, -117.2),
        (0, "2024-01-01 00:15:00", "2024-01-01 00:20:00", 7, "Pub", 32.7, -117.1),
    ])
    v = build_venue_table(str(tmp_path), SDC_10K, batch_size=2)
    assert v["venue_id"].tolist() == [3, 7]
    assert v["venue_type"].tolist() == ["Apartment", "Pub"]
    assert list(v.index) == [0, 1]


def test_venue_index_map_points_at_row_positions(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 7, "Pub", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 3, "Apartment", 32.8, -117.2),
    ])
    v = build_venue_table(str(tmp_path), SDC_10K)
    assert venue_index_map(v) == {3: 0, 7: 1}


def test_venue_arrays_have_the_expected_dtypes_and_order(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 7, "Pub", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 3, "Apartment", 32.8, -117.2),
    ])
    a = venue_arrays(build_venue_table(str(tmp_path), SDC_10K))
    assert a["venues_id.i32"].dtype == np.int32
    assert a["venues_id.i32"].tolist() == [3, 7]
    assert a["venues_type.u8"].tolist() == [0, 3]        # Apartment=0, Pub=3
    assert a["venues_lon.f32"].dtype == np.float32
    np.testing.assert_allclose(a["venues_lat.f32"], [32.8, 32.7], rtol=1e-6)


def test_venue_arrays_raises_on_unmapped_venue_type():
    """venue_arrays must reject unmapped venue types to prevent silent data corruption.

    .map() + .to_numpy(dtype=uint8) silently converts NaN -> 0 (Apartment), masking
    the error if an unknown venue_type is encountered.
    """
    venues = pd.DataFrame({
        "venue_id": [1, 2, 3],
        "venue_type": ["Apartment", "UnknownType", "Pub"],
        "latitude": [32.8, 32.9, 32.7],
        "longitude": [-117.2, -117.3, -117.1],
    })
    with np.testing.assert_raises(ValueError) as cm:
        venue_arrays(venues)
    assert "UnknownType" in str(cm.exception)
