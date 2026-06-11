"""Command-line entry point: build a bundle from a dataset directory."""

import argparse

from .build import build_bundle


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the Poop SimCity data bundle.")
    parser.add_argument("--dataset", required=True, help="Path to dataset_00/ directory")
    parser.add_argument("--out", required=True, help="Output bundle directory")
    parser.add_argument("--run-id", default="dataset_00")
    parser.add_argument("--clean-keep-fraction", type=float, default=1.0,
                        help="Fraction of clean (non-pathogen) poop events to keep")
    parser.add_argument("--cell-size-deg", type=float, default=0.02,
                        help="Wastewater grid cell size in degrees")
    args = parser.parse_args(argv)

    manifest = build_bundle(args.dataset, args.out, run_id=args.run_id,
                            clean_keep_fraction=args.clean_keep_fraction,
                            cell_size_deg=args.cell_size_deg)
    print(f"Wrote bundle to {args.out}: "
          f"{manifest['numAgents']} agents, {manifest['numTicks']} ticks, "
          f"outbreak {manifest['outbreakWindow']}")


if __name__ == "__main__":
    main()
