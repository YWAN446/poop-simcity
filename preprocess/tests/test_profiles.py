import pytest
from poop_simcity_preprocess.profiles import DATASET_00, SDC_10K, get_profile


def test_dataset_00_profile_matches_v1_layout():
    p = get_profile("dataset_00")
    assert p is DATASET_00
    assert p.schema_version == 1
    assert p.checkin_file == "check_in"
    assert p.disease_file == "disease_status"
    assert p.poop_file == "poop_in"
    assert p.source_agent_col == "source_agent_id"
    assert p.checkout_col is None


def test_sdc_10k_profile_has_checkout_and_capitalised_names():
    p = get_profile("dataset_sdc-10k")
    assert p is SDC_10K
    assert p.schema_version == 2
    assert p.checkin_file == "Checkin"
    assert p.disease_file == "DiseasesStatus"
    assert p.poop_file == "Poopin"
    assert p.source_agent_col == "SourceAgentId"
    assert p.checkout_col == "CheckoutTime"


def test_unknown_profile_lists_known_names():
    with pytest.raises(ValueError, match="dataset_sdc-10k"):
        get_profile("nope")
