/** One selectable simulation run. */
export interface DatasetEntry {
  id: string;
  label: string; // shown in the switcher
  base: string; // e.g. "/data/dataset_00"
  schemaVersion: 1 | 2;
  committed: boolean; // does the bundle ship in the repo?
}

export const DATASETS: DatasetEntry[] = [
  {
    id: "dataset_00",
    label: "Atlanta · 1,000 agents",
    base: "/data/dataset_00",
    schemaVersion: 1,
    committed: true,
  },
  {
    id: "dataset_sdc-10k",
    label: "San Diego · 10,000 agents",
    base: "/data/dataset_sdc-10k",
    schemaVersion: 2,
    committed: false,
  },
];

export const DEFAULT_DATASET_ID = "dataset_00";

export function findDataset(id: string | undefined | null): DatasetEntry | undefined {
  return id == null ? undefined : DATASETS.find((d) => d.id === id);
}

/**
 * Picks the dataset to open on. Precedence: a `?dataset=<id>` query param wins,
 * then a build-time `envDefault` (see `VITE_DEFAULT_DATASET` in `app/.env*`),
 * then `dataset_00`, whose bundle is committed so a fresh clone always has
 * something to show. An id that matches nothing at any level falls through to
 * the next level rather than throwing.
 */
export function resolveInitialDataset(
  search: string,
  envDefault: string | undefined,
): DatasetEntry {
  const queryId = new URLSearchParams(search).get("dataset");
  return (
    findDataset(queryId) ??
    findDataset(envDefault) ??
    findDataset(DEFAULT_DATASET_ID)!
  );
}
