import { ScatterplotLayer, PolygonLayer, ArcLayer, IconLayer } from "@deck.gl/layers";
import type { Bundle } from "../data/loadBundle";
import { positionAtTick } from "../sim/interpolation";
import { stateAtTick } from "../sim/diseaseState";
import { STATE_COLORS, VENUE_COLORS, dayNightTint, scaleRgb, type RGBA } from "./theme";
import { hourBinIndex } from "../sim/timeMapping";

export interface AgentDatum {
  position: [number, number];
  color: RGBA;
  code: number;
}

// Draw priority so Exposed/Infectious render on top of the Susceptible/Recovered
// crowd (deck.gl draws later data last). S=0, R=3 sit at the bottom; E then I top.
const DRAW_PRIORITY: Record<number, number> = { 0: 0, 3: 1, 1: 2, 2: 3 };

/** Compute every agent's position + color at `tick`, ordered so E/I draw on top. */
export function agentData(bundle: Bundle, tick: number, hour: number): AgentDatum[] {
  const out: AgentDatum[] = [];
  const tint = dayNightTint(hour);
  const { agents, agentSlice, transitionsByAgent } = bundle;
  for (const [agentId, slice] of agentSlice) {
    const pos = positionAtTick(
      agents.tick, agents.lon, agents.lat, slice.offset, slice.count, tick,
    );
    if (!pos) continue;
    const code = stateAtTick(transitionsByAgent.get(agentId) ?? [], tick);
    out.push({ position: pos, color: scaleRgb(STATE_COLORS[code], tint), code });
  }
  out.sort((a, b) => DRAW_PRIORITY[a.code] - DRAW_PRIORITY[b.code]);
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

// Little-character sprite tinted per agent by disease state. mask:true makes the
// white silhouette take getColor; anchorY near the feet so characters "stand".
const AGENT_ICON_MAPPING = {
  marker: { x: 0, y: 0, width: 128, height: 128, mask: true, anchorY: 116 },
};

export function makeAgentIconLayer(data: AgentDatum[]) {
  return new IconLayer<AgentDatum>({
    id: "agents",
    data,
    iconAtlas: "/sprites/agent.png",
    iconMapping: AGENT_ICON_MAPPING,
    getIcon: () => "marker",
    getPosition: (d) => d.position,
    getColor: (d) => d.color,
    // Sized in meters: a small "crowd" of dots at city zoom that grows into
    // distinct little characters as you zoom in (clamped to a sane pixel range).
    getSize: 1500,
    sizeUnits: "meters",
    sizeMinPixels: 5,
    sizeMaxPixels: 34,
    billboard: true,
    alphaCutoff: 0.05,
    updateTriggers: { getColor: data },
  });
}

// Soft breathing halo behind Exposed/Infectious agents so an outbreak glows out
// of the calm crowd. `pulse` in [0,1] modulates radius and alpha. Not day/night
// tinted on purpose — infected should glow through the night.
export function makeInfectionGlowLayer(data: AgentDatum[], pulse: number) {
  return new ScatterplotLayer<AgentDatum>({
    id: "infection-glow",
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => {
      const infectious = d.code === 2;
      const alpha = Math.round((infectious ? 125 : 70) * (0.45 + 0.55 * pulse));
      return (infectious
        ? [235, 62, 45, alpha]
        : [245, 176, 48, alpha]) as RGBA;
    },
    getRadius: (d) => (d.code === 2 ? 1300 : 950) * (0.8 + 0.4 * pulse),
    radiusUnits: "meters",
    radiusMinPixels: 9,
    radiusMaxPixels: 46,
    stroked: false,
    pickable: false,
    updateTriggers: { getFillColor: pulse, getRadius: pulse },
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

/** Count of distinct venue positions by venue type id (drives the legend). */
export function countVenuesByType(bundle: Bundle): Record<number, number> {
  const seen = new Map<string, number>();
  const { agents } = bundle;
  for (let i = 0; i < agents.count; i++) {
    const key = `${agents.lon[i].toFixed(4)},${agents.lat[i].toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, agents.vtype[i]);
  }
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const v of seen.values()) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
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

// Poop-pile sprite, tinted per event (red = pathogen-bearing, brown = clean)
// and faded by age. mask:true makes the white silhouette take getColor; the
// anchor sits at the base so the pile "rests" on its location.
const POOP_ICON_MAPPING = {
  poop: { x: 0, y: 0, width: 128, height: 128, mask: true, anchorY: 122 },
};

export function makePoopLayer(data: PoopDatum[]) {
  return new IconLayer<PoopDatum>({
    id: "poops",
    data,
    iconAtlas: "/sprites/poop.png",
    iconMapping: POOP_ICON_MAPPING,
    getIcon: () => "poop",
    getPosition: (d) => d.position,
    getColor: (d) =>
      d.infected
        ? [230, 60, 48, Math.round(230 * (1 - d.age))] as [number, number, number, number]
        : [150, 110, 70, Math.round(195 * (1 - d.age))] as [number, number, number, number],
    // Grows as the splash ages; sized in meters so it scales with zoom (clamped).
    getSize: (d) => 700 + d.age * 800,
    sizeUnits: "meters",
    sizeMinPixels: 11,
    sizeMaxPixels: 40,
    billboard: true,
    alphaCutoff: 0.05,
    updateTriggers: { getColor: data, getSize: data },
  });
}

export interface WwDatum { polygon: [number, number][]; value: number; }

export function wastewaterData(bundle: Bundle, tick: number): WwDatum[] {
  const ww = bundle.wastewater;
  const bin = hourBinIndex(Math.round(tick), bundle.manifest.tickIntervalSec, ww.cadenceSec);
  return ww.regions.map((r) => ({
    polygon: r.polygon,
    value: ww.series[r.id]?.[Math.min(bin, (ww.series[r.id]?.length ?? 1) - 1)] ?? 0,
  }));
}

export function makeWastewaterLayer(data: WwDatum[]) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 1);
  return new PolygonLayer<WwDatum>({
    id: "wastewater",
    data,
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => {
      const t = Math.log10(d.value + 1) / Math.log10(max + 1);
      return [60 + t * 160, 200 - t * 120, 90, Math.round(20 + t * 140)] as [number, number, number, number];
    },
    stroked: false,
    extruded: false,
    updateTriggers: { getFillColor: data },
  });
}

export interface ArcDatum { source: [number, number]; target: [number, number]; age: number; }

const ARC_WINDOW_TICKS = 288; // ~1 day

export function arcData(bundle: Bundle, tick: number): ArcDatum[] {
  const out: ArcDatum[] = [];
  for (const [t, src, tgt] of bundle.disease.transmissions) {
    if (t > tick || t < tick - ARC_WINDOW_TICKS) continue;
    const s = bundle.agentSlice.get(src);
    const g = bundle.agentSlice.get(tgt);
    if (!s || !g) continue;
    const sp = positionAtTick(bundle.agents.tick, bundle.agents.lon, bundle.agents.lat, s.offset, s.count, tick);
    const gp = positionAtTick(bundle.agents.tick, bundle.agents.lon, bundle.agents.lat, g.offset, g.count, tick);
    if (sp && gp) out.push({ source: sp, target: gp, age: (tick - t) / ARC_WINDOW_TICKS });
  }
  return out;
}

export function makeArcLayer(data: ArcDatum[]) {
  return new ArcLayer<ArcDatum>({
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
