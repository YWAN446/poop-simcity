import numpy as np
import pandas as pd
from poop_simcity_preprocess.poops import build_poop_events
from poop_simcity_preprocess.encoding import POOP_EVENT_DTYPE


def _poops(rows):
    cols = ["agent_id", "time", "latitude", "longitude", "venue_type",
            "pathogen_level", "disease_status", "infectious_started_time"]
    df = pd.DataFrame(rows, columns=cols)
    df["time"] = pd.to_datetime(df["time"])
    return df


def test_events_sorted_by_tick_with_infected_flag():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _poops([
        (1, "2024-01-01 00:15:00", 33.7, -84.4, "Apartment", 0.0, "Susceptible", None),
        (2, "2024-01-01 00:05:00", 33.8, -84.3, "Workplace", 5.0, "Infectious", None),
    ])
    raw = build_poop_events(df, start)
    arr = np.frombuffer(raw, dtype=POOP_EVENT_DTYPE)
    assert list(arr["tick"]) == [0, 2]          # sorted ascending
    assert arr[0]["infected"] == 1              # pathogen 5.0 -> infected
    assert arr[0]["vtype"] == 1                 # Workplace
    assert arr[1]["infected"] == 0              # clean


def test_clean_downsample_keeps_all_infected():
    start = pd.Timestamp("2024-01-01 00:05:00")
    rows = []
    for i in range(10):
        rows.append((i, "2024-01-01 00:10:00", 33.7, -84.4, "Apartment", 0.0,
                     "Susceptible", None))
    rows.append((99, "2024-01-01 00:10:00", 33.7, -84.4, "Apartment", 7.0,
                 "Infectious", None))
    df = _poops(rows)
    raw = build_poop_events(df, start, clean_keep_fraction=0.5)
    arr = np.frombuffer(raw, dtype=POOP_EVENT_DTYPE)
    assert (arr["infected"] == 1).sum() == 1          # the infected one survives
    assert 4 <= (arr["infected"] == 0).sum() <= 6     # ~half the clean ones kept
