import { describe, it, expect } from "vitest";
import { loadBundleV2 } from "../src/data/loadBundleV2";
import type { ManifestV2 } from "../src/types2";

const ARTIFACTS = {
  venuesLon: "venues_lon.f32", venuesLat: "venues_lat.f32",
  venuesType: "venues_type.u8", venuesId: "venues_id.i32",
  staysTick: "stays_tick.u16", staysDwell: "stays_dwell.u16",
  staysVenue: "stays_venue.u16", staysIndex: "stays_index.json",
  poopsTick: "poops_tick.u16", poopsLon: "poops_lon.u16",
  poopsLat: "poops_lat.u16",
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

  describe("cross-artifact consistency", () => {
    it("rejects venue arrays that disagree on length with each other", async () => {
      const fetchFn = fakeFetch({ "venues_lat.f32": bin(new Float32Array([32.7])) });
      await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/venue/i);
    });

    it("rejects a venue count that disagrees with manifest.numVenues", async () => {
      const fetchFn = fakeFetch({
        "manifest.json": { ...MANIFEST, numVenues: 99 },
      });
      await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/numVenues/);
    });

    it("rejects stays arrays that disagree on length with each other", async () => {
      const fetchFn = fakeFetch({
        "stays_dwell.u16": bin(new Uint16Array([4, 6])),
      });
      await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/stays/i);
    });

    it("rejects a stays_index whose counts don't sum to the stays array length", async () => {
      const fetchFn = fakeFetch({
        "stays_index.json": [
          { agentId: 0, offset: 0, count: 2 },
          { agentId: 1, offset: 2, count: 5 },
        ],
      });
      await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/stays_index/);
    });

    it("rejects poop arrays that disagree on length with each other", async () => {
      const fetchFn = fakeFetch({ "poops_infected.u8": bin(new Uint8Array([1])) });
      await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/poop/i);
    });

    it("rejects a wastewater matrix whose length doesn't match regions * numBins", async () => {
      const fetchFn = fakeFetch({
        "wastewater.bin": bin(new Float32Array([1])),
      });
      await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/wastewater/i);
    });
  });
});

describe("sewersheds", () => {
  const SHED_FILES: Record<string, unknown> = {
    "sewersheds.json": {
      kind: "zcta-union",
      sewersheds: [
        { id: "encina", label: "Encina", residents: 2, venues: 3,
          polygons: [[[[0, 0], [0, 1], [1, 1], [0, 0]]]] },
      ],
      outside: { label: "Outside sewersheds", residents: 1, venues: 1 },
    },
    // 2 rows (1 shed + Outside) x 1 bin
    "sewershed_ww.bin": bin(new Float32Array([5, 7])),
    // 2 rows x 4 states x 1 bin
    "sewershed_seir.bin": bin(new Uint16Array([2, 0, 0, 0, 1, 0, 0, 0])),
    "agent_home_shed.u8": bin(new Uint8Array([0, 0, 255])),
  };
  const SHED_ARTIFACTS = {
    sewersheds: "sewersheds.json", sewershedWw: "sewershed_ww.bin",
    sewershedSeir: "sewershed_seir.bin", agentHomeShed: "agent_home_shed.u8",
  };

  it("decodes the sewershed artifacts when present", async () => {
    const manifest = {
      ...MANIFEST,
      artifacts: { ...ARTIFACTS, ...SHED_ARTIFACTS },
    };
    const b = await loadBundleV2("/data/t", fakeFetch({ "manifest.json": manifest, ...SHED_FILES }));
    expect(b.sewersheds).toBeDefined();
    expect(b.sewersheds!.sheds.map((s) => s.id)).toEqual(["encina"]);
    expect(b.sewersheds!.rows).toBe(2);        // one shed plus Outside
    expect(b.sewersheds!.numBins).toBe(1);
    expect(Array.from(b.sewersheds!.ww)).toEqual([5, 7]);
    expect(b.sewersheds!.outside.residents).toBe(1);
  });

  it("is undefined when the bundle declares no sewershed artifacts", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.sewersheds).toBeUndefined();
  });

  it("rejects a sewershed matrix whose length disagrees with the row count", async () => {
    const manifest = { ...MANIFEST, artifacts: { ...ARTIFACTS, ...SHED_ARTIFACTS } };
    const fetchFn = fakeFetch({
      "manifest.json": manifest, ...SHED_FILES,
      "sewershed_ww.bin": bin(new Float32Array([1, 2, 3])),   // not a multiple of rows
    });
    await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/sewershed_ww/);
  });

  it("rejects a sewershed numBins that disagrees with aggregates.gridTicks.length", async () => {
    // 2 rows x 2 bins, but MANIFEST's aggregates.json has a single-bin gridTicks — a
    // stale sewershed_ww.bin regenerated against a different window than aggregates.json.
    const manifest = { ...MANIFEST, artifacts: { ...ARTIFACTS, ...SHED_ARTIFACTS } };
    const fetchFn = fakeFetch({
      "manifest.json": manifest, ...SHED_FILES,
      "sewershed_ww.bin": bin(new Float32Array([5, 6, 7, 8])),
      "sewershed_seir.bin": bin(new Uint16Array([
        2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0,
      ])),
    });
    await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/numBins/);
  });
});
