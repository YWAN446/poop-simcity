// app/tests/layersV2.test.ts
import { describe, it, expect } from "vitest";
import {
  agentBinaryData, countVenuesByTypeV2, poopDataV2, venueOccupancyData,
} from "../src/render/layersV2";
import { createAgentFrame, updateAgentFrame } from "../src/render/agentFrame";
import type { BundleV2 } from "../src/types2";

function makeBundle(): BundleV2 {
  return {
    base: "/x",
    manifest: {
      numVenues: 2, bbox: [-118, 32, -116, 34],
      venueTypes: ["Apartment", "Workplace", "Restaurant", "Pub"],
    } as BundleV2["manifest"],
    venues: {
      lon: new Float32Array([-117.0, -116.5]),
      lat: new Float32Array([32.0, 33.0]),
      type: new Uint8Array([0, 3]),
      id: new Int32Array([10, 11]),
      count: 2,
    },
    stays: {
      tick: new Uint16Array([0, 0]),
      dwell: new Uint16Array([100, 100]),
      venue: new Uint16Array([0, 0]),
      count: 2,
    },
    stayIndex: new Map([[0, { offset: 0, count: 1 }], [1, { offset: 1, count: 1 }]]),
    agentIds: new Int32Array([0, 1]),
    poops: {
      tick: new Uint16Array([0, 10, 40]),
      lonQ: new Uint16Array([0, 32768, 65535]),
      latQ: new Uint16Array([0, 32768, 65535]),
      pathogen: new Float32Array([0, 5, 0]),
      infected: new Uint8Array([0, 1, 0]),
      count: 3,
    },
    transitionsByAgent: new Map(),
    transmissions: { tick: new Uint16Array(), source: new Uint16Array(),
                     target: new Uint16Array(), count: 0 },
    aggregates: {} as BundleV2["aggregates"],
    wastewater: { kind: "grid", cadenceSec: 3600, numBins: 0, regions: [],
                  values: new Float32Array() },
    poopLon: (i) => -118 + (i === 0 ? 0 : i === 1 ? 1 : 2),
    poopLat: (i) => 32 + (i === 0 ? 0 : i === 1 ? 1 : 2),
  };
}

describe("agentBinaryData", () => {
  it("exposes packed positions and a 4-channel colour attribute", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const data = agentBinaryData(f, 12);
    expect(data.length).toBe(2);
    expect(data.attributes.getPosition.size).toBe(2);
    expect(data.attributes.getColor.size).toBe(4);
    expect(data.attributes.getColor.value.length).toBe(2 * 4);
  });

  it("orders vertices by draw priority, not slot order", () => {
    const b = makeBundle();
    b.transitionsByAgent = new Map([[0, [[0, 2]]]]);   // agent 0 Infectious
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const data = agentBinaryData(f, 12);
    // Agent 0 must be drawn last, so its position occupies the final vertex.
    const lastLon = data.attributes.getPosition.value[2];
    expect(lastLon).toBeCloseTo(f.positions[0], 5);
  });
});

describe("venueOccupancyData", () => {
  it("emits one row per venue carrying its live occupancy", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const rows = venueOccupancyData(b, f);
    expect(rows).toHaveLength(2);
    expect(rows[0].occupancy).toBe(2);
    expect(rows[1].occupancy).toBe(0);
    expect(rows[0].position[0]).toBeCloseTo(-117.0, 5);
    expect(rows[1].type).toBe(3);
  });
});

describe("poopDataV2", () => {
  it("includes only events inside the fade window and ages them", () => {
    const rows = poopDataV2(makeBundle(), 10);
    expect(rows).toHaveLength(2);            // ticks 0 and 10, not 40
    expect(rows[1].age).toBeCloseTo(0, 5);   // tick 10 just happened
    expect(rows[0].age).toBeGreaterThan(0);
  });

  it("marks pathogen-bearing events as infected", () => {
    const rows = poopDataV2(makeBundle(), 10);
    expect(rows[1].infected).toBe(1);
    expect(rows[0].infected).toBe(0);
  });

  it("dequantizes coordinates through the bundle helpers", () => {
    const rows = poopDataV2(makeBundle(), 10);
    expect(rows[0].position).toEqual([-118, 32]);
  });
});

describe("countVenuesByTypeV2", () => {
  it("counts from the venue table rather than deduping waypoints", () => {
    expect(countVenuesByTypeV2(makeBundle())).toEqual({ 0: 1, 1: 0, 2: 0, 3: 1 });
  });
});
