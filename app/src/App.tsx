import { useState } from "react";
import { DATASETS, resolveInitialDataset } from "./data/datasets";
import { DatasetSwitcher } from "./ui/DatasetSwitcher";
import { PlaybackV1 } from "./ui/PlaybackV1";
import { PlaybackV2 } from "./ui/PlaybackV2";

// Build-time default (see app/.env and app/.env.sdc-10k): the deployed San
// Diego site is built with `npm run build:sdc-10k` so it keeps opening on
// dataset_sdc-10k, while a plain `npm run build`/`npm run dev` opens on
// dataset_00, whose bundle is committed and always available.
const ENV_DEFAULT = import.meta.env.VITE_DEFAULT_DATASET as string | undefined;

export default function App() {
  const [datasetId, setDatasetId] = useState(
    () => resolveInitialDataset(window.location.search, ENV_DEFAULT).id,
  );
  const dataset = DATASETS.find((d) => d.id === datasetId) ?? DATASETS[0];

  return (
    <div className="app-shell">
      <DatasetSwitcher datasets={DATASETS} selected={dataset.id} onChange={setDatasetId} />
      {dataset.schemaVersion === 2
        ? <PlaybackV2 dataset={dataset} />
        : <PlaybackV1 dataset={dataset} />}
    </div>
  );
}
