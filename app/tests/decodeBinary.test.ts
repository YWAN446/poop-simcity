import { describe, it, expect } from "vitest";
import { decodeAgentWaypoints, decodePoopEvents } from "../src/data/decodeBinary";

function buildAgentBuffer(records: [number, number, number, number][]): ArrayBuffer {
  const buf = new ArrayBuffer(records.length * 13);
  const dv = new DataView(buf);
  records.forEach(([tick, lon, lat, vtype], i) => {
    const o = i * 13;
    dv.setUint32(o, tick, true);
    dv.setFloat32(o + 4, lon, true);
    dv.setFloat32(o + 8, lat, true);
    dv.setUint8(o + 12, vtype);
  });
  return buf;
}

function buildPoopBuffer(
  records: [number, number, number, number, number][],
): ArrayBuffer {
  const buf = new ArrayBuffer(records.length * 14);
  const dv = new DataView(buf);
  records.forEach(([tick, lon, lat, vtype, infected], i) => {
    const o = i * 14;
    dv.setUint32(o, tick, true);
    dv.setFloat32(o + 4, lon, true);
    dv.setFloat32(o + 8, lat, true);
    dv.setUint8(o + 12, vtype);
    dv.setUint8(o + 13, infected);
  });
  return buf;
}

describe("decodeAgentWaypoints", () => {
  it("decodes 13-byte records into parallel arrays", () => {
    const buf = buildAgentBuffer([
      [0, -84.4, 33.7, 0],
      [12, -84.39, 33.71, 1],
    ]);
    const wp = decodeAgentWaypoints(buf);
    expect(wp.count).toBe(2);
    expect(wp.tick[0]).toBe(0);
    expect(wp.tick[1]).toBe(12);
    expect(wp.lon[1]).toBeCloseTo(-84.39, 4);
    expect(wp.vtype[1]).toBe(1);
  });
});

describe("decodePoopEvents", () => {
  it("decodes 14-byte records including the infected flag", () => {
    const buf = buildPoopBuffer([[5, -84.5, 33.6, 3, 1]]);
    const p = decodePoopEvents(buf);
    expect(p.count).toBe(1);
    expect(p.tick[0]).toBe(5);
    expect(p.vtype[0]).toBe(3);
    expect(p.infected[0]).toBe(1);
  });
});
