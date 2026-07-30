"""Binary record layouts shared with the browser (decoded via DataView).

Tightly packed, little-endian. Field order and offsets are a wire contract:
AGENT_WAYPOINT (13 bytes): tick u32, lon f32, lat f32, vtype u8
POOP_EVENT     (14 bytes): tick u32, lon f32, lat f32, vtype u8, infected u8

There is no `pathogen` field: the simulation's decay model produces magnitudes down to
`1.005e-113`, far below float32's smallest positive subnormal (~1.4e-45), so a float32
magnitude column reads `0.0` for a real fraction of genuinely infected events (19,109 of
69,432 in this run, 27.5%). `infected` is computed upstream from the source float64
`pathogen_level` column (`> 0`) before any narrowing, so it never depends on that
precision loss - it is the sole authoritative infected/clean flag, and nothing in the
app ever reads a per-event pathogen magnitude.
"""

import numpy as np

AGENT_WAYPOINT_DTYPE = np.dtype(
    [("tick", "<u4"), ("lon", "<f4"), ("lat", "<f4"), ("vtype", "<u1")]
)

POOP_EVENT_DTYPE = np.dtype(
    [
        ("tick", "<u4"),
        ("lon", "<f4"),
        ("lat", "<f4"),
        ("vtype", "<u1"),
        ("infected", "<u1"),
    ]
)


def records_to_bytes(arr: np.ndarray) -> bytes:
    """Serialize a structured array to tightly packed little-endian bytes."""
    return arr.tobytes()
