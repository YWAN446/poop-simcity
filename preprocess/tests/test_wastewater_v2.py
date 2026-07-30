import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.constants import TICK_INTERVAL_SEC
from poop_simcity_preprocess.poop_stream import iter_poop_batches
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.wastewater_v2 import build_wastewater_v2
from poop_simcity_preprocess.window import make_window, ticks_of

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 02:55:00")   # 3 hourly bins
BBOX = [-117.10, 32.50, -117.00, 32.60]


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def test_only_pathogen_bearing_events_populate_cells(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.51, -117.09, "Apartment", 4.0, "Infectious", None),
        (1, "2024-01-01 00:20:00", 32.55, -117.05, "Apartment", 0.0, "Susceptible", None),
    ])
    matrix, regions = build_wastewater_v2(str(tmp_path), SDC_10K, WINDOW, BBOX,
                                          cell_size_deg=0.02)
    assert len(regions["regions"]) == 1
    assert matrix.shape == (1, 3)
    assert matrix.dtype == np.float32
    np.testing.assert_allclose(matrix[0], [4.0, 0.0, 0.0])


def test_events_in_the_same_cell_and_bin_are_summed(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.51, -117.09, "Apartment", 4.0, "Infectious", None),
        (1, "2024-01-01 00:40:00", 32.515, -117.095, "Apartment", 6.0, "Infectious", None),
    ])
    matrix, regions = build_wastewater_v2(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.02)
    assert len(regions["regions"]) == 1
    np.testing.assert_allclose(matrix[0], [10.0, 0.0, 0.0])


def test_regions_carry_geometry_and_ids_in_matrix_row_order(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.51, -117.09, "Apartment", 4.0, "Infectious", None),
        (1, "2024-01-01 01:10:00", 32.59, -117.01, "Apartment", 9.0, "Infectious", None),
    ])
    matrix, regions = build_wastewater_v2(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.02)
    assert regions["kind"] == "grid"
    assert regions["numBins"] == 3
    ids = [r["id"] for r in regions["regions"]]
    assert ids == sorted(ids)
    assert len(regions["regions"][0]["polygon"]) == 4
    assert matrix.shape == (2, 3)
    np.testing.assert_allclose(matrix[:, 1].sum(), 9.0)


# --- Equivalence test guarding the build_wastewater_v2 vectorization --------
#
# build_wastewater_v2 replaces a per-row dict-lookup loop (one iteration per
# pathogen-bearing event) with a per-batch `groupby(["ix","iy","bin"]).sum()`
# reduction, applying only the aggregated sums to the accumulator. This test
# compares that against a straightforward per-row reference (the same
# dict-of-arrays approach used before vectorization) over a fixture that
# exercises: multiple cells, multiple bins, several events landing in the
# same cell+bin, a clean (pathogen_level == 0) event that must be excluded,
# and - by calling build_wastewater_v2 with batch_size=1 - events whose
# same-cell-bin duplicates are forced into separate streaming batches, so the
# per-batch aggregation must still combine correctly across batch boundaries.
def _reference_wastewater(dataset_dir, profile, window, bbox, cell_size_deg,
                          cadence_sec=3600):
    min_lon, min_lat, max_lon, max_lat = bbox
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    num_bins = (window.num_ticks + bin_ticks - 1) // bin_ticks

    cells = {}
    columns = ["time", "latitude", "longitude", "pathogen_level"]
    for df in iter_poop_batches(dataset_dir, profile, window, columns,
                                batch_size=2_000_000):
        df = df[df["pathogen_level"] > 0]
        if df.empty:
            continue
        ix = ((df["longitude"].to_numpy() - min_lon) // cell_size_deg).astype("int64")
        iy = ((df["latitude"].to_numpy() - min_lat) // cell_size_deg).astype("int64")
        bins = ticks_of(df["time"], window) // bin_ticks
        levels = df["pathogen_level"].to_numpy(dtype="float64")
        for x, y, b, v in zip(ix, iy, bins, levels):
            key = (int(x), int(y))
            row = cells.get(key)
            if row is None:
                row = np.zeros(num_bins, dtype="float64")
                cells[key] = row
            row[int(b)] += v

    keys = sorted(cells)
    matrix = np.zeros((len(keys), num_bins), dtype="float64")
    for i, key in enumerate(keys):
        matrix[i] = cells[key]
    return matrix, keys


def test_build_wastewater_v2_matches_reference_across_batch_boundaries(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:05:00", 32.51, -117.09, "Apartment", 4.0, "Infectious", None),  # cell (0,0) bin0
        (1, "2024-01-01 00:10:00", 32.515, -117.095, "Apartment", 6.0, "Infectious", None),  # cell (0,0) bin0
        (2, "2024-01-01 00:20:00", 32.55, -117.05, "Apartment", 0.0, "Susceptible", None),  # clean, excluded
        (3, "2024-01-01 01:05:00", 32.51, -117.09, "Apartment", 3.0, "Infectious", None),  # cell (0,0) bin1
        (4, "2024-01-01 01:10:00", 32.59, -117.01, "Apartment", 9.0, "Infectious", None),  # cell (4,4) bin1
        (5, "2024-01-01 02:00:00", 32.59, -117.01, "Apartment", 2.0, "Infectious", None),  # cell (4,4) bin2
        (6, "2024-01-01 02:05:00", 32.59, -117.01, "Apartment", 5.0, "Infectious", None),  # cell (4,4) bin2
        (7, "2024-01-01 02:10:00", 32.53, -117.03, "Apartment", 7.0, "Infectious", None),  # cell (3,1) bin2
    ])

    ref_matrix, ref_keys = _reference_wastewater(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.02)

    # batch_size=3 splits the 8 rows into batches of (0,1,2), (3,4,5), (6,7).
    # Rows 0/1 (same cell+bin) land in the same batch, exercising the
    # intra-batch groupby(...).sum() reduction; rows 5/6 (same cell+bin) are
    # split across the batch 1/2 boundary, exercising cross-batch summation
    # into the accumulator. Together they cover both duplicate-handling paths
    # in one run.
    matrix, regions = build_wastewater_v2(str(tmp_path), SDC_10K, WINDOW, BBOX,
                                          cell_size_deg=0.02, batch_size=3)

    ids = [r["id"] for r in regions["regions"]]
    expected_ids = [f"{x}_{y}" for x, y in ref_keys]
    assert ids == expected_ids
    assert matrix.shape == ref_matrix.shape
    np.testing.assert_allclose(matrix, ref_matrix, rtol=1e-6)
