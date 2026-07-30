# Poop SimCity — San Diego 10k Run with Dwell-Time Movement

**Date:** 2026-07-29
**Status:** Approved design, pre-implementation
**Source data:** `dataset_sdc-10k/` — a second simulation run of the same model as
`dataset_00`, relocated to San Diego County with 10× the population and, critically, explicit
venue check-out times.
**Supersedes nothing:** extends the design in
`2026-06-10-poop-simcity-visualizer-design.md`. The v1 bundle for `dataset_00` keeps
building and loading unchanged.

## 1. Purpose & Scope

Play back the `dataset_sdc-10k` run in the existing Poop SimCity visualizer, using the new
`CheckoutTime` column to model agents as **dwelling at venues for real durations** rather
than continuously gliding between check-ins.

**In scope:** a bundle format v2 for this run; a dwell/travel movement model; a venue
occupancy layer that dwell makes possible; a streaming preprocessor that can handle 10×
data on limited RAM.

**Out of scope:** challenge mode, real sewersheds, social-network layers (unchanged from the
v1 design's future-work list). No UI dataset switcher — this build targets
`dataset_sdc-10k` and `dataset_00` remains buildable but is not selectable at runtime.

### Key decisions

- **Playback window: 2024-01-01 → 2024-07-31** (213 days, 61,344 ticks). Captures 99.3% of
  all exposures plus the complete take-off, peak and decline. Keeps every tick index below
  65,536 so tick fields fit `uint16`.
- **All 10,000 agents** on the map. No population subsampling.
- **Single bundle, no lazy loading.** 89.1 MB raw (19 files), roughly half that compressed.
- **Struct-of-arrays binary**, so every field decodes as a zero-copy typed array.
- **Agent stays reference venues by index**; poop events carry quantized coordinates.
- Clean-poop keep fraction and window bounds are CLI flags, not constants.

## 2. Source Data Audit (`dataset_sdc-10k/`)

10,000 agents (ids 0–9999), 12,134 venues, San Diego County
(lon −117.595 to −116.120, lat 32.536 to 33.480), 5-minute ticks,
2024-01-01 → 2024-12-31.

| File | Rows | Notes |
|------|-----:|-------|
| `Checkin.parquet` | 14,727,879 | `agent_id, time, CheckoutTime, venue_id, venue_type, latitude, longitude` |
| `DiseasesStatus.parquet` | 43,809,992 | `time, agent_id, exposed_started_time, infectious_started_time, pathogen_level, disease_status, SourceAgentId, latitude, longitude` |
| `Poopin.parquet` | 10,708,639 | `agent_id, time, latitude, longitude, venue_type, pathogen_level, disease_status, infectious_started_time` |

Venue type mix: 9,364 Apartment, 2,470 Workplace, 200 Restaurant, 100 Pub.

### 2.1 What this run adds over `dataset_00`

- **`CheckoutTime` is complete and well-formed.** Zero nulls, zero unparseable values, zero
  overlapping stays per agent. Every duration is a positive multiple of 300 s
  (min 300 s, median 11,400 s ≈ 3.2 h, max 229,800 s ≈ 2.7 days). The gap between a
  checkout and the same agent's next check-in is always ≥ 300 s (median 300 s, max 7,200 s).
  Dwell and travel are therefore both unambiguous with no heuristics.
- **A stable venue table.** `venue_id → (venue_type, latitude, longitude)` is single-valued
  for all 12,134 venues.
- **Exact exposure and infectious onset times.** `exposed_started_time` is never null and
  always 5-minute aligned; `SourceAgentId` is set for every Exposed row. In `dataset_00`
  exposure times were mostly null, forcing transmission arcs to be dated from daily
  snapshots. Here the transmission chain is exact.
- **A much stronger wastewater signal.** 4,057,983 of 10,708,639 poop events carry pathogen
  (37.9%, versus 6.6% in `dataset_00`).
- **Every poop event sits exactly on a venue coordinate** (verified on 1.5M sampled events).

### 2.2 Epidemic shape

10 seed infections on 2024-01-01 → 5,490 of 10,000 agents ever exposed → burnout in
November. Exposure timing from `exposed_started_time`:

| Share of all exposures | Date reached |
|---|---|
| 1% | 2024-01-08 |
| 5% | 2024-02-01 |
| 50% | 2024-04-09 |
| 95% | 2024-06-21 |
| 99% | 2024-07-29 |
| 100% | 2024-09-16 |

Peak prevalence falls in late April. The chosen Jul 31 cutoff drops 0.7% of exposures, all
in a thin August–September tail.

### 2.3 Missing relative to `dataset_00`

Nothing required by the app is absent. For the record:

| Absent | Consequence |
|---|---|
| `social_links.parquet` | Only the post-v1 social-network layer. Infection arcs are unaffected and in fact more accurate, since `SourceAgentId` plus exact `exposed_started_time` replaces snapshot-dated inference. |
| `FriendFamilyGraph.dgs`, `WorkGraph.dgs` | Unused in v1 and in this design. |
| `output_matrix.csv` | Was optional wastewater cross-validation only. The derived signal cannot be cross-checked against the model's own aggregation for this run. |
| Sewer-network / sewershed geometry | Same gap as `dataset_00`. The 0.02° grid proxy stands; 632 grid cells are populated by pathogen-bearing events. |
| Run parameters (`modified.properties`, `run.log`) | Provenance only; not consumed by the pipeline. |

One inherited limitation: **recovery has no explicit timestamp.** `exposed_started_time` and
`infectious_started_time` give exact S→E and E→I times, but I→R is only observable from the
daily status snapshots, so recovery resolves to the day. This is recorded in the manifest so
the app never implies more precision than exists.

## 3. Architecture

Unchanged in shape from v1: a build-time Python preprocessor emits a static bundle consumed
by the Vite/React/deck.gl app with no backend. Two structural changes inside those pieces.

**Preprocessor becomes streaming.** `build.py` currently calls `pq.read_table(...).to_pandas()`
on each file. `DiseasesStatus.parquet` is 43.8M rows and available RAM is ~6 GB, so full
materialization is not viable. All three inputs move to `ParquetFile.iter_batches` with
per-batch reduction. Only per-agent state (small, bounded by 10,000 agents) is retained
across batches.

**A dataset profile replaces hardcoded names.** File and column names differ between runs:

| Concept | `dataset_00` | `dataset_sdc-10k` |
|---|---|---|
| check-in file | `check_in.parquet` | `Checkin.parquet` |
| disease file | `disease_status.parquet` | `DiseasesStatus.parquet` |
| poop file | `poop_in.parquet` | `Poopin.parquet` |
| transmission source column | `source_agent_id` | `SourceAgentId` |
| check-out column | *(absent)* | `CheckoutTime` (ISO string) |
| timestamp precision | `timestamp[ns]` | `timestamp[us]` |

A new `profiles.py` holds one dataclass per run describing filenames, column mapping, and
whether check-out times are present. `build_bundle` takes a profile. `dataset_00` keeps
emitting schemaVersion 1; `dataset_sdc-10k` emits schemaVersion 2.

## 4. Bundle Format v2

Written to `app/public/data/dataset_sdc-10k/`. All binaries are little-endian
struct-of-arrays: one file per field, so the browser does `new Uint16Array(buffer)` with no
per-record loop. Ticks are indices from `windowStart`, `tick = (time − windowStart) / 300`.

### `manifest.json`

```jsonc
{
  "schemaVersion": 2,
  "runId": "dataset_sdc-10k",
  "tickIntervalSec": 300,
  "windowStart": "2024-01-01T00:00:00",
  "windowEnd":   "2024-07-31T23:55:00",
  "numTicks": 61344,
  "numAgents": 10000,
  "numVenues": 12134,
  "bbox": [-117.594923, 32.535643, -116.119757, 33.479878],
  "outbreakWindow": { "startTick": 0, "endTick": 61332 },
  "venueTypes": ["Apartment", "Workplace", "Restaurant", "Pub"],
  "coverage": {
    "transmissionsInWindow": 5444,
    "recoveryTimeResolution": "daily",
    "cleanPoopKeepFraction": 0.3
  },
  "artifacts": {
    "venuesLon": "venues_lon.f32",   "venuesLat": "venues_lat.f32",
    "venuesType": "venues_type.u8",  "venuesId": "venues_id.i32",
    "staysTick": "stays_tick.u16",   "staysDwell": "stays_dwell.u16",
    "staysVenue": "stays_venue.u16", "staysIndex": "stays_index.json",
    "poopsTick": "poops_tick.u16",   "poopsLon": "poops_lon.u16",
    "poopsLat": "poops_lat.u16",
    "poopsInfected": "poops_infected.u8",
    "disease": "disease.bin",        "diseaseIndex": "disease_index.json",
    "transmissions": "transmissions.bin",
    "aggregates": "aggregates.json",
    "wastewater": "wastewater.bin",  "wastewaterRegions": "wastewater_regions.json"
  }
}
```

The bbox is computed from the source data rather than hardcoded; the values above are what
this run yields. `outbreakWindow` spans the whole window here, since prevalence is non-zero
from tick 0 through Jul 31, so the app opens at the start rather than seeking into the run.

`coverage` exists so the UI can state honestly what was trimmed and where precision is
limited, rather than implying full-year, full-precision data. `transmissionsInWindow` counts
transmissions the build actually saw; the 99.3% figure quoted in this document comes from a
full-year audit, which a windowed build cannot recompute for itself.

### Venues — `venues_lon.f32`, `venues_lat.f32`, `venues_type.u8`

12,134 entries, index-aligned. Venue index is assigned by sorted `venue_id`, and
`venues_id.i32` records the original ids so the bundle stays traceable to source.
Roughly 0.11 MB total.

### Agent stays — `stays_tick.u16`, `stays_dwell.u16`, `stays_venue.u16` + `stays_index.json`

One record per check-in, sorted by `(agent_id, tick)`:

- `tick` — check-in tick, `0 … 61343`
- `dwell` — stay length in ticks, `≥ 1`, clipped so `tick + dwell ≤ numTicks`
- `venue` — index into the venue table

`stays_index.json` is `[{ agentId, offset, count }, …]`. Position is exact (the venue's own
coordinates), never quantized. About 8.67M records × 6 bytes ≈ 52 MB.

Boundary rules: stays beginning at or after `windowEnd` are dropped; a stay whose checkout
falls past `windowEnd` is clipped; an agent's final in-window stay has no travel successor
and simply holds.

### Poop events — `poops_tick.u16`, `poops_lon.u16`, `poops_lat.u16`, `poops_infected.u8`

Sorted by tick, so the app keeps its forward-advancing stream pointer. Coordinates are
quantized to `uint16` across the bbox, which gives ~2.3 m longitude and ~1.6 m latitude
resolution — far finer than a splash sprite. Quantization is used here rather than a venue
reference because `Poopin` has no `venue_id`, and reverse-joining on coordinates is
ambiguous: `(lat, lon, venue_type)` yields only 11,954 distinct keys for 12,134 venues, with
up to 3 venues sharing a key.

Every pathogen-bearing event is kept; clean events are deterministically downsampled to
`cleanPoopKeepFraction` (default 0.3) by `agent_id` modulo. Each record is
`tick u16 + lonQ u16 + latQ u16 + infected u8` — about 3.1M records × 7 bytes ≈ 22.0 MB.

There is no per-event pathogen magnitude field. An earlier version of this design stored
one (`poops_pathogen.f32`), but the simulation's pathogen decay model produces values as
small as `4.89e-161`, far below float32's smallest positive subnormal (~1.4e-45), so
**322,424 of 1,619,274 pathogen-bearing events in the window (19.9%) would underflow to
`0.0`** once `pathogen_level` is narrowed to float32 — and no renderer ever read that
magnitude anyway. `poops_infected.u8` is what actually drives every infected-vs-clean
decision in the app: it is computed from the source float64 `pathogen_level` column
(`> 0`) before any narrowing, so it is exact regardless of what a float32 copy of the
magnitude would or wouldn't be able to represent. Storing a lossy, unread float column
alongside it added nothing but confusion, so it was dropped rather than widened.

**The downsampled stream is for rendering only.** Pathogen inflow and the wastewater grid
are computed from *every* event in the window, before downsampling.

### Disease — `disease.bin` + `disease_index.json`

Per agent, a transition list and pathogen samples. Transition ticks come from the most
precise source available:

- S→E — `exposed_started_time` (exact, 5-minute aligned)
- E→I — `infectious_started_time` (exact)
- I→R — first daily snapshot showing `Recovered` (day resolution; flagged in the manifest)

`disease.bin` holds two concatenated sections, each a run of fixed-width records, with
`disease_index.json` giving per-agent offsets and counts into both:

- transitions: `(tick u16, code u8)`, 3 bytes each, ascending by tick; `code` uses the
  existing `S=0, E=1, I=2, R=3` mapping
- pathogen samples: `(tick u16, level f32)`, 6 bytes each, one per week per shedding agent

```jsonc
// disease_index.json
[{ "agentId": 0, "transOffset": 0, "transCount": 3,
   "sampleOffset": 0, "sampleCount": 26 }, …]
```

Offsets are in record units within their own section, so each section decodes independently.
Agents absent from the index are Susceptible throughout and shed nothing.

`transmissions.bin` holds 5,444 records of `(tick u16, source u16, target u16)` derived from
`exposed_started_time` + `SourceAgentId` — exact, unlike the v1 bundle. Weekly rather than
daily pathogen sampling keeps this artifact near 2 MB; weekly is sufficient because the
samples drive per-agent shedding display, while the charts and wastewater grid use their own
full-resolution aggregates.

### Aggregates — `aggregates.json`

Hourly, 5,112 bins: SEIR counts over all 10,000 agents plus total pathogen inflow. Derived
from transitions and the complete poop set.

`gridTicks[i]` is bin `i`'s **opening** tick, while `seir[state][i]` is the population state
at that bin's **closing** tick, so a transition partway through an hour is already reflected
in that hour's counts. This makes SEIR describe the same closed interval that
`pathogenInflow` sums over, and it differs deliberately from the v1 bundle, which samples
state at the opening tick. The bundle records the convention as `"seirSampledAt": "binEnd"`
so a consumer never has to infer it from the numbers.

### Wastewater — `wastewater.bin` + `wastewater_regions.json`

Unchanged regions × time-series interface. 632 populated 0.02° cells × 5,112 hourly bins as
`float32` ≈ 12.9 MB, with region geometry in the sidecar JSON. Cell size stays a CLI flag.

### Size summary

Recomputed from the built bundle (no `poops_pathogen.f32`; see above):

| Artifact | Size |
|---|---:|
| stays | 52.5 MB |
| poops | 22.0 MB |
| wastewater | 13.1 MB |
| disease + transmissions | 1.1 MB |
| aggregates | 0.2 MB |
| venues | 0.2 MB |
| **Total** | **89.1 MB (19 files)** |

## 5. Dwell / Travel Movement Model

The core behavioural change. `positionAtTick` is replaced by `agentStateAtTick`, which
returns position plus a movement flag.

Given an agent's stay slice and a query tick `t`, binary-search for the last stay with
`tick ≤ t`, then:

1. **Before the first stay** — agent is not yet rendered.
2. **Dwelling**, when `t < tick[i] + dwell[i]` — position is venue `venue[i]`'s
   coordinates, offset by a per-agent jitter (§5.1). `moving = false`.
3. **Travelling**, when `t ≥ tick[i] + dwell[i]` and a next stay exists — linear
   interpolation from venue `venue[i]` to venue `venue[i+1]` over
   `[tick[i] + dwell[i], tick[i+1]]`. `moving = true`.
4. **After the last in-window stay** — hold at that venue. `moving = false`.

Because gaps are always ≥ 1 tick, the travel span is never zero and needs no divide-by-zero
guard beyond an assertion.

### 5.1 Per-venue jitter (required, not cosmetic)

Agents are inside a venue **94–100% of the time**, and 10,000 agents share 12,134 venues. Without
displacement, co-located agents draw exactly on top of each other and a crowded apartment
block is indistinguishable from an empty one. Each agent gets a deterministic offset derived
from a hash of `agentId`, distributed on a disc of radius **30 m** (roughly a building
footprint, and about 6 px at neighbourhood zoom — enough to separate a dozen occupants
without detaching them from their venue). Determinism matters: the offset must be a pure
function of `agentId`, or agents will visibly vibrate in place between frames.

The offset applies only while dwelling. During travel the agent interpolates between true
venue centres so paths stay clean.

### 5.2 Rendering consequences

- **Movement is rare and brief.** Travel occupies only a few percent of each agent's
  timeline, so moving agents get a distinct treatment (a short motion trail) to make commute
  waves legible instead of lost in a static field.
- **Venue occupancy becomes meaningful and is a new layer.** Venue markers scale and warm in
  colour with the number of agents currently inside, computed per frame while agent positions
  are resolved. This is the visible payoff of having check-out times.
- **`venueData` / `countVenuesByType` stop reverse-engineering venues** from deduplicated
  waypoint coordinates and read the real venue table instead.

### 5.3 Per-frame performance

`agentData` currently allocates one object per agent and sorts the array every frame. At
10,000 agents and 60 fps that is 600k allocations per second plus a sort. It is replaced by
preallocated typed arrays (positions `Float32Array`, state codes `Uint8Array`) reused across
frames, with draw order handled by bucketing into four state groups rather than a comparison
sort. Per-frame work is then 10,000 binary searches over ~870 stays each, which is trivial.

## 6. Runtime Data Flow

On load: manifest → validate `schemaVersion === 2` → fetch artifacts in parallel → wrap
buffers as typed arrays → build the per-agent stay index and venue table → centre the map on
bbox → start at the outbreak window. Per frame:

1. Playback clock advances sim-time by `speed × dt`, clamped to the window.
2. For each agent, resolve dwell-or-travel position and disease state; accumulate venue
   occupancy counts in the same pass.
3. Advance the poop pointer to spawn splashes near the current tick; age existing ones.
4. Move chart cursors; read wastewater region values at the current hourly bin.

## 7. Error Handling / Edge Cases

- **Encoding guards.** The preprocessor raises if any tick ≥ 65,536, any dwell ≥ 65,536, or
  any venue index ≥ 65,536, rather than silently truncating. These are the assumptions that
  make `uint16` safe; a wider window must fail loudly, not corrupt.
- **Unknown categories.** The existing `_check_categories` guard is retained for venue types
  and disease statuses.
- Agents with no in-window stays are omitted from the index and never rendered.
- Agents with no disease transitions are Susceptible throughout.
- Stays clipped at `windowEnd`; poop and disease events outside the window dropped.
- `schemaVersion` mismatch, or a failed artifact fetch, produces a clear error screen.
- Splash rendering stays capped by the existing visual budget.

## 8. Testing

**Preprocessor (pytest), on small synthetic fixtures:**

- dwell extraction: check-in/check-out pairs → `(tick, dwell, venue)`, including clipping at
  the window edge and dropping out-of-window stays
- venue table construction and index assignment; stability of `venue_id → index`
- coordinate quantization round-trip within tolerance
- transition assembly from exact `exposed_started_time` / `infectious_started_time` plus
  snapshot-derived recovery
- streaming equivalence: batched aggregation over a fixture must equal the same computation
  done in one pass, which is what guards the rewrite of `build.py`
- overflow guards raise on an over-wide window
- inflow and wastewater are computed pre-downsampling (assert a downsampled build has
  identical aggregates to a full build)

**App (Vitest):**

- `agentStateAtTick`: dwelling, travelling, before-first, after-last, and the exact boundary
  ticks between dwell and travel
- jitter determinism (same agent, same offset, across calls) and bounded magnitude
- venue occupancy counting
- typed-array decode of each v2 artifact

Rendering quality is verified manually against the running app.

## 9. Build Sequence

1. `profiles.py` + streaming readers; `dataset_00` still builds byte-identical output.
2. Venue table + stay extraction with dwell, plus overflow guards.
3. Poop quantization, disease/transmission assembly, aggregates, wastewater — full bundle.
4. App: v2 loader and typed-array decode.
5. App: `agentStateAtTick` with jitter, replacing `positionAtTick`; typed-array frame path.
6. Venue layer from the real table + occupancy; travel treatment for moving agents.
7. Manifest-driven copy in the HUD for window and precision caveats; polish.

## 10. Future Work

Unchanged from the v1 design (challenge mode, real sewersheds, sound), plus:

- **Full-year playback** via time-sharded lazy loading, if the August–November tail and the
  quiet months become interesting.
- **Dwell-aware transmission attribution:** with exact exposure times and known dwell
  intervals, the venue where each transmission occurred can be identified — a per-venue
  attack-rate layer this run's data supports and `dataset_00` did not.
