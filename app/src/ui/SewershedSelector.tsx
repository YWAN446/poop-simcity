import type { ScopeId, ScopeOption } from "../sim/sewershedScope";

/**
 * Scope control for the HUD charts. Rendered only when the bundle has
 * sewersheds, so `dataset_00` never sees it.
 */
export function SewershedSelector({
  options, selected, onChange, kind,
}: {
  options: ScopeOption[];
  selected: ScopeId;
  onChange: (id: ScopeId) => void;
  kind: string;
}) {
  return (
    <div className="shed-selector">
      <div className="shed-selector-label">
        Sewershed
        {kind === "zcta-union" && (
          <span
            className="shed-selector-note"
            title="Boundaries are unions of Census ZIP Code Tabulation Areas, not pipe networks."
          >
            {" "}· ZIP-code approximation
          </span>
        )}
      </div>
      <div className="shed-selector-options">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={o.id === selected ? "shed-chip shed-chip-on" : "shed-chip"}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
