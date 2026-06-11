import { useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bundle } from "../data/loadBundle";
import { GAME_MAP_STYLE } from "../render/mapStyle";
import { DeckOverlay } from "../render/DeckOverlay";
import { agentData, makeAgentLayer } from "../render/layers";

export function MapView({ bundle, tick }: { bundle: Bundle; tick: number }) {
  const [minLon, minLat, maxLon, maxLat] = bundle.manifest.bbox;
  const layers = useMemo(() => [makeAgentLayer(agentData(bundle, tick))], [bundle, tick]);

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
