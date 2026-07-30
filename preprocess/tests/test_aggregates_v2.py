import bisect

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from poop_simcity_preprocess.aggregates_v2 import (
    build_aggregates_v2, pathogen_inflow_hourly, seir_hourly,
)
from poop_simcity_preprocess.constants import TICK_INTERVAL_SEC
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 02:55:00")   # 36 ticks, 3 bins


def test_seir_counts_agents_by_last_transition_at_or_before_each_bin():
    # Agent 0 exposed at tick 6 (bin 0), infectious at tick 18 (bin 1).
    seir = seir_hourly({0: [(6, 1), (18, 2)]}, num_agents=3, window=WINDOW)
    assert seir["S"] == [2, 2, 2]        # agents 1 and 2 never transition
    assert seir["E"] == [1, 0, 0]
    assert seir["I"] == [0, 1, 1]
    assert seir["R"] == [0, 0, 0]


def test_agents_before_their_first_transition_count_as_susceptible():
    seir = seir_hourly({0: [(30, 1)]}, num_agents=1, window=WINDOW)
    assert seir["S"] == [1, 1, 0]
    assert seir["E"] == [0, 0, 1]


def test_num_agents_smaller_than_transitions_raises_instead_of_going_negative():
    # 2 agents have transitions but the caller claims only 1 agent exists -
    # the "everyone else is Susceptible" bulk-add would go negative.
    with pytest.raises(ValueError, match="num_agents"):
        seir_hourly({1: [(10, 1)], 2: [(20, 2)]}, num_agents=1, window=WINDOW)


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def test_inflow_sums_pathogen_per_hourly_bin(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.5, -117.0, "Apartment", 5.0, "Infectious", None),
        (1, "2024-01-01 00:50:00", 32.5, -117.0, "Apartment", 3.0, "Infectious", None),
        (2, "2024-01-01 02:00:00", 32.5, -117.0, "Apartment", 7.0, "Infectious", None),
    ])
    assert pathogen_inflow_hourly(str(tmp_path), SDC_10K, WINDOW) == [8.0, 0.0, 7.0]


def test_aggregates_bundle_shape(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.5, -117.0, "Apartment", 5.0, "Infectious", None),
    ])
    agg = build_aggregates_v2(str(tmp_path), SDC_10K, WINDOW, {0: [(6, 1)]}, 2)
    assert agg["cadenceSec"] == 3600
    assert agg["seirSampledAt"] == "binEnd"
    assert agg["gridTicks"] == [0, 12, 24]
    assert len(agg["pathogenInflow"]) == 3
    assert agg["seir"]["E"][0] == 1


# --- Equivalence test guarding the seir_hourly vectorization -----------------
#
# seir_hourly replaces a per-agent, per-bin `bisect` loop with a single
# `np.searchsorted` call per agent. This test checks the vectorized function
# against a straightforward (slow) per-agent/per-bin reference across the
# shapes that matter: zero, one, and many transitions per agent; a transition
# landing exactly on a bin boundary tick vs. strictly between two boundary
# ticks; and agents missing from the transitions dict entirely (which must
# still be counted, in bulk, as Susceptible).
#
# Bin `gi` covers ticks `[gi*bin_ticks, (gi+1)*bin_ticks)` (truncated at the
# window length for the final bin), so the reference compares against the
# END of each bin, not its opening tick - matching the two tests above
# (agent 0's tick-6 transition already counts as bin 0's state, and the
# tick-30 transition in the second test only takes effect in bin 2, whose
# range is ticks 24-35).
def _reference_seir_hourly(transitions, num_agents, window, cadence_sec=3600):
    state_names = ["S", "E", "I", "R"]
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    num_bins = (window.num_ticks + bin_ticks - 1) // bin_ticks
    counts = {name: [0] * num_bins for name in state_names}

    for trans in transitions.values():
        ticks = [t for t, _ in trans]
        for gi in range(num_bins):
            bin_end = min((gi + 1) * bin_ticks, window.num_ticks)
            idx = bisect.bisect_left(ticks, bin_end) - 1
            code = trans[idx][1] if idx >= 0 else 0
            counts[state_names[code]][gi] += 1

    missing = num_agents - len(transitions)
    if missing:
        for gi in range(num_bins):
            counts["S"][gi] += missing
    return counts


def test_seir_hourly_matches_reference_on_varied_transition_shapes():
    window = make_window("2024-01-01 00:00:00", "2024-01-01 05:00:00")  # 61 ticks, 6 bins
    transitions = {
        0: [],                                # explicit zero transitions
        1: [(12, 1)],                         # one transition, exactly on a bin boundary
        2: [(5, 1), (12, 2), (50, 3)],         # many transitions, boundary + mid-bin mixed
        3: [(7, 1)],                          # one transition, strictly between bin ticks
        # agents 4 and 5 are absent from the dict entirely
    }
    result = seir_hourly(transitions, num_agents=6, window=window)
    expected = _reference_seir_hourly(transitions, num_agents=6, window=window)
    assert result == expected

    num_bins = len(result["S"])
    for gi in range(num_bins):
        total = sum(result[state][gi] for state in ["S", "E", "I", "R"])
        assert total == 6
