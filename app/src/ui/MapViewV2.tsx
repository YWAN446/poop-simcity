import { useMemo } from "react";
import { Map, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Layer } from "@deck.gl/core";
import type { BundleV2 } from "../types2";
import { type AgentFrame, updateAgentFrame } from "../render/agentFrame";
import { GAME_MAP_STYLE } from "../render/mapStyle";
import { DeckOverlay } from "../render/DeckOverlay";
import { makePoopLayer } from "../render/layers";
import {
  agentBinaryData, makeAgentLayerV2, makeTravelTrailLayer,
  venueOccupancyData, makeVenueOccupancyLayer, poopDataV2,
  wastewaterDataV2, makeWastewaterLayerV2, wastewaterGlobalMaxV2,
  transmissionArcDataV2, makeArcLayerV2,
  infectionGlowData, makeInfectionGlowLayerV2,
  sewershedPolygonData, makeSewershedLayer,
} from "../render/layersV2";
import type { LayerFlags } from "./LayerToggles";
import { usePulse } from "../hooks/usePulse";
import { tickToDate } from "../sim/timeMapping";
import { dayNightTint } from "../render/theme";
import type { ScopeId } from "../sim/sewershedScope";

export function MapViewV2({
  bundle, frame, tick, flags, scope, onSelectScope,
}: {
  bundle: BundleV2; frame: AgentFrame; tick: number; flags: LayerFlags;
  /** Currently selected sewershed scope; drives the boundary layer's highlight. */
  scope: ScopeId;
  /** Selects a sewershed when its boundary is clicked, re-scoping the HUD charts. */
  onSelectScope: (id: string) => void;
}) {
  const [minLon, minLat, maxLon, maxLat] = bundle.manifest.bbox;
  const hour = tickToDate(bundle.manifest.windowStart, bundle.manifest.tickIntervalSec, tick).getHours();
  // Scans ~3.2M floats; compute once per bundle and reuse across every frame so
  // the wastewater layer's color scale stays comparable over the whole playback.
  const wwMax = useMemo(() => wastewaterGlobalMaxV2(bundle), [bundle]);
  // Driven by rAF rather than the playback clock, so the outbreak keeps breathing
  // while paused.
  const pulse = usePulse();

  // The frame is mutated in place here and read by every layer below, so this must
  // run before any layer is constructed.
  updateAgentFrame(frame, bundle, tick);

  const layers: Layer[] = [];
  // Drawn first (and thus underneath everything, including the agents) so the
  // boundaries read as ground beneath the simulation rather than an overlay on it.
  if (flags.sewersheds && bundle.sewersheds) {
    layers.push(makeSewershedLayer(
      sewershedPolygonData(bundle.sewersheds), scope, onSelectScope,
    ));
  }
  if (flags.wastewater) layers.push(makeWastewaterLayerV2(wastewaterDataV2(bundle, tick), wwMax));
  if (flags.venues) layers.push(makeVenueOccupancyLayer(venueOccupancyData(bundle, frame), tick));
  if (flags.poops) layers.push(makePoopLayer(poopDataV2(bundle, tick)));
  if (flags.agents) {
    layers.push(makeTravelTrailLayer(frame, tick));
    // Behind the sprites, so the halo reads as a glow around each agent.
    const glow = infectionGlowData(frame);
    if (glow.length > 0) layers.push(makeInfectionGlowLayerV2(glow, pulse));
    layers.push(makeAgentLayerV2(agentBinaryData(frame, hour), tick));
  }
  if (flags.arcs) layers.push(makeArcLayerV2(transmissionArcDataV2(bundle, frame, tick)));

  const nightAlpha = Math.max(0, (1 - dayNightTint(hour)) * 0.6);

  return (
    <>
      <Map
        initialViewState={{
          longitude: (minLon + maxLon) / 2,
          latitude: (minLat + maxLat) / 2,
          zoom: 9,
        }}
        mapStyle={GAME_MAP_STYLE}
        style={{ position: "absolute", inset: 0 }}
      >
        <DeckOverlay layers={layers} interleaved />
        <NavigationControl position="top-left" showCompass={false} />
      </Map>
      <div
        className="night-overlay"
        style={{ background: `rgba(8,10,40,${nightAlpha})` }}
      />
    </>
  );
}
