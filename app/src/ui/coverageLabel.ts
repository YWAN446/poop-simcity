import type { ManifestV2 } from "../types2";

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

/**
 * Caveat about the render stream's clean-poop downsampling, or "" for a full-fidelity
 * bundle. Every pathogen-bearing event is always kept; only clean events are sampled down
 * to `cleanPoopKeepFraction`, so a bundle built with a low fraction shows far more red
 * (infected) splashes on the map than the underlying data actually contains. `1.0` means
 * nothing was trimmed, so the caveat is omitted rather than stating a no-op fraction.
 */
function cleanPoopCoverageNote(cleanPoopKeepFraction: number): string {
  if (cleanPoopKeepFraction >= 1) return "";
  const pct = Math.round(cleanPoopKeepFraction * 100);
  return ` · clean poops sampled at ${pct}% (all infected kept), so infected are over-represented`;
}

/** Honest, manifest-derived summary of the simulated window and its precision. */
export function coverageLabel(manifest: ManifestV2): string {
  const start = new Date(manifest.windowStart);
  const end = new Date(manifest.windowEnd);
  const startLabel = start.getFullYear() === end.getFullYear()
    ? formatMonthDay(start)
    : `${formatMonthDay(start)} ${start.getFullYear()}`;
  const endLabel = `${formatMonthDay(end)} ${end.getFullYear()}`;
  const resolution = RESOLUTION_PHRASES[manifest.coverage.recoveryTimeResolution]
    ?? manifest.coverage.recoveryTimeResolution;
  const note = cleanPoopCoverageNote(manifest.coverage.cleanPoopKeepFraction);
  return `${startLabel} – ${endLabel} · recovery times resolved to ${resolution}${note}`;
}
