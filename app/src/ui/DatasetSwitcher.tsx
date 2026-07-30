import type { DatasetEntry } from "../data/datasets";

/**
 * Small always-visible panel so a dead-end (e.g. a bundle that isn't committed)
 * is never a dead end: whatever else is on screen, the user can pick another
 * dataset from here.
 */
export function DatasetSwitcher({
  datasets, selected, onChange,
}: { datasets: DatasetEntry[]; selected: string; onChange: (id: string) => void }) {
  return (
    <div className="dataset-switcher">
      <label htmlFor="dataset-select">Dataset</label>
      <select
        id="dataset-select"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
      >
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
      </select>
    </div>
  );
}
