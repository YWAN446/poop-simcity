import { useMemo } from "react";
import { Map, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Layer } from "@deck.gl/core";
import type { Bundle } from "../data/loadBundle";
import { GAME_MAP_STYLE } from "../render/mapStyle";
import { DeckOverlay } from "../render/DeckOverlay";
import {
  agentData, makeAgentIconLayer, makeInfectionGlowLayer, venueData, makeVenueLayer,
  poopData, makePoopLayer, wastewaterData, makeWastewaterLayer, wastewaterGlobalMax,
  arcData, makeArcLayer,
} from "../render/layers";
import type { LayerFlags } from "./LayerToggles";
import { tickToDate } from "../sim/timeMapping";
import { dayNightTint } from "../render/theme";
import { usePulse } from "../hooks/usePulse";

export function MapView({ bundle, tick, flags }: { bundle: Bundle; tick: number; flags: LayerFlags }) {
  const [minLon, minLat, maxLon, maxLat] = bundle.manifest.bbox;
  const hour = tickToDate(bundle.manifest.startTime, bundle.manifest.tickIntervalSec, tick).getHours();
  // Venues don't change with time; build the layer once per bundle to avoid an
  // O(waypoints) dedup scan on every animation frame.
  // Memoize the expensive DATA (venue dedup), but build fresh Layer instances each
  // render. deck.gl layers are single-use descriptors — reusing one instance breaks
  // re-adding a layer after it's been toggled off.
  const venuePoints = useMemo(() => venueData(bundle), [bundle]);
  const wwMax = useMemo(() => wastewaterGlobalMax(bundle), [bundle]);
  const baseLayers = useMemo(() => {
    const ls: Layer[] = [];
    if (flags.wastewater) ls.push(makeWastewaterLayer(wastewaterData(bundle, tick), wwMax));
    if (flags.venues) ls.push(makeVenueLayer(venuePoints));
    if (flags.poops) ls.push(makePoopLayer(poopData(bundle, tick)));
    if (flags.arcs) ls.push(makeArcLayer(arcData(bundle, tick)));
    return ls;
  }, [bundle, tick, flags, venuePoints, wwMax]);

  // Agent positions/colors change only with tick/hour; the glow pulses every frame.
  const agents = useMemo(() => agentData(bundle, tick, hour), [bundle, tick, hour]);
  const glowData = useMemo(
    () => agents.filter((a) => a.code === 1 || a.code === 2),
    [agents],
  );
  const pulse = usePulse();

  const layers: Layer[] = [...baseLayers];
  if (flags.agents) {
    if (glowData.length > 0) layers.push(makeInfectionGlowLayer(glowData, pulse));
    layers.push(makeAgentIconLayer(agents));
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
