export interface LayerFlags {
  venues: boolean; poops: boolean; agents: boolean; wastewater: boolean; arcs: boolean;
}

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
          {k}
        </label>
      ))}
    </div>
  );
}
