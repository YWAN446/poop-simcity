"""Detect the active outbreak window from hourly SEIR counts."""


def detect_outbreak_window(seir, grid_ticks):
    """Return (start_tick, end_tick) bracketing all bins where E+I > 0.

    Falls back to the full span when there is no infection activity.
    """
    active = [i for i in range(len(grid_ticks)) if seir["E"][i] + seir["I"][i] > 0]
    if not active:
        return (grid_ticks[0], grid_ticks[-1])
    return (grid_ticks[active[0]], grid_ticks[active[-1]])
