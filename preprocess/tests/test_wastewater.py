import pandas as pd
from poop_simcity_preprocess.wastewater import build_wastewater_grid


def _poops(rows):
    cols = ["agent_id", "time", "latitude", "longitude", "venue_type",
            "pathogen_level", "disease_status", "infectious_started_time"]
    df = pd.DataFrame(rows, columns=cols)
    df["time"] = pd.to_datetime(df["time"])
    return df


def test_grid_bins_pathogen_by_cell_and_hour():
    start = pd.Timestamp("2024-01-01 00:05:00")
    end = pd.Timestamp("2024-01-01 01:05:00")
    bbox = [-84.50, 33.60, -84.40, 33.70]  # 0.10 x 0.10 deg
    df = _poops([
        # Two infected events in the same cell, hour bin 0.
        (1, "2024-01-01 00:10:00", 33.61, -84.49, "Apartment", 10.0, "Infectious", None),
        (2, "2024-01-01 00:20:00", 33.62, -84.48, "Apartment", 5.0, "Infectious", None),
        # A clean event contributes no signal.
        (3, "2024-01-01 00:20:00", 33.61, -84.49, "Apartment", 0.0, "Susceptible", None),
    ])
    out = build_wastewater_grid(df, bbox, start, end, cell_size_deg=0.05)
    assert out["kind"] == "grid"
    assert out["cadenceSec"] == 3600
    # One active cell, summing 10 + 5 in hour bin 0.
    assert len(out["regions"]) == 1
    region_id = out["regions"][0]["id"]
    assert out["series"][region_id][0] == 15.0
    centroid = out["regions"][0]["centroid"]
    assert -84.50 <= centroid[0] <= -84.40
    assert len(out["regions"][0]["polygon"]) == 4
