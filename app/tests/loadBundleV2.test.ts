import { describe, it, expect } from "vitest";
import { loadBundleV2 } from "../src/data/loadBundleV2";
import type { ManifestV2 } from "../src/types2";

const ARTIFACTS = {
  venuesLon: "venues_lon.f32", venuesLat: "venues_lat.f32",
  venuesType: "venues_type.u8", venuesId: "venues_id.i32",
  staysTick: "stays_tick.u16", staysDwell: "stays_dwell.u16",
  staysVenue: "stays_venue.u16", staysIndex: "stays_index.json",
  poopsTick: "poops_tick.u16", poopsLon: "poops_lon.u16",
  poopsLat: "poops_lat.u16", poopsPathogen: "poops_pathogen.f32",
  poopsInfected: "poops_infected.u8",
  disease: "disease.bin", diseaseIndex: "disease_index.json",
  transmissions: "transmissions.bin",
  aggregates: "aggregates.json",
  wastewater: "wastewater.bin", wastewaterRegions: "wastewater_regions.json",
};

const MANIFEST: ManifestV2 = {
  schemaVersion: 2, runId: "t", tickIntervalSec: 300,
  windowStart: "2024-01-01T00:00:00", windowEnd: "2024-01-01T00:55:00",
  numTicks: 12, numAgents: 2, numVenues: 2,
  bbox: [-118, 32, -116, 34],
  outbreakWindow: { startTick: 0, endTick: 11 },
  venueTypes: ["Apartment", "Workplace", "Restaurant", "Pub"],
  coverage: { transmissionsInWindow: 1, recoveryTimeResolution: "daily", cleanPoopKeepFraction: 1 },
  artifacts: ARTIFACTS,
};

function bin(arr: ArrayBufferView): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

// Two transitions for agent 0 (3 bytes each), then one sample (6 bytes).
function diseaseBin(): ArrayBuffer {
  const buf = new ArrayBuffer(2 * 3 + 6);
  const dv = new DataView(buf);
  dv.setUint16(0, 4, true); dv.setUint8(2, 1);
  dv.setUint16(3, 9, true); dv.setUint8(5, 2);
  dv.setUint16(6, 4, true); dv.setFloat32(8, 2.5, true);
  return buf;
}

const FILES: Record<string, unknown> = {
  "manifest.json": MANIFEST,
  "venues_lon.f32": bin(new Float32Array([-117.2, -117.1])),
  "venues_lat.f32": bin(new Float32Array([32.7, 32.8])),
  "venues_type.u8": bin(new Uint8Array([0, 1])),
  "venues_id.i32": bin(new Int32Array([10, 11])),
  "stays_tick.u16": bin(new Uint16Array([0, 6, 0])),
  "stays_dwell.u16": bin(new Uint16Array([4, 6, 12])),
  "stays_venue.u16": bin(new Uint16Array([0, 1, 1])),
  "stays_index.json": [
    { agentId: 0, offset: 0, count: 2 },
    { agentId: 1, offset: 2, count: 1 },
  ],
  "poops_tick.u16": bin(new Uint16Array([1, 5])),
  "poops_lon.u16": bin(new Uint16Array([0, 65535])),
  "poops_lat.u16": bin(new Uint16Array([32768, 0])),
  "poops_pathogen.f32": bin(new Float32Array([0, 9])),
  "poops_infected.u8": bin(new Uint8Array([0, 1])),
  "disease.bin": diseaseBin(),
  "disease_index.json": [
    { agentId: 0, transOffset: 0, transCount: 2, sampleOffset: 0, sampleCount: 1 },
  ],
  "transmissions.bin": bin(new Uint16Array([3, 1, 0])),
  "aggregates.json": {
    cadenceSec: 3600, startTime: "2024-01-01T00:00:00", gridTicks: [0],
    seir: { S: [2], E: [0], I: [0], R: [0] }, pathogenInflow: [9],
  },
  "wastewater.bin": bin(new Float32Array([1, 2])),
  "wastewater_regions.json": {
    kind: "grid", cadenceSec: 3600, numBins: 1,
    regions: [
      { id: "0_0", centroid: [-117.2, 32.7], polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { id: "1_0", centroid: [-117.1, 32.8], polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    ],
  },
};

function fakeFetch(overrides: Record<string, unknown> = {}): typeof fetch {
  const files = { ...FILES, ...overrides };
  return (async (url: string) => {
    const name = url.split("/").pop()!;
    const body = files[name];
    if (body === undefined) return { ok: false, status: 404 } as Response;
    if (body instanceof ArrayBuffer) {
      return { ok: true, status: 200, arrayBuffer: async () => body } as Response;
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe("loadBundleV2", () => {
  it("decodes artifacts into typed arrays without copying record by record", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.venues.count).toBe(2);
    expect(b.venues.lon[0]).toBeCloseTo(-117.2, 4);
    expect(b.stays.count).toBe(3);
    expect(b.stays.dwell[2]).toBe(12);
    expect(b.poops.count).toBe(2);
    expect(Array.from(b.poops.infected)).toEqual([0, 1]);
    expect(b.wastewater.values.length).toBe(2);
  });

  it("indexes stays by agent id", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.stayIndex.get(0)).toEqual({ offset: 0, count: 2 });
    expect(b.stayIndex.get(1)).toEqual({ offset: 2, count: 1 });
  });

  it("splits disease.bin into per-agent transitions", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.transitionsByAgent.get(0)).toEqual([[4, 1], [9, 2]]);
    expect(b.transitionsByAgent.get(1)).toBeUndefined();
  });

  it("dequantizes poop coordinates back across the bbox", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.poopLon(0)).toBeCloseTo(-118, 4);
    expect(b.poopLon(1)).toBeCloseTo(-116, 4);
    expect(b.poopLat(0)).toBeCloseTo(33, 3);
  });

  it("rejects a schemaVersion it does not implement", async () => {
    const fetchFn = fakeFetch({ "manifest.json": { ...MANIFEST, schemaVersion: 1 } });
    await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/schemaVersion/);
  });

  it("reports which artifact failed to load", async () => {
    const fetchFn = fakeFetch({ "stays_tick.u16": undefined });
    await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/stays_tick/);
  });
});
