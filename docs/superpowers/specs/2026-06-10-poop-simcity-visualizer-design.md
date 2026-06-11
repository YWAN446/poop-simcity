# Poop SimCity — Living-City Visualizer Design

**Date:** 2026-06-10
**Status:** Approved design, pre-implementation
**Source data:** `dataset_00/` — one simulation run from the preprint *"Where do We Poop? City-Wide Simulation of Defecation Behavior for Wastewater-Based Epidemiology"* (arXiv:2601.04231v2)

## 1. Purpose & Scope

Build a web-based, game-flavored visualizer that plays back a precomputed agent-based
simulation of defecation behavior and disease spread across Fulton County, GA. The
experience is a **living-city playback** ("Poop SimCity"): a real geographic map with a
playful skin, on which 1,000 agents move between venues, defecation events pop, an SEIR
outbreak ripples through the population, and pathogen accumulates into a wastewater
signal.

**In scope (v1):** observational playback with strong visual polish, time controls, and a
HUD/dashboard.

**Out of scope (v1), planned later:** a **challenge mode** where the user places a budget
of wastewater sensors and is scored on outbreak detection. The data pipeline and the
wastewater "regions" interface are designed so challenge mode can be layered on without
rework.

### Key decisions (from brainstorming)
- Living-city **playback first**, challenge mode later.
- **Real geography** (true lat/lon) with a **game skin** on top — not an invented map.
- **Full-year scrubber** with the outbreak window highlighted; native 5-minute resolution
  when zoomed in, hourly stepping when zoomed out.
- Default layers: agent characters, venues, poop splashes, SEIR chart, wastewater
  time-series. Wastewater heat/sampling layer and infection arcs are toggleable overlays.
- **Approach A — static precomputed bundle, no backend.**
- Wastewater built against a generic **regions × time-series** interface; v1 uses a spatial
  grid proxy, swappable for the user's real **sewershed GIS shapefiles** (provided later) as
  drop-in GeoJSON.
- Agents are **little characters** (with a colored-dot LOD fallback when zoomed far out).

## 2. Source Data (`dataset_00/`)

1,000 agents, full year (2024-01-01 → 2024-12-31), 5-minute ticks, Atlanta metro
(lat 33.51–34.19, lon −84.78 to −84.16).

| File | Rows | Use |
|------|------|-----|
| `check_in.parquet` | 1.44M | Agent location waypoints: `agent_id, time, venue_id, venue_type, lat, lon`. Venue types: Apartment, Workplace, Restaurant, Pub. |
| `disease_status.parquet` | 4.38M | Per-agent S/E/I/R snapshots: `time, agent_id, exposed_started_time, infectious_started_time, pathogen_level, disease_status, source_agent_id, lat, lon`. |
| `poop_in.parquet` | 1.05M | Defecation events: `agent_id, time, lat, lon, venue_type, pathogen_level, disease_status, infectious_started_time`. ~69K carry pathogen. |
| `social_links.parquet` | 2.09M | Daily directed social edges: `time, from, to`. |
| `FriendFamilyGraph.dgs`, `WorkGraph.dgs` | — | GraphStream social/work graphs. Not used in v1. |
| `output_matrix.csv` | 736 MB | Aggregated wastewater matrix. **Not loaded by the app.** Optional preprocessing validation source only. |

The dataset contains **no sewer-network geometry**; v1 derives the wastewater signal from
`poop_in` aggregated to a spatial grid.

## 3. Architecture

Two cleanly separated pieces:

- **Preprocessor** (Python, build-time): reads the parquet files once, emits a compact
  static **data bundle**. Run rarely; not part of the live app.
- **Web app** (static site): Vite + React + TypeScript; MapLibre GL JS for the real map +
  game skin; deck.gl for GPU-accelerated agent/poop/arc layers; uPlot for
  playback-synced charts. No backend — deployable to any static host, works offline.

```
parquet files ──[Python preprocessor]──> public/data/<run_id>/ (bundle)
                                              │
                                   [static web app: Vite/React]
                                              │
                                   MapLibre + deck.gl + uPlot
```

## 4. Data Bundle Format (preprocessor output)

Versioned folder `public/data/<run_id>/`. Ticks are integer indices from `startTime`
(`tick = (time − startTime) / 300s`). Exact byte layouts below are a recommended starting
point and may be refined during implementation; the *logical content* is fixed.

### `manifest.json`
```jsonc
{
  "schemaVersion": 1,
  "runId": "dataset_00",
  "tickIntervalSec": 300,
  "startTime": "2024-01-01T00:05:00",
  "endTime":   "2024-12-31T00:05:00",
  "numTicks": <int>,
  "numAgents": 1000,
  "bbox": [minLon, minLat, maxLon, maxLat],
  "outbreakWindow": { "startTick": <int>, "endTick": <int> },
  "venueTypes": ["Apartment", "Workplace", "Restaurant", "Pub"],
  "artifacts": {
    "agents": "agents.bin",
    "agentsIndex": "agents_index.json",
    "disease": "disease.json",
    "poops": "poops.bin",
    "aggregates": "aggregates.json",
    "wastewater": "wastewater.json"
  }
}
```

### Agent tracks — `agents.bin` + `agents_index.json`
- **Logical content:** per agent, a time-ordered list of check-in waypoints
  `(tick, lon, lat, venueTypeId)`. The browser interpolates position between consecutive
  waypoints; an agent holds at its last venue until the next waypoint (no teleport tween
  across long gaps — straight-line tween only between consecutive check-ins).
- **Encoding:** one interleaved binary array sorted by agent, then tick. Per waypoint:
  `uint32 tick, float32 lon, float32 lat, uint8 venueTypeId` (padded to 16 bytes for
  alignment). `agents_index.json` is `[{ agentId, offset, count }, …]` giving each agent's
  slice.

### Disease timelines — `disease.json`
Snapshots collapsed to actual transitions (sparse; a few per agent):
```jsonc
{
  "stateCodes": { "S": 0, "E": 1, "I": 2, "R": 3 },
  "agents": [
    { "agentId": 0,
      "transitions": [[tick, stateCode], …],     // state changes only
      "pathogenSamples": [[tick, level], …] },    // sampled (e.g. daily) during Infectious
    …
  ],
  "transmissions": [[tick, sourceAgentId, targetAgentId], …]  // for infection arcs
}
```
Agents with no transitions are Susceptible throughout. "State at tick" = last transition
at or before the tick.

### Poop events — `poops.bin`
Interleaved, **sorted by tick** (enables a forward-advancing stream pointer). Per event:
`uint32 tick, float32 lon, float32 lat, uint8 venueTypeId, uint8 infectedFlag,
float32 pathogenLevel`. Clean (non-pathogen) events are downsampled in preprocessing if
splash density exceeds the render budget; infected events are always kept.

### Aggregates — `aggregates.json`
Precomputed hourly series (cheap to drive the charts):
```jsonc
{
  "cadenceSec": 3600,
  "startTime": "2024-01-01T00:05:00",
  "seir": { "S": [...], "E": [...], "I": [...], "R": [...] },
  "pathogenInflow": [...]   // total pathogen entering the system per hour
}
```

### Wastewater regions — `wastewater.json`
Generic **regions × time-series** interface (v1 = spatial grid; later = sewershed GeoJSON):
```jsonc
{
  "kind": "grid",                     // or "sewershed"
  "cadenceSec": 3600,
  "regions": [
    { "id": "...", "centroid": [lon, lat], "polygon": [[lon,lat], …] }, …
  ],
  "series": { "<regionId>": [...] }   // pathogen load per region per time bin
}
```

## 5. Web App Components

- **MapView** — MapLibre base (a free, no-API-key vector style such as OpenFreeMap/Carto,
  restyled into the muted game skin) with deck.gl overlays:
  - `AgentLayer` — little-character sprites (IconLayer/sprite atlas) positioned by
    interpolation, tinted/badged by disease state; LOD fallback to colored dots at low zoom.
  - `VenueLayer` — venue icons.
  - `PoopLayer` — ephemeral fading splash pulses.
  - `WastewaterLayer` (toggle) — grid heat / manhole sampling gauges.
  - `InfectionArcLayer` (toggle) — transient source→target arcs.
- **PlaybackController** — owns sim-time; a `requestAnimationFrame` loop maps wall-clock →
  sim-time at an adjustable speed, exposing `currentTick` + interpolation `alpha`. Native
  5-minute resolution when zoomed in, hourly stepping when zoomed out.
- **Timeline/Scrubber** — full-year track with the outbreak window highlighted; drag to
  seek; day/week/month zoom.
- **HUD/Dashboard** — clock/calendar, S/E/I/R counters, SEIR area chart + wastewater
  time-series chart (cursor synced to playback), layer toggles, speed control.
- **DataLoader** — fetches manifest + artifacts, decodes binary into typed arrays, builds
  in-memory indices (per-agent waypoint slices; time-sorted poop index).

## 6. Runtime Data Flow

On load: manifest → artifacts → decode → build indices → center map on bbox → start at the
outbreak window. Each animation frame:
1. PlaybackController advances sim-time by `speed × dt`, clamped to `[startTick, endTick]`.
2. **Agents:** binary-search each agent's waypoints for the bracketing pair, lerp position;
   look up active disease state from the transition timeline.
3. **Poops:** advance a pointer through the tick-sorted events to spawn splashes near the
   current tick; age/fade existing splashes. Pointer resets on seek.
4. **Charts:** move cursors to the current time; values read from precomputed aggregates.
5. **Wastewater:** read region series at the current (coarsened) time bin.

1,000 interpolations/frame is trivial; rendering is GPU-side via deck.gl.

## 7. Visual / Art Direction — "Poop SimCity"

Cozy, tactile board-game charm — playful but clean and legible, never gross. The
frontend-design skill guides implementation to keep quality high.

- **Map skin:** custom muted MapLibre style — soft pastel/paper land, gentle water,
  light-gray simplified roads, soft-green parks — deliberately low-contrast so colorful
  agents and events pop.
- **Day/night cycle:** the map subtly tints with the sim clock (warm dawn → bright midday →
  blue dusk → dim night), giving "living city" ambiance tied to the 5-minute time.
- **Agents:** little characters (sprite-based), color-coded by state — Susceptible calm
  teal, Exposed amber, Infectious warm red with a soft pulsing glow, Recovered muted green
  — with gentle movement easing. LOD: simplify to colored dots when zoomed far out.
- **Venues:** cute icons with soft shadows and a subtle bob — house (Apartment), building
  (Workplace), fork (Restaurant), mug (Pub).
- **Poop splashes (signature flourish):** a little 💩 pop with a ripple; clean = soft brown
  pip, infected = glowing "pathogen" color with a stronger ripple; quick pop-and-fade.
- **Wastewater:** sampling points as manhole gauges filling with colored liquid; grid heat
  layer in a toxic gradient.
- **HUD:** rounded translucent panels, soft shadows, friendly geometric typography; big
  clock/calendar, animated S/E/I/R counters, clean charts, game-style speed controls
  (1×/2×/…).
- **Sound:** optional subtle plops/ambient, **off by default** — polish item, not v1-critical.

## 8. Error Handling / Edge Cases

- Agents hidden before their first check-in; long gaps hold at the last venue (tween only
  between consecutive check-ins — no teleport jitter).
- Sim-time clamped to `[startTick, endTick]`.
- `schemaVersion` validated on load; clear error UI on mismatch or failed artifact fetch.
- Simultaneous-splash visual budget caps poop rendering; clean poops downsampled in
  preprocessing if needed.
- Agents with no disease transitions render as Susceptible throughout.
- `output_matrix.csv` is never loaded by the app.

## 9. Testing

- **Preprocessor (pytest):** small synthetic parquet fixtures — track extraction,
  transition collapsing (e.g. `S,S,E,E,I` → transitions at the right ticks), aggregate
  correctness, binary round-trip decode. A validation script confirms SEIR counts derived
  from transitions match raw snapshot counts at sampled times.
- **App (Vitest):** pure logic — waypoint interpolation, bracketing binary search,
  state-at-tick lookup, time/scale mapping. Component smoke tests. Manual visual
  verification for rendering quality.

## 10. Build Sequence

1. Preprocessor → data bundle from `dataset_00` (manifest + all artifacts).
2. App skeleton (Vite/React/TS) + MapLibre game-skin base map centered on bbox.
3. DataLoader + AgentLayer interpolation + play/pause/scrub.
4. Disease coloring + SEIR chart + clock/HUD + day/night tint.
5. Poop splashes + wastewater grid layer + wastewater chart.
6. Infection arcs, layer toggles, timeline zoom, character art + polish.

## 11. Future Work (post-v1)

- **Challenge mode:** sensor-placement budget on the wastewater grid; detection scoring vs.
  ground truth. May introduce DuckDB-wasm or a small backend for live recomputation.
- **Real sewersheds:** swap the grid for the user's GIS shapefiles via the regions interface
  (GeoJSON).
- **output_matrix.csv** cross-validation of the derived wastewater signal.
- Social-network layer from `social_links` / `.dgs` graphs.
- Sound design.
