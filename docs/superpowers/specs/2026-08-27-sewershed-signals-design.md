# Sewershed-Specific Wastewater Signals

**Date:** 2026-08-27
**Status:** Approved design, pre-implementation
**Source data:** `san_diego_shapefiles/` — three treatment-plant service areas for the
`dataset_sdc-10k` run.
**Extends:** `2026-07-29-sdc-10k-dwell-visualizer-design.md`. The v1 `dataset_00`
bundle and app path are untouched.

## 1. Purpose & Scope

Today the app shows one wastewater curve for the whole simulated region. A real
wastewater programme samples at a *treatment plant*, which serves a *sewershed* — so
the measurable signal is per-sewershed, not regional.

This adds that geography: assign every defecation event and every agent to one of
three San Diego sewersheds, emit per-sewershed wastewater and resident-case series,
draw the boundaries, and let selecting a sewershed re-scope the HUD charts.

**In scope:** sewershed assignment in the preprocessor, four new bundle artifacts, a
boundary layer, and a selector that re-scopes the existing SEIR and wastewater charts.

**Out of scope:** sensor placement / challenge mode (unchanged from the roadmap);
sub-sewershed ZCTA breakdowns; any change to the 0.02° grid, which stays exactly as it
is.

### Why this is worth building

Sewersheds are not merely a spatial filter. The audit below found that **South Bay
holds 1.3% of resident agents but receives 2.9% of the pathogen mass** — because it
contains 397 venues, many of them workplaces, against only 127 residents. People
commute in and shed there.

That mismatch between *where cases live* and *where their pathogen lands* is the
central difficulty in back-translating a wastewater signal into case counts. Putting
the two curves side by side for one sewershed makes it directly legible. Encina and
Point Loma track their resident share almost exactly, which gives the comparison a
built-in control.

## 2. Source Data Audit (`san_diego_shapefiles/`)

Three shapefile sets: `encina`, `point_loma`, `south_bay`.

| | records | geometry |
|---|---:|---|
| Encina | 18 | 1 multipolygon, 2 interior rings |
| Point Loma | 62 | 3 multipolygons, 5 interior rings |
| South Bay | 3 | 1 interior ring |

**The CRS is geographic NAD83** (`GEOGCS`, degrees), not projected, so coordinates are
already lon/lat and **no reprojection is required**. NAD83 and WGS84 differ by about a
metre in San Diego, far below the resolution of anything here.

**Each "sewershed" is a union of Census ZCTAs**, not a pipe network — the attribute
table is `ZCTA5CE20`, `GEOID20`, `ALAND20` and friends. Boundaries therefore follow ZIP
codes. The UI must say so; the signal should not be read as more physically precise
than it is.

**The three dissolved sewersheds are disjoint** — zero venues fall in two — so
assignment is unambiguous and needs no tie-break rule.

### 2.1 Holes are real, and they matter

Dissolving each file's ZCTAs leaves genuine interior rings: **3 holes in Point Loma and
1 in South Bay**. A naive `.shp` reader that treats every ring as a filled polygon
silently converts those holes into solid land.

This was measured, not assumed. The naive reading misassigns **12 venues and 2
agents** — small overall, but **11 of the 12 land in South Bay**, a 2.7% error on the
one sewershed whose small counts make it interesting. This is why the design takes a
dependency instead of hand-rolling a parser (§4.1).

### 2.2 Coverage (hole-aware geometry)

| sewershed | venues | share | residents | share | pathogen events | pathogen mass |
|---|---:|---:|---:|---:|---:|---:|
| Point Loma | 7,743 | 63.8% | 6,420 | 64.2% | 1,054,882 (65.1%) | 63.8% |
| Encina | 2,758 | 22.7% | 2,324 | 23.2% | 365,775 (22.6%) | 23.3% |
| South Bay | 397 | 3.3% | 127 | 1.3% | 41,443 (2.6%) | 2.9% |
| Outside all three | 1,236 | 10.2% | 1,129 | 11.3% | 157,174 (9.7%) | 10.0% |

Every one of the 10,000 agents has at least one Apartment stay, so the residence rule
in §3.2 never needs a fallback.

**About 10% of activity falls outside all three sewersheds.** That is kept as a fourth
series labelled *Outside sewersheds* rather than dropped, so the parts continue to sum
to the regional totals already in the bundle — which is also what makes the invariant
test in §7 possible.

South Bay's roughly 195 pathogen-bearing events per day support a daily curve
comfortably; at hourly cadence it averages about 8 per bin and will look lumpy. That is
honest sampling noise, not a defect, and it is the same noise a real small-plant signal
carries.

## 3. Assignment Rules

The two questions are different and get different rules. Conflating them is the main
scientific error available here.

### 3.1 Wastewater — by where the event happened

Each defecation event is assigned by **its own coordinates**, read from
`Poopin.parquet` in float64 and tested against the full-resolution sewershed geometry.
This is what the plant measures: pathogen follows the pipe from wherever it was
deposited, regardless of who deposited it or where they live.

### 3.2 Residents — by most-dwelled Apartment

Each agent is assigned the sewershed of the Apartment where it accumulates the most
dwell time across the window, summing `dwell` over stays whose venue type is
`Apartment`. Ties break toward the lower venue index, deterministically.

This uses the `CheckoutTime` durations that distinguish this run, and is robust to an
agent visiting other homes or relocating — neither of which a first-check-in rule would
survive.

## 4. Preprocessor

New module `preprocess/poop_simcity_preprocess/sewersheds.py`, plus wiring in
`build_v2.py`. Nothing in the v1 path changes.

### 4.1 Dependencies

Two additions to `preprocess/requirements.txt`:

- **`pyshp>=2.3`** — pure-Python shapefile reader, no GDAL. Resolves ring orientation
  so holes stay holes (§2.1).
- **`shapely>=2.0`** — already installed in the working environment but never declared;
  this makes it explicit. Provides `unary_union` and vectorized `contains_xy`.

### 4.2 Steps

1. Read each `.shp` with `pyshp`, convert via `__geo_interface__`, repair any invalid
   ring with `buffer(0)`, and `unary_union` the file's polygons into one geometry.
2. Assign the 12,134 venues once — used for residence, and for the venue counts shown
   in the UI.
3. Assign poop events by coordinate while streaming `Poopin.parquet`, accumulating
   hourly pathogen per sewershed in float64.
4. Assign agents by the §3.2 rule, then accumulate hourly resident SEIR by walking the
   existing disease transitions per agent.

### 4.3 Two geometries, deliberately

**Assignment uses full-resolution rings. Rendering uses a simplified copy** at roughly
50 m tolerance, so the browser payload stays small. These must not be swapped:
simplifying before assignment would move points across boundaries, and the resulting
error would be invisible in the output.

### 4.4 New artifacts

| file | contents | approx size |
|---|---|---:|
| `sewersheds.json` | the **three real sewersheds only**: id, label, simplified rings, resident count, venue count | ~200 KB |
| `sewershed_ww.bin` | float32, **4 rows** (3 sheds + Outside) × 5,112 hourly bins — pathogen | 82 KB |
| `sewershed_seir.bin` | uint16, **4 rows** × 4 states × 5,112 bins — resident SEIR | 164 KB |
| `agent_home_shed.u8` | one byte per agent, index-aligned with `stays_index.json` | 10 KB |

**Outside has no entry in `sewersheds.json`** — it is not a place, it is the remainder.
Both matrices therefore have one more row than that file has entries: rows 0..n-1 follow
`sewersheds.json` order, and the final row is always Outside. Bin cadence is hourly
(3,600 s, 12 ticks), matching `aggregates.json` so the series are directly comparable.
`agent_home_shed.u8` uses `255` for Outside so the value is never confused with a valid
index. Total is roughly 0.5 MB on an 89 MB bundle.

`manifest.json` gains the four artifact keys and a `sewershedKind: "zcta-union"` field
recording the provenance caveat from §2.

## 5. App

- **`SewershedLayer`** — a `PolygonLayer` drawing the three boundaries: translucent
  fill, visible outline, the selected one emphasised. Behind its own layer toggle.
- **Selector** — `All | Encina | Point Loma | South Bay | Outside`, driven either by the
  control or by clicking a polygon. Default `All`, which is byte-for-byte today's view.
- **Charts** — with `All` selected the charts read the existing global aggregates
  unchanged; with a sewershed selected they read that row of the new matrices.
- **Headings state the scope and its size** — "SEIR — residents of South Bay (127
  agents)" — so a small-sample caveat is visible rather than buried.
- **Atlanta** — `dataset_00` has no sewersheds. The loader treats the artifacts as
  optional; when absent the layer, its toggle, and the selector do not render.

## 6. Honesty Requirements

Consistent with the existing HUD coverage line, the UI must not overstate:

- Boundaries are **ZCTA unions, not pipe networks** — stated where the layer is named.
- **Outside sewersheds** appears as a real series, not silently dropped.
- Resident counts appear next to the scope, so South Bay's 127 agents cannot be
  mistaken for a population-scale curve.

## 7. Testing

**The load-bearing test is an invariant:** for both pathogen inflow and each SEIR state,
**the four per-sewershed series must sum, bin for bin, to the global series already in
the bundle.** One assertion catches assignment gaps, double counting, and binning drift
together. It is only possible because Outside is retained (§2.2).

Also:

- point-in-polygon: a point inside a **hole** is Outside, not inside; a point just
  outside a boundary; a point inside each shed. The hole case is the regression guard
  for §2.1.
- residence: most-dwelled Apartment wins over a more *frequent* but shorter-dwelled one;
  ties break deterministically; non-Apartment stays never count.
- simplified rings are used for rendering and never for assignment.
- artifact round-trip decode, and the row-order and Outside-last contract.
- app: selector re-scoping, and graceful absence on a bundle without sewersheds.

## 8. Build Sequence

1. `sewersheds.py`: read, dissolve, assign venues. Tests including the hole case.
2. Wastewater accumulation by event coordinate; hourly matrix.
3. Residence rule and resident SEIR matrix.
4. Artifact writing, manifest keys, `build_v2.py` wiring, invariant test.
5. Regenerate the bundle; extend `verify_bundle_v2.py` with the sum invariant.
6. App: types, loader, optional-artifact handling.
7. App: layer, selector, chart re-scoping, headings.

## 9. Future Work

- Per-ZCTA breakdown within a sewershed — the shapefiles already carry ZCTA ids.
- Sensor-placement challenge mode scored per sewershed rather than per grid cell.
- Comparing the modelled per-sewershed signal against real plant measurements.
