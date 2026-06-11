"""Build the tick-sorted poop event stream."""

import numpy as np

from .constants import VENUE_TYPE_TO_ID
from .encoding import POOP_EVENT_DTYPE, records_to_bytes
from .timeutil import time_to_tick


def build_poop_events(poop_df, start_time, clean_keep_fraction=1.0):
    """Return POOP_EVENT_DTYPE bytes sorted by tick.

    clean_keep_fraction < 1.0 deterministically downsamples non-pathogen events
    (by agent_id modulo) while keeping every infected (pathogen > 0) event.
    """
    df = poop_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["vtype"] = df["venue_type"].map(VENUE_TYPE_TO_ID).astype("uint8")
    df["infected"] = (df["pathogen_level"] > 0).astype("uint8")

    if clean_keep_fraction < 1.0:
        keep_mod = max(1, round(1.0 / clean_keep_fraction))
        clean_mask = df["infected"] == 0
        drop = clean_mask & ((df["agent_id"] % keep_mod) != 0)
        df = df[~drop]

    df = df.sort_values("tick", kind="stable").reset_index(drop=True)

    arr = np.zeros(len(df), dtype=POOP_EVENT_DTYPE)
    arr["tick"] = df["tick"].to_numpy()
    arr["lon"] = df["longitude"].to_numpy()
    arr["lat"] = df["latitude"].to_numpy()
    arr["vtype"] = df["vtype"].to_numpy()
    arr["infected"] = df["infected"].to_numpy()
    arr["pathogen"] = df["pathogen_level"].to_numpy()
    return records_to_bytes(arr)
