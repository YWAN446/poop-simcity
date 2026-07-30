// app/src/render/layersV2.ts
import { ArcLayer, IconLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { AgentFrame } from "./agentFrame";
import { Presence } from "../sim/dwell";
import { STATE_COLORS, VENUE_COLORS, dayNightTint, scaleRgb } from "./theme";
import { hourBinIndex } from "../sim/timeMapping";
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

// ---------------------------------------------------------------------------
// Wastewater grid
//
// v2's matrix is a single flat, row-major Float32Array (region-major: value for
// region `r` at bin `b` lives at `values[r * numBins + b]`), unlike v1's
// `Record<regionId, number[]>` series map. There's no per-region lookup by id
// needed here since region order in `regions[]` matches row order in `values`.
// ---------------------------------------------------------------------------

export interface WwDatumV2 { polygon: [number, number][]; value: number; }

/** Convert `tick` to a bin index into the wastewater matrix, clamped to range. */
export function wastewaterBinIndexV2(bundle: BundleV2, tick: number): number {
  const { cadenceSec, numBins } = bundle.wastewater;
  const bin = hourBinIndex(tick, bundle.manifest.tickIntervalSec, cadenceSec);
  return Math.min(numBins - 1, Math.max(0, bin));
}

/** Per-region pathogen value for the bin containing `tick`. */
export function wastewaterDataV2(bundle: BundleV2, tick: number): WwDatumV2[] {
  const { regions, values, numBins } = bundle.wastewater;
  const bin = wastewaterBinIndexV2(bundle, tick);
  const out: WwDatumV2[] = new Array(regions.length);
  for (let r = 0; r < regions.length; r++) {
    out[r] = { polygon: regions[r].polygon, value: values[r * numBins + bin] };
  }
  return out;
}

/**
 * Largest per-cell pathogen value across all regions and all time bins (~632 x
 * 5112 floats). Colors the wastewater layer on an absolute scale so a given
 * color always means the same pathogen load across playback, same contract as
 * v1's `wastewaterGlobalMax`. Callers must compute this once per bundle (e.g.
 * via `useMemo` keyed on `bundle`) and reuse it — it is too expensive to run
 * per frame.
 */
export function wastewaterGlobalMaxV2(bundle: BundleV2): number {
  let max = 1;
  const { values } = bundle.wastewater;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > max) max = values[i];
  }
  return max;
}

export function makeWastewaterLayerV2(data: WwDatumV2[], max: number) {
  const logMax = Math.log10(max + 1);
  return new PolygonLayer<WwDatumV2>({
    id: "wastewater",
    data,
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => {
      const t = Math.log10(d.value + 1) / logMax; // 0 (green) .. 1 (red), log-scaled
      return [60 + t * 160, 200 - t * 120, 90, Math.round(20 + t * 140)] as [number, number, number, number];
    },
    stroked: false,
    extruded: false,
    updateTriggers: { getFillColor: [data, max] },
  });
}

// ---------------------------------------------------------------------------
// Transmission arcs
//
// v2's `transmissions` is a struct-of-arrays sorted ascending by tick (vs v1's
// array of [tick, source, target] triples), so the time window is a binary
// search rather than a linear scan. Endpoints are agent ids, but the live frame
// is indexed by slot, so an id -> slot reverse index is required; it's cached
// per bundle (keyed on the `agentIds` array identity) rather than rebuilt per
// frame or per call.
// ---------------------------------------------------------------------------

export interface ArcDatumV2 { source: [number, number]; target: [number, number]; age: number; }

const ARC_WINDOW_TICKS = 288; // ~1 day, matches v1

const slotIndexCache = new WeakMap<Int32Array, Map<number, number>>();

function agentSlotIndex(bundle: BundleV2): Map<number, number> {
  let idx = slotIndexCache.get(bundle.agentIds);
  if (!idx) {
    idx = new Map();
    for (let slot = 0; slot < bundle.agentIds.length; slot++) {
      idx.set(bundle.agentIds[slot], slot);
    }
    slotIndexCache.set(bundle.agentIds, idx);
  }
  return idx;
}

/**
 * Transient source->target arcs for transmissions within `ARC_WINDOW_TICKS` of
 * `tick`. Positions come from the live agent frame (packed by slot); a
 * transmission is skipped if either endpoint isn't currently visible (not yet
 * arrived, or the agent has no active presence this tick).
 */
export function transmissionArcDataV2(
  bundle: BundleV2, frame: AgentFrame, tick: number,
): ArcDatumV2[] {
  const { transmissions } = bundle;
  const slotOf = agentSlotIndex(bundle);
  const lowTick = tick - ARC_WINDOW_TICKS;

  let lo = 0, hi = transmissions.count - 1, start = transmissions.count;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (transmissions.tick[mid] >= lowTick) { start = mid; hi = mid - 1; } else { lo = mid + 1; }
  }

  const out: ArcDatumV2[] = [];
  for (let i = start; i < transmissions.count && transmissions.tick[i] <= tick; i++) {
    const srcSlot = slotOf.get(transmissions.source[i]);
    const tgtSlot = slotOf.get(transmissions.target[i]);
    if (srcSlot === undefined || tgtSlot === undefined) continue;
    if (frame.presence[srcSlot] === Presence.Absent) continue;
    if (frame.presence[tgtSlot] === Presence.Absent) continue;
    out.push({
      source: [frame.positions[srcSlot * 2], frame.positions[srcSlot * 2 + 1]],
      target: [frame.positions[tgtSlot * 2], frame.positions[tgtSlot * 2 + 1]],
      age: (tick - transmissions.tick[i]) / ARC_WINDOW_TICKS,
    });
  }
  return out;
}

export function makeArcLayerV2(data: ArcDatumV2[]) {
  return new ArcLayer<ArcDatumV2>({
    id: "arcs",
    data,
    getSourcePosition: (d) => d.source,
    getTargetPosition: (d) => d.target,
    getSourceColor: (d) => [229, 80, 57, Math.round(220 * (1 - d.age))] as [number, number, number, number],
    getTargetColor: (d) => [237, 187, 79, Math.round(220 * (1 - d.age))] as [number, number, number, number],
    getWidth: 2,
    updateTriggers: { getSourceColor: data, getTargetColor: data },
  });
}
