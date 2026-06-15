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
      by preprocessing multiple runs and letting the user switch datasets.
- [ ] **Sound** — optional subtle plops / ambient, off by default.

### Polish & infrastructure
- [ ] **Auto-deploy** — connect the repo to Cloudflare Pages (or a GitHub Action) so pushes to
      `main` deploy automatically, instead of manual `npm run deploy`.
- [ ] **Bundle size** — `agents.bin` (~18 MB) dominates the download; trim via downsampling or a
      sparser encoding; code-split the JS.
- [ ] **Responsive layout** — make the HUD/legend usable on smaller screens.
- [ ] **Access control (optional)** — gate the public demo to specific people via Cloudflare Access
      if it shouldn't be fully public.
- [ ] **A short on-screen intro / "How it works"** for first-time viewers.

---

*Update this file as items move from Planned to Done.*
