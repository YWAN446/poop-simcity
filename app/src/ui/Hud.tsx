import type { Aggregates, Manifest } from "../types";
import { hourBinIndex } from "../sim/timeMapping";
import { SeirChart } from "./SeirChart";
import { WastewaterChart } from "./WastewaterChart";

export function Hud({
  manifest, agg, tick, ticksPerSecond, onSpeed,
}: {
  manifest: Manifest; agg: Aggregates; tick: number;
  ticksPerSecond: number; onSpeed: (v: number) => void;
}) {
  // Clamp the hourly bin; each chart shows its own date + values readout below it.
  const bin = Math.min(
    agg.seir.S.length - 1,
    hourBinIndex(Math.round(tick), manifest.tickIntervalSec, agg.cadenceSec),
  );
  return (
    <div className="hud">
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
