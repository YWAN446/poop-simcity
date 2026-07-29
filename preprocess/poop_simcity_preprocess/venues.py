"""The shared venue table that agent stays reference by index.

Built by streaming the check-in file: it is the only place venue geometry
appears, and `venue_id -> (type, lat, lon)` is single-valued in both runs, so the
first sighting of each id wins.
"""

import os

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from .constants import VENUE_TYPE_TO_ID

VENUE_COLUMNS = ["venue_id", "venue_type", "latitude", "longitude"]


def build_venue_table(dataset_dir, profile, batch_size=2_000_000) -> pd.DataFrame:
    path = os.path.join(dataset_dir, f"{profile.checkin_file}.parquet")
    seen = {}
    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=VENUE_COLUMNS):
        df = batch.to_pandas()
        df = df.drop_duplicates("venue_id")
        for vid, vtype, lat, lon in zip(df["venue_id"], df["venue_type"],
                                        df["latitude"], df["longitude"]):
            seen.setdefault(int(vid), (str(vtype), float(lat), float(lon)))

    rows = [(vid, *seen[vid]) for vid in sorted(seen)]
    return pd.DataFrame(rows, columns=VENUE_COLUMNS)


def venue_index_map(venues: pd.DataFrame) -> dict:
    return {int(v): i for i, v in enumerate(venues["venue_id"])}


def venue_arrays(venues: pd.DataFrame) -> dict:
    return {
        "venues_id.i32": venues["venue_id"].to_numpy(dtype=np.int32),
        "venues_lon.f32": venues["longitude"].to_numpy(dtype=np.float32),
        "venues_lat.f32": venues["latitude"].to_numpy(dtype=np.float32),
        "venues_type.u8": venues["venue_type"].map(VENUE_TYPE_TO_ID)
                                              .to_numpy(dtype=np.uint8),
    }
