# Poop SimCity 🚽🏙️

**▶️ Live demo: https://poop-simcity.pages.dev** — no install needed, just open it.

It opens on the San Diego run (10,000 agents, dwell-time movement); the **dataset
switcher** in the top-left also plays back the original Atlanta run (1,000 agents).

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
That's all you need — the Atlanta data bundle is included in the repo, so you don't
need Python or the raw simulation data just to run the app.

```bash
git clone <this-repo-url>
cd where-do-we-poop-game/app
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

First load fetches a ~30 MB data bundle, so give it a second. Press **Play**, drag
the timeline to the highlighted **outbreak window**, and zoom into a cluster to
watch the little characters turn amber and red.

### Switching datasets

The **dataset switcher** (top-left) chooses which simulation run to play back:

| | agents | bundle |
|---|---|---|
| **Atlanta** (`dataset_00`) | 1,000 | committed — works straight from a clone |
| **San Diego** (`dataset_sdc-10k`) | 10,000, with dwell-time movement | **not committed** (~89 MB) — build it first |

Selecting San Diego before its bundle exists shows the exact command to generate it
— the same one under **Developing → The `dataset_sdc-10k` bundle** below. The
switcher stays usable on that screen, so you can go straight back to Atlanta.

You can also deep-link a run with `?dataset=dataset_sdc-10k`, and a build can pin its
own default — `npm run build:sdc-10k` opens on San Diego, which is how that demo is
deployed, while a plain `npm run build` opens on Atlanta.

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

### The `dataset_sdc-10k` bundle (schemaVersion 2, 10,000 agents)

A second, larger simulation run — 10,000 agents, 12,134 venues, San Diego County —
is supported via `schemaVersion 2` of the bundle format. Unlike `dataset_00`, this
bundle is **not committed** to the repo (it's ~89.4 MB across 23 files; see
`.gitignore`), so it must be generated locally. With the raw `dataset_sdc-10k/` parquet folder
(`Checkin.parquet`, `DiseasesStatus.parquet`, `Poopin.parquet`) present at the repo
root, from `preprocess/`:

```bash
python -m poop_simcity_preprocess.cli \
  --dataset ../dataset_sdc-10k \
  --out ../app/public/data/dataset_sdc-10k \
  --run-id dataset_sdc-10k \
  --profile dataset_sdc-10k \
  --window-start 2024-01-01T00:00:00 \
  --window-end 2024-07-31T23:55:00 \
  --clean-keep-fraction 0.3 \
  --shapefile-dir ../san_diego_shapefiles
python verify_bundle_v2.py --bundle ../app/public/data/dataset_sdc-10k \
  --dataset ../dataset_sdc-10k --profile dataset_sdc-10k
```

`--shapefile-dir` points at a directory of `<shed>_sewershed.shp` files (one
dissolved ZCTA-union polygon per treatment plant) and adds the per-sewershed
wastewater/SEIR artifacts (`sewersheds.json`, `sewershed_ww.bin`,
`sewershed_seir.bin`, `agent_home_shed.u8`) plus a `sewershedKind` field on the
manifest. It's optional: omitting the flag produces a bundle with no
sewershed layer at all (schemaVersion 2 bundles worked this way before this
layer existed).

The `--window-start`/`--window-end` bounds cover January 1 through July 31, 2024 —
about 99.3% of all disease exposures in the source data — rather than the full
simulated year. Two things force a window at all: (1) ticks are encoded as
`uint16`, capping any run at 65,536 five-minute ticks (~227 days), well short of
a full year; and (2) even without that ceiling, restricting to the
highest-exposure stretch keeps the bundle a manageable size. `--clean-keep-fraction`
only thins *non-pathogen-bearing* poop events for render budget — every
pathogen-bearing poop event is always kept, and nothing quantitative (SEIR,
wastewater totals) is ever computed from the thinned stream.

---

### Deploying / updating the live site
The live demo is hosted free on **Cloudflare Pages** (static files only — no
backend). To publish an update, from `app/`:

```bash
npm run deploy   # builds, then uploads dist/ to the poop-simcity Pages project
```

(First time on a new machine, or after the token expires: `npx wrangler login` once
to authorize Cloudflare.)

### One site, both runs

There is a single Pages project, **`poop-simcity`**. `dist/` contains both bundles, so
the deployed site serves both runs and the dataset switcher moves between them —
no second project needed.

`npm run deploy` runs `build:sdc-10k`, so the site opens on San Diego. Deep-link the
other run with
[`?dataset=dataset_00`](https://poop-simcity.pages.dev/?dataset=dataset_00).

Note the San Diego bundle is gitignored, so **deploy from a checkout where you have
built it** — otherwise `dist/` ships only Atlanta and the switcher's San Diego option
lands on the "generate this bundle" screen.

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
