import { describe, it, expect } from "vitest";
import { JITTER_RADIUS_M, jitterDegrees, jitterInto } from "../src/sim/jitter";

const M_PER_DEG_LAT = 111_320;

describe("jitterDegrees", () => {
  it("is a pure function of agentId", () => {
    expect(jitterDegrees(42, 32.7)).toEqual(jitterDegrees(42, 32.7));
  });

  it("gives different agents different offsets", () => {
    const a = jitterDegrees(1, 32.7);
    const b = jitterDegrees(2, 32.7);
    expect(a).not.toEqual(b);
  });

  it("stays inside the 30 m radius", () => {
    for (let id = 0; id < 500; id++) {
      const [dLon, dLat] = jitterDegrees(id, 32.7);
      const north = dLat * M_PER_DEG_LAT;
      const east = dLon * M_PER_DEG_LAT * Math.cos((32.7 * Math.PI) / 180);
      expect(Math.hypot(east, north)).toBeLessThanOrEqual(JITTER_RADIUS_M + 1e-6);
    }
  });

  it("spreads agents around rather than clustering on one bearing", () => {
    const lons = Array.from({ length: 200 }, (_, i) => jitterDegrees(i, 32.7)[0]);
    expect(Math.min(...lons)).toBeLessThan(0);
    expect(Math.max(...lons)).toBeGreaterThan(0);
  });

  it("compensates longitude for latitude so the disc stays round", () => {
    const [equatorLon] = jitterDegrees(7, 0);
    const [highLon] = jitterDegrees(7, 60);
    expect(Math.abs(highLon)).toBeGreaterThan(Math.abs(equatorLon));
  });

  it("jitterInto writes the same values that jitterDegrees returns", () => {
    for (const [agentId, lat] of [[42, 32.7], [1, 32.7], [7, 0], [7, 60], [999, -12.3]] as const) {
      const expected = jitterDegrees(agentId, lat);
      const out: [number, number] = [0, 0];
      jitterInto(agentId, lat, out);
      expect(out).toEqual(expected);
    }
  });
});
