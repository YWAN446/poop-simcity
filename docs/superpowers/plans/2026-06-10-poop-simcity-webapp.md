# Poop SimCity Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the static, game-flavored "Poop SimCity" web app that plays back the precomputed data bundle on a real map of Fulton County — animated agents colored by disease state, poop splashes, a wastewater layer, an SEIR/wastewater HUD, and a full-year scrubber.

**Architecture:** A Vite + React + TypeScript static app. A pure-logic core (binary decoding, position interpolation, disease-state lookup, time mapping, playback clock) is fully unit-tested with Vitest. A rendering layer (MapLibre GL base map with a custom game skin + deck.gl overlays via `MapboxOverlay`) and a HUD (uPlot charts) are built as integration tasks verified in the browser. No backend — the app fetches the static bundle from `public/data/dataset_00/`.

**Tech Stack:** Vite 5, React 18, TypeScript 5, maplibre-gl 4, react-map-gl 7 (maplibre), deck.gl 9 (`@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/mapbox`), uPlot 1.6, Vitest 2.

This is **Plan 2 of 2**. Plan 1 (the preprocessor) is merged; the bundle it produces lives at `app/public/data/dataset_00/` (gitignored).

**Spec:** `docs/superpowers/specs/2026-06-10-poop-simcity-visualizer-design.md` (sections 3–8 define the app; section 4 + the notes below define the exact bundle wire format).

---

## Bundle Wire Format (the concrete contract this app reads)

Located at `public/data/dataset_00/`. `tick` is an integer index; real-clock time = `startTime + tick * tickIntervalSec` seconds.

- **`manifest.json`**: `{ schemaVersion:1, runId, tickIntervalSec:300, startTime:"2024-01-01T00:05:00", endTime:"2024-12-31T00:05:00", numTicks:105121, numAgents:1000, bbox:[minLon,minLat,maxLon,maxLat], outbreakWindow:{startTick:0,endTick:49812}, venueTypes:["Apartment","Workplace","Restaurant","Pub"], artifacts:{agents,agentsIndex,disease,poops,aggregates,wastewater} }`
- **`agents.bin`**: tightly packed little-endian records, **13 bytes each**: `tick` u32 @0, `lon` f32 @4, `lat` f32 @8, `vtype` u8 @12. Sorted by (agent, tick).
- **`agents_index.json`**: `[{ agentId, offset, count }]` — offset/count in **records** (not bytes), one entry per agent.
- **`poops.bin`**: little-endian records, **18 bytes each**: `tick` u32 @0, `lon` f32 @4, `lat` f32 @8, `vtype` u8 @12, `infected` u8 @13, `pathogen` f32 @14. Sorted by tick.
- **`disease.json`**: `{ stateCodes:{S:0,E:1,I:2,R:3}, agents:[{ agentId, transitions:[[tick,code],...], pathogenSamples:[[tick,level],...] }], transmissions:[[tick,sourceId,targetId],...] }`. State at a tick = the last transition at-or-before it (default S/code 0).
- **`aggregates.json`**: `{ cadenceSec:3600, startTime, gridTicks:[...8761], seir:{S,E,I,R:[...8761]}, pathogenInflow:[...8761] }`.
- **`wastewater.json`**: `{ kind:"grid", cadenceSec:3600, regions:[{ id, centroid:[lon,lat], polygon:[[lon,lat]×4] }], series:{ "<id>":[...8761] } }`. 146 regions.

Venue type id = index into `venueTypes` (0=Apartment, 1=Workplace, 2=Restaurant, 3=Pub).

---

## File Structure

```
app/
  package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, vitest.config.ts, index.html
  public/data/dataset_00/        # the bundle (gitignored)
  src/
    main.tsx, App.tsx, App.css
    types.ts                     # TS interfaces mirroring the bundle
    data/
      decodeBinary.ts            # agents.bin / poops.bin -> SoA typed arrays
      loadBundle.ts              # fetch + decode all artifacts -> Bundle
    sim/
      interpolation.ts           # bracketing search + lerp position at a tick
      diseaseState.ts            # state code at a tick from transitions
      timeMapping.ts             # tick <-> Date, hour-bin index
      playbackClock.ts           # advance/clamp tick by wall-clock dt and speed
    render/
      theme.ts                   # palette: disease-state + venue colors, day/night
      mapStyle.ts                # MapLibre game-skin style object
      layers.ts                  # deck.gl layer factory functions
      DeckOverlay.tsx            # MapboxOverlay wiring (deck.gl over maplibre)
    ui/
      MapView.tsx                # map + overlay container
      Timeline.tsx               # full-year scrubber with outbreak band
      Hud.tsx                    # clock/calendar + S/E/I/R counters + toggles + speed
      SeirChart.tsx              # uPlot SEIR area chart synced to playback
      WastewaterChart.tsx        # uPlot pathogen inflow chart synced to playback
    hooks/
      usePlayback.ts             # RAF loop -> currentTick + interpolation alpha
      useBundle.ts               # load bundle, expose status
  tests/
    decodeBinary.test.ts, interpolation.test.ts, diseaseState.test.ts,
    timeMapping.test.ts, playbackClock.test.ts, loadBundle.test.ts, theme.test.ts
```

Tasks 1–7 are pure-logic, fully TDD. Tasks 8–13 are browser-verified rendering/UI (the spec sanctions manual visual verification for rendering). All work happens on a feature branch off `main`.

---

### Task 0: Scaffold the Vite + React + TS app

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/tsconfig.node.json`, `app/vite.config.ts`, `app/vitest.config.ts`, `app/index.html`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/App.css`
- Test: `app/tests/smoke.test.ts`

- [ ] **Step 1: Create project files**

`app/package.json`:
```json
{
  "name": "poop-simcity",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "maplibre-gl": "^4.7.1",
    "react-map-gl": "^7.1.7",
    "deck.gl": "^9.0.33",
    "uplot": "^1.6.31"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

`app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`app/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

`app/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

`app/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`app/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Poop SimCity</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`app/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`app/src/App.tsx`:
```tsx
export default function App() {
  return <div className="app-shell">Poop SimCity</div>;
}
```

`app/src/App.css`:
```css
:root { color-scheme: dark; }
html, body, #root { margin: 0; height: 100%; }
.app-shell { height: 100%; font-family: system-ui, sans-serif; }
```

- [ ] **Step 2: Write the smoke test**

`app/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Install and run**

Run from `app/`:
```
npm install
npm test
```
Expected: 1 passed. (If `npm install` warns about peer deps for deck.gl/react-map-gl, that is acceptable; the versions above are compatible.)

- [ ] **Step 4: Confirm dev server boots**

Run `npm run dev`, confirm Vite serves at `http://localhost:5173` and the page shows "Poop SimCity". Stop the server.

- [ ] **Step 5: Add app-specific gitignore and commit**

Append to the repo root `.gitignore` (if not already covered): `app/node_modules/` and `app/dist/` (note: `app/public/data/` is already ignored). Then:
```bash
git add app/package.json app/tsconfig.json app/tsconfig.node.json app/vite.config.ts app/vitest.config.ts app/index.html app/src app/tests/smoke.test.ts .gitignore
git commit -m "chore: scaffold Vite React TS app"
```
Do NOT commit `app/node_modules/` or `app/package-lock.json` is fine to commit.

---

### Task 1: Binary decoding (`decodeBinary` + `types`)

**Files:**
- Create: `app/src/types.ts`
- Create: `app/src/data/decodeBinary.ts`
- Test: `app/tests/decodeBinary.test.ts`

Decodes the `.bin` artifacts into Structure-of-Arrays typed arrays (1.4M agent waypoints — avoid per-record objects).

- [ ] **Step 1: Write the failing test**

`app/tests/decodeBinary.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decodeAgentWaypoints, decodePoopEvents } from "../src/data/decodeBinary";

function buildAgentBuffer(records: [number, number, number, number][]): ArrayBuffer {
  const buf = new ArrayBuffer(records.length * 13);
  const dv = new DataView(buf);
  records.forEach(([tick, lon, lat, vtype], i) => {
    const o = i * 13;
    dv.setUint32(o, tick, true);
    dv.setFloat32(o + 4, lon, true);
    dv.setFloat32(o + 8, lat, true);
    dv.setUint8(o + 12, vtype);
  });
  return buf;
}

function buildPoopBuffer(
  records: [number, number, number, number, number, number][],
): ArrayBuffer {
  const buf = new ArrayBuffer(records.length * 18);
  const dv = new DataView(buf);
  records.forEach(([tick, lon, lat, vtype, infected, pathogen], i) => {
    const o = i * 18;
    dv.setUint32(o, tick, true);
    dv.setFloat32(o + 4, lon, true);
    dv.setFloat32(o + 8, lat, true);
    dv.setUint8(o + 12, vtype);
    dv.setUint8(o + 13, infected);
    dv.setFloat32(o + 14, pathogen, true);
  });
  return buf;
}

describe("decodeAgentWaypoints", () => {
  it("decodes 13-byte records into parallel arrays", () => {
    const buf = buildAgentBuffer([
      [0, -84.4, 33.7, 0],
      [12, -84.39, 33.71, 1],
    ]);
    const wp = decodeAgentWaypoints(buf);
    expect(wp.count).toBe(2);
    expect(wp.tick[0]).toBe(0);
    expect(wp.tick[1]).toBe(12);
    expect(wp.lon[1]).toBeCloseTo(-84.39, 4);
    expect(wp.vtype[1]).toBe(1);
  });
});

describe("decodePoopEvents", () => {
  it("decodes 18-byte records including infected flag and pathogen", () => {
    const buf = buildPoopBuffer([[5, -84.5, 33.6, 3, 1, 1e7]]);
    const p = decodePoopEvents(buf);
    expect(p.count).toBe(1);
    expect(p.tick[0]).toBe(5);
    expect(p.vtype[0]).toBe(3);
    expect(p.infected[0]).toBe(1);
    expect(p.pathogen[0]).toBeCloseTo(1e7, -2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `app/`: `npm test -- decodeBinary`
Expected: FAIL (cannot find module `decodeBinary`).

- [ ] **Step 3: Write the implementation**

`app/src/types.ts`:
```ts
export interface Manifest {
  schemaVersion: number;
  runId: string;
  tickIntervalSec: number;
  startTime: string;
  endTime: string;
  numTicks: number;
  numAgents: number;
  bbox: [number, number, number, number];
  outbreakWindow: { startTick: number; endTick: number };
  venueTypes: string[];
  artifacts: Record<string, string>;
}

export interface AgentIndexEntry {
  agentId: number;
  offset: number;
  count: number;
}

export interface AgentWaypoints {
  tick: Uint32Array;
  lon: Float32Array;
  lat: Float32Array;
  vtype: Uint8Array;
  count: number;
}

export interface PoopEvents {
  tick: Uint32Array;
  lon: Float32Array;
  lat: Float32Array;
  vtype: Uint8Array;
  infected: Uint8Array;
  pathogen: Float32Array;
  count: number;
}

export interface DiseaseAgent {
  agentId: number;
  transitions: [number, number][];
  pathogenSamples: [number, number][];
}

export interface Disease {
  stateCodes: Record<string, number>;
  agents: DiseaseAgent[];
  transmissions: [number, number, number][];
}

export interface Aggregates {
  cadenceSec: number;
  startTime: string;
  gridTicks: number[];
  seir: { S: number[]; E: number[]; I: number[]; R: number[] };
  pathogenInflow: number[];
}

export interface WastewaterRegion {
  id: string;
  centroid: [number, number];
  polygon: [number, number][];
}

export interface Wastewater {
  kind: string;
  cadenceSec: number;
  regions: WastewaterRegion[];
  series: Record<string, number[]>;
}
```

`app/src/data/decodeBinary.ts`:
```ts
import type { AgentWaypoints, PoopEvents } from "../types";

const AGENT_RECORD_BYTES = 13;
const POOP_RECORD_BYTES = 18;

export function decodeAgentWaypoints(buffer: ArrayBuffer): AgentWaypoints {
  const count = buffer.byteLength / AGENT_RECORD_BYTES;
  const dv = new DataView(buffer);
  const tick = new Uint32Array(count);
  const lon = new Float32Array(count);
  const lat = new Float32Array(count);
  const vtype = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * AGENT_RECORD_BYTES;
    tick[i] = dv.getUint32(o, true);
    lon[i] = dv.getFloat32(o + 4, true);
    lat[i] = dv.getFloat32(o + 8, true);
    vtype[i] = dv.getUint8(o + 12);
  }
  return { tick, lon, lat, vtype, count };
}

export function decodePoopEvents(buffer: ArrayBuffer): PoopEvents {
  const count = buffer.byteLength / POOP_RECORD_BYTES;
  const dv = new DataView(buffer);
  const tick = new Uint32Array(count);
  const lon = new Float32Array(count);
  const lat = new Float32Array(count);
  const vtype = new Uint8Array(count);
  const infected = new Uint8Array(count);
  const pathogen = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * POOP_RECORD_BYTES;
    tick[i] = dv.getUint32(o, true);
    lon[i] = dv.getFloat32(o + 4, true);
    lat[i] = dv.getFloat32(o + 8, true);
    vtype[i] = dv.getUint8(o + 12);
    infected[i] = dv.getUint8(o + 13);
    pathogen[i] = dv.getFloat32(o + 14, true);
  }
  return { tick, lon, lat, vtype, infected, pathogen, count };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- decodeBinary` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/types.ts app/src/data/decodeBinary.ts app/tests/decodeBinary.test.ts
git commit -m "feat: decode agents.bin and poops.bin into typed arrays"
```

---

### Task 2: Disease state at a tick (`diseaseState`)

**Files:**
- Create: `app/src/sim/diseaseState.ts`
- Test: `app/tests/diseaseState.test.ts`

- [ ] **Step 1: Write the failing test**

`app/tests/diseaseState.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { stateAtTick } from "../src/sim/diseaseState";

describe("stateAtTick", () => {
  const transitions: [number, number][] = [
    [0, 0],
    [48, 1],
    [72, 2],
  ];

  it("returns the last transition at or before the tick", () => {
    expect(stateAtTick(transitions, 0)).toBe(0);
    expect(stateAtTick(transitions, 47)).toBe(0);
    expect(stateAtTick(transitions, 48)).toBe(1);
    expect(stateAtTick(transitions, 100)).toBe(2);
  });

  it("defaults to Susceptible (0) before the first transition or when empty", () => {
    expect(stateAtTick([[10, 2]], 5)).toBe(0);
    expect(stateAtTick([], 5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- diseaseState` → FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

`app/src/sim/diseaseState.ts`:
```ts
/** State code active at `tick` = the last transition at-or-before it (default 0/S). */
export function stateAtTick(transitions: [number, number][], tick: number): number {
  let lo = 0;
  let hi = transitions.length - 1;
  let result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (transitions[mid][0] <= tick) {
      result = transitions[mid][1];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- diseaseState` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/sim/diseaseState.ts app/tests/diseaseState.test.ts
git commit -m "feat: disease state lookup at a tick"
```

---

### Task 3: Position interpolation (`interpolation`)

**Files:**
- Create: `app/src/sim/interpolation.ts`
- Test: `app/tests/interpolation.test.ts`

Given an agent's waypoint slice within the shared SoA arrays, return the interpolated `[lon, lat]` at a query tick. Holds at the first waypoint before it appears and at the last waypoint after; lerps linearly between consecutive waypoints.

- [ ] **Step 1: Write the failing test**

`app/tests/interpolation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { positionAtTick } from "../src/sim/interpolation";

// Two agents share these arrays. Agent A = records [0,2), Agent B = record [2].
const tick = new Uint32Array([0, 10, 0]);
const lon = new Float32Array([-84.0, -85.0, -84.5]);
const lat = new Float32Array([33.0, 34.0, 33.5]);

describe("positionAtTick", () => {
  it("lerps linearly between two waypoints", () => {
    const p = positionAtTick(tick, lon, lat, 0, 2, 5);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo(-84.5, 5); // halfway in lon
    expect(p![1]).toBeCloseTo(33.5, 5); // halfway in lat
  });

  it("holds at the first waypoint before it and the last after it", () => {
    expect(positionAtTick(tick, lon, lat, 0, 2, -3)![0]).toBeCloseTo(-84.0, 5);
    expect(positionAtTick(tick, lon, lat, 0, 2, 99)![0]).toBeCloseTo(-85.0, 5);
  });

  it("returns the single waypoint for a one-waypoint agent", () => {
    const p = positionAtTick(tick, lon, lat, 2, 1, 7);
    expect(p![0]).toBeCloseTo(-84.5, 5);
    expect(p![1]).toBeCloseTo(33.5, 5);
  });

  it("returns null for an empty slice", () => {
    expect(positionAtTick(tick, lon, lat, 0, 0, 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- interpolation` → FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

`app/src/sim/interpolation.ts`:
```ts
/**
 * Interpolated [lon, lat] at `queryTick` for the waypoint slice [start, start+count)
 * of the shared SoA arrays. Holds at the endpoints; lerps between neighbors.
 * Returns null for an empty slice.
 */
export function positionAtTick(
  tick: Uint32Array,
  lon: Float32Array,
  lat: Float32Array,
  start: number,
  count: number,
  queryTick: number,
): [number, number] | null {
  if (count <= 0) return null;
  const end = start + count;
  if (queryTick <= tick[start]) return [lon[start], lat[start]];
  if (queryTick >= tick[end - 1]) return [lon[end - 1], lat[end - 1]];

  // Binary search for the last waypoint with tick <= queryTick.
  let lo = start;
  let hi = end - 1;
  let i = start;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tick[mid] <= queryTick) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const t0 = tick[i];
  const t1 = tick[i + 1];
  const span = t1 - t0;
  const alpha = span === 0 ? 0 : (queryTick - t0) / span;
  return [
    lon[i] + (lon[i + 1] - lon[i]) * alpha,
    lat[i] + (lat[i + 1] - lat[i]) * alpha,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- interpolation` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/sim/interpolation.ts app/tests/interpolation.test.ts
git commit -m "feat: interpolate agent position at a tick"
```

---

### Task 4: Time mapping (`timeMapping`)

**Files:**
- Create: `app/src/sim/timeMapping.ts`
- Test: `app/tests/timeMapping.test.ts`

- [ ] **Step 1: Write the failing test**

`app/tests/timeMapping.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- timeMapping` → FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

`app/src/sim/timeMapping.ts`:
```ts
/** Wall-clock Date for a tick. */
export function tickToDate(
  startTime: string,
  tickIntervalSec: number,
  tick: number,
): Date {
  return new Date(new Date(startTime).getTime() + tick * tickIntervalSec * 1000);
}

/** Index into an hourly aggregate series for a given tick. */
export function hourBinIndex(
  tick: number,
  tickIntervalSec: number,
  cadenceSec: number,
): number {
  const ticksPerBin = cadenceSec / tickIntervalSec;
  return Math.floor(tick / ticksPerBin);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- timeMapping` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/sim/timeMapping.ts app/tests/timeMapping.test.ts
git commit -m "feat: tick-to-date and hourly-bin mapping"
```

---

### Task 5: Playback clock (`playbackClock`)

**Files:**
- Create: `app/src/sim/playbackClock.ts`
- Test: `app/tests/playbackClock.test.ts`

Pure clock math: advance a fractional tick by a wall-clock delta and a speed (sim-ticks per real second), clamped to a range.

- [ ] **Step 1: Write the failing test**

`app/tests/playbackClock.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { advanceTick } from "../src/sim/playbackClock";

describe("advanceTick", () => {
  const range = { min: 0, max: 100 };

  it("advances by dtMs * ticksPerSecond", () => {
    // 1000ms at 12 ticks/sec -> +12
    expect(advanceTick(10, 1000, 12, range)).toBeCloseTo(22, 5);
  });

  it("clamps at the upper bound", () => {
    expect(advanceTick(98, 1000, 12, range)).toBe(100);
  });

  it("clamps at the lower bound for negative speed", () => {
    expect(advanceTick(2, 1000, -12, range)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playbackClock` → FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

`app/src/sim/playbackClock.ts`:
```ts
export interface TickRange {
  min: number;
  max: number;
}

/** New (fractional) tick after `dtMs` at `ticksPerSecond`, clamped to range. */
export function advanceTick(
  currentTick: number,
  dtMs: number,
  ticksPerSecond: number,
  range: TickRange,
): number {
  const next = currentTick + (dtMs / 1000) * ticksPerSecond;
  return Math.min(range.max, Math.max(range.min, next));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- playbackClock` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/sim/playbackClock.ts app/tests/playbackClock.test.ts
git commit -m "feat: playback clock advance/clamp math"
```

---

### Task 6: Bundle loader (`loadBundle`)

**Files:**
- Create: `app/src/data/loadBundle.ts`
- Test: `app/tests/loadBundle.test.ts`

Fetches every artifact named in the manifest, decodes the binaries, and builds in-memory lookup maps (agentId → waypoint slice, agentId → transitions). Tested against a stubbed `fetch`.

- [ ] **Step 1: Write the failing test**

`app/tests/loadBundle.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { loadBundle } from "../src/data/loadBundle";

function agentBuffer(records: [number, number, number, number][]): ArrayBuffer {
  const buf = new ArrayBuffer(records.length * 13);
  const dv = new DataView(buf);
  records.forEach(([t, lon, lat, vt], i) => {
    const o = i * 13;
    dv.setUint32(o, t, true);
    dv.setFloat32(o + 4, lon, true);
    dv.setFloat32(o + 8, lat, true);
    dv.setUint8(o + 12, vt);
  });
  return buf;
}

const manifest = {
  schemaVersion: 1, runId: "test", tickIntervalSec: 300,
  startTime: "2024-01-01T00:05:00", endTime: "2024-01-01T01:05:00",
  numTicks: 13, numAgents: 2, bbox: [-85, 33, -84, 34],
  outbreakWindow: { startTick: 0, endTick: 12 },
  venueTypes: ["Apartment", "Workplace", "Restaurant", "Pub"],
  artifacts: {
    agents: "agents.bin", agentsIndex: "agents_index.json", disease: "disease.json",
    poops: "poops.bin", aggregates: "aggregates.json", wastewater: "wastewater.json",
  },
};

const files: Record<string, unknown> = {
  "manifest.json": manifest,
  "agents_index.json": [
    { agentId: 0, offset: 0, count: 1 },
    { agentId: 1, offset: 1, count: 1 },
  ],
  "agents.bin": agentBuffer([[0, -84.4, 33.7, 0], [0, -84.3, 33.8, 1]]),
  "disease.json": {
    stateCodes: { S: 0, E: 1, I: 2, R: 3 },
    agents: [{ agentId: 1, transitions: [[0, 2]], pathogenSamples: [] }],
    transmissions: [],
  },
  "poops.bin": new ArrayBuffer(0),
  "aggregates.json": {
    cadenceSec: 3600, startTime: manifest.startTime, gridTicks: [0, 12],
    seir: { S: [2, 2], E: [0, 0], I: [0, 0], R: [0, 0] }, pathogenInflow: [0, 0],
  },
  "wastewater.json": { kind: "grid", cadenceSec: 3600, regions: [], series: {} },
};

function stubFetch(base: string) {
  return vi.fn(async (url: string) => {
    const name = url.replace(base + "/", "");
    const payload = files[name];
    return {
      ok: true,
      json: async () => payload,
      arrayBuffer: async () => payload as ArrayBuffer,
    } as Response;
  });
}

describe("loadBundle", () => {
  it("loads, decodes, and indexes the bundle", async () => {
    const base = "/data/dataset_00";
    const bundle = await loadBundle(base, stubFetch(base) as unknown as typeof fetch);

    expect(bundle.manifest.numAgents).toBe(2);
    expect(bundle.agents.count).toBe(2);

    const slice = bundle.agentSlice.get(1)!;
    expect(slice).toEqual({ offset: 1, count: 1 });

    // Agent 1 has a transition to Infectious; agent 0 defaults to none.
    expect(bundle.transitionsByAgent.get(1)).toEqual([[0, 2]]);
    expect(bundle.transitionsByAgent.has(0)).toBe(false);

    expect(bundle.aggregates.seir.S[0]).toBe(2);
    expect(bundle.wastewater.kind).toBe("grid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loadBundle` → FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

`app/src/data/loadBundle.ts`:
```ts
import type {
  Aggregates, AgentIndexEntry, AgentWaypoints, Disease, Manifest,
  PoopEvents, Wastewater,
} from "../types";
import { decodeAgentWaypoints, decodePoopEvents } from "./decodeBinary";

export interface Bundle {
  base: string;
  manifest: Manifest;
  agents: AgentWaypoints;
  agentSlice: Map<number, { offset: number; count: number }>;
  poops: PoopEvents;
  disease: Disease;
  transitionsByAgent: Map<number, [number, number][]>;
  aggregates: Aggregates;
  wastewater: Wastewater;
}

export async function loadBundle(
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<Bundle> {
  const manifest = (await getJson(fetchFn, `${base}/manifest.json`)) as Manifest;
  const a = manifest.artifacts;

  const [index, agentsBuf, disease, poopsBuf, aggregates, wastewater] =
    await Promise.all([
      getJson(fetchFn, `${base}/${a.agentsIndex}`) as Promise<AgentIndexEntry[]>,
      getBuffer(fetchFn, `${base}/${a.agents}`),
      getJson(fetchFn, `${base}/${a.disease}`) as Promise<Disease>,
      getBuffer(fetchFn, `${base}/${a.poops}`),
      getJson(fetchFn, `${base}/${a.aggregates}`) as Promise<Aggregates>,
      getJson(fetchFn, `${base}/${a.wastewater}`) as Promise<Wastewater>,
    ]);

  const agentSlice = new Map<number, { offset: number; count: number }>();
  for (const e of index) agentSlice.set(e.agentId, { offset: e.offset, count: e.count });

  const transitionsByAgent = new Map<number, [number, number][]>();
  for (const ag of disease.agents) transitionsByAgent.set(ag.agentId, ag.transitions);

  return {
    base,
    manifest,
    agents: decodeAgentWaypoints(agentsBuf),
    agentSlice,
    poops: decodePoopEvents(poopsBuf),
    disease,
    transitionsByAgent,
    aggregates,
    wastewater,
  };
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

async function getBuffer(fetchFn: typeof fetch, url: string): Promise<ArrayBuffer> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.arrayBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loadBundle` → 1 passed.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` → all pure-logic tests pass (smoke + Tasks 1–6).
```bash
git add app/src/data/loadBundle.ts app/tests/loadBundle.test.ts
git commit -m "feat: load and index the data bundle"
```

---

### Task 7: Theme and map style (`theme`, `mapStyle`)

**Files:**
- Create: `app/src/render/theme.ts`
- Create: `app/src/render/mapStyle.ts`
- Test: `app/tests/theme.test.ts`

Centralizes the game-skin palette (disease-state colors as RGBA arrays for deck.gl, venue colors, day/night tint) and a MapLibre style object. A free, no-API-key raster basemap (CARTO light) is restyled toward the muted skin; the deck.gl overlays carry the color.

- [ ] **Step 1: Write the failing test**

`app/tests/theme.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { STATE_COLORS, VENUE_COLORS, dayNightTint } from "../src/render/theme";

describe("theme", () => {
  it("has an RGBA color for every disease state code 0..3", () => {
    for (const code of [0, 1, 2, 3]) {
      expect(STATE_COLORS[code]).toHaveLength(4);
      STATE_COLORS[code].forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
    }
  });

  it("has a color for every venue type id 0..3", () => {
    for (const code of [0, 1, 2, 3]) {
      expect(VENUE_COLORS[code]).toHaveLength(4);
    }
  });

  it("dayNightTint returns a darker factor near midnight than noon", () => {
    const noon = dayNightTint(12);
    const midnight = dayNightTint(0);
    expect(midnight).toBeLessThan(noon);
    expect(noon).toBeLessThanOrEqual(1);
    expect(midnight).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- theme` → FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

`app/src/render/theme.ts`:
```ts
export type RGBA = [number, number, number, number];

// Disease state colors (indexed by code): S=teal, E=amber, I=warm red, R=muted green.
export const STATE_COLORS: Record<number, RGBA> = {
  0: [56, 178, 172, 200],
  1: [237, 187, 79, 230],
  2: [229, 80, 57, 240],
  3: [120, 160, 120, 180],
};

// Venue colors (indexed by venue type id): Apartment, Workplace, Restaurant, Pub.
export const VENUE_COLORS: Record<number, RGBA> = {
  0: [110, 130, 170, 255],
  1: [150, 140, 120, 255],
  2: [200, 140, 90, 255],
  3: [150, 110, 170, 255],
};

/** Brightness multiplier in [0.35, 1] following a daily cycle; hour in [0,24). */
export function dayNightTint(hour: number): number {
  const t = Math.cos(((hour - 13) / 24) * 2 * Math.PI); // peak ~1pm
  return 0.675 + 0.325 * t;
}
```

`app/src/render/mapStyle.ts`:
```ts
import type { StyleSpecification } from "maplibre-gl";

/** Muted "game skin" basemap using CARTO's free raster tiles (no API key). */
export const GAME_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap, © CARTO",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e9e4d8" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.7, "raster-saturation": -0.4 } },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- theme` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/render/theme.ts app/src/render/mapStyle.ts app/tests/theme.test.ts
git commit -m "feat: add game-skin palette and map style"
```

---

> **Tasks 8–13 are rendering/UI integration verified in the browser.** For each, after implementing, run `npm run dev`, open `http://localhost:5173`, and confirm the described behavior; capture a screenshot for the review. There are no unit tests for visual output (per spec §9, rendering is manually verified), but `npm test` must continue to pass (no regressions) and `npm run build` must typecheck cleanly.

### Task 8: Map view with deck.gl overlay and animated agents

**Files:**
- Create: `app/src/render/DeckOverlay.tsx`
- Create: `app/src/render/layers.ts`
- Create: `app/src/ui/MapView.tsx`
- Create: `app/src/hooks/useBundle.ts`
- Modify: `app/src/App.tsx`

This task gets agents on the map at a fixed tick (playback comes in Task 9). It proves the bundle loads, the map renders with the game skin, and 1,000 agents draw at interpolated positions colored by disease state.

- [ ] **Step 1: Bundle-loading hook**

`app/src/hooks/useBundle.ts`:
```tsx
import { useEffect, useState } from "react";
import { loadBundle, type Bundle } from "../data/loadBundle";

type State =
  | { status: "loading" }
  | { status: "ready"; bundle: Bundle }
  | { status: "error"; message: string };

export function useBundle(base: string): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    loadBundle(base)
      .then((bundle) => alive && setState({ status: "ready", bundle }))
      .catch((e) => alive && setState({ status: "error", message: String(e) }));
    return () => {
      alive = false;
    };
  }, [base]);
  return state;
}
```

- [ ] **Step 2: deck.gl layer factory (agent layer)**

`app/src/render/layers.ts`:
```ts
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Bundle } from "../data/loadBundle";
import { positionAtTick } from "../sim/interpolation";
import { stateAtTick } from "../sim/diseaseState";
import { STATE_COLORS, type RGBA } from "./theme";

export interface AgentDatum {
  position: [number, number];
  color: RGBA;
}

/** Compute every agent's position + color at `tick`. */
export function agentData(bundle: Bundle, tick: number): AgentDatum[] {
  const out: AgentDatum[] = [];
  const { agents, agentSlice, transitionsByAgent } = bundle;
  for (const [agentId, slice] of agentSlice) {
    const pos = positionAtTick(
      agents.tick, agents.lon, agents.lat, slice.offset, slice.count, tick,
    );
    if (!pos) continue;
    const code = stateAtTick(transitionsByAgent.get(agentId) ?? [], tick);
    out.push({ position: pos, color: STATE_COLORS[code] });
  }
  return out;
}

export function makeAgentLayer(data: AgentDatum[]) {
  return new ScatterplotLayer<AgentDatum>({
    id: "agents",
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: 40,
    radiusMinPixels: 2,
    radiusMaxPixels: 8,
    pickable: false,
    updateTriggers: { getFillColor: data },
  });
}
```

- [ ] **Step 3: deck.gl-over-maplibre overlay component**

`app/src/render/DeckOverlay.tsx`:
```tsx
import { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";

/** Interleaved deck.gl overlay controlled by react-map-gl. */
export function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}
```

- [ ] **Step 4: Map view**

`app/src/ui/MapView.tsx`:
```tsx
import { useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bundle } from "../data/loadBundle";
import { GAME_MAP_STYLE } from "../render/mapStyle";
import { DeckOverlay } from "../render/DeckOverlay";
import { agentData, makeAgentLayer } from "../render/layers";

export function MapView({ bundle, tick }: { bundle: Bundle; tick: number }) {
  const [minLon, minLat, maxLon, maxLat] = bundle.manifest.bbox;
  const layers = useMemo(() => [makeAgentLayer(agentData(bundle, tick))], [bundle, tick]);

  return (
    <Map
      initialViewState={{
        longitude: (minLon + maxLon) / 2,
        latitude: (minLat + maxLat) / 2,
        zoom: 9,
      }}
      mapStyle={GAME_MAP_STYLE}
      style={{ position: "absolute", inset: 0 }}
    >
      <DeckOverlay layers={layers} interleaved />
    </Map>
  );
}
```

- [ ] **Step 5: Wire into App at a fixed tick**

`app/src/App.tsx`:
```tsx
import { useBundle } from "./hooks/useBundle";
import { MapView } from "./ui/MapView";

const BUNDLE_BASE = "/data/dataset_00";

export default function App() {
  const state = useBundle(BUNDLE_BASE);
  if (state.status === "loading") return <div className="app-shell">Loading…</div>;
  if (state.status === "error")
    return <div className="app-shell">Error: {state.message}</div>;
  // Fixed mid-outbreak tick until playback lands in Task 9.
  const tick = Math.floor(state.bundle.manifest.outbreakWindow.endTick / 4);
  return (
    <div className="app-shell">
      <MapView bundle={state.bundle} tick={tick} />
    </div>
  );
}
```

- [ ] **Step 6: Verify in the browser**

Run `npm run dev`. Confirm: the map centers on Atlanta with the muted skin; ~1,000 colored dots appear spread across the metro; a mix of teal (S) and red (I) is visible at this mid-outbreak tick. Run `npm run build` to confirm it typechecks. Capture a screenshot.

- [ ] **Step 7: Commit**

```bash
git add app/src/hooks/useBundle.ts app/src/render/layers.ts app/src/render/DeckOverlay.tsx app/src/ui/MapView.tsx app/src/App.tsx
git commit -m "feat: render animated agents on the game-skin map"
```

---

### Task 9: Playback (RAF loop + timeline scrubber)

**Files:**
- Create: `app/src/hooks/usePlayback.ts`
- Create: `app/src/ui/Timeline.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Playback hook (RAF loop driving currentTick)**

`app/src/hooks/usePlayback.ts`:
```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { advanceTick, type TickRange } from "../sim/playbackClock";

export function usePlayback(range: TickRange, initialTick: number) {
  const [tick, setTick] = useState(initialTick);
  const [playing, setPlaying] = useState(false);
  const [ticksPerSecond, setTicksPerSecond] = useState(48); // ~4 sim-hours / real sec
  const last = useRef<number | null>(null);
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const step = (now: number) => {
      if (last.current != null) {
        const next = advanceTick(tickRef.current, now - last.current, ticksPerSecond, range);
        setTick(next);
        if (next >= range.max) setPlaying(false);
      }
      last.current = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, ticksPerSecond, range]);

  const seek = useCallback((t: number) => setTick(Math.min(range.max, Math.max(range.min, t))), [range]);
  return { tick, playing, setPlaying, ticksPerSecond, setTicksPerSecond, seek };
}
```

- [ ] **Step 2: Timeline scrubber with outbreak band**

`app/src/ui/Timeline.tsx`:
```tsx
import type { Manifest } from "../types";

export function Timeline({
  manifest, tick, onSeek,
}: { manifest: Manifest; tick: number; onSeek: (t: number) => void }) {
  const max = manifest.numTicks - 1;
  const ow = manifest.outbreakWindow;
  const pct = (t: number) => `${(t / max) * 100}%`;
  return (
    <div className="timeline">
      <div className="timeline-track">
        <div
          className="timeline-outbreak"
          style={{ left: pct(ow.startTick), width: pct(ow.endTick - ow.startTick) }}
        />
        <input
          type="range"
          min={0}
          max={max}
          value={Math.round(tick)}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
```

Add to `app/src/App.css`:
```css
.timeline { position: absolute; left: 16px; right: 16px; bottom: 16px; }
.timeline-track { position: relative; }
.timeline-outbreak {
  position: absolute; top: 50%; height: 6px; transform: translateY(-50%);
  background: rgba(229, 80, 57, 0.35); border-radius: 3px; pointer-events: none;
}
.timeline input[type="range"] { width: 100%; }
```

- [ ] **Step 3: Wire playback into App**

`app/src/App.tsx` (replace the fixed-tick body):
```tsx
import { useBundle } from "./hooks/useBundle";
import { usePlayback } from "./hooks/usePlayback";
import { MapView } from "./ui/MapView";
import { Timeline } from "./ui/Timeline";

const BUNDLE_BASE = "/data/dataset_00";

export default function App() {
  const state = useBundle(BUNDLE_BASE);
  if (state.status === "loading") return <div className="app-shell">Loading…</div>;
  if (state.status === "error")
    return <div className="app-shell">Error: {state.message}</div>;
  return <Playback base={state} />;
}

function Playback({ base }: { base: { status: "ready"; bundle: import("./data/loadBundle").Bundle } }) {
  const { bundle } = base;
  const range = { min: 0, max: bundle.manifest.numTicks - 1 };
  const { tick, playing, setPlaying, seek } = usePlayback(range, bundle.manifest.outbreakWindow.startTick);
  return (
    <div className="app-shell">
      <MapView bundle={bundle} tick={tick} />
      <button className="play-btn" onClick={() => setPlaying(!playing)}>
        {playing ? "Pause" : "Play"}
      </button>
      <Timeline manifest={bundle.manifest} tick={tick} onSeek={seek} />
    </div>
  );
}
```

Add to `app/src/App.css`:
```css
.play-btn { position: absolute; left: 16px; top: 16px; z-index: 2;
  padding: 8px 16px; border-radius: 999px; border: none; cursor: pointer;
  background: #e55039; color: white; font-weight: 600; }
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`. Confirm: pressing Play animates agents moving between venues and disease colors changing over time; the scrubber drags to any point and the scene updates; the outbreak band is visible on the timeline. `npm run build` typechecks.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/usePlayback.ts app/src/ui/Timeline.tsx app/src/App.tsx app/src/App.css
git commit -m "feat: add playback loop and timeline scrubber"
```

---

### Task 10: HUD — clock, SEIR counters, charts, speed control

**Files:**
- Create: `app/src/ui/Hud.tsx`
- Create: `app/src/ui/SeirChart.tsx`
- Create: `app/src/ui/WastewaterChart.tsx`
- Modify: `app/src/App.tsx`, `app/src/App.css`

- [ ] **Step 1: SEIR chart (uPlot) synced to playback**

`app/src/ui/SeirChart.tsx`:
```tsx
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Aggregates } from "../types";

export function SeirChart({ agg, hourBin }: { agg: Aggregates; hourBin: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const x = agg.gridTicks.map((_, i) => i);
    const data: uPlot.AlignedData = [x, agg.seir.S, agg.seir.E, agg.seir.I, agg.seir.R];
    const opts: uPlot.Options = {
      width: 320, height: 120, title: "SEIR",
      scales: { x: { time: false } },
      series: [
        {},
        { label: "S", stroke: "#38b2ac", fill: "rgba(56,178,172,0.2)" },
        { label: "E", stroke: "#edbb4f" },
        { label: "I", stroke: "#e55039", fill: "rgba(229,80,57,0.25)" },
        { label: "R", stroke: "#78a078" },
      ],
    };
    plot.current = new uPlot(opts, data, ref.current);
    return () => plot.current?.destroy();
  }, [agg]);

  useEffect(() => {
    plot.current?.setCursor({ left: plot.current.valToPos(hourBin, "x"), top: 0 });
  }, [hourBin]);

  return <div ref={ref} />;
}
```

- [ ] **Step 2: Wastewater inflow chart (uPlot)**

`app/src/ui/WastewaterChart.tsx`:
```tsx
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import type { Aggregates } from "../types";

export function WastewaterChart({ agg, hourBin }: { agg: Aggregates; hourBin: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const x = agg.pathogenInflow.map((_, i) => i);
    const data: uPlot.AlignedData = [x, agg.pathogenInflow];
    const opts: uPlot.Options = {
      width: 320, height: 100, title: "Wastewater pathogen / hr",
      scales: { x: { time: false } },
      series: [{}, { label: "load", stroke: "#7a6baa", fill: "rgba(122,107,170,0.3)" }],
    };
    plot.current = new uPlot(opts, data, ref.current);
    return () => plot.current?.destroy();
  }, [agg]);

  useEffect(() => {
    plot.current?.setCursor({ left: plot.current.valToPos(hourBin, "x"), top: 0 });
  }, [hourBin]);

  return <div ref={ref} />;
}
```

- [ ] **Step 3: HUD container (clock + counters + speed)**

`app/src/ui/Hud.tsx`:
```tsx
import type { Aggregates, Manifest } from "../types";
import { tickToDate, hourBinIndex } from "../sim/timeMapping";
import { SeirChart } from "./SeirChart";
import { WastewaterChart } from "./WastewaterChart";

export function Hud({
  manifest, agg, tick, ticksPerSecond, onSpeed,
}: {
  manifest: Manifest; agg: Aggregates; tick: number;
  ticksPerSecond: number; onSpeed: (v: number) => void;
}) {
  const date = tickToDate(manifest.startTime, manifest.tickIntervalSec, tick);
  const bin = Math.min(
    agg.seir.S.length - 1,
    hourBinIndex(Math.round(tick), manifest.tickIntervalSec, agg.cadenceSec),
  );
  const counts = {
    S: agg.seir.S[bin], E: agg.seir.E[bin], I: agg.seir.I[bin], R: agg.seir.R[bin],
  };
  return (
    <div className="hud">
      <div className="hud-clock">{date.toLocaleString()}</div>
      <div className="hud-counts">
        <span className="c-s">S {counts.S}</span>
        <span className="c-e">E {counts.E}</span>
        <span className="c-i">I {counts.I}</span>
        <span className="c-r">R {counts.R}</span>
      </div>
      <SeirChart agg={agg} hourBin={bin} />
      <WastewaterChart agg={agg} hourBin={bin} />
      <label className="hud-speed">
        Speed
        <input
          type="range" min={6} max={288} step={6}
          value={ticksPerSecond} onChange={(e) => onSpeed(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Mount the HUD and pass speed control through**

In `app/src/App.tsx`, destructure `ticksPerSecond, setTicksPerSecond` from `usePlayback`, and render inside the shell:
```tsx
<Hud
  manifest={bundle.manifest}
  agg={bundle.aggregates}
  tick={tick}
  ticksPerSecond={ticksPerSecond}
  onSpeed={setTicksPerSecond}
/>
```
(Add the `import { Hud } from "./ui/Hud";` and include `ticksPerSecond`, `setTicksPerSecond` in the `usePlayback` destructure.)

Add to `app/src/App.css`:
```css
.hud { position: absolute; right: 16px; top: 16px; z-index: 2;
  display: flex; flex-direction: column; gap: 8px; padding: 12px;
  background: rgba(20,20,26,0.72); border-radius: 14px; color: #eee;
  backdrop-filter: blur(6px); }
.hud-clock { font: 600 14px ui-monospace, monospace; }
.hud-counts { display: flex; gap: 10px; font: 600 13px system-ui; }
.c-s { color: #38b2ac; } .c-e { color: #edbb4f; }
.c-i { color: #e55039; } .c-r { color: #78a078; }
```

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`. Confirm: clock advances during playback; S/E/I/R counters update; both charts render and their cursors track the current time; the speed slider changes playback rate. `npm run build` typechecks.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/Hud.tsx app/src/ui/SeirChart.tsx app/src/ui/WastewaterChart.tsx app/src/App.tsx app/src/App.css
git commit -m "feat: add HUD with clock, SEIR counters, and charts"
```

---

### Task 11: Venue layer and poop splash layer

**Files:**
- Modify: `app/src/render/layers.ts`
- Modify: `app/src/ui/MapView.tsx`

- [ ] **Step 1: Venue layer from agent waypoints**

A venue is a distinct (lon, lat, vtype) location agents check into. Add to `app/src/render/layers.ts`:
```ts
import { ScatterplotLayer } from "@deck.gl/layers"; // already imported above
import { VENUE_COLORS } from "./theme";

export interface VenueDatum { position: [number, number]; color: RGBA; }

/** Unique venue positions (deduped by rounded lon/lat) colored by type. */
export function venueData(bundle: Bundle): VenueDatum[] {
  const seen = new Map<string, VenueDatum>();
  const { agents } = bundle;
  for (let i = 0; i < agents.count; i++) {
    const key = `${agents.lon[i].toFixed(4)},${agents.lat[i].toFixed(4)}`;
    if (!seen.has(key)) {
      seen.set(key, {
        position: [agents.lon[i], agents.lat[i]],
        color: VENUE_COLORS[agents.vtype[i]],
      });
    }
  }
  return [...seen.values()];
}

export function makeVenueLayer(data: VenueDatum[]) {
  return new ScatterplotLayer<VenueDatum>({
    id: "venues",
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: 25,
    radiusMinPixels: 1.5,
    radiusMaxPixels: 5,
    opacity: 0.5,
  });
}
```

- [ ] **Step 2: Poop splash layer (events within a fade window of the tick)**

Add to `app/src/render/layers.ts`:
```ts
export interface PoopDatum { position: [number, number]; age: number; infected: number; }

const SPLASH_WINDOW_TICKS = 24; // ~2 hours of fade

/** Poop events whose tick is within the fade window ending at `tick`. */
export function poopData(bundle: Bundle, tick: number): PoopDatum[] {
  const { poops } = bundle;
  const out: PoopDatum[] = [];
  // poops.tick is ascending; linear scan is fine for the bounded window via bisect.
  let lo = 0, hi = poops.count - 1, startIdx = poops.count;
  const lowTick = tick - SPLASH_WINDOW_TICKS;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (poops.tick[mid] >= lowTick) { startIdx = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  for (let i = startIdx; i < poops.count && poops.tick[i] <= tick; i++) {
    out.push({
      position: [poops.lon[i], poops.lat[i]],
      age: (tick - poops.tick[i]) / SPLASH_WINDOW_TICKS,
      infected: poops.infected[i],
    });
  }
  return out;
}

export function makePoopLayer(data: PoopDatum[]) {
  return new ScatterplotLayer<PoopDatum>({
    id: "poops",
    data,
    getPosition: (d) => d.position,
    getRadius: (d) => 60 + d.age * 120,
    radiusMinPixels: 2,
    radiusMaxPixels: 14,
    getFillColor: (d) =>
      d.infected
        ? [120, 200, 90, Math.round(200 * (1 - d.age))]
        : [150, 110, 70, Math.round(140 * (1 - d.age))],
    stroked: false,
    updateTriggers: { getFillColor: data, getRadius: data },
  });
}
```

- [ ] **Step 3: Compose the layers in MapView**

In `app/src/ui/MapView.tsx`, replace the single-layer `useMemo` with venue (bottom), poop, agent (top):
```tsx
import {
  agentData, makeAgentLayer, venueData, makeVenueLayer, poopData, makePoopLayer,
} from "../render/layers";

const venues = useMemo(() => makeVenueLayer(venueData(bundle)), [bundle]);
const layers = useMemo(
  () => [venues, makePoopLayer(poopData(bundle, tick)), makeAgentLayer(agentData(bundle, tick))],
  [venues, bundle, tick],
);
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`. Confirm: faint venue markers underlie the scene; during playback, poop splashes pop and fade at venues — green-ish for infected, brown for clean; splashes scale up as they age then vanish. `npm run build` typechecks.

- [ ] **Step 5: Commit**

```bash
git add app/src/render/layers.ts app/src/ui/MapView.tsx
git commit -m "feat: add venue markers and poop splash layer"
```

---

### Task 12: Wastewater layer + infection arcs + layer toggles

**Files:**
- Modify: `app/src/render/layers.ts`
- Create: `app/src/ui/LayerToggles.tsx`
- Modify: `app/src/ui/MapView.tsx`, `app/src/App.tsx`, `app/src/App.css`

- [ ] **Step 1: Wastewater polygon layer (heat by current hour)**

Add to `app/src/render/layers.ts`:
```ts
import { PolygonLayer } from "@deck.gl/layers";
import { hourBinIndex } from "../sim/timeMapping";

export interface WwDatum { polygon: [number, number][]; value: number; }

export function wastewaterData(bundle: Bundle, tick: number): WwDatum[] {
  const ww = bundle.wastewater;
  const bin = hourBinIndex(Math.round(tick), bundle.manifest.tickIntervalSec, ww.cadenceSec);
  return ww.regions.map((r) => ({
    polygon: r.polygon,
    value: ww.series[r.id]?.[Math.min(bin, (ww.series[r.id]?.length ?? 1) - 1)] ?? 0,
  }));
}

export function makeWastewaterLayer(data: WwDatum[]) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 1);
  return new PolygonLayer<WwDatum>({
    id: "wastewater",
    data,
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => {
      const t = Math.log10(d.value + 1) / Math.log10(max + 1);
      return [60 + t * 160, 200 - t * 120, 90, Math.round(20 + t * 140)];
    },
    stroked: false,
    extruded: false,
    updateTriggers: { getFillColor: data },
  });
}
```

- [ ] **Step 2: Infection arc layer (recent transmissions)**

Add to `app/src/render/layers.ts`:
```ts
import { ArcLayer } from "@deck.gl/layers";

export interface ArcDatum { source: [number, number]; target: [number, number]; age: number; }

const ARC_WINDOW_TICKS = 288; // ~1 day

/** Recent transmissions; endpoints are source/target positions at `tick`. */
export function arcData(bundle: Bundle, tick: number): ArcDatum[] {
  const out: ArcDatum[] = [];
  for (const [t, src, tgt] of bundle.disease.transmissions) {
    if (t > tick || t < tick - ARC_WINDOW_TICKS) continue;
    const s = bundle.agentSlice.get(src);
    const g = bundle.agentSlice.get(tgt);
    if (!s || !g) continue;
    const sp = positionAtTick(bundle.agents.tick, bundle.agents.lon, bundle.agents.lat, s.offset, s.count, tick);
    const gp = positionAtTick(bundle.agents.tick, bundle.agents.lon, bundle.agents.lat, g.offset, g.count, tick);
    if (sp && gp) out.push({ source: sp, target: gp, age: (tick - t) / ARC_WINDOW_TICKS });
  }
  return out;
}

export function makeArcLayer(data: ArcDatum[]) {
  return new ArcLayer<ArcDatum>({
    id: "arcs",
    data,
    getSourcePosition: (d) => d.source,
    getTargetPosition: (d) => d.target,
    getSourceColor: (d) => [229, 80, 57, Math.round(220 * (1 - d.age))],
    getTargetColor: (d) => [237, 187, 79, Math.round(220 * (1 - d.age))],
    getWidth: 2,
    updateTriggers: { getSourceColor: data, getTargetColor: data },
  });
}
```

- [ ] **Step 3: Layer toggles UI**

`app/src/ui/LayerToggles.tsx`:
```tsx
export interface LayerFlags {
  venues: boolean; poops: boolean; agents: boolean; wastewater: boolean; arcs: boolean;
}

export function LayerToggles({
  flags, onChange,
}: { flags: LayerFlags; onChange: (f: LayerFlags) => void }) {
  const items: (keyof LayerFlags)[] = ["agents", "poops", "venues", "wastewater", "arcs"];
  return (
    <div className="layer-toggles">
      {items.map((k) => (
        <label key={k}>
          <input
            type="checkbox"
            checked={flags[k]}
            onChange={(e) => onChange({ ...flags, [k]: e.target.checked })}
          />
          {k}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Thread flags into MapView**

Change `MapView` to accept `flags: LayerFlags` and build the layer list conditionally (bottom→top: wastewater, venues, poops, arcs, agents):
```tsx
const layers = useMemo(() => {
  const ls = [];
  if (flags.wastewater) ls.push(makeWastewaterLayer(wastewaterData(bundle, tick)));
  if (flags.venues) ls.push(makeVenueLayer(venueData(bundle)));
  if (flags.poops) ls.push(makePoopLayer(poopData(bundle, tick)));
  if (flags.arcs) ls.push(makeArcLayer(arcData(bundle, tick)));
  if (flags.agents) ls.push(makeAgentLayer(agentData(bundle, tick)));
  return ls;
}, [bundle, tick, flags]);
```
In `App.tsx`, hold `flags` state (default agents/poops/venues on, wastewater/arcs off) and render `<LayerToggles>`; pass `flags` to `MapView`. Add `.layer-toggles` styling (a small panel under the HUD).

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`. Confirm: toggling wastewater shows the heat grid intensifying during the outbreak; toggling arcs shows brief red→amber transmission arcs near infection events; all toggles add/remove their layer without errors. `npm run build` typechecks.

- [ ] **Step 6: Commit**

```bash
git add app/src/render/layers.ts app/src/ui/LayerToggles.tsx app/src/ui/MapView.tsx app/src/App.tsx app/src/App.css
git commit -m "feat: add wastewater heat layer, infection arcs, and layer toggles"
```

---

### Task 13: Day/night tint, character agents, and polish

**Files:**
- Modify: `app/src/render/layers.ts`, `app/src/render/theme.ts`, `app/src/ui/MapView.tsx`, `app/src/App.css`

- [ ] **Step 1: Apply day/night tint to agent colors**

In `agentData` (`layers.ts`), accept the current hour and multiply each agent color's RGB by `dayNightTint(hour)`:
```ts
import { dayNightTint } from "./theme";
// signature: agentData(bundle, tick, hour)
const tint = dayNightTint(hour);
// when pushing: color: scaleRgb(STATE_COLORS[code], tint)
```
Add a helper in `theme.ts`:
```ts
export function scaleRgb(c: RGBA, k: number): RGBA {
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), c[3]];
}
```
Compute `hour` in `MapView` from `tickToDate(...).getHours()` and pass it through. Also tint the map: set the MapLibre `raster-brightness-max`/container background overlay opacity from the same factor (a simple CSS overlay div with `background: rgba(10,12,30, X)` where `X = (1 - tint) * 0.5` is acceptable).

- [ ] **Step 2: Swap agent dots for character sprites with LOD fallback**

Create a small sprite sheet `app/public/sprites/agents.png` (4 tinophased simple character icons is overkill — use one white silhouette that gets `getColor`-tinted). Replace `makeAgentLayer`'s `ScatterplotLayer` with an `IconLayer` when zoom ≥ 11, falling back to the `ScatterplotLayer` below that (pass the current `zoom` from the map `viewState` into MapView). Keep the `ScatterplotLayer` path exactly as-is for the LOD fallback. Use:
```ts
import { IconLayer } from "@deck.gl/layers";
// IconLayer with iconAtlas "/sprites/agents.png", a single "person" icon,
// getColor: (d) => d.color, getSize: 18, sizeMinPixels: 10.
```
If producing a sprite sheet is impractical in this environment, keep the polished `ScatterplotLayer` characters-as-dots and note it — do not block the task on art assets.

- [ ] **Step 3: Polish pass**

- Round HUD/timeline panels, soft shadows, consistent palette (already largely in CSS).
- Default the initial view to fit the bbox (compute a zoom that frames `bbox`).
- Ensure Play resets to `outbreakWindow.startTick` if at the end.
- Confirm no console errors during a full play-through of the outbreak window.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`. Play from the outbreak start: confirm the city subtly darkens at night and brightens by day; agents read as characters when zoomed in and as dots when zoomed out (or polished dots if sprites were skipped); the whole scene is cohesive and readable. `npm run build` typechecks. `npm test` still green. Capture a final screenshot.

- [ ] **Step 5: Commit**

```bash
git add app/src/render app/src/ui app/src/App.css app/public/sprites 2>/dev/null
git commit -m "feat: add day/night tint, character agents, and polish"
```

---

## Self-Review

**Spec coverage** (spec §3–§8 ↔ tasks):
- Real map + game skin → Tasks 7, 8 ✓. deck.gl agent/venue/poop/wastewater/arc layers → Tasks 8, 11, 12 ✓. PlaybackController (RAF, speed, native/coarse via fractional tick) → Tasks 5, 9 ✓. Timeline with outbreak band + seek → Task 9 ✓. HUD: clock/calendar, S/E/I/R counters, SEIR chart, wastewater chart, layer toggles, speed → Tasks 10, 12 ✓. DataLoader (fetch + decode + indices) → Tasks 1, 6 ✓. Runtime data flow (per-frame interpolation, state lookup, poop window, chart cursor, ww bin) → Tasks 3, 2, 11, 10, 12 ✓. Day/night cycle + characters with LOD → Task 13 ✓. Error handling (loading/error states, clamped time) → Tasks 8 (useBundle), 5/9 (clamp) ✓. Wastewater regions interface (grid now, sewershed later) → consumed generically in Task 12 ✓.
- Deferred to future (not v1): challenge mode, social-network layer, sound, real sewershed GeoJSON swap — all explicitly post-v1 in the spec.

**Placeholder scan:** Every code step has complete code. The only conditional is Task 13 Step 2's sprite asset, which has an explicit fallback (keep polished dots) so it never blocks.

**Type consistency:** `Bundle` (from `loadBundle`) is the shared shape consumed by `layers.ts`, `MapView`, hooks, and HUD. `positionAtTick`/`stateAtTick`/`hourBinIndex`/`tickToDate`/`advanceTick` signatures are used consistently. deck.gl layer factories (`makeAgentLayer`, `makeVenueLayer`, `makePoopLayer`, `makeWastewaterLayer`, `makeArcLayer`) and their `*Data` producers share the `Bundle`+`tick` interface. `LayerFlags` keys match the conditional layer assembly in `MapView`. The binary offsets in `decodeBinary.ts` (13/18 bytes) exactly mirror the preprocessor's `AGENT_WAYPOINT_DTYPE`/`POOP_EVENT_DTYPE`.

---

## Done When

- `npm test` passes (smoke + Tasks 1–6 pure-logic suites).
- `npm run build` typechecks with no errors.
- `npm run dev` shows the full experience: a game-skinned Atlanta map; 1,000 agents animating between venues colored by S/E/I/R; poop splashes; a working full-year scrubber with the outbreak band; a HUD with a live clock, S/E/I/R counters, and SEIR + wastewater charts synced to playback; toggleable wastewater heat and infection-arc layers; and a day/night tint.
- A screenshot of the running app is captured for the final review.
```
