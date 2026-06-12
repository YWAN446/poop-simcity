import { describe, it, expect } from "vitest";
import { positionAtTick } from "../src/sim/interpolation";

// Two agents share these arrays. Agent A = records [0,2), Agent B = record [2].
const tick = new Uint32Array([0, 10, 0]);
const lon = new Float32Array([-84.0, -85.0, -84.5]);
const lat = new Float32Array([33.0, 34.0, 33.5]);

describe("positionAtTick", () => {
  it("lerps linearly between two waypoints", () => {
    const p = positionAtTick(tick, lon, lat, 0, 2, 5);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo(-84.5, 5); // halfway in lon
    expect(p![1]).toBeCloseTo(33.5, 5); // halfway in lat
  });

  it("holds at the first waypoint before it and the last after it", () => {
    expect(positionAtTick(tick, lon, lat, 0, 2, -3)![0]).toBeCloseTo(-84.0, 5);
    expect(positionAtTick(tick, lon, lat, 0, 2, 99)![0]).toBeCloseTo(-85.0, 5);
  });

  it("returns the single waypoint for a one-waypoint agent", () => {
    const p = positionAtTick(tick, lon, lat, 2, 1, 7);
    expect(p![0]).toBeCloseTo(-84.5, 5);
    expect(p![1]).toBeCloseTo(33.5, 5);
  });

  it("returns null for an empty slice", () => {
    expect(positionAtTick(tick, lon, lat, 0, 0, 5)).toBeNull();
  });
});
