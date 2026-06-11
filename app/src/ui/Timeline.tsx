import type { Manifest } from "../types";

export function Timeline({
  manifest, tick, onSeek,
}: { manifest: Manifest; tick: number; onSeek: (t: number) => void }) {
  const max = manifest.numTicks - 1;
  const ow = manifest.outbreakWindow;
  const pct = (t: number) => `${(t / max) * 100}%`;
  return (
    <div className="timeline">
      <div className="timeline-track">
        <div
          className="timeline-outbreak"
          style={{ left: pct(ow.startTick), width: pct(ow.endTick - ow.startTick) }}
        />
        <input
          type="range"
          min={0}
          max={max}
          value={Math.round(tick)}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
