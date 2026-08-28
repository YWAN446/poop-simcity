import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import shapefile

from poop_simcity_preprocess.aggregates_v2 import pathogen_inflow_hourly
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.sewersheds import load_sewersheds
from poop_simcity_preprocess.sewershed_series import sewershed_pathogen_hourly
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 02:55:00")  # 36 ticks, 3 bins


def _square(x0, y0, x1, y1):
    return [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]


def _sheds(tmp_path):
    d = tmp_path / "sheds"
    d.mkdir()
    boxes = {"encina": (0, 0, 1, 1), "point_loma": (2, 2, 3, 3), "south_bay": (4, 4, 5, 5)}
    for name, (x0, y0, x1, y1) in boxes.items():
        w = shapefile.Writer(str(d / f"{name}_sewershed"), shapeType=shapefile.POLYGON)
        w.field("ZCTA5CE20", "C")
        w.poly([_square(x0, y0, x1, y1)])
        w.record("00000")
        w.close()
    return load_sewersheds(str(d))


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def _row(t, lat, lon, pathogen):
    return (0, t, lat, lon, "Apartment", pathogen, "Infectious", None)


def test_events_land_in_the_right_shed_and_bin(tmp_path):
    _write_poops(tmp_path, [
        _row("2024-01-01 00:10:00", 0.5, 0.5, 4.0),    # encina,     bin 0
        _row("2024-01-01 01:10:00", 2.5, 2.5, 7.0),    # point_loma, bin 1
        _row("2024-01-01 02:10:00", 4.5, 4.5, 9.0),    # south_bay,  bin 2
        _row("2024-01-01 00:20:00", 9.9, 9.9, 3.0),    # outside,    bin 0
    ])
    m = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, _sheds(tmp_path))
    assert m.shape == (4, 3)
    np.testing.assert_allclose(m[0], [4.0, 0.0, 0.0])
    np.testing.assert_allclose(m[1], [0.0, 7.0, 0.0])
    np.testing.assert_allclose(m[2], [0.0, 0.0, 9.0])
    np.testing.assert_allclose(m[3], [3.0, 0.0, 0.0])   # Outside is the last row


def test_rows_sum_to_the_global_inflow_series(tmp_path):
    """The load-bearing invariant: the per-shed partition is exhaustive and
    disjoint, so it must reconstruct the series the bundle already ships."""
    _write_poops(tmp_path, [
        _row("2024-01-01 00:10:00", 0.5, 0.5, 4.0),
        _row("2024-01-01 00:40:00", 2.5, 2.5, 6.0),
        _row("2024-01-01 01:10:00", 9.9, 9.9, 2.5),
        _row("2024-01-01 02:50:00", 4.5, 4.5, 1.25),
        _row("2024-01-01 01:30:00", 0.5, 0.5, 0.0),     # clean event still binned
    ])
    m = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, _sheds(tmp_path))
    global_series = pathogen_inflow_hourly(str(tmp_path), SDC_10K, WINDOW)
    np.testing.assert_allclose(m.sum(axis=0), global_series, rtol=1e-9)


def test_out_of_window_events_are_excluded(tmp_path):
    _write_poops(tmp_path, [
        _row("2024-01-01 00:10:00", 0.5, 0.5, 4.0),
        _row("2024-02-01 00:10:00", 0.5, 0.5, 99.0),
    ])
    m = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, _sheds(tmp_path))
    assert m.sum() == pytest.approx(4.0)


def test_batch_boundaries_do_not_change_the_result(tmp_path):
    rows = [_row(f"2024-01-01 0{i//6}:{(i%6)*10:02d}:00", 0.5, 0.5, 1.0) for i in range(18)]
    _write_poops(tmp_path, rows)
    sheds = _sheds(tmp_path)
    big = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, sheds, batch_size=1000)
    small = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, sheds, batch_size=3)
    np.testing.assert_allclose(big, small)
