import numpy as np
import pandas as pd
import pytest

from poop_simcity_preprocess.window import (
    make_window, mask_in_window, ticks_of, to_u16,
)


def test_window_tick_count_is_inclusive_of_the_last_tick():
    w = make_window("2024-01-01 00:00:00", "2024-01-01 00:55:00")
    assert w.num_ticks == 12          # 00:00 .. 00:55 inclusive, 5-minute steps


def test_production_window_is_61344_ticks_and_fits_u16():
    w = make_window("2024-01-01 00:00:00", "2024-07-31 23:55:00")
    assert w.num_ticks == 61344
    assert w.num_ticks - 1 <= 65535


def test_ticks_of_floors_to_the_containing_tick():
    w = make_window("2024-01-01 00:00:00", "2024-01-01 00:55:00")
    t = ticks_of(pd.to_datetime(pd.Series(
        ["2024-01-01 00:00:00", "2024-01-01 00:04:59", "2024-01-01 00:05:00"])), w)
    assert t.tolist() == [0, 0, 1]


def test_mask_in_window_excludes_both_ends_correctly():
    w = make_window("2024-01-01 00:00:00", "2024-01-01 00:55:00")
    times = pd.to_datetime(pd.Series([
        "2023-12-31 23:55:00",   # before
        "2024-01-01 00:00:00",   # first tick
        "2024-01-01 00:55:00",   # last tick
        "2024-01-01 01:00:00",   # past the end
    ]))
    assert mask_in_window(times, w).tolist() == [False, True, True, False]


def test_to_u16_round_trips_in_range_values():
    out = to_u16(np.array([0, 61343, 65535]), "tick")
    assert out.dtype == np.uint16
    assert out.tolist() == [0, 61343, 65535]


def test_to_u16_raises_on_overflow_naming_the_field():
    with pytest.raises(ValueError, match="tick"):
        to_u16(np.array([0, 65536]), "tick")


def test_to_u16_raises_on_negative():
    with pytest.raises(ValueError, match="dwell"):
        to_u16(np.array([-1, 5]), "dwell")
