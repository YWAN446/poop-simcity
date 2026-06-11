import { describe, it, expect, vi } from "vitest";
import { loadBundle } from "../src/data/loadBundle";

function agentBuffer(records: [number, number, number, number][]): ArrayBuffer {
  const buf = new ArrayBuffer(records.length * 13);
  const dv = new DataView(buf);
  records.forEach(([t, lon, lat, vt], i) => {
    const o = i * 13;
    dv.setUint32(o, t, true);
    dv.setFloat32(o + 4, lon, true);
    dv.setFloat32(o + 8, lat, true);
    dv.setUint8(o + 12, vt);
  });
  return buf;
}

const manifest = {
  schemaVersion: 1, runId: "test", tickIntervalSec: 300,
  startTime: "2024-01-01T00:05:00", endTime: "2024-01-01T01:05:00",
  numTicks: 13, numAgents: 2, bbox: [-85, 33, -84, 34],
  outbreakWindow: { startTick: 0, endTick: 12 },
  venueTypes: ["Apartment", "Workplace", "Restaurant", "Pub"],
  artifacts: {
    agents: "agents.bin", agentsIndex: "agents_index.json", disease: "disease.json",
    poops: "poops.bin", aggregates: "aggregates.json", wastewater: "wastewater.json",
  },
};

const files: Record<string, unknown> = {
  "manifest.json": manifest,
  "agents_index.json": [
    { agentId: 0, offset: 0, count: 1 },
    { agentId: 1, offset: 1, count: 1 },
  ],
  "agents.bin": agentBuffer([[0, -84.4, 33.7, 0], [0, -84.3, 33.8, 1]]),
  "disease.json": {
    stateCodes: { S: 0, E: 1, I: 2, R: 3 },
    agents: [{ agentId: 1, transitions: [[0, 2]], pathogenSamples: [] }],
    transmissions: [],
  },
  "poops.bin": new ArrayBuffer(0),
  "aggregates.json": {
    cadenceSec: 3600, startTime: manifest.startTime, gridTicks: [0, 12],
    seir: { S: [2, 2], E: [0, 0], I: [0, 0], R: [0, 0] }, pathogenInflow: [0, 0],
  },
  "wastewater.json": { kind: "grid", cadenceSec: 3600, regions: [], series: {} },
};

function stubFetch(base: string) {
  return vi.fn(async (url: string) => {
    const name = url.replace(base + "/", "");
    const payload = files[name];
    return {
      ok: true,
      json: async () => payload,
      arrayBuffer: async () => payload as ArrayBuffer,
    } as Response;
  });
}

describe("loadBundle", () => {
  it("loads, decodes, and indexes the bundle", async () => {
    const base = "/data/dataset_00";
    const bundle = await loadBundle(base, stubFetch(base) as unknown as typeof fetch);

    expect(bundle.manifest.numAgents).toBe(2);
    expect(bundle.agents.count).toBe(2);

    const slice = bundle.agentSlice.get(1)!;
    expect(slice).toEqual({ offset: 1, count: 1 });

    // Agent 1 has a transition to Infectious; agent 0 defaults to none.
    expect(bundle.transitionsByAgent.get(1)).toEqual([[0, 2]]);
    expect(bundle.transitionsByAgent.has(0)).toBe(false);

    expect(bundle.aggregates.seir.S[0]).toBe(2);
    expect(bundle.wastewater.kind).toBe("grid");
  });
});
