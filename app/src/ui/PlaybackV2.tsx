import { useMemo, useState } from "react";
import { useBundleV2 } from "../hooks/useBundleV2";
import { usePlayback } from "../hooks/usePlayback";
import { MapViewV2 } from "./MapViewV2";
import { Timeline } from "./Timeline";
import { Hud } from "./Hud";
import { LayerToggles, type LayerFlags } from "./LayerToggles";
import { Legend } from "./Legend";
import { DatasetError } from "./DatasetError";
import { coverageLabel } from "./coverageLabel";
import { countVenuesByTypeV2 } from "../render/layersV2";
import { createAgentFrame } from "../render/agentFrame";
import { ALL_SCOPE, scopeOptions, scopedAggregates, scopeHeading, type ScopeId } from "../sim/sewershedScope";
import { SewershedSelector } from "./SewershedSelector";
import type { DatasetEntry } from "../data/datasets";
import type { BundleV2 } from "../types2";

/** schemaVersion-2 playback path (dwell-time movement, typed-array bundle). */
export function PlaybackV2({ dataset }: { dataset: DatasetEntry }) {
  const state = useBundleV2(dataset.base);
  if (state.status === "loading") return <div className="dataset-status">Loading {dataset.label}…</div>;
  if (state.status === "error") return <DatasetError dataset={dataset} message={state.message} />;
  return <ReadyV2 bundle={state.bundle} />;
}

function ReadyV2({ bundle }: { bundle: BundleV2 }) {
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
    // Cheap (a handful of polygons) and the whole point of this feature, so on by default.
    sewersheds: true,
  });
  const venueCounts = useMemo(() => countVenuesByTypeV2(bundle), [bundle]);
  const frame = useMemo(() => createAgentFrame(bundle), [bundle]);
  const [scope, setScope] = useState<ScopeId>(ALL_SCOPE);
  const options = useMemo(() => scopeOptions(bundle), [bundle]);
  const agg = useMemo(() => scopedAggregates(bundle, scope), [bundle, scope]);
  return (
    <>
      <MapViewV2
        bundle={bundle} frame={frame} tick={tick} flags={flags}
        scope={scope} onSelectScope={setScope}
      />
      <Legend venueCounts={venueCounts} />
      <Hud
        manifest={bundle.manifest}
        agg={agg}
        tick={tick}
        ticksPerSecond={ticksPerSecond}
        onSpeed={setTicksPerSecond}
        coverageLine={coverageLabel(bundle.manifest)}
        scopeLine={bundle.sewersheds && scopeHeading(bundle, scope)}
        scopeSelector={bundle.sewersheds && (
          <SewershedSelector
            options={options}
            selected={scope}
            onChange={setScope}
            kind={bundle.sewersheds.kind}
          />
        )}
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
      <LayerToggles flags={flags} onChange={setFlags} hasSewersheds={bundle.sewersheds != null} />
    </>
  );
}
