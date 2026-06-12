import type { Aggregates, Manifest } from "../types";
import { tickToDate, hourBinIndex } from "../sim/timeMapping";
import { SeirChart } from "./SeirChart";
import { WastewaterChart } from "./WastewaterChart";

export function Hud({
  manifest, agg, tick, ticksPerSecond, onSpeed,
}: {
  manifest: Manifest; agg: Aggregates; tick: number;
  ticksPerSecond: number; onSpeed: (v: number) => void;
}) {
  const date = tickToDate(manifest.startTime, manifest.tickIntervalSec, tick);
  const bin = Math.min(
    agg.seir.S.length - 1,
    hourBinIndex(Math.round(tick), manifest.tickIntervalSec, agg.cadenceSec),
  );
  const counts = {
    S: agg.seir.S[bin], E: agg.seir.E[bin], I: agg.seir.I[bin], R: agg.seir.R[bin],
  };
  return (
    <div className="hud">
      <div className="hud-clock">{date.toLocaleString()}</div>
      <div className="hud-counts">
        <span className="c-s">S {counts.S}</span>
        <span className="c-e">E {counts.E}</span>
        <span className="c-i">I {counts.I}</span>
        <span className="c-r">R {counts.R}</span>
      </div>
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
