import numpy as np
from poop_simcity_preprocess.encoding import (
    AGENT_WAYPOINT_DTYPE,
    POOP_EVENT_DTYPE,
    records_to_bytes,
)


def test_dtype_itemsizes_are_stable():
    # Field layout is a wire contract with the browser; lock the sizes.
    assert AGENT_WAYPOINT_DTYPE.itemsize == 13
    assert POOP_EVENT_DTYPE.itemsize == 18


def test_agent_record_roundtrip():
    arr = np.zeros(2, dtype=AGENT_WAYPOINT_DTYPE)
    arr[0] = (5, -84.4, 33.7, 2)
    arr[1] = (17, -84.39, 33.71, 0)
    raw = records_to_bytes(arr)
    back = np.frombuffer(raw, dtype=AGENT_WAYPOINT_DTYPE)
    assert back[0]["tick"] == 5
    assert abs(back[1]["lon"] - (-84.39)) < 1e-4
    assert back[0]["vtype"] == 2


def test_poop_record_roundtrip():
    arr = np.zeros(1, dtype=POOP_EVENT_DTYPE)
    arr[0] = (9, -84.5, 33.6, 1, 1, 1.0e7)
    raw = records_to_bytes(arr)
    back = np.frombuffer(raw, dtype=POOP_EVENT_DTYPE)
    assert back[0]["tick"] == 9
    assert back[0]["infected"] == 1
    assert abs(back[0]["pathogen"] - 1.0e7) / 1.0e7 < 1e-3
