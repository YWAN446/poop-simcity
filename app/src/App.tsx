import { useMemo, useState } from "react";
import { useBundleV2 } from "./hooks/useBundleV2";
import { usePlayback } from "./hooks/usePlayback";
import { MapView } from "./ui/MapView";
import { Timeline } from "./ui/Timeline";
import { Hud } from "./ui/Hud";
import { LayerToggles, type LayerFlags } from "./ui/LayerToggles";
import { Legend } from "./ui/Legend";
import { countVenuesByTypeV2 } from "./render/layersV2";
import { createAgentFrame } from "./render/agentFrame";
import type { BundleV2 } from "./types2";

const BUNDLE_BASE = "/data/dataset_sdc-10k";

export default function App() {
  const state = useBundleV2(BUNDLE_BASE);
  if (state.status === "loading") return <div className="app-shell">Loading…</div>;
  if (state.status === "error")
    return <div className="app-shell">Error: {state.message}</div>;
  return <Playback bundle={state.bundle} />;
}

function Playback({ bundle }: { bundle: BundleV2 }) {
  const range = useMemo(
    () => ({ min: 0, max: bundle.manifest.numTicks - 1 }),
    [bundle.manifest.numTicks],
  );
  const { tick, playing, setPlaying, seek, ticksPerSecond, setTicksPerSecond } = usePlayback(
    range,
    bundle.manifest.outbreakWindow.startTick,
  );
  // `arcs` is the Transmissions layer. On by default: it is cheap (a few dozen live
  // arcs even at the outbreak peak) and it is the clearest thing on the map that the
  // exact per-agent exposure times in this run made possible. Wastewater stays off —
  // it covers the map in polygons and is better opted into.
  const [flags, setFlags] = useState<LayerFlags>({
    agents: true, poops: true, venues: true, wastewater: false, arcs: true,
  });
  const venueCounts = useMemo(() => countVenuesByTypeV2(bundle), [bundle]);
  const frame = useMemo(() => createAgentFrame(bundle), [bundle]);
  return (
    <div className="app-shell">
      <MapView bundle={bundle} frame={frame} tick={tick} flags={flags} />
      <Legend venueCounts={venueCounts} />
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
