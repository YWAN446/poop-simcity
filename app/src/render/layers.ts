import { ScatterplotLayer } from "@deck.gl/layers";
import type { Bundle } from "../data/loadBundle";
import { positionAtTick } from "../sim/interpolation";
import { stateAtTick } from "../sim/diseaseState";
import { STATE_COLORS, type RGBA } from "./theme";

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
