import { Presence, resolvePose, type AgentPose } from "../sim/dwell";
import { jitterInto } from "../sim/jitter";
import { stateAtTick } from "../sim/diseaseState";
import type { BundleV2 } from "../types2";

/**
 * Per-frame agent state in reusable typed arrays.
 *
 * `createAgentFrame` allocates the frame's typed arrays once, sized to the agent and
 * venue counts. `updateAgentFrame` reuses them on every call: per-agent scratch
 * (`pose`, `jitterScratch`) and the empty-transitions sentinel (`NO_TRANSITIONS`) are
 * module-level and reused across agents and frames, so the per-frame path is
 * allocation-free. Draw order comes from four fixed buckets rather than a comparison
 * sort. The v1 path allocated an object per agent and sorted the array every frame —
 * at 10,000 agents and 60 fps that is 600k+ allocations per second.
 *
 * Arrays are indexed by *slot* — the agent's position in `bundle.agentIds` — not by
 * agent id.
 */
export interface AgentFrame {
  positions: Float32Array;   // packed [lon, lat] per slot
  codes: Uint8Array;         // disease state code per slot
  presence: Uint8Array;      // Presence per slot
  order: Uint32Array;        // first `visible` entries are slots in draw order
  visible: number;
  occupancy: Uint16Array;    // agents currently inside each venue
}

// S and R form the calm backdrop; E then I draw over them.
const DRAW_BUCKETS = [0, 3, 1, 2];

export function createAgentFrame(bundle: BundleV2): AgentFrame {
  const n = bundle.agentIds.length;
  return {
    positions: new Float32Array(n * 2),
    codes: new Uint8Array(n),
    presence: new Uint8Array(n),
    order: new Uint32Array(n),
    visible: 0,
    occupancy: new Uint16Array(bundle.manifest.numVenues),
  };
}

const pose: AgentPose = { lon: 0, lat: 0, presence: Presence.Absent, venue: -1 };
const jitterScratch: [number, number] = [0, 0];
// Shared sentinel for agents with no transition record (never exposed in this
// window) — frozen so a future `stateAtTick` change can't mutate shared state.
const NO_TRANSITIONS = Object.freeze([]) as unknown as [number, number][];
const buckets: number[][] = [[], [], [], []];

export function updateAgentFrame(
  frame: AgentFrame,
  bundle: BundleV2,
  tick: number,
): void {
  const { stays, venues, stayIndex, agentIds, transitionsByAgent } = bundle;
  frame.occupancy.fill(0);
  for (const b of buckets) b.length = 0;

  for (let slot = 0; slot < agentIds.length; slot++) {
    const agentId = agentIds[slot];
    const slice = stayIndex.get(agentId);
    if (!slice) {
      frame.presence[slot] = Presence.Absent;
      continue;
    }

    const presence = resolvePose(stays, venues, slice, tick, pose);
    frame.presence[slot] = presence;
    if (presence === Presence.Absent) continue;

    let lon = pose.lon;
    let lat = pose.lat;
    if (presence === Presence.Dwelling) {
      frame.occupancy[pose.venue]++;
      jitterInto(agentId, lat, jitterScratch);
      lon += jitterScratch[0];
      lat += jitterScratch[1];
    }
    frame.positions[slot * 2] = lon;
    frame.positions[slot * 2 + 1] = lat;

    const code = stateAtTick(transitionsByAgent.get(agentId) ?? NO_TRANSITIONS, tick);
    frame.codes[slot] = code;
    buckets[code].push(slot);
  }

  let w = 0;
  for (const code of DRAW_BUCKETS) {
    for (const slot of buckets[code]) frame.order[w++] = slot;
  }
  frame.visible = w;
}
