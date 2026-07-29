import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.poop_stream import (
    build_poop_stream, dequantize, quantize,
)
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 23:55:00")
BBOX = [-118.0, 32.0, -116.0, 34.0]


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def test_quantize_round_trips_within_one_step():
    lo, hi = -118.0, -116.0
    vals = np.array([-118.0, -117.3, -116.0])
    back = dequantize(quantize(vals, lo, hi), lo, hi)
    np.testing.assert_allclose(back, vals, atol=(hi - lo) / 65535)


def test_quantize_pins_the_endpoints():
    q = quantize(np.array([-118.0, -116.0]), -118.0, -116.0)
    assert q.tolist() == [0, 65535]


def _row(agent, time, pathogen):
    return (agent, time, 32.5, -117.0, "Apartment", pathogen,
            "Infectious" if pathogen else "Susceptible", None)


def test_stream_is_sorted_by_tick(tmp_path):
    _write_poops(tmp_path, [
        _row(0, "2024-01-01 02:00:00", 0.0),
        _row(1, "2024-01-01 00:00:00", 5.0),
    ])
    a = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, clean_keep_fraction=1.0)
    assert a["poops_tick.u16"].tolist() == [0, 24]
    np.testing.assert_allclose(a["poops_pathogen.f32"], [5.0, 0.0])


def test_out_of_window_events_are_dropped(tmp_path):
    _write_poops(tmp_path, [
        _row(0, "2024-01-01 00:00:00", 1.0),
        _row(0, "2024-02-01 00:00:00", 1.0),
    ])
    a = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, clean_keep_fraction=1.0)
    assert len(a["poops_tick.u16"]) == 1


def test_downsampling_keeps_every_infected_event_and_thins_clean_ones(tmp_path):
    rows = [_row(a, "2024-01-01 00:00:00", 0.0) for a in range(10)]
    rows += [_row(a, "2024-01-01 00:05:00", 3.0) for a in range(10)]
    _write_poops(tmp_path, rows)
    a = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, clean_keep_fraction=0.5)
    pathogen = a["poops_pathogen.f32"]
    assert (pathogen > 0).sum() == 10          # every infected event survives
    assert (pathogen == 0).sum() == 5          # agents 0,2,4,6,8 (id % 2 == 0)


def test_downsampling_is_deterministic(tmp_path):
    rows = [_row(a, "2024-01-01 00:00:00", 0.0) for a in range(20)]
    _write_poops(tmp_path, rows)
    first = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.25)
    second = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.25)
    np.testing.assert_array_equal(first["poops_lon.u16"], second["poops_lon.u16"])
    assert len(first["poops_tick.u16"]) == 5
