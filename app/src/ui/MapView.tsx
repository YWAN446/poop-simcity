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
} from "../render/layersV2";
import type { LayerFlags } from "./LayerToggles";
import { tickToDate } from "../sim/timeMapping";
import { dayNightTint } from "../render/theme";

export function MapView({
  bundle, frame, tick, flags,
}: { bundle: BundleV2; frame: AgentFrame; tick: number; flags: LayerFlags }) {
  const [minLon, minLat, maxLon, maxLat] = bundle.manifest.bbox;
  const hour = tickToDate(bundle.manifest.windowStart, bundle.manifest.tickIntervalSec, tick).getHours();

  // The frame is mutated in place here and read by every layer below, so this must
  // run before any layer is constructed.
  updateAgentFrame(frame, bundle, tick);

  const layers: Layer[] = [];
  if (flags.venues) layers.push(makeVenueOccupancyLayer(venueOccupancyData(bundle, frame), tick));
  if (flags.poops) layers.push(makePoopLayer(poopDataV2(bundle, tick)));
  if (flags.agents) {
    layers.push(makeTravelTrailLayer(frame, tick));
    layers.push(makeAgentLayerV2(agentBinaryData(frame, hour), tick));
  }

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
