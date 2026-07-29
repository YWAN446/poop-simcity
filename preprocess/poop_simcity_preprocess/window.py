"""Playback window arithmetic and the uint16 encoding guard.

Bundle v2 stores ticks, dwell lengths and venue indices as uint16, which is only
safe while the window stays under 65,536 ticks. `to_u16` is the single place that
enforces it, and it raises rather than truncating: a silently wrapped tick would
put agents in the wrong place with no visible error.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .constants import TICK_INTERVAL_SEC

U16_MAX = 65535


@dataclass(frozen=True)
class Window:
    start: pd.Timestamp
    end: pd.Timestamp        # timestamp of the last included tick, inclusive
    num_ticks: int


def make_window(start, end) -> Window:
    start = pd.Timestamp(start)
    end = pd.Timestamp(end)
    if end < start:
        raise ValueError(f"window end {end} precedes start {start}")
    span = (end - start).total_seconds()
    return Window(start=start, end=end, num_ticks=int(span // TICK_INTERVAL_SEC) + 1)


def ticks_of(times, window: Window) -> np.ndarray:
    delta = pd.to_datetime(times) - window.start
    return (delta.dt.total_seconds() // TICK_INTERVAL_SEC).to_numpy(dtype="int64")


def mask_in_window(times, window: Window) -> np.ndarray:
    t = pd.to_datetime(times)
    return ((t >= window.start) & (t <= window.end)).to_numpy(dtype=bool)


def to_u16(arr: np.ndarray, label: str) -> np.ndarray:
    arr = np.asarray(arr)
    if arr.size:
        hi = int(arr.max())
        lo = int(arr.min())
        if hi > U16_MAX or lo < 0:
            raise ValueError(
                f"{label} out of uint16 range: min={lo} max={hi} "
                f"(limit {U16_MAX}); narrow the playback window"
            )
    return arr.astype(np.uint16)
