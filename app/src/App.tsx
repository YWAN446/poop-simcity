import { useMemo, useState } from "react";
import { useBundle } from "./hooks/useBundle";
import { usePlayback } from "./hooks/usePlayback";
import { MapView } from "./ui/MapView";
import { Timeline } from "./ui/Timeline";
import { Hud } from "./ui/Hud";
import { LayerToggles, type LayerFlags } from "./ui/LayerToggles";
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
  const [flags, setFlags] = useState<LayerFlags>({
    agents: true, poops: true, venues: true, wastewater: false, arcs: false,
  });
  return (
    <div className="app-shell">
      <MapView bundle={bundle} tick={tick} flags={flags} />
      <Hud
        manifest={bundle.manifest}
        agg={bundle.aggregates}
        tick={tick}
        ticksPerSecond={ticksPerSecond}
        onSpeed={setTicksPerSecond}
      />
      <button
        className="play-btn"
        onClick={() => {
          if (!playing && tick >= range.max) seek(bundle.manifest.outbreakWindow.startTick);
          setPlaying(!playing);
        }}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <Timeline manifest={bundle.manifest} tick={tick} onSeek={seek} />
      <LayerToggles flags={flags} onChange={setFlags} />
    </div>
  );
}
