"""Command-line entry point: build a bundle from a dataset directory."""

import argparse

from .build import build_bundle
from .build_v2 import build_bundle_v2
from .profiles import get_profile

# clean_keep_fraction's profile-aware default: schemaVersion 1 keeps every clean event
# (matches dataset_00's historical default and keeps that path byte-identical);
# schemaVersion 2 keeps 0.3, the value both the design spec and the README document.
DEFAULT_CLEAN_KEEP_FRACTION = {1: 1.0, 2: 0.3}


def build_parser():
    parser = argparse.ArgumentParser(description="Build the Poop SimCity data bundle.")
    parser.add_argument("--dataset", required=True, help="Path to the dataset directory")
    parser.add_argument("--out", required=True, help="Output bundle directory")
    parser.add_argument("--run-id", default=None,
                        help="Bundle run id (defaults to the selected --profile's name)")
    parser.add_argument("--profile", default="dataset_00",
                        help="Dataset profile name (dataset_00 or dataset_sdc-10k)")
    parser.add_argument("--window-start", default="2024-01-01T00:00:00",
                        help="First tick's timestamp (schemaVersion 2 only)")
    parser.add_argument("--window-end", default="2024-07-31T23:55:00",
                        help="Last tick's timestamp, inclusive (schemaVersion 2 only)")
    parser.add_argument("--clean-keep-fraction", type=float, default=None,
                        help="Fraction of clean (non-pathogen) poop events to keep "
                             "(defaults to 1.0 for schemaVersion 1, 0.3 for "
                             "schemaVersion 2)")
    parser.add_argument("--cell-size-deg", type=float, default=0.02,
                        help="Wastewater grid cell size in degrees")
    parser.add_argument("--batch-size", type=int, default=2_000_000,
                        help="Parquet rows per streaming batch (schemaVersion 2 only)")
    parser.add_argument("--shapefile-dir", default=None,
                        help="Directory of <shed>_sewershed.shp files "
                             "(schemaVersion 2 only); omitted = no sewershed artifacts")
    return parser


def resolve_run_id(args, profile):
    """`--run-id`'s profile-aware default: the selected profile's own name."""
    return args.run_id if args.run_id is not None else profile.name


def resolve_clean_keep_fraction(args, profile):
    """`--clean-keep-fraction`'s profile-aware default; see DEFAULT_CLEAN_KEEP_FRACTION."""
    if args.clean_keep_fraction is not None:
        return args.clean_keep_fraction
    return DEFAULT_CLEAN_KEEP_FRACTION[profile.schema_version]


def main(argv=None):
    args = build_parser().parse_args(argv)

    profile = get_profile(args.profile)
    run_id = resolve_run_id(args, profile)
    clean_keep_fraction = resolve_clean_keep_fraction(args, profile)

    if profile.schema_version == 1:
        manifest = build_bundle(args.dataset, args.out, run_id=run_id,
                                clean_keep_fraction=clean_keep_fraction,
                                cell_size_deg=args.cell_size_deg, profile=profile)
    else:
        manifest = build_bundle_v2(
            args.dataset, args.out, run_id=run_id,
            window_start=args.window_start, window_end=args.window_end,
            profile=profile, clean_keep_fraction=clean_keep_fraction,
            cell_size_deg=args.cell_size_deg, batch_size=args.batch_size,
            shapefile_dir=args.shapefile_dir)

    print(f"Wrote schemaVersion {manifest['schemaVersion']} bundle to {args.out}: "
          f"{manifest['numAgents']} agents, {manifest['numTicks']} ticks, "
          f"outbreak {manifest['outbreakWindow']}")


if __name__ == "__main__":
    main()
