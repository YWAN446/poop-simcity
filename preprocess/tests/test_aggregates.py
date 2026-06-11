import pandas as pd
from poop_simcity_preprocess.aggregates import seir_counts_over_time, build_aggregates


def test_seir_counts_step_function():
    # Agent 1: S at tick 0, I at tick 12. Agent 2: no transitions -> S throughout.
    transitions = {1: [[0, 0], [12, 2]], 2: []}
    grid = [0, 12, 24]  # hourly ticks
    counts = seir_counts_over_time(transitions, num_agents=2, grid_ticks=grid)
    assert counts["S"] == [2, 1, 1]   # both S at t0; agent1 leaves S after t12
    assert counts["I"] == [0, 1, 1]


def test_build_aggregates_shape_and_inflow():
    start = pd.Timestamp("2024-01-01 00:05:00")
    disease = pd.DataFrame({
        "time": pd.to_datetime(["2024-01-01 00:05:00", "2024-01-01 01:05:00"]),
        "agent_id": [0, 0],
        "disease_status": ["Susceptible", "Infectious"],
        "pathogen_level": [0.0, 3.0],
        "source_agent_id": [-1, -1],
        "exposed_started_time": [pd.NaT, pd.NaT],
        "infectious_started_time": [pd.NaT, pd.NaT],
        "latitude": [33.7, 33.7],
        "longitude": [-84.4, -84.4],
    })
    poops = pd.DataFrame({
        "agent_id": [0],
        "time": pd.to_datetime(["2024-01-01 01:10:00"]),  # tick 13 -> hour bin 1
        "latitude": [33.7], "longitude": [-84.4],
        "venue_type": ["Apartment"], "pathogen_level": [50.0],
        "disease_status": ["Infectious"], "infectious_started_time": [pd.NaT],
    })
    end = pd.Timestamp("2024-01-01 01:05:00")
    agg = build_aggregates(disease, poops, start, end, num_agents=1)
    assert agg["cadenceSec"] == 3600
    assert len(agg["seir"]["S"]) == 2          # hour bins 0 and 1
    assert agg["seir"]["I"][1] == 1            # agent infectious by hour 1
    assert agg["pathogenInflow"][1] == 50.0
