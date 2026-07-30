// app/tests/layersV2.test.ts
import { describe, it, expect } from "vitest";
import {
  agentBinaryData, countVenuesByTypeV2, poopDataV2, venueOccupancyData,
  wastewaterDataV2, wastewaterBinIndexV2, wastewaterGlobalMaxV2,
  transmissionArcDataV2,
} from "../src/render/layersV2";
import { createAgentFrame, updateAgentFrame, type AgentFrame } from "../src/render/agentFrame";
import { Presence } from "../src/sim/dwell";
import type { BundleV2 } from "../src/types2";

function makeBundle(): BundleV2 {
  return {
    base: "/x",
    manifest: {
      numVenues: 2, bbox: [-118, 32, -116, 34], tickIntervalSec: 300,
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

  it("keeps the same data array and row identity across frames, mutating occupancy in place", () => {
    // deck.gl invalidates every attribute for every venue when the `data` array
    // it's handed changes identity, which also makes `updateTriggers: { getRadius }`
    // inert. venueOccupancyData must hand back the *same* array (and the same row
    // objects within it) across calls for one bundle, updating only `occupancy`.
    const b = makeBundle();
    const f = createAgentFrame(b);

    updateAgentFrame(f, b, -1); // before either agent's single stay starts -> both Absent
    const first = venueOccupancyData(b, f);
    const firstRow0 = first[0];
    expect(first[0].occupancy).toBe(0);

    updateAgentFrame(f, b, 5); // both agents now dwelling at venue 0
    const second = venueOccupancyData(b, f);

    expect(second).toBe(first);           // stable array identity
    expect(second[0]).toBe(firstRow0);    // stable row identity
    expect(second[0].occupancy).toBe(2);  // occupancy actually updated in place
    expect(second[0].position[0]).toBeCloseTo(-117.0, 5); // static fields untouched
  });

  it("does not share cached rows between distinct bundles", () => {
    const b1 = makeBundle();
    const b2 = makeBundle();
    const f1 = createAgentFrame(b1);
    const f2 = createAgentFrame(b2);
    updateAgentFrame(f1, b1, 5);
    updateAgentFrame(f2, b2, -1);
    const rows1 = venueOccupancyData(b1, f1);
    const rows2 = venueOccupancyData(b2, f2);
    expect(rows1).not.toBe(rows2);
    expect(rows1[0].occupancy).toBe(2);
    expect(rows2[0].occupancy).toBe(0);
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

describe("wastewaterBinIndexV2", () => {
  // tickIntervalSec: 300, cadenceSec: 3600 -> 12 ticks per hourly bin.
  function bundleWithBins(numBins: number): BundleV2 {
    return {
      ...makeBundle(),
      wastewater: { kind: "grid", cadenceSec: 3600, numBins, regions: [], values: new Float32Array() },
    };
  }

  it("converts tick to hourly bin", () => {
    const b = bundleWithBins(5);
    expect(wastewaterBinIndexV2(b, 0)).toBe(0);
    expect(wastewaterBinIndexV2(b, 11)).toBe(0);
    expect(wastewaterBinIndexV2(b, 12)).toBe(1);
    expect(wastewaterBinIndexV2(b, 35)).toBe(2);
  });

  it("clamps to 0 for negative or pre-window ticks", () => {
    expect(wastewaterBinIndexV2(bundleWithBins(5), -100)).toBe(0);
  });

  it("clamps to numBins - 1 for ticks past the last bin", () => {
    expect(wastewaterBinIndexV2(bundleWithBins(5), 1_000_000)).toBe(4);
  });
});

describe("wastewaterDataV2", () => {
  it("indexes the flat row-major [region][bin] matrix without transposing", () => {
    // Non-square (2 regions x 3 bins) with asymmetric values, so a transposed
    // lookup (bin * numRegions + region) would disagree with the correct one
    // (region * numBins + bin) for at least one cell.
    const b: BundleV2 = {
      ...makeBundle(),
      wastewater: {
        kind: "grid", cadenceSec: 3600, numBins: 3,
        regions: [
          { id: "r0", centroid: [0, 0], polygon: [[0, 0], [0, 1], [1, 1], [1, 0]] },
          { id: "r1", centroid: [1, 1], polygon: [[1, 1], [1, 2], [2, 2], [2, 1]] },
        ],
        values: new Float32Array([1, 2, 3, 10, 20, 30]), // region0=[1,2,3], region1=[10,20,30]
      },
    };
    const rows = wastewaterDataV2(b, 24); // 24 / 12 = bin 2
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe(3);  // region 0, bin 2 -> values[0*3+2]
    expect(rows[1].value).toBe(30); // region 1, bin 2 -> values[1*3+2]
    expect(rows[0].polygon).toEqual(b.wastewater.regions[0].polygon);
  });
});

describe("wastewaterGlobalMaxV2", () => {
  it("scans every region and every bin, not just the current one", () => {
    const b: BundleV2 = {
      ...makeBundle(),
      wastewater: {
        kind: "grid", cadenceSec: 3600, numBins: 3, regions: [],
        values: new Float32Array([1, 2, 3, 10, 999, 30]), // peak buried mid-matrix
      },
    };
    expect(wastewaterGlobalMaxV2(b)).toBe(999);
  });

  it("floors at 1 so an all-zero matrix doesn't divide by zero downstream", () => {
    const b: BundleV2 = {
      ...makeBundle(),
      wastewater: { kind: "grid", cadenceSec: 3600, numBins: 2, regions: [], values: new Float32Array(4) },
    };
    expect(wastewaterGlobalMaxV2(b)).toBe(1);
  });
});

describe("transmissionArcDataV2", () => {
  // Non-contiguous, non-slot-order agent ids so an id/slot mix-up would fail.
  function bundleWithTransmissions(
    tick: Uint16Array, source: Uint16Array, target: Uint16Array,
  ): BundleV2 {
    return {
      ...makeBundle(),
      agentIds: new Int32Array([900, 17, 5]), // slot 0->900, slot 1->17, slot 2->5
      transmissions: { tick, source, target, count: tick.length },
    };
  }

  function makeFrame(): AgentFrame {
    const positions = new Float32Array(6);
    positions.set([-117, 32, -116.5, 32.5, -116, 33]); // slots 0,1,2
    return {
      positions,
      codes: new Uint8Array(3),
      presence: new Uint8Array([Presence.Dwelling, Presence.Dwelling, Presence.Dwelling]),
      order: new Uint32Array(3),
      visible: 3,
      occupancy: new Uint16Array(0),
    };
  }

  it("resolves agent id to slot via agentIds rather than treating id as slot", () => {
    const b = bundleWithTransmissions(
      new Uint16Array([10]), new Uint16Array([900]), new Uint16Array([5]),
    );
    const arcs = transmissionArcDataV2(b, makeFrame(), 10);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].source).toEqual([-117, 32]);  // slot 0 = agent 900
    expect(arcs[0].target).toEqual([-116, 33]);  // slot 2 = agent 5
  });

  it("skips an arc when either endpoint is not currently visible", () => {
    const b = bundleWithTransmissions(
      new Uint16Array([10]), new Uint16Array([900]), new Uint16Array([5]),
    );
    const frame = makeFrame();
    frame.presence[2] = Presence.Absent; // agent 5 (target) not visible
    expect(transmissionArcDataV2(b, frame, 10)).toHaveLength(0);
  });

  it("excludes transmissions outside the trailing tick window", () => {
    const b = bundleWithTransmissions(
      new Uint16Array([10, 500, 9999]),
      new Uint16Array([900, 900, 900]),
      new Uint16Array([5, 5, 5]),
    );
    const arcs = transmissionArcDataV2(b, makeFrame(), 500);
    expect(arcs).toHaveLength(1); // tick 10 too far in the past, 9999 in the future
    expect(arcs[0].age).toBeCloseTo(0, 5);
  });
});
