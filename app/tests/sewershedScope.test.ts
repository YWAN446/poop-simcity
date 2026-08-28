import { describe, it, expect } from "vitest";
import {
  ALL_SCOPE, OUTSIDE_SCOPE, scopeOptions, scopedAggregates, scopeHeading,
} from "../src/sim/sewershedScope";
import type { BundleV2 } from "../src/types2";

// 2 rows (Encina + Outside) x 3 bins.
function makeBundle(): BundleV2 {
  return {
    aggregates: {
      cadenceSec: 3600, startTime: "2024-01-01T00:00:00", gridTicks: [0, 12, 24],
      seir: { S: [10, 9, 9], E: [0, 1, 0], I: [0, 0, 1], R: [0, 0, 0] },
      pathogenInflow: [12, 20, 30],
    },
    sewersheds: {
      kind: "zcta-union",
      sheds: [{ id: "encina", label: "Encina", residents: 6, venues: 3, polygons: [] }],
      outside: { label: "Outside sewersheds", residents: 4, venues: 1 },
      ww: new Float32Array([5, 8, 10, /* outside */ 7, 12, 20]),
      seir: new Uint16Array([
        6, 5, 5, 0, 1, 0, 0, 0, 1, 0, 0, 0,   // encina: S,E,I,R over 3 bins
        4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // outside
      ]),
      homeShed: new Uint8Array([0, 255]),
      numBins: 3, rows: 2,
    },
  } as unknown as BundleV2;
}

describe("scopeOptions", () => {
  it("lists All, each sewershed, then Outside", () => {
    expect(scopeOptions(makeBundle()).map((o) => o.id))
      .toEqual([ALL_SCOPE, "encina", OUTSIDE_SCOPE]);
  });

  it("is just All when the bundle has no sewersheds", () => {
    const b = { aggregates: makeBundle().aggregates } as unknown as BundleV2;
    expect(scopeOptions(b).map((o) => o.id)).toEqual([ALL_SCOPE]);
  });
});

describe("scopedAggregates", () => {
  it("returns the untouched global aggregates for All", () => {
    const b = makeBundle();
    expect(scopedAggregates(b, ALL_SCOPE)).toBe(b.aggregates);
  });

  it("slices one sewershed's own rows", () => {
    const agg = scopedAggregates(makeBundle(), "encina");
    expect(agg.pathogenInflow).toEqual([5, 8, 10]);
    expect(agg.seir.S).toEqual([6, 5, 5]);
    expect(agg.seir.E).toEqual([0, 1, 0]);
    expect(agg.seir.I).toEqual([0, 0, 1]);
  });

  it("reads Outside from the final row", () => {
    const agg = scopedAggregates(makeBundle(), OUTSIDE_SCOPE);
    expect(agg.pathogenInflow).toEqual([7, 12, 20]);
    expect(agg.seir.S).toEqual([4, 4, 4]);
  });

  it("keeps the time axis identical so the charts stay aligned", () => {
    const b = makeBundle();
    const agg = scopedAggregates(b, "encina");
    expect(agg.gridTicks).toEqual(b.aggregates.gridTicks);
    expect(agg.cadenceSec).toBe(b.aggregates.cadenceSec);
    expect(agg.startTime).toBe(b.aggregates.startTime);
  });

  it("scoped series sum back to the global series", () => {
    const b = makeBundle();
    const e = scopedAggregates(b, "encina");
    const o = scopedAggregates(b, OUTSIDE_SCOPE);
    const summed = e.pathogenInflow.map((v, i) => v + o.pathogenInflow[i]);
    expect(summed).toEqual(b.aggregates.pathogenInflow);
    const s = e.seir.S.map((v, i) => v + o.seir.S[i]);
    expect(s).toEqual(b.aggregates.seir.S);
  });

  it("falls back to All for an unknown scope rather than throwing", () => {
    const b = makeBundle();
    expect(scopedAggregates(b, "nonsense")).toBe(b.aggregates);
  });
});

describe("scopeHeading", () => {
  it("names the scope, its resident count, and its venue count", () => {
    // Encina in makeBundle() has 6 residents and 3 venues — both must appear, since the
    // wastewater curve is venue-driven, not resident-driven (see scopeHeading's docstring).
    expect(scopeHeading(makeBundle(), "encina")).toBe("Encina — 6 residents, 3 venues");
  });

  it("names Outside with its own resident and venue counts", () => {
    expect(scopeHeading(makeBundle(), OUTSIDE_SCOPE))
      .toBe("Outside sewersheds — 4 residents, 1 venues");
  });

  it("says nothing extra for All", () => {
    expect(scopeHeading(makeBundle(), ALL_SCOPE)).toMatch(/all/i);
  });
});
