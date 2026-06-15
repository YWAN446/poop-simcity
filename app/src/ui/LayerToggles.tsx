export interface LayerFlags {
  venues: boolean; poops: boolean; agents: boolean; wastewater: boolean; arcs: boolean;
}

// Human-readable labels for each flag (the `arcs` layer draws transmission links).
const LAYER_LABELS: Record<keyof LayerFlags, string> = {
  agents: "Agents",
  poops: "Poops",
  venues: "Venues",
  wastewater: "Wastewater",
  arcs: "Transmissions",
};

export function LayerToggles({
  flags, onChange,
}: { flags: LayerFlags; onChange: (f: LayerFlags) => void }) {
  const items: (keyof LayerFlags)[] = ["agents", "poops", "venues", "wastewater", "arcs"];
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
