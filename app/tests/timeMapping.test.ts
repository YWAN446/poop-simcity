import { describe, it, expect } from "vitest";
import { tickToDate, hourBinIndex } from "../src/sim/timeMapping";

const START = "2024-01-01T00:05:00";

describe("tickToDate", () => {
  it("maps tick to wall-clock time at 5-minute resolution", () => {
    expect(tickToDate(START, 300, 0).toISOString()).toBe(
      new Date(START).toISOString(),
    );
    // 12 ticks * 5 min = 1 hour later
    const d = tickToDate(START, 300, 12);
    expect(d.getTime() - new Date(START).getTime()).toBe(3600 * 1000);
  });
});

describe("hourBinIndex", () => {
  it("maps a tick to its hourly aggregate bin", () => {
    // cadence 3600s / tick 300s = 12 ticks per bin
    expect(hourBinIndex(0, 300, 3600)).toBe(0);
    expect(hourBinIndex(11, 300, 3600)).toBe(0);
    expect(hourBinIndex(12, 300, 3600)).toBe(1);
    expect(hourBinIndex(25, 300, 3600)).toBe(2);
  });
});
