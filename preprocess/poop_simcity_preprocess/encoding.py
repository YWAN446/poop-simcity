"""Binary record layouts shared with the browser (decoded via DataView).

Tightly packed, little-endian. Field order and offsets are a wire contract:
AGENT_WAYPOINT (13 bytes): tick u32, lon f32, lat f32, vtype u8
POOP_EVENT     (18 bytes): tick u32, lon f32, lat f32, vtype u8, infected u8, pathogen f32
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
        ("pathogen", "<f4"),
    ]
)


def records_to_bytes(arr: np.ndarray) -> bytes:
    """Serialize a structured array to tightly packed little-endian bytes."""
    return arr.tobytes()
