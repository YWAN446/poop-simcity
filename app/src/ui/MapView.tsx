import { useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Layer } from "@deck.gl/core";
import type { Bundle } from "../data/loadBundle";
import { GAME_MAP_STYLE } from "../render/mapStyle";
import { DeckOverlay } from "../render/DeckOverlay";
import {
  agentData, makeAgentLayer, venueData, makeVenueLayer, poopData, makePoopLayer,
  wastewaterData, makeWastewaterLayer, arcData, makeArcLayer,
} from "../render/layers";
import type { LayerFlags } from "./LayerToggles";

export function MapView({ bundle, tick, flags }: { bundle: Bundle; tick: number; flags: LayerFlags }) {
  const [minLon, minLat, maxLon, maxLat] = bundle.manifest.bbox;
  const layers = useMemo(() => {
    const ls: Layer[] = [];
    if (flags.wastewater) ls.push(makeWastewaterLayer(wastewaterData(bundle, tick)));
    if (flags.venues) ls.push(makeVenueLayer(venueData(bundle)));
    if (flags.poops) ls.push(makePoopLayer(poopData(bundle, tick)));
    if (flags.arcs) ls.push(makeArcLayer(arcData(bundle, tick)));
    if (flags.agents) ls.push(makeAgentLayer(agentData(bundle, tick)));
    return ls;
  }, [bundle, tick, flags]);

  return (
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
    </Map>
  );
}
