import type { DatasetEntry } from "../data/datasets";
import { regenerateCommand } from "../data/bundleCommands";

/**
 * Shown in place of the map when a dataset's bundle fails to load — most
 * commonly a fresh clone with `dataset_sdc-10k` selected, whose ~89 MB bundle
 * is gitignored rather than committed (see `.gitignore`). Names the dataset,
 * says plainly what's missing, and gives the exact command to generate it,
 * rather than surfacing the raw fetch error. The dataset switcher lives
 * outside this component (in `App`), so it stays usable on this screen.
 */
export function DatasetError({
  dataset, message,
}: { dataset: DatasetEntry; message: string }) {
  return (
    <div className="dataset-error">
      <h2>“{dataset.label}” isn’t available</h2>
      <p>
        {dataset.committed
          ? "This dataset's bundle failed to load."
          : "This dataset's bundle is not committed to the repository, so it must be generated locally with the preprocessor."}
      </p>
      <p>Run this from <code>preprocess/</code>:</p>
      <pre className="dataset-error-command">{regenerateCommand(dataset.id)}</pre>
      <p className="dataset-error-detail">
        Or pick a different dataset above. ({message})
      </p>
    </div>
  );
}
