import type { Aggregates } from "../types";
import { hourBinIndex } from "../sim/timeMapping";
import { SeirChart } from "./SeirChart";
import { WastewaterChart } from "./WastewaterChart";

/** Structural minimum both v1 `Manifest` and v2 `ManifestV2` satisfy. */
export interface HudManifest {
  tickIntervalSec: number;
}

export function Hud({
  manifest, agg, tick, ticksPerSecond, onSpeed, coverageLine, scopeLine,
}: {
  manifest: HudManifest; agg: Aggregates; tick: number;
  ticksPerSecond: number; onSpeed: (v: number) => void;
  /** Honest coverage caveat (v2 only — see `coverageLabel`); omitted for v1,
   * whose manifest has no `coverage` field to describe. */
  coverageLine?: string;
  /** Which sewershed scope the charts below are drawn from (see `scopeHeading`);
   * omitted when the bundle has no sewersheds. */
  scopeLine?: string;
}) {
  // Clamp the hourly bin; each chart shows its own date + values readout below it.
  const bin = Math.min(
    agg.seir.S.length - 1,
    hourBinIndex(Math.round(tick), manifest.tickIntervalSec, agg.cadenceSec),
  );
  return (
    <div className="hud">
      {coverageLine != null && <div className="hud-coverage">{coverageLine}</div>}
      {scopeLine != null && <div className="hud-scope">Showing {scopeLine}</div>}
      <SeirChart agg={agg} hourBin={bin} />
      <WastewaterChart agg={agg} hourBin={bin} />
      <label className="hud-speed">
        Speed
        <input
          type="range" min={6} max={288} step={6}
          value={ticksPerSecond} onChange={(e) => onSpeed(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
