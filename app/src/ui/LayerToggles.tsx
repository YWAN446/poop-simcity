export interface LayerFlags {
  venues: boolean; poops: boolean; agents: boolean; wastewater: boolean; arcs: boolean;
  /** Optional so the v1 (dataset_00 / Atlanta) flag state, which has no notion
   * of sewersheds, still satisfies this type unchanged. */
  sewersheds?: boolean;
}

// Human-readable labels for each flag (the `arcs` layer draws transmission links).
const LAYER_LABELS: Record<keyof LayerFlags, string> = {
  agents: "Agents",
  poops: "Poops",
  venues: "Venues",
  wastewater: "Wastewater",
  arcs: "Transmissions",
  sewersheds: "Sewersheds",
};

export function LayerToggles({
  flags, onChange, hasSewersheds = false,
}: {
  flags: LayerFlags; onChange: (f: LayerFlags) => void;
  /** Hides the Sewersheds toggle for bundles that ship no sewershed artifacts
   * (e.g. dataset_00 / Atlanta), matching the layer itself being unrenderable.
   * Defaults to hidden so the v1 call site (which knows nothing of sewersheds)
   * needs no change. */
  hasSewersheds?: boolean;
}) {
  const items: (keyof LayerFlags)[] = [
    "agents", "poops", "venues", "wastewater",
    ...(hasSewersheds ? (["sewersheds"] as const) : []),
    "arcs",
  ];
  return (
    <div className="layer-toggles">
      {items.map((k) => (
        <label key={k}>
          <input
            type="checkbox"
            checked={flags[k]}
            onChange={(e) => onChange({ ...flags, [k]: e.target.checked })}
          />
          {LAYER_LABELS[k]}
        </label>
      ))}
    </div>
  );
}
