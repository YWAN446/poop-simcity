// app/src/render/layersV2.ts
import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { AgentFrame } from "./agentFrame";
import { Presence } from "../sim/dwell";
import { STATE_COLORS, VENUE_COLORS, dayNightTint, scaleRgb } from "./theme";
import type { BundleV2 } from "../types2";

export interface AgentBinaryData {
  length: number;
  attributes: {
    getPosition: { value: Float32Array; size: 2 };
    getColor: { value: Uint8Array; size: 4 };
  };
}

// Reused across frames; grown only when the visible count exceeds capacity.
let positionScratch = new Float32Array(0);
let colorScratch = new Uint8Array(0);

/**
 * Repack the frame's visible slots into contiguous deck.gl binary attributes.
 * Vertices follow `frame.order`, so Exposed/Infectious agents land last and draw
 * on top of the calm crowd.
 */
export function agentBinaryData(frame: AgentFrame, hour: number): AgentBinaryData {
  const n = frame.visible;
  if (positionScratch.length < n * 2) {
    positionScratch = new Float32Array(n * 2);
    colorScratch = new Uint8Array(n * 4);
  }
  const tint = dayNightTint(hour);

  for (let v = 0; v < n; v++) {
    const slot = frame.order[v];
    positionScratch[v * 2] = frame.positions[slot * 2];
    positionScratch[v * 2 + 1] = frame.positions[slot * 2 + 1];
    const [r, g, b, a] = scaleRgb(STATE_COLORS[frame.codes[slot]], tint);
    colorScratch[v * 4] = r;
    colorScratch[v * 4 + 1] = g;
    colorScratch[v * 4 + 2] = b;
    colorScratch[v * 4 + 3] = a;
  }

  return {
    length: n,
    attributes: {
      getPosition: { value: positionScratch.subarray(0, n * 2), size: 2 },
      getColor: { value: colorScratch.subarray(0, n * 4), size: 4 },
    },
  };
}

const AGENT_ICON_MAPPING = {
  marker: { x: 0, y: 0, width: 128, height: 128, mask: true, anchorY: 116 },
};

export function makeAgentLayerV2(data: AgentBinaryData, updateTrigger: number) {
  return new IconLayer({
    id: "agents",
    data,
    iconAtlas: "/sprites/agent.png",
    iconMapping: AGENT_ICON_MAPPING,
    getIcon: () => "marker",
    getSize: 1500,
    sizeUnits: "meters",
    sizeMinPixels: 5,
    sizeMaxPixels: 34,
    billboard: true,
    alphaCutoff: 0.05,
    updateTriggers: { getPosition: updateTrigger, getColor: updateTrigger },
  });
}

/**
 * A faint dot behind each travelling agent. Travel occupies only a few percent of
 * an agent's timeline, so without a distinct treatment commute waves are invisible
 * against the parked majority.
 */
export function makeTravelTrailLayer(frame: AgentFrame, tick: number) {
  const moving: { position: [number, number] }[] = [];
  for (let v = 0; v < frame.visible; v++) {
    const slot = frame.order[v];
    if (frame.presence[slot] === Presence.Travelling) {
      moving.push({
        position: [frame.positions[slot * 2], frame.positions[slot * 2 + 1]],
      });
    }
  }
  return new ScatterplotLayer<{ position: [number, number] }>({
    id: "travel-trails",
    data: moving,
    getPosition: (d) => d.position,
    getFillColor: [255, 255, 255, 60],
    getRadius: 900,
    radiusUnits: "meters",
    radiusMinPixels: 3,
    radiusMaxPixels: 18,
    stroked: false,
    pickable: false,
    updateTriggers: { getPosition: tick },
  });
}

export interface VenueOccupancyDatum {
  position: [number, number];
  type: number;
  occupancy: number;
}

export function venueOccupancyData(
  bundle: BundleV2,
  frame: AgentFrame,
): VenueOccupancyDatum[] {
  const { venues } = bundle;
  const rows: VenueOccupancyDatum[] = new Array(venues.count);
  for (let i = 0; i < venues.count; i++) {
    rows[i] = {
      position: [venues.lon[i], venues.lat[i]],
      type: venues.type[i],
      occupancy: frame.occupancy[i],
    };
  }
  return rows;
}

export function makeVenueOccupancyLayer(data: VenueOccupancyDatum[], tick: number) {
  return new ScatterplotLayer<VenueOccupancyDatum>({
    id: "venues",
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => VENUE_COLORS[d.type],
    // Radius grows with the square root of occupancy so a busy venue reads as busy
    // without a full apartment block swamping the map.
    getRadius: (d) => 25 + 55 * Math.sqrt(d.occupancy),
    radiusUnits: "meters",
    radiusMinPixels: 1.5,
    radiusMaxPixels: 22,
    opacity: 0.5,
    stroked: false,
    updateTriggers: { getRadius: tick },
  });
}

export interface PoopDatumV2 {
  position: [number, number];
  age: number;
  infected: number;
}

const SPLASH_WINDOW_TICKS = 24; // ~2 hours of fade

export function poopDataV2(bundle: BundleV2, tick: number): PoopDatumV2[] {
  const { poops } = bundle;
  const lowTick = tick - SPLASH_WINDOW_TICKS;
  let lo = 0;
  let hi = poops.count - 1;
  let startIdx = poops.count;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (poops.tick[mid] >= lowTick) {
      startIdx = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const out: PoopDatumV2[] = [];
  for (let i = startIdx; i < poops.count && poops.tick[i] <= tick; i++) {
    out.push({
      position: [bundle.poopLon(i), bundle.poopLat(i)],
      age: (tick - poops.tick[i]) / SPLASH_WINDOW_TICKS,
      infected: poops.infected[i],
    });
  }
  return out;
}

export function countVenuesByTypeV2(bundle: BundleV2): Record<number, number> {
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < bundle.venues.count; i++) {
    counts[bundle.venues.type[i]]++;
  }
  return counts;
}
