import { describe, it, expect } from "vitest";
import { advanceTick } from "../src/sim/playbackClock";

describe("advanceTick", () => {
  const range = { min: 0, max: 100 };

  it("advances by dtMs * ticksPerSecond", () => {
    // 1000ms at 12 ticks/sec -> +12
    expect(advanceTick(10, 1000, 12, range)).toBeCloseTo(22, 5);
  });

  it("clamps at the upper bound", () => {
    expect(advanceTick(98, 1000, 12, range)).toBe(100);
  });

  it("clamps at the lower bound for negative speed", () => {
    expect(advanceTick(2, 1000, -12, range)).toBe(0);
  });
});
