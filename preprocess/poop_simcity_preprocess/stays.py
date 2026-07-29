# preprocess/poop_simcity_preprocess/stays.py
"""Agent stays: one record per check-in, carrying its dwell length.

Streamed per batch into small int64 blocks, concatenated once, then sorted by
(agent, tick). The concatenated form is ~140 MB for the production run, which is
affordable; a per-agent Python list of 8.7M tuples would not be.
"""

import os

import numpy as np
import pyarrow.parquet as pq

from .window import mask_in_window, ticks_of, to_u16


def build_stays(dataset_dir, profile, window, venue_index, batch_size=2_000_000):
    if profile.checkout_col is None:
        raise ValueError(
            f"profile {profile.name!r} has no check-out column; "
            "dwell-based stays need one"
        )

    path = os.path.join(dataset_dir, f"{profile.checkin_file}.parquet")
    columns = ["agent_id", "time", profile.checkout_col, "venue_id"]
    last_tick = window.num_ticks - 1
    blocks = []

    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=columns):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        if df.empty:
            continue

        unknown = set(df["venue_id"].unique()) - set(venue_index)
        if unknown:
            raise ValueError(
                f"check-in references venue_id(s) absent from the venue table: "
                f"{sorted(unknown)[:5]}"
            )

        tick = ticks_of(df["time"], window)
        checkout_tick = ticks_of(df[profile.checkout_col], window)
        dwell = np.clip(checkout_tick - tick, 1, None)
        dwell = np.minimum(dwell, last_tick - tick + 1)
        venue = df["venue_id"].map(venue_index).to_numpy(dtype="int64")

        blocks.append(np.stack(
            [df["agent_id"].to_numpy(dtype="int64"), tick, dwell, venue], axis=1))

    if not blocks:
        empty = np.zeros(0, dtype=np.uint16)
        return ({"stays_tick.u16": empty, "stays_dwell.u16": empty.copy(),
                 "stays_venue.u16": empty.copy()}, [])

    rows = np.concatenate(blocks)
    rows = rows[np.lexsort((rows[:, 1], rows[:, 0]))]

    agent_ids, counts = np.unique(rows[:, 0], return_counts=True)
    offsets = np.concatenate(([0], np.cumsum(counts)[:-1]))
    index = [
        {"agentId": int(a), "offset": int(o), "count": int(c)}
        for a, o, c in zip(agent_ids, offsets, counts)
    ]

    return ({
        "stays_tick.u16": to_u16(rows[:, 1], "stay tick"),
        "stays_dwell.u16": to_u16(rows[:, 2], "stay dwell"),
        "stays_venue.u16": to_u16(rows[:, 3], "stay venue index"),
    }, index)
