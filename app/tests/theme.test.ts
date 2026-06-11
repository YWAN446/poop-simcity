import { describe, it, expect } from "vitest";
import { STATE_COLORS, VENUE_COLORS, dayNightTint } from "../src/render/theme";

describe("theme", () => {
  it("has an RGBA color for every disease state code 0..3", () => {
    for (const code of [0, 1, 2, 3]) {
      expect(STATE_COLORS[code]).toHaveLength(4);
      STATE_COLORS[code].forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
    }
  });

  it("has a color for every venue type id 0..3", () => {
    for (const code of [0, 1, 2, 3]) {
      expect(VENUE_COLORS[code]).toHaveLength(4);
    }
  });

  it("dayNightTint returns a darker factor near midnight than noon", () => {
    const noon = dayNightTint(12);
    const midnight = dayNightTint(0);
    expect(midnight).toBeLessThan(noon);
    expect(noon).toBeLessThanOrEqual(1);
    expect(midnight).toBeGreaterThanOrEqual(0);
  });
});
