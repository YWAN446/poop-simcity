# Poop SimCity — Roadmap

A living document tracking what's built and what's planned.

- **Live demo:** https://poop-simcity.pages.dev
- **Repo:** https://github.com/YWAN446/poop-simcity (private)
- **Paper:** *Where do We Poop? City-Wide Simulation of Defecation Behavior for
  Wastewater-Based Epidemiology* — [arXiv:2601.04231](https://arxiv.org/abs/2601.04231)

**Status:** v1 shipped and deployed. A web-based, game-flavored visualizer that
plays back a simulated year of 1,000 agents in Fulton County — agents moving
between venues, an SEIR outbreak, defecation events, and the resulting wastewater
pathogen signal — on a real map with a scrubbable timeline.

**v2 in review ([PR #1](https://github.com/YWAN446/poop-simcity/pull/1)):** a second
run, `dataset_sdc-10k` — 10,000 agents in San Diego County — whose check-ins carry
a `CheckoutTime`, so agents now **dwell at venues for real durations** instead of
gliding continuously.

---

## Done

### Data pipeline (Python preprocessor)
- [x] Converts the raw simulation parquet files into a compact, web-ready static bundle:
      per-agent movement tracks, collapsed S→E→I→R disease timelines, the poop-event
      stream, hourly SEIR + pathogen-inflow aggregates, a spatial wastewater grid, and a manifest.
- [x] Detects the outbreak window; validates input categories and time bounds.
- [x] Test-driven (22 pytest tests) + a real-bundle verification script.

### Web app (Vite + React + TypeScript, MapLibre + deck.gl + uPlot, no backend)
- [x] Real Atlanta map with a muted "game skin"; loads the static bundle (no server).
- [x] Animated agents; full-year scrubber with the outbreak window highlighted; play/pause + speed.
- [x] HUD with SEIR + wastewater charts synced to playback; layer toggles.
- [x] Poop splashes, wastewater heat layer, infection arcs, day/night tint.
- [x] Pure logic (decode, interpolation, disease-state lookup, time mapping, playback
      clock, bundle loader) unit-tested (19 Vitest tests).

### Publishing
- [x] README with quick-start; data bundle committed for zero-setup runs.
- [x] Private GitHub repo; free live demo on Cloudflare Pages; one-command `npm run deploy`.

### Visual refinements
- [x] Agents render as little character sprites (not dots).
- [x] Exposed/Infectious highlighted over a muted S/R crowd; pulsing glow behind infected agents.
- [x] Poops render as poop-pile sprites; pathogen-bearing ones are red, clean ones brown.
- [x] Map zoom in/out buttons; venue-toggle bug fixed.
- [x] Wastewater chart retitled "Number of Pathogen in Wastewater" with a real date axis;
      larger charts and a wider HUD; "Arcs" renamed to "Transmissions".
- [x] Two-line legend under each chart (date + S/E/I/R or pathogen value); removed the
      redundant top clock/counts.
- [x] Color legend explaining agents, poops, and venues (with venue counts).
- [x] Wastewater legend gradient + absolute (global) color scale, comparable across time.

### Second run: `dataset_sdc-10k` — San Diego, 10,000 agents, dwell-time movement (PR #1)
- [x] **Dwell/travel movement** from the new `CheckoutTime` column — agents park at a venue
      for its real duration, then travel to the next. Deterministic 30 m per-agent jitter so
      10,000 agents don't collapse onto 12,134 identical points.
- [x] **Venue occupancy layer** — venue markers scale with how many agents are inside right
      now, which is the visible payoff of having check-out times.
- [x] **Bundle format v2** — struct-of-arrays, one file per field, so every artifact decodes
      as a zero-copy typed array; agent stays reference venues by index (6 bytes, was 13).
- [x] **Streaming preprocessor** — handles 585 MB of parquet (43.8M disease rows) on limited
      RAM; two hot loops vectorized. Whole build runs in ~23 s.
- [x] Playback window Jan 1 – Jul 31 2024: 99.3% of all exposures, and every tick index stays
      under 65,536 so tick fields fit `uint16`.
- [x] `verify_bundle_v2.py` cross-checks the generated bundle against the source parquet
      (22 checks, including counts re-derived from the parquet rather than the manifest).
- [x] Per-frame render path rebuilt on reusable typed arrays; ~43 fps with all six layers on.
- [x] Fixed a float32 underflow that silently rendered ~1 in 5 infected splashes as clean.
- [x] HUD now discloses the playback window, daily recovery resolution, and clean-poop
      downsampling — all derived from the manifest rather than hardcoded.

---

## Planned

### Next up (small / mostly designed)
- [ ] **Make restaurants/pubs more visible** — there are only ~19 restaurants and ~10 pubs
      vs ~895 apartments, so they're easy to miss; enlarge or brighten those markers.
- [ ] **Wastewater scale toggle** — switch between absolute (global) and per-moment scaling.
- [ ] **Pathogen value format** — option for the full number with separators vs compact ("53.86M").
- [ ] **Chart hover inspection** — let hovering a chart read off values at that time (today the
      readout follows playback only).

### Bigger features
- [ ] **Challenge mode** — place a budget of wastewater sensors on the grid and score outbreak
      detection (lead time / accuracy) vs ground truth. The wastewater layer already uses a
      generic regions × time-series interface to support this.
- [ ] **Real sewersheds** — swap the spatial-grid proxy for real sewershed GIS shapefiles
      (drop-in GeoJSON) when available.
- [ ] **Social-network layer** — visualize the friend/family and work graphs (`social_links`,
      `.dgs`) and infection paths through them.
- [ ] **Scenario switcher** — compare the paper's infection-rate scenarios (0.1 / 0.15 / 0.2 / 0.25)
      by preprocessing multiple runs and letting the user switch datasets. Now doubly wanted:
      two runs exist (`dataset_00`, `dataset_sdc-10k`) but the app targets only the latter,
      and they use different bundle schema versions.
- [ ] **Full-year playback for `dataset_sdc-10k`** — the Aug–Nov tail and the quiet months are
      cut to keep the bundle to one download; time-sharded lazy loading would restore them.
- [ ] **Dwell-aware transmission attribution** — with exact exposure times and known dwell
      intervals, the venue where each transmission happened is derivable; a per-venue
      attack-rate layer is possible on this run and wasn't on `dataset_00`.
- [ ] **Sound** — optional subtle plops / ambient, off by default.

### Polish & infrastructure
- [ ] **Auto-deploy** — connect the repo to Cloudflare Pages (or a GitHub Action) so pushes to
      `main` deploy automatically, instead of manual `npm run deploy`.
- [ ] **Bundle size** — `agents.bin` (~18 MB) dominates the download; trim via downsampling or a
      sparser encoding; code-split the JS. For `dataset_sdc-10k` the bundle is 101.7 MB and is
      **gitignored** rather than committed (regenerate with the README command in ~23 s), so a
      fresh clone can't run that view until it's rebuilt — revisit if the demo should host it.
- [ ] **Retire the v1 render path** — `app/src/render/layers.ts` is now ~93% unreferenced by the
      app (only `makePoopLayer` is live), along with `useBundle.ts` and `usePulse.ts`. Deleting
      them is a clean separate change; deliberately not done alongside the v2 port.
- [ ] **Responsive layout** — make the HUD/legend usable on smaller screens.
- [ ] **Access control (optional)** — gate the public demo to specific people via Cloudflare Access
      if it shouldn't be fully public.
- [ ] **A short on-screen intro / "How it works"** for first-time viewers.

---

*Update this file as items move from Planned to Done.*
