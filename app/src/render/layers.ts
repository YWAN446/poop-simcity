import { ScatterplotLayer } from "@deck.gl/layers";
import type { Bundle } from "../data/loadBundle";
import { positionAtTick } from "../sim/interpolation";
import { stateAtTick } from "../sim/diseaseState";
import { STATE_COLORS, VENUE_COLORS, type RGBA } from "./theme";

export interface AgentDatum {
  position: [number, number];
  color: RGBA;
}

/** Compute every agent's position + color at `tick`. */
export function agentData(bundle: Bundle, tick: number): AgentDatum[] {
  const out: AgentDatum[] = [];
  const { agents, agentSlice, transitionsByAgent } = bundle;
  for (const [agentId, slice] of agentSlice) {
    const pos = positionAtTick(
      agents.tick, agents.lon, agents.lat, slice.offset, slice.count, tick,
    );
    if (!pos) continue;
    const code = stateAtTick(transitionsByAgent.get(agentId) ?? [], tick);
    out.push({ position: pos, color: STATE_COLORS[code] });
  }
  return out;
}

export function makeAgentLayer(data: AgentDatum[]) {
  return new ScatterplotLayer<AgentDatum>({
    id: "agents",
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: 40,
    radiusMinPixels: 2,
    radiusMaxPixels: 8,
    pickable: false,
    updateTriggers: { getFillColor: data },
  });
}

export interface VenueDatum { position: [number, number]; color: RGBA; }

/** Unique venue positions (deduped by rounded lon/lat) colored by type. */
export function venueData(bundle: Bundle): VenueDatum[] {
  const seen = new Map<string, VenueDatum>();
  const { agents } = bundle;
  for (let i = 0; i < agents.count; i++) {
    const key = `${agents.lon[i].toFixed(4)},${agents.lat[i].toFixed(4)}`;
    if (!seen.has(key)) {
      seen.set(key, {
        position: [agents.lon[i], agents.lat[i]],
        color: VENUE_COLORS[agents.vtype[i]],
      });
    }
  }
  return [...seen.values()];
}

export function makeVenueLayer(data: VenueDatum[]) {
  return new ScatterplotLayer<VenueDatum>({
    id: "venues",
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: 25,
    radiusMinPixels: 1.5,
    radiusMaxPixels: 5,
    opacity: 0.5,
  });
}

export interface PoopDatum { position: [number, number]; age: number; infected: number; }

const SPLASH_WINDOW_TICKS = 24; // ~2 hours of fade

/** Poop events whose tick is within the fade window ending at `tick`. */
export function poopData(bundle: Bundle, tick: number): PoopDatum[] {
  const { poops } = bundle;
  const out: PoopDatum[] = [];
  let lo = 0, hi = poops.count - 1, startIdx = poops.count;
  const lowTick = tick - SPLASH_WINDOW_TICKS;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (poops.tick[mid] >= lowTick) { startIdx = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  for (let i = startIdx; i < poops.count && poops.tick[i] <= tick; i++) {
    out.push({
      position: [poops.lon[i], poops.lat[i]],
      age: (tick - poops.tick[i]) / SPLASH_WINDOW_TICKS,
      infected: poops.infected[i],
    });
  }
  return out;
}

export function makePoopLayer(data: PoopDatum[]) {
  return new ScatterplotLayer<PoopDatum>({
    id: "poops",
    data,
    getPosition: (d) => d.position,
    getRadius: (d) => 60 + d.age * 120,
    radiusMinPixels: 2,
    radiusMaxPixels: 14,
    getFillColor: (d) =>
      d.infected
        ? [120, 200, 90, Math.round(200 * (1 - d.age))] as [number, number, number, number]
        : [150, 110, 70, Math.round(140 * (1 - d.age))] as [number, number, number, number],
    stroked: false,
    updateTriggers: { getFillColor: data, getRadius: data },
  });
}
