"""Convert wall-clock timestamps to integer simulation ticks."""

import pandas as pd

from .constants import TICK_INTERVAL_SEC


def time_to_tick(times, start_time):
    """Return integer tick index = floor((time - start) / 300s).

    Accepts a single Timestamp (returns int) or a Series (returns int64 Series).
    """
    start = pd.Timestamp(start_time)
    if isinstance(times, pd.Series):
        delta = pd.to_datetime(times) - start
        return (delta.dt.total_seconds() // TICK_INTERVAL_SEC).astype("int64")
    delta = pd.Timestamp(times) - start
    return int(delta.total_seconds() // TICK_INTERVAL_SEC)
