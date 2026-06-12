import { useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Layer } from "@deck.gl/core";
import type { Bundle } from "../data/loadBundle";
import { GAME_MAP_STYLE } from "../render/mapStyle";
import { DeckOverlay } from "../render/DeckOverlay";
import {
  agentData, makeAgentIconLayer, venueData, makeVenueLayer, poopData, makePoopLayer,
  wastewaterData, makeWastewaterLayer, arcData, makeArcLayer,
} from "../render/layers";
import type { LayerFlags } from "./LayerToggles";
import { tickToDate } from "../sim/timeMapping";
import { dayNightTint } from "../render/theme";

export function MapView({ bundle, tick, flags }: { bundle: Bundle; tick: number; flags: LayerFlags }) {
  const [minLon, minLat, maxLon, maxLat] = bundle.manifest.bbox;
  const hour = tickToDate(bundle.manifest.startTime, bundle.manifest.tickIntervalSec, tick).getHours();
  // Venues don't change with time; build the layer once per bundle to avoid an
  // O(waypoints) dedup scan on every animation frame.
  const venueLayer = useMemo(() => makeVenueLayer(venueData(bundle)), [bundle]);
  const layers = useMemo(() => {
    const ls: Layer[] = [];
    if (flags.wastewater) ls.push(makeWastewaterLayer(wastewaterData(bundle, tick)));
    if (flags.venues) ls.push(venueLayer);
    if (flags.poops) ls.push(makePoopLayer(poopData(bundle, tick)));
    if (flags.arcs) ls.push(makeArcLayer(arcData(bundle, tick)));
    if (flags.agents) ls.push(makeAgentIconLayer(agentData(bundle, tick, hour)));
    return ls;
  }, [bundle, tick, flags, hour, venueLayer]);

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
      </Map>
      <div
        className="night-overlay"
        style={{ background: `rgba(8,10,40,${nightAlpha})` }}
      />
    </>
  );
}
