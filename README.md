# Poop SimCity 🚽🏙️

**▶️ Live demo: https://poop-simcity.pages.dev** — no install needed, just open it.

See [ROADMAP.md](ROADMAP.md) for what's built and what's planned.

A web-based, game-flavored visualizer for the agent-based wastewater-epidemiology
simulation in **"Where do We Poop? City-Wide Simulation of Defecation Behavior for
Wastewater-Based Epidemiology"** ([arXiv:2601.04231](https://arxiv.org/abs/2601.04231)).

It plays back a full simulated year of **1,000 agents in Fulton County, GA** as a
living city: little characters move between homes, workplaces, restaurants, and
pubs on a real map; an SEIR outbreak ripples through them; defecation events light
up venues; and the resulting pathogen signal builds in a wastewater layer — all on
a scrubbable timeline with a day/night cycle.

- **Susceptible / Recovered** agents recede into a calm, muted crowd.
- **Exposed (amber)** and **Infectious (red)** agents are bold and wear a soft
  **pulsing glow**, so outbreak hotspots announce themselves.
- A HUD shows a live clock, S/E/I/R counts, and SEIR + wastewater charts synced to
  playback. Layers (wastewater heat, infection arcs, venues, poops) are toggleable.

---

## Quick start (run it on your laptop)

**Prerequisites:** [Node.js](https://nodejs.org/) 18 or newer (`node --version`).
That's all you need — the precomputed data bundle is included in the repo, so you
don't need Python or the raw simulation data just to run the app.

```bash
git clone <this-repo-url>
cd where-do-we-poop-game/app
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

First load fetches a ~31 MB data bundle, so give it a second. Press **Play**, drag
the timeline to the highlighted **outbreak window**, and zoom into a cluster to
watch the little characters turn amber and red.

### Controls
- **Play / Pause** (top-left) and the **Speed** slider (HUD) control playback.
- **Timeline** (bottom): drag to seek anywhere in the year; the red band marks the
  detected outbreak window.
- **Layer toggles** (lower-right): show/hide agents, poops, venues, the wastewater
  heat grid, and infection arcs.

---

## What's in here

```
where-do-we-poop-game/
├── app/                     # Vite + React + TypeScript web app (MapLibre + deck.gl + uPlot)
│   ├── src/                 #   data loading, sim playback logic, render layers, UI
│   ├── tests/               #   Vitest unit tests for the pure logic
│   └── public/data/         #   the precomputed bundle the app plays back (committed)
├── preprocess/              # Python preprocessor: parquet simulation output -> compact bundle
│   ├── poop_simcity_preprocess/
│   └── tests/               #   pytest suite
└── docs/superpowers/        # design spec and implementation plans
```

The app is a **static site with no backend** — it just fetches the bundle from
`app/public/data/dataset_00/` and renders it.

---

## Developing

**Web app** (from `app/`):
```bash
npm run dev      # hot-reloading dev server
npm test         # Vitest unit tests
npm run build    # type-check + production build into app/dist/
```

**Preprocessor** (from `preprocess/`, requires Python 3.11+):
```bash
pip install -r requirements.txt
python -m pytest          # run the test suite
```

### Regenerating the data bundle (optional)
The committed bundle is enough to run the app. To regenerate it (e.g. from a
different simulation run) you need the raw simulation output — a `dataset_00/`
folder of parquet files (`check_in`, `disease_status`, `poop_in`, …), which is
**not** included here because it's large research data. With that folder present at
the repo root, from `preprocess/`:

```bash
python -m poop_simcity_preprocess.cli \
  --dataset ../dataset_00 \
  --out ../app/public/data/dataset_00 \
  --clean-keep-fraction 0.25
python verify_bundle.py   # sanity-checks the generated bundle
```

The raw simulation data and the original simulation framework are available from
the paper's project: <https://github.com/onspatial/wastewater-based-epidemiology-patterns-of-life>.

---

### Deploying / updating the live site
The live demo is hosted free on **Cloudflare Pages** (static files only — no
backend). To publish an update, from `app/`:

```bash
npm run deploy   # builds, then uploads dist/ to the poop-simcity Pages project
```

(First time on a new machine: `npx wrangler login` once to authorize Cloudflare.)

---

## Tech stack
- **App:** Vite, React, TypeScript, MapLibre GL JS (game-skin map), deck.gl
  (GPU agent / poop / wastewater / arc layers), uPlot (charts).
- **Preprocessor:** Python, pandas, pyarrow, numpy.
- The map basemap uses free CARTO raster tiles (no API key required).

## Citation
If you use this, please cite the preprint:
> Amiri, H., Deverakonda, A., Wang, Y., & Züfle, A. *Where do We Poop? City-Wide
> Simulation of Defecation Behavior for Wastewater-Based Epidemiology.*
> arXiv:2601.04231.
