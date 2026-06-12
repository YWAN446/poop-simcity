import { useMemo } from "react";
import { useBundle } from "./hooks/useBundle";
import { usePlayback } from "./hooks/usePlayback";
import { MapView } from "./ui/MapView";
import { Timeline } from "./ui/Timeline";
import { Hud } from "./ui/Hud";
import type { Bundle } from "./data/loadBundle";

const BUNDLE_BASE = "/data/dataset_00";

export default function App() {
  const state = useBundle(BUNDLE_BASE);
  if (state.status === "loading") return <div className="app-shell">Loading…</div>;
  if (state.status === "error")
    return <div className="app-shell">Error: {state.message}</div>;
  return <Playback bundle={state.bundle} />;
}

function Playback({ bundle }: { bundle: Bundle }) {
  const range = useMemo(
    () => ({ min: 0, max: bundle.manifest.numTicks - 1 }),
    [bundle.manifest.numTicks],
  );
  const { tick, playing, setPlaying, seek, ticksPerSecond, setTicksPerSecond } = usePlayback(
    range,
    bundle.manifest.outbreakWindow.startTick,
  );
  return (
    <div className="app-shell">
      <MapView bundle={bundle} tick={tick} />
      <Hud
        manifest={bundle.manifest}
        agg={bundle.aggregates}
        tick={tick}
        ticksPerSecond={ticksPerSecond}
        onSpeed={setTicksPerSecond}
      />
      <button className="play-btn" onClick={() => setPlaying(!playing)}>
        {playing ? "Pause" : "Play"}
      </button>
      <Timeline manifest={bundle.manifest} tick={tick} onSeek={seek} />
    </div>
  );
}
