import { describe, it, expect } from "vitest";
import { createAgentFrame, updateAgentFrame } from "../src/render/agentFrame";
import { Presence } from "../src/sim/dwell";
import type { BundleV2 } from "../src/types2";

function makeBundle(): BundleV2 {
  const venues = {
    lon: new Float32Array([-117.0, -116.0]),
    lat: new Float32Array([32.0, 33.0]),
    type: new Uint8Array([0, 1]),
    id: new Int32Array([10, 11]),
    count: 2,
  };
  // Agent 0: venue 0 tick 0 dwell 10, then venue 1 tick 20 dwell 10.
  // Agent 1: venue 0 tick 0 dwell 100.
  // Agent 2: venue 1 tick 50 dwell 10  (absent before tick 50).
  const stays = {
    tick: new Uint16Array([0, 20, 0, 50]),
    dwell: new Uint16Array([10, 10, 100, 10]),
    venue: new Uint16Array([0, 1, 0, 1]),
    count: 4,
  };
  const stayIndex = new Map([
    [0, { offset: 0, count: 2 }],
    [1, { offset: 2, count: 1 }],
    [2, { offset: 3, count: 1 }],
  ]);
  return {
    base: "/x",
    manifest: { numVenues: 2 } as BundleV2["manifest"],
    venues,
    stays,
    stayIndex,
    agentIds: new Int32Array([0, 1, 2]),
    poops: { tick: new Uint16Array(), lonQ: new Uint16Array(), latQ: new Uint16Array(),
             infected: new Uint8Array(), count: 0 },
    transitionsByAgent: new Map([[1, [[0, 2]]]]),   // agent 1 infectious from tick 0
    transmissions: { tick: new Uint16Array(), source: new Uint16Array(),
                     target: new Uint16Array(), count: 0 },
    aggregates: {} as BundleV2["aggregates"],
    wastewater: { kind: "grid", cadenceSec: 3600, numBins: 0, regions: [],
                  values: new Float32Array() },
    poopLon: () => 0,
    poopLat: () => 0,
  };
}

describe("agentFrame", () => {
  it("allocates arrays sized to the agent and venue counts", () => {
    const f = createAgentFrame(makeBundle());
    expect(f.positions.length).toBe(6);
    expect(f.codes.length).toBe(3);
    expect(f.occupancy.length).toBe(2);
  });

  it("omits agents that have not checked in yet", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    expect(f.visible).toBe(2);
    expect(f.presence[2]).toBe(Presence.Absent);
  });

  it("counts venue occupancy only for dwelling agents", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    expect(Array.from(f.occupancy)).toEqual([2, 0]);   // agents 0 and 1 in venue 0
    updateAgentFrame(f, b, 15);                        // agent 0 now travelling
    expect(Array.from(f.occupancy)).toEqual([1, 0]);
  });

  it("resets occupancy between frames instead of accumulating", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    updateAgentFrame(f, b, 5);
    expect(Array.from(f.occupancy)).toEqual([2, 0]);
  });

  it("applies jitter so co-located agents get distinct positions", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    expect(f.positions[0]).not.toBe(f.positions[2]);
    expect(f.positions[0]).toBeCloseTo(-117.0, 2);   // still essentially at the venue
  });

  it("does not jitter travelling agents", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 15);                       // agent 0 halfway to venue 1
    expect(f.positions[0]).toBeCloseTo(-116.5, 5);
    expect(f.positions[1]).toBeCloseTo(32.5, 5);
  });

  it("orders visible slots so infectious agents draw last", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const order = Array.from(f.order.slice(0, f.visible));
    expect(f.codes[order[order.length - 1]]).toBe(2);   // agent 1 is Infectious
    expect(f.codes[order[0]]).toBe(0);
  });

  it("reuses the same array instances across frames", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    const positions = f.positions;
    updateAgentFrame(f, b, 5);
    updateAgentFrame(f, b, 60);
    expect(f.positions).toBe(positions);
  });
});
