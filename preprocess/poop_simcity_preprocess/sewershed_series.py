"""Per-sewershed hourly series.

Two different questions, two different assignment rules:

- Wastewater is assigned by the event's OWN coordinates. That is what a plant
  measures: pathogen follows the pipe from wherever it was deposited, whoever
  deposited it.
- Resident cases are assigned by the agent's home (see `sewersheds.home_shed_by_agent`).

Both are accumulated on the same hourly bin grid as `aggregates.json`, so the
per-shed rows sum back to the global series — the invariant the tests lean on.
"""

import numpy as np

from .aggregates_v2 import hourly_bin_grid
from .poop_stream import iter_poop_batches
from .sewersheds import assign_points
from .window import ticks_of


def sewershed_pathogen_hourly(dataset_dir, profile, window, sheds,
                              cadence_sec=3600, batch_size=2_000_000):
    """Pathogen per sewershed per hourly bin; shape (len(sheds) + 1, num_bins).

    The final row is Outside. Accumulates in float64; callers narrow to float32
    only when writing the artifact.
    """
    grid_ticks, bin_ticks = hourly_bin_grid(window, cadence_sec)
    num_bins = len(grid_ticks)
    n_rows = len(sheds) + 1
    outside_row = len(sheds)
    totals = np.zeros((n_rows, num_bins), dtype="float64")

    columns = ["time", "latitude", "longitude", "pathogen_level"]
    for df in iter_poop_batches(dataset_dir, profile, window, columns, batch_size):
        shed = assign_points(sheds, df["longitude"].to_numpy(), df["latitude"].to_numpy())
        row = np.where(shed < 0, outside_row, shed).astype("int64")
        bins = ticks_of(df["time"], window) // bin_ticks
        # Flat index so one np.add.at call covers every (row, bin) pair.
        np.add.at(
            totals.reshape(-1),
            row * num_bins + bins,
            df["pathogen_level"].to_numpy(dtype="float64"),
        )
    return totals
