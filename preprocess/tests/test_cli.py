from poop_simcity_preprocess.cli import (
    build_parser, resolve_clean_keep_fraction, resolve_run_id,
)
from poop_simcity_preprocess.profiles import DATASET_00, SDC_10K


def _parse(extra_args):
    return build_parser().parse_args([
        "--dataset", "d", "--out", "o", *extra_args,
    ])


def test_run_id_defaults_to_the_selected_profiles_name_when_omitted():
    args = _parse(["--profile", "dataset_sdc-10k"])
    assert resolve_run_id(args, SDC_10K) == "dataset_sdc-10k"

    args = _parse([])
    assert resolve_run_id(args, DATASET_00) == "dataset_00"


def test_explicit_run_id_overrides_the_profile_default():
    args = _parse(["--profile", "dataset_sdc-10k", "--run-id", "my-custom-run"])
    assert resolve_run_id(args, SDC_10K) == "my-custom-run"


def test_clean_keep_fraction_defaults_to_1_for_schema_version_1():
    args = _parse([])
    assert resolve_clean_keep_fraction(args, DATASET_00) == 1.0


def test_clean_keep_fraction_defaults_to_0_3_for_schema_version_2():
    args = _parse(["--profile", "dataset_sdc-10k"])
    assert resolve_clean_keep_fraction(args, SDC_10K) == 0.3


def test_explicit_clean_keep_fraction_overrides_the_profile_default():
    args = _parse(["--profile", "dataset_sdc-10k", "--clean-keep-fraction", "0.75"])
    assert resolve_clean_keep_fraction(args, SDC_10K) == 0.75

    args = _parse(["--clean-keep-fraction", "0.5"])
    assert resolve_clean_keep_fraction(args, DATASET_00) == 0.5


def test_dataset_00_defaults_are_unchanged_so_its_output_stays_byte_identical():
    # The whole point: run the CLI with no --run-id / --clean-keep-fraction / --profile
    # flags at all (dataset_00's historical invocation) and confirm the resolved values
    # are exactly what build_bundle's own defaults were before this file existed.
    args = _parse([])
    profile = DATASET_00
    assert resolve_run_id(args, profile) == "dataset_00"
    assert resolve_clean_keep_fraction(args, profile) == 1.0
