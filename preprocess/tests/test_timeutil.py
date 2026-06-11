import pandas as pd
from poop_simcity_preprocess.timeutil import time_to_tick


def test_scalar_tick_is_zero_at_start():
    start = pd.Timestamp("2024-01-01 00:05:00")
    assert time_to_tick(pd.Timestamp("2024-01-01 00:05:00"), start) == 0


def test_scalar_tick_counts_five_minute_steps():
    start = pd.Timestamp("2024-01-01 00:05:00")
    assert time_to_tick(pd.Timestamp("2024-01-01 00:10:00"), start) == 1
    assert time_to_tick(pd.Timestamp("2024-01-01 01:05:00"), start) == 12


def test_series_tick_conversion():
    start = pd.Timestamp("2024-01-01 00:05:00")
    s = pd.Series(pd.to_datetime(
        ["2024-01-01 00:05:00", "2024-01-01 00:10:00", "2024-01-02 00:05:00"]
    ))
    out = time_to_tick(s, start)
    assert list(out) == [0, 1, 288]
