import { describe, it, expect } from "vitest";
import { Presence, resolvePose, type AgentPose } from "../src/sim/dwell";
import type { Stays, Venues } from "../src/types2";

// Venue 0 at (-117.0, 32.0); venue 1 at (-116.0, 33.0).
const venues: Venues = {
  lon: new Float32Array([-117.0, -116.0]),
  lat: new Float32Array([32.0, 33.0]),
  type: new Uint8Array([0, 1]),
  id: new Int32Array([10, 11]),
  count: 2,
};

// Agent A (slice 0..2): venue 0 from tick 10 for 10 ticks, then venue 1 from tick 30.
// Agent B (slice 2..3): a single stay at venue 1 from tick 0 for 5 ticks.
const stays: Stays = {
  tick: new Uint16Array([10, 30, 0]),
  dwell: new Uint16Array([10, 10, 5]),
  venue: new Uint16Array([0, 1, 1]),
  count: 3,
};

const A = { offset: 0, count: 2 };
const B = { offset: 2, count: 1 };
const pose = (): AgentPose => ({ lon: 0, lat: 0, presence: Presence.Absent, venue: -1 });

describe("resolvePose", () => {
  it("reports Absent before the first check-in", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 9, out)).toBe(Presence.Absent);
  });

  it("parks the agent at its venue for the whole dwell", () => {
    const out = pose();
    for (const t of [10, 15, 19]) {
      expect(resolvePose(stays, venues, A, t, out)).toBe(Presence.Dwelling);
      expect(out.lon).toBeCloseTo(-117.0, 5);
      expect(out.lat).toBeCloseTo(32.0, 5);
      expect(out.venue).toBe(0);
    }
  });

  it("starts travelling on the tick the dwell ends", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 20, out)).toBe(Presence.Travelling);
    expect(out.lon).toBeCloseTo(-117.0, 5);   // alpha 0, still at the origin venue
    expect(out.venue).toBe(-1);
  });

  it("interpolates linearly across the travel gap", () => {
    const out = pose();
    resolvePose(stays, venues, A, 25, out);   // halfway between tick 20 and 30
    expect(out.lon).toBeCloseTo(-116.5, 5);
    expect(out.lat).toBeCloseTo(32.5, 5);
  });

  it("arrives exactly at the next venue on its check-in tick", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 30, out)).toBe(Presence.Dwelling);
    expect(out.lon).toBeCloseTo(-116.0, 5);
    expect(out.venue).toBe(1);
  });

  it("holds at the last venue after its dwell ends", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 999, out)).toBe(Presence.Dwelling);
    expect(out.lon).toBeCloseTo(-116.0, 5);
    expect(out.venue).toBe(1);
  });

  it("handles a single-stay agent", () => {
    const out = pose();
    expect(resolvePose(stays, venues, B, 2, out)).toBe(Presence.Dwelling);
    expect(out.venue).toBe(1);
    expect(resolvePose(stays, venues, B, 500, out)).toBe(Presence.Dwelling);
  });

  it("reports Absent for an empty slice", () => {
    const out = pose();
    expect(resolvePose(stays, venues, { offset: 0, count: 0 }, 5, out))
      .toBe(Presence.Absent);
  });
});
