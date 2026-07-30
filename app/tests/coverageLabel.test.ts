import { describe, it, expect } from "vitest";
import { coverageLabel } from "../src/ui/coverageLabel";
import type { ManifestV2 } from "../src/types2";

function manifest(overrides: Partial<ManifestV2["coverage"]> = {}): ManifestV2 {
  return {
    schemaVersion: 2,
    runId: "t",
    tickIntervalSec: 300,
    windowStart: "2024-01-01T00:00:00",
    windowEnd: "2024-07-31T23:55:00",
    numTicks: 61344,
    numAgents: 10000,
    numVenues: 12134,
    bbox: [-118, 32, -116, 34],
    outbreakWindow: { startTick: 0, endTick: 61332 },
    venueTypes: ["Apartment", "Workplace", "Restaurant", "Pub"],
    coverage: {
      transmissionsInWindow: 5444,
      recoveryTimeResolution: "daily",
      cleanPoopKeepFraction: 0.3,
      ...overrides,
    },
    artifacts: {},
  };
}

describe("coverageLabel", () => {
  it("states the window and recovery-time precision", () => {
    const label = coverageLabel(manifest({ cleanPoopKeepFraction: 1 }));
    expect(label).toContain("Jan 1");
    expect(label).toContain("Jul 31 2024");
    expect(label).toContain("recovery times resolved to the day");
  });

  it("adds no caveat when every clean poop event was kept", () => {
    const label = coverageLabel(manifest({ cleanPoopKeepFraction: 1 }));
    expect(label).not.toMatch(/clean/i);
    expect(label).not.toMatch(/infected/i);
    expect(label).not.toMatch(/%/);
  });

  it("derives the caveat percentage from cleanPoopKeepFraction instead of hardcoding it", () => {
    const label = coverageLabel(manifest({ cleanPoopKeepFraction: 0.3 }));
    expect(label).toContain("30%");
    // It's the clean stream that's sampled, not the infected one - every infected
    // event is kept - and the visible consequence is over-representation of infected
    // splashes, not under-representation.
    expect(label).toMatch(/clean/i);
    expect(label).toMatch(/infected.*(kept|all)/i);
    expect(label).toMatch(/over-represented/i);

    const half = coverageLabel(manifest({ cleanPoopKeepFraction: 0.5 }));
    expect(half).toContain("50%");
  });

  it("falls back to the raw resolution string for an unrecognized value", () => {
    const label = coverageLabel(manifest({ recoveryTimeResolution: "weekly" }));
    expect(label).toContain("recovery times resolved to weekly");
  });
});
