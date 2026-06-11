from poop_simcity_preprocess import constants


def test_venue_ids_are_dense_and_ordered():
    assert constants.VENUE_TYPE_TO_ID["Apartment"] == 0
    assert constants.VENUE_TYPE_TO_ID["Pub"] == 3
    assert set(constants.VENUE_TYPE_TO_ID.values()) == {0, 1, 2, 3}


def test_state_codes():
    assert constants.STATE_CODES["Susceptible"] == 0
    assert constants.STATE_CODES["Recovered"] == 3
    assert constants.TICK_INTERVAL_SEC == 300
