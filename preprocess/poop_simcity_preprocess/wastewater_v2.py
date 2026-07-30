"""Pathogen load per spatial grid cell per hour, as a float32 matrix.

Same regions x time-series interface as v1, so real sewershed polygons can replace
the grid later without touching the app. Values go to a binary matrix because a
JSON object of 633 x 5,112 numbers would be ~28 MB of text.
"""

import numpy as np
import pandas as pd

from .constants import TICK_INTERVAL_SEC
from .poop_stream import iter_poop_batches
from .window import ticks_of


def build_wastewater_v2(dataset_dir, profile, window, bbox, cell_size_deg=0.02,
                        cadence_sec=3600, batch_size=2_000_000):
    """Aggregate pathogen_level into a (region, hour) grid, streamed from the
    poop parquet.

    At real scale (~4M pathogen-bearing rows across the window) a per-row
    Python loop with a dict lookup is too slow. Instead each batch is reduced
    with `groupby(["ix", "iy", "bin"]).sum()` first, which shrinks the
    Python-level work from millions of rows to the number of distinct
    (cell, bin) pairs touched by that batch; only those aggregated sums are
    then folded into the running per-cell accumulator.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    num_bins = (window.num_ticks + bin_ticks - 1) // bin_ticks

    cells = {}   # (ix, iy) -> float64 accumulator array of length num_bins
    columns = ["time", "latitude", "longitude", "pathogen_level"]
    for df in iter_poop_batches(dataset_dir, profile, window, columns, batch_size):
        df = df[df["pathogen_level"] > 0]
        if df.empty:
            continue

        ix = ((df["longitude"].to_numpy() - min_lon) // cell_size_deg).astype("int64")
        iy = ((df["latitude"].to_numpy() - min_lat) // cell_size_deg).astype("int64")
        bins = (ticks_of(df["time"], window) // bin_ticks).astype("int64")
        levels = df["pathogen_level"].to_numpy(dtype="float64")

        batch = pd.DataFrame({"ix": ix, "iy": iy, "bin": bins, "level": levels})
        grouped = batch.groupby(["ix", "iy", "bin"], sort=False)["level"].sum()
        for (x, y, b), v in grouped.items():
            x, y, b = int(x), int(y), int(b)
            row = cells.get((x, y))
            if row is None:
                row = np.zeros(num_bins, dtype="float64")
                cells[(x, y)] = row
            row[b] += v

    keys = sorted(cells)
    matrix = np.zeros((len(keys), num_bins), dtype=np.float32)
    regions = []
    for i, (x, y) in enumerate(keys):
        matrix[i] = cells[(x, y)]
        x0 = min_lon + x * cell_size_deg
        y0 = min_lat + y * cell_size_deg
        x1, y1 = x0 + cell_size_deg, y0 + cell_size_deg
        regions.append({
            "id": f"{x}_{y}",
            "centroid": [x0 + cell_size_deg / 2, y0 + cell_size_deg / 2],
            "polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        })

    return np.ascontiguousarray(matrix), {
        "kind": "grid", "cadenceSec": cadence_sec,
        "numBins": num_bins, "regions": regions,
    }
