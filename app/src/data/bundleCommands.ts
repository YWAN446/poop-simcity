/**
 * The exact preprocessor invocations documented in the repo's README, keyed by
 * dataset id. Shown verbatim on the missing-bundle screen so a fresh clone gets
 * a copy-pasteable command instead of a vague pointer at "the README". Run from
 * the `preprocess/` directory (see README.md's "Regenerating the data bundle"
 * and "The dataset_sdc-10k bundle" sections, which this mirrors).
 */
const REGENERATE_COMMANDS: Record<string, string> = {
  dataset_00: [
    "python -m poop_simcity_preprocess.cli \\",
    "  --dataset ../dataset_00 \\",
    "  --out ../app/public/data/dataset_00 \\",
    "  --clean-keep-fraction 0.25",
    "python verify_bundle.py",
  ].join("\n"),
  "dataset_sdc-10k": [
    "python -m poop_simcity_preprocess.cli \\",
    "  --dataset ../dataset_sdc-10k \\",
    "  --out ../app/public/data/dataset_sdc-10k \\",
    "  --run-id dataset_sdc-10k \\",
    "  --profile dataset_sdc-10k \\",
    "  --window-start 2024-01-01T00:00:00 \\",
    "  --window-end 2024-07-31T23:55:00 \\",
    "  --clean-keep-fraction 0.3",
    "python verify_bundle_v2.py --bundle ../app/public/data/dataset_sdc-10k \\",
    "  --dataset ../dataset_sdc-10k --profile dataset_sdc-10k",
  ].join("\n"),
};

/** The command to regenerate `datasetId`'s bundle, run from `preprocess/`. */
export function regenerateCommand(datasetId: string): string {
  return (
    REGENERATE_COMMANDS[datasetId] ??
    "See README.md's preprocessor section for this dataset."
  );
}
