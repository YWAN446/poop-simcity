from poop_simcity_preprocess.outbreak import detect_outbreak_window


def test_window_brackets_active_period():
    seir = {"E": [0, 0, 2, 1, 0], "I": [0, 1, 3, 0, 0]}
    grid_ticks = [0, 12, 24, 36, 48]
    # Active (E+I>0) at indices 1,2,3 -> ticks 12..36.
    assert detect_outbreak_window(seir, grid_ticks) == (12, 36)


def test_no_activity_returns_full_span():
    seir = {"E": [0, 0], "I": [0, 0]}
    grid_ticks = [0, 12]
    assert detect_outbreak_window(seir, grid_ticks) == (0, 12)
