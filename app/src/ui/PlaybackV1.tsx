import { useMemo, useState } from "react";
import { useBundle } from "../hooks/useBundle";
import { usePlayback } from "../hooks/usePlayback";
import { MapViewV1 } from "./MapViewV1";
import { Timeline } from "./Timeline";
import { Hud } from "./Hud";
import { LayerToggles, type LayerFlags } from "./LayerToggles";
import { Legend } from "./Legend";
import { DatasetError } from "./DatasetError";
import { countVenuesByType } from "../render/layers";
import type { DatasetEntry } from "../data/datasets";
import type { Bundle } from "../data/loadBundle";

/** schemaVersion-1 playback path (the original Atlanta run). */
export function PlaybackV1({ dataset }: { dataset: DatasetEntry }) {
  const state = useBundle(dataset.base);
  if (state.status === "loading") return <div className="dataset-status">Loading {dataset.label}…</div>;
  if (state.status === "error") return <DatasetError dataset={dataset} message={state.message} />;
  return <ReadyV1 bundle={state.bundle} />;
}

function ReadyV1({ bundle }: { bundle: Bundle }) {
  const range = useMemo(
    () => ({ min: 0, max: bundle.manifest.numTicks - 1 }),
    [bundle.manifest.numTicks],
  );
  const { tick, playing, setPlaying, seek, ticksPerSecond, setTicksPerSecond } = usePlayback(
    range,
    bundle.manifest.outbreakWindow.startTick,
  );
  const [flags, setFlags] = useState<LayerFlags>({
    agents: true, poops: true, venues: true, wastewater: false, arcs: true,
  });
  const venueCounts = useMemo(() => countVenuesByType(bundle), [bundle]);
  return (
    <>
      <MapViewV1 bundle={bundle} tick={tick} flags={flags} />
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
    </>
  );
}
