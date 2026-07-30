import type { Aggregates } from "../types";
import type { ManifestV2 } from "../types2";
import { hourBinIndex } from "../sim/timeMapping";
import { SeirChart } from "./SeirChart";
import { WastewaterChart } from "./WastewaterChart";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatMonthDay(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// Maps the manifest's coarse-grained coverage vocabulary to a short phrase.
// Falls back to the raw value for a resolution this HUD doesn't have wording for,
// rather than silently mis-describing it.
const RESOLUTION_PHRASES: Record<string, string> = {
  daily: "the day",
  hourly: "the hour",
};

/** Honest, manifest-derived summary of the simulated window and its precision. */
function coverageLabel(manifest: ManifestV2): string {
  const start = new Date(manifest.windowStart);
  const end = new Date(manifest.windowEnd);
  const startLabel = start.getFullYear() === end.getFullYear()
    ? formatMonthDay(start)
    : `${formatMonthDay(start)} ${start.getFullYear()}`;
  const endLabel = `${formatMonthDay(end)} ${end.getFullYear()}`;
  const resolution = RESOLUTION_PHRASES[manifest.coverage.recoveryTimeResolution]
    ?? manifest.coverage.recoveryTimeResolution;
  return `${startLabel} – ${endLabel} · recovery times resolved to ${resolution}`;
}

export function Hud({
  manifest, agg, tick, ticksPerSecond, onSpeed,
}: {
  manifest: ManifestV2; agg: Aggregates; tick: number;
  ticksPerSecond: number; onSpeed: (v: number) => void;
}) {
  // Clamp the hourly bin; each chart shows its own date + values readout below it.
  const bin = Math.min(
    agg.seir.S.length - 1,
    hourBinIndex(Math.round(tick), manifest.tickIntervalSec, agg.cadenceSec),
  );
  return (
    <div className="hud">
      <div style={{ font: "600 11px system-ui", color: "#aaa" }}>
        {coverageLabel(manifest)}
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
