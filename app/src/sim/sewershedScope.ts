import type { Aggregates } from "../types";
import type { BundleV2 } from "../types2";

export const ALL_SCOPE = "all";
export const OUTSIDE_SCOPE = "outside";

export type ScopeId = string;

export interface ScopeOption {
  id: ScopeId;
  label: string;
  /** Resident agents in this scope, or null for All. */
  residents: number | null;
}

const STATES = ["S", "E", "I", "R"] as const;

export function scopeOptions(bundle: BundleV2): ScopeOption[] {
  const opts: ScopeOption[] = [{ id: ALL_SCOPE, label: "All", residents: null }];
  const s = bundle.sewersheds;
  if (!s) return opts;
  for (const shed of s.sheds) {
    opts.push({ id: shed.id, label: shed.label, residents: shed.residents });
  }
  opts.push({ id: OUTSIDE_SCOPE, label: s.outside.label, residents: s.outside.residents });
  return opts;
}

/** Row index for a scope, or -1 for All / unknown. */
function rowFor(bundle: BundleV2, scope: ScopeId): number {
  const s = bundle.sewersheds;
  if (!s || scope === ALL_SCOPE) return -1;
  if (scope === OUTSIDE_SCOPE) return s.rows - 1;
  const i = s.sheds.findIndex((shed) => shed.id === scope);
  return i;
}

/**
 * The aggregates the charts should draw for `scope`.
 *
 * For All this is the bundle's own object, returned by reference — the default
 * view stays exactly what it was before sewersheds existed. For a sewershed it
 * is a fresh `Aggregates` with the same time axis and that shed's own series,
 * which is what lets `SeirChart` and `WastewaterChart` stay unchanged.
 */
export function scopedAggregates(bundle: BundleV2, scope: ScopeId): Aggregates {
  const s = bundle.sewersheds;
  const row = rowFor(bundle, scope);
  if (!s || row < 0) return bundle.aggregates;

  const { numBins } = s;
  const inflow = Array.from(s.ww.subarray(row * numBins, (row + 1) * numBins));
  const seir = {} as Aggregates["seir"];
  STATES.forEach((name, si) => {
    const start = (row * 4 + si) * numBins;
    seir[name] = Array.from(s.seir.subarray(start, start + numBins));
  });
  return {
    ...bundle.aggregates,
    seir,
    pathogenInflow: inflow,
  };
}

/** Chart heading that states the scope and how many people it covers. */
export function scopeHeading(bundle: BundleV2, scope: ScopeId): string {
  const opt = scopeOptions(bundle).find((o) => o.id === scope);
  if (!opt || opt.id === ALL_SCOPE) return "all sewersheds";
  return `${opt.label} (${opt.residents!.toLocaleString()} residents)`;
}
