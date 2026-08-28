# Sewershed-Specific Wastewater Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign every defecation event and every agent to one of three San Diego sewersheds, so the app can show a per-sewershed wastewater curve alongside the case curve for the people who actually live there.

**Architecture:** A new preprocessor module dissolves the ZCTA shapefiles into three geometries and emits four small artifacts (boundaries, a per-shed hourly pathogen matrix, a per-shed hourly resident-SEIR matrix, and a per-agent home index). The app treats those artifacts as optional, adds a boundary layer, and re-scopes the existing charts by building a **derived `Aggregates` object** — so `SeirChart` and `WastewaterChart` need no changes at all.

**Tech Stack:** Python 3.12 + pyshp/shapely/numpy/pandas (preprocessor, pytest); TypeScript + React 18 + deck.gl 9 (app, vitest).

**Spec:** `docs/superpowers/specs/2026-08-27-sewershed-signals-design.md`

## Global Constraints

- **Three sewersheds, disjoint, in this fixed order:** `encina`, `point_loma`, `south_bay` (alphabetical, matching `sorted(glob('*.shp'))`). Every matrix has **one extra final row for Outside**, which has no entry in `sewersheds.json`.
- **`agent_home_shed.u8` uses `255` for Outside**, never a valid shed index.
- **Assignment uses full-resolution geometry; rendering uses a simplified copy** (tolerance `0.00045` degrees ≈ 50 m). Never swap these — simplifying before assignment moves points across boundaries with no visible symptom.
- **Wastewater is assigned by event coordinate; residence is assigned by most-dwelled Apartment.** These are different questions and must not share a rule.
- **Outside is retained as a real series**, never dropped. This is what makes the sum invariant possible.
- Bin cadence is hourly (`3600` s, 12 ticks), matching `aggregates.json`, giving **5,112 bins** for the production window.
- Shapefiles are **geographic NAD83 degrees** — already lon/lat, no reprojection.
- The v1 `dataset_00` path must not change. The 0.02° wastewater grid must not change.
- Expected production figures (from the spec's audit): venues 2,758 / 7,743 / 397 / 1,236 outside; residents 2,324 / 6,420 / 127 / 1,129 outside.
- Run pytest from `preprocess/`; run vitest/tsc/build from `app/`.

---

### Task 1: Sewershed geometry — read, dissolve, assign

**Files:**
- Create: `preprocess/poop_simcity_preprocess/sewersheds.py`
- Modify: `preprocess/requirements.txt`
- Test: `preprocess/tests/test_sewersheds.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SHED_IDS = ["encina", "point_loma", "south_bay"]`; `OUTSIDE = -1`; `OUTSIDE_U8 = 255`; `SIMPLIFY_DEG = 0.00045`; `load_sewersheds(shapefile_dir) -> list[Sewershed]` where `Sewershed` is a frozen dataclass with `id: str`, `label: str`, `geometry` (shapely, full resolution); `assign_points(sheds, lon, lat) -> np.ndarray` returning int8 shed index per point with `-1` for Outside; `simplified_rings(shed) -> list[list[list[list[float]]]]` (polygons → rings → `[lon, lat]` pairs).

- [ ] **Step 1: Add the dependencies**

Append to `preprocess/requirements.txt`:

```
pyshp>=2.3
shapely>=2.0
```

`pyshp` is required rather than a hand-rolled `.shp` parser because the dissolved boundaries contain real interior rings (3 in Point Loma, 1 in South Bay). A reader that treats every ring as a filled polygon converts those holes to solid land and misassigns 12 venues, 11 of them in South Bay. `shapely` is already installed in the environment but was never declared.

Install: `python -m pip install "pyshp>=2.3" "shapely>=2.0"`

- [ ] **Step 2: Write the failing test**

```python
# preprocess/tests/test_sewersheds.py
import numpy as np
import pytest
import shapefile
from shapely.geometry import Polygon

from poop_simcity_preprocess.sewersheds import (
    OUTSIDE, SHED_IDS, assign_points, load_sewersheds, simplified_rings,
)


def _write_shapefile(path_base, rings_per_record):
    """Write a polygon shapefile. Each record is a list of rings; by the shapefile
    spec an outer ring is clockwise and a hole is counter-clockwise."""
    w = shapefile.Writer(str(path_base), shapeType=shapefile.POLYGON)
    w.field("ZCTA5CE20", "C")
    for rings in rings_per_record:
        w.poly(rings)
        w.record("00000")
    w.close()
    # pyshp does not write a .prj; the real files carry geographic NAD83.
    with open(f"{path_base}.prj", "w") as f:
        f.write('GEOGCS["GCS_North_American_1983"]')


def _square(x0, y0, x1, y1, clockwise=True):
    pts = [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]
    return pts if clockwise else pts[::-1]


def test_dissolves_multiple_polygons_into_one_geometry(tmp_path):
    d = tmp_path / "sheds"
    d.mkdir()
    # Two adjacent squares in one file must dissolve into a single 2x1 rectangle.
    _write_shapefile(d / "encina_sewershed", [
        [_square(0, 0, 1, 1)],
        [_square(1, 0, 2, 1)],
    ])
    _write_shapefile(d / "point_loma_sewershed", [[_square(10, 10, 11, 11)]])
    _write_shapefile(d / "south_bay_sewershed", [[_square(20, 20, 21, 21)]])

    sheds = load_sewersheds(str(d))
    assert [s.id for s in sheds] == SHED_IDS
    assert sheds[0].geometry.geom_type == "Polygon"
    assert sheds[0].geometry.area == pytest.approx(2.0)


def test_a_point_inside_a_hole_is_outside(tmp_path):
    """The regression guard for hole handling: a naive reader that treats every
    ring as solid would report this point as inside."""
    d = tmp_path / "sheds"
    d.mkdir()
    _write_shapefile(d / "encina_sewershed", [[
        _square(0, 0, 10, 10),                       # outer ring, clockwise
        _square(4, 4, 6, 6, clockwise=False),        # hole, counter-clockwise
    ]])
    _write_shapefile(d / "point_loma_sewershed", [[_square(20, 20, 21, 21)]])
    _write_shapefile(d / "south_bay_sewershed", [[_square(30, 30, 31, 31)]])

    sheds = load_sewersheds(str(d))
    assert len(sheds[0].geometry.interiors) == 1

    lon = np.array([1.0, 5.0, 20.5, 50.0])   # in shed 0, in its hole, in shed 1, nowhere
    lat = np.array([1.0, 5.0, 20.5, 50.0])
    assert assign_points(sheds, lon, lat).tolist() == [0, OUTSIDE, 1, OUTSIDE]


def test_assignment_is_exhaustive_and_single_valued(tmp_path):
    d = tmp_path / "sheds"
    d.mkdir()
    _write_shapefile(d / "encina_sewershed", [[_square(0, 0, 1, 1)]])
    _write_shapefile(d / "point_loma_sewershed", [[_square(2, 2, 3, 3)]])
    _write_shapefile(d / "south_bay_sewershed", [[_square(4, 4, 5, 5)]])
    sheds = load_sewersheds(str(d))
    lon = np.array([0.5, 2.5, 4.5, 9.0])
    lat = np.array([0.5, 2.5, 4.5, 9.0])
    out = assign_points(sheds, lon, lat)
    assert out.tolist() == [0, 1, 2, OUTSIDE]
    assert out.dtype == np.int8


def test_simplified_rings_are_lonlat_pairs_and_keep_holes(tmp_path):
    d = tmp_path / "sheds"
    d.mkdir()
    _write_shapefile(d / "encina_sewershed", [[
        _square(0, 0, 10, 10),
        _square(4, 4, 6, 6, clockwise=False),
    ]])
    _write_shapefile(d / "point_loma_sewershed", [[_square(20, 20, 21, 21)]])
    _write_shapefile(d / "south_bay_sewershed", [[_square(30, 30, 31, 31)]])
    polys = simplified_rings(load_sewersheds(str(d))[0])
    assert len(polys) == 1            # one polygon
    assert len(polys[0]) == 2         # outer ring + one hole
    assert len(polys[0][0][0]) == 2   # each vertex is [lon, lat]


def test_empty_point_array_is_handled(tmp_path):
    d = tmp_path / "sheds"
    d.mkdir()
    for n in ("encina", "point_loma", "south_bay"):
        _write_shapefile(d / f"{n}_sewershed", [[_square(0, 0, 1, 1)]])
    sheds = load_sewersheds(str(d))
    out = assign_points(sheds, np.array([]), np.array([]))
    assert out.shape == (0,) and out.dtype == np.int8


def test_missing_shapefile_raises_naming_the_file(tmp_path):
    d = tmp_path / "sheds"
    d.mkdir()
    _write_shapefile(d / "encina_sewershed", [[_square(0, 0, 1, 1)]])
    with pytest.raises(FileNotFoundError, match="point_loma"):
        load_sewersheds(str(d))
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd preprocess && python -m pytest tests/test_sewersheds.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.sewersheds'`

- [ ] **Step 4: Write the implementation**

```python
# preprocess/poop_simcity_preprocess/sewersheds.py
"""Sewershed geometry: read the shapefiles, dissolve them, assign points.

Each input file is a set of Census ZCTA polygons approximating one treatment
plant's service area, so the first thing we do is dissolve each file into a
single geometry. The dissolved boundaries contain genuine interior rings, which
is why this reads via pyshp rather than parsing `.shp` by hand: a reader that
treats every ring as filled turns a hole into solid land and misassigns points
inside it.

The three sewersheds are disjoint in the real data, so assignment needs no
tie-break; `assign_points` still assigns first-match-wins so that a future
overlapping input degrades predictably rather than double-counting.
"""

import os
from dataclasses import dataclass

import numpy as np
import shapefile
import shapely
from shapely.geometry import shape
from shapely.ops import unary_union

# Fixed order, matching sorted() over the shapefile directory. Every per-shed
# matrix uses this order, with Outside appended as a final row.
SHED_IDS = ["encina", "point_loma", "south_bay"]
SHED_LABELS = {
    "encina": "Encina",
    "point_loma": "Point Loma",
    "south_bay": "South Bay",
}

# Sentinel for "in none of the sewersheds".
OUTSIDE = -1
# The on-disk encoding of OUTSIDE in agent_home_shed.u8. 255 can never collide
# with a real shed index.
OUTSIDE_U8 = 255

# ~50 m at San Diego's latitude. Used ONLY for the rings shipped to the browser;
# assignment always uses the full-resolution geometry.
SIMPLIFY_DEG = 0.00045


@dataclass(frozen=True)
class Sewershed:
    id: str
    label: str
    geometry: object  # shapely Polygon/MultiPolygon, full resolution


def load_sewersheds(shapefile_dir) -> list:
    """Read and dissolve each sewershed's shapefile, in SHED_IDS order."""
    sheds = []
    for shed_id in SHED_IDS:
        path = os.path.join(shapefile_dir, f"{shed_id}_sewershed.shp")
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"missing sewershed shapefile for {shed_id!r}: expected {path}"
            )
        reader = shapefile.Reader(path)
        geoms = []
        for s in reader.shapes():
            g = shape(s.__geo_interface__)
            # A self-touching ZCTA ring would make unary_union raise; buffer(0)
            # is the standard repair and is a no-op on valid input.
            geoms.append(g if g.is_valid else g.buffer(0))
        sheds.append(Sewershed(
            id=shed_id, label=SHED_LABELS[shed_id], geometry=unary_union(geoms),
        ))
    return sheds


def assign_points(sheds, lon, lat) -> np.ndarray:
    """Index of the sewershed containing each point, or OUTSIDE.

    Vectorized: one `contains_xy` call per sewershed over all points, rather
    than a per-point loop. At real scale this runs over ~4M poop events.
    """
    lon = np.asarray(lon, dtype="float64")
    lat = np.asarray(lat, dtype="float64")
    out = np.full(lon.shape, OUTSIDE, dtype=np.int8)
    if lon.size == 0:
        return out
    for i, shed in enumerate(sheds):
        inside = shapely.contains_xy(shed.geometry, lon, lat)
        out = np.where(inside & (out == OUTSIDE), np.int8(i), out)
    return out


def simplified_rings(shed) -> list:
    """Render-only boundary: polygons -> rings -> [lon, lat] pairs.

    Simplified for payload size. NEVER feed this back into assign_points:
    moving a boundary by ~50 m silently reclassifies points near it.
    """
    g = shed.geometry.simplify(SIMPLIFY_DEG, preserve_topology=True)
    polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    out = []
    for p in polys:
        rings = [[[float(x), float(y)] for x, y in p.exterior.coords]]
        for interior in p.interiors:
            rings.append([[float(x), float(y)] for x, y in interior.coords])
        out.append(rings)
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd preprocess && python -m pytest tests/test_sewersheds.py -v`
Expected: 6 passed

- [ ] **Step 6: Sanity-check against the real shapefiles**

Run this throwaway check (do not commit it) and confirm the numbers match the plan's Global Constraints:

```bash
cd preprocess && python -c "
from poop_simcity_preprocess.sewersheds import load_sewersheds, assign_points
import numpy as np
sheds = load_sewersheds('../san_diego_shapefiles')
for s in sheds:
    holes = sum(len(p.interiors) for p in ([s.geometry] if s.geometry.geom_type=='Polygon' else s.geometry.geoms))
    print(s.id, s.geometry.geom_type, 'holes=', holes)
lon = np.fromfile('../app/public/data/dataset_sdc-10k/venues_lon.f32', dtype='<f4').astype('float64')
lat = np.fromfile('../app/public/data/dataset_sdc-10k/venues_lat.f32', dtype='<f4').astype('float64')
a = assign_points(sheds, lon, lat)
print('venues per shed:', [(s.id, int((a==i).sum())) for i,s in enumerate(sheds)], 'outside', int((a==-1).sum()))
"
```

Expected: Point Loma reports 3 holes, South Bay 1; venue counts 2758 / 7743 / 397 and 1236 outside. If they differ, stop and report — the geometry is being read wrongly.

- [ ] **Step 7: Commit**

```bash
git add preprocess/poop_simcity_preprocess/sewersheds.py preprocess/tests/test_sewersheds.py preprocess/requirements.txt
git commit -m "feat: read, dissolve and assign against sewershed geometry"
```

---

### Task 2: Agent residence by most-dwelled Apartment

**Files:**
- Modify: `preprocess/poop_simcity_preprocess/sewersheds.py`
- Test: `preprocess/tests/test_sewersheds.py`

**Interfaces:**
- Consumes: `assign_points`, `OUTSIDE` (Task 1).
- Produces: `home_shed_by_agent(stay_arrays, stay_index, venue_types, venue_shed) -> np.ndarray` — int8, one entry per entry in `stay_index` (same order), value is a shed index or `OUTSIDE`. `stay_arrays` is the dict returned by `build_stays` (keys `stays_dwell.u16`, `stays_venue.u16`); `venue_types` is the `uint8` venue-type array; `venue_shed` is `assign_points`' output over the venue table.

- [ ] **Step 1: Write the failing test**

```python
# append to preprocess/tests/test_sewersheds.py
import numpy as np

from poop_simcity_preprocess.sewersheds import OUTSIDE, home_shed_by_agent

APARTMENT = 0
WORKPLACE = 1


def _stays(venue, dwell):
    return {
        "stays_venue.u16": np.array(venue, dtype=np.uint16),
        "stays_dwell.u16": np.array(dwell, dtype=np.uint16),
    }


def test_home_is_the_apartment_with_the_most_dwell_not_the_most_visits():
    # Agent 0 visits venue 1 three times (30 ticks total) but sleeps at venue 0
    # once for 100 ticks. Home is venue 0.
    venue_types = np.array([APARTMENT, APARTMENT], dtype=np.uint8)
    venue_shed = np.array([0, 1], dtype=np.int8)
    arrays = _stays([0, 1, 1, 1], [100, 10, 10, 10])
    index = [{"agentId": 0, "offset": 0, "count": 4}]
    assert home_shed_by_agent(arrays, index, venue_types, venue_shed).tolist() == [0]


def test_non_apartment_stays_never_count():
    # The workplace has far more dwell, but only Apartments can be a home.
    venue_types = np.array([APARTMENT, WORKPLACE], dtype=np.uint8)
    venue_shed = np.array([0, 1], dtype=np.int8)
    arrays = _stays([0, 1], [5, 5000])
    index = [{"agentId": 0, "offset": 0, "count": 2}]
    assert home_shed_by_agent(arrays, index, venue_types, venue_shed).tolist() == [0]


def test_ties_break_toward_the_lower_venue_index():
    venue_types = np.array([APARTMENT, APARTMENT], dtype=np.uint8)
    venue_shed = np.array([0, 1], dtype=np.int8)
    arrays = _stays([1, 0], [50, 50])
    index = [{"agentId": 0, "offset": 0, "count": 2}]
    assert home_shed_by_agent(arrays, index, venue_types, venue_shed).tolist() == [0]


def test_home_in_no_sewershed_is_outside():
    venue_types = np.array([APARTMENT], dtype=np.uint8)
    venue_shed = np.array([OUTSIDE], dtype=np.int8)
    arrays = _stays([0], [10])
    index = [{"agentId": 0, "offset": 0, "count": 1}]
    assert home_shed_by_agent(arrays, index, venue_types, venue_shed).tolist() == [OUTSIDE]


def test_agent_with_no_apartment_stay_is_outside():
    venue_types = np.array([WORKPLACE], dtype=np.uint8)
    venue_shed = np.array([0], dtype=np.int8)
    arrays = _stays([0], [10])
    index = [{"agentId": 0, "offset": 0, "count": 1}]
    assert home_shed_by_agent(arrays, index, venue_types, venue_shed).tolist() == [OUTSIDE]


def test_each_agent_uses_only_its_own_slice():
    venue_types = np.array([APARTMENT, APARTMENT], dtype=np.uint8)
    venue_shed = np.array([0, 1], dtype=np.int8)
    arrays = _stays([0, 1], [10, 10])
    index = [
        {"agentId": 7, "offset": 0, "count": 1},
        {"agentId": 9, "offset": 1, "count": 1},
    ]
    assert home_shed_by_agent(arrays, index, venue_types, venue_shed).tolist() == [0, 1]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd preprocess && python -m pytest tests/test_sewersheds.py -k home -v`
Expected: FAIL with `ImportError: cannot import name 'home_shed_by_agent'`

- [ ] **Step 3: Write the implementation**

Append to `preprocess/poop_simcity_preprocess/sewersheds.py`:

```python
def home_shed_by_agent(stay_arrays, stay_index, venue_types, venue_shed) -> np.ndarray:
    """Each agent's sewershed of residence, in `stay_index` order.

    Residence is the Apartment where the agent accumulates the most dwell time
    across the window — not its first check-in, which a single visit to someone
    else's home would decide, and not where it happens to be at a given hour.
    This is the rule the CheckoutTime durations make possible.

    Ties break toward the lower venue index (argmax over a bincount), which is
    deterministic. An agent with no Apartment stay at all is OUTSIDE; that case
    does not arise in the production run, where all 10,000 agents have one.
    """
    venue = stay_arrays["stays_venue.u16"].astype("int64")
    dwell = stay_arrays["stays_dwell.u16"].astype("int64")
    is_apartment = venue_types[venue] == 0   # VENUE_TYPE_TO_ID["Apartment"]

    out = np.full(len(stay_index), OUTSIDE, dtype=np.int8)
    for i, entry in enumerate(stay_index):
        lo = entry["offset"]
        hi = lo + entry["count"]
        mask = is_apartment[lo:hi]
        if not mask.any():
            continue
        totals = np.bincount(venue[lo:hi][mask], weights=dwell[lo:hi][mask])
        out[i] = venue_shed[int(totals.argmax())]
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd preprocess && python -m pytest tests/test_sewersheds.py -v`
Expected: 12 passed (6 from Task 1 plus 6 new)

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/sewersheds.py preprocess/tests/test_sewersheds.py
git commit -m "feat: assign agent residence by most-dwelled apartment"
```

---

### Task 3: Per-sewershed hourly wastewater series

**Files:**
- Create: `preprocess/poop_simcity_preprocess/sewershed_series.py`
- Test: `preprocess/tests/test_sewershed_series.py`

**Interfaces:**
- Consumes: `assign_points`, `OUTSIDE` (Task 1); `iter_poop_batches` from `poop_stream.py`; `hourly_bin_grid` from `aggregates_v2.py`; `ticks_of` from `window.py`.
- Produces: `sewershed_pathogen_hourly(dataset_dir, profile, window, sheds, cadence_sec=3600, batch_size=2_000_000) -> np.ndarray` — a `float64` array of shape `(len(sheds) + 1, num_bins)`, Outside last.

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_sewershed_series.py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import shapefile

from poop_simcity_preprocess.aggregates_v2 import pathogen_inflow_hourly
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.sewersheds import load_sewersheds
from poop_simcity_preprocess.sewershed_series import sewershed_pathogen_hourly
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 02:55:00")  # 36 ticks, 3 bins


def _square(x0, y0, x1, y1):
    return [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]


def _sheds(tmp_path):
    d = tmp_path / "sheds"
    d.mkdir()
    boxes = {"encina": (0, 0, 1, 1), "point_loma": (2, 2, 3, 3), "south_bay": (4, 4, 5, 5)}
    for name, (x0, y0, x1, y1) in boxes.items():
        w = shapefile.Writer(str(d / f"{name}_sewershed"), shapeType=shapefile.POLYGON)
        w.field("ZCTA5CE20", "C")
        w.poly([_square(x0, y0, x1, y1)])
        w.record("00000")
        w.close()
    return load_sewersheds(str(d))


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def _row(t, lat, lon, pathogen):
    return (0, t, lat, lon, "Apartment", pathogen, "Infectious", None)


def test_events_land_in_the_right_shed_and_bin(tmp_path):
    _write_poops(tmp_path, [
        _row("2024-01-01 00:10:00", 0.5, 0.5, 4.0),    # encina,     bin 0
        _row("2024-01-01 01:10:00", 2.5, 2.5, 7.0),    # point_loma, bin 1
        _row("2024-01-01 02:10:00", 4.5, 4.5, 9.0),    # south_bay,  bin 2
        _row("2024-01-01 00:20:00", 9.9, 9.9, 3.0),    # outside,    bin 0
    ])
    m = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, _sheds(tmp_path))
    assert m.shape == (4, 3)
    np.testing.assert_allclose(m[0], [4.0, 0.0, 0.0])
    np.testing.assert_allclose(m[1], [0.0, 7.0, 0.0])
    np.testing.assert_allclose(m[2], [0.0, 0.0, 9.0])
    np.testing.assert_allclose(m[3], [3.0, 0.0, 0.0])   # Outside is the last row


def test_rows_sum_to_the_global_inflow_series(tmp_path):
    """The load-bearing invariant: the per-shed partition is exhaustive and
    disjoint, so it must reconstruct the series the bundle already ships."""
    _write_poops(tmp_path, [
        _row("2024-01-01 00:10:00", 0.5, 0.5, 4.0),
        _row("2024-01-01 00:40:00", 2.5, 2.5, 6.0),
        _row("2024-01-01 01:10:00", 9.9, 9.9, 2.5),
        _row("2024-01-01 02:50:00", 4.5, 4.5, 1.25),
        _row("2024-01-01 01:30:00", 0.5, 0.5, 0.0),     # clean event still binned
    ])
    m = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, _sheds(tmp_path))
    global_series = pathogen_inflow_hourly(str(tmp_path), SDC_10K, WINDOW)
    np.testing.assert_allclose(m.sum(axis=0), global_series, rtol=1e-9)


def test_out_of_window_events_are_excluded(tmp_path):
    _write_poops(tmp_path, [
        _row("2024-01-01 00:10:00", 0.5, 0.5, 4.0),
        _row("2024-02-01 00:10:00", 0.5, 0.5, 99.0),
    ])
    m = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, _sheds(tmp_path))
    assert m.sum() == pytest.approx(4.0)


def test_batch_boundaries_do_not_change_the_result(tmp_path):
    rows = [_row(f"2024-01-01 0{i//6}:{(i%6)*10:02d}:00", 0.5, 0.5, 1.0) for i in range(18)]
    _write_poops(tmp_path, rows)
    sheds = _sheds(tmp_path)
    big = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, sheds, batch_size=1000)
    small = sewershed_pathogen_hourly(str(tmp_path), SDC_10K, WINDOW, sheds, batch_size=3)
    np.testing.assert_allclose(big, small)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd preprocess && python -m pytest tests/test_sewershed_series.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.sewershed_series'`

- [ ] **Step 3: Write the implementation**

```python
# preprocess/poop_simcity_preprocess/sewershed_series.py
"""Per-sewershed hourly series.

Two different questions, two different assignment rules:

- Wastewater is assigned by the event's OWN coordinates. That is what a plant
  measures: pathogen follows the pipe from wherever it was deposited, whoever
  deposited it.
- Resident cases are assigned by the agent's home (see `sewersheds.home_shed_by_agent`).

Both are accumulated on the same hourly bin grid as `aggregates.json`, so the
per-shed rows sum back to the global series — the invariant the tests lean on.
"""

import numpy as np

from .aggregates_v2 import hourly_bin_grid
from .poop_stream import iter_poop_batches
from .sewersheds import assign_points
from .window import ticks_of


def sewershed_pathogen_hourly(dataset_dir, profile, window, sheds,
                              cadence_sec=3600, batch_size=2_000_000):
    """Pathogen per sewershed per hourly bin; shape (len(sheds) + 1, num_bins).

    The final row is Outside. Accumulates in float64; callers narrow to float32
    only when writing the artifact.
    """
    grid_ticks, bin_ticks = hourly_bin_grid(window, cadence_sec)
    num_bins = len(grid_ticks)
    n_rows = len(sheds) + 1
    outside_row = len(sheds)
    totals = np.zeros((n_rows, num_bins), dtype="float64")

    columns = ["time", "latitude", "longitude", "pathogen_level"]
    for df in iter_poop_batches(dataset_dir, profile, window, columns, batch_size):
        shed = assign_points(sheds, df["longitude"].to_numpy(), df["latitude"].to_numpy())
        row = np.where(shed < 0, outside_row, shed).astype("int64")
        bins = ticks_of(df["time"], window) // bin_ticks
        # Flat index so one np.add.at call covers every (row, bin) pair.
        np.add.at(
            totals.reshape(-1),
            row * num_bins + bins,
            df["pathogen_level"].to_numpy(dtype="float64"),
        )
    return totals
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd preprocess && python -m pytest tests/test_sewershed_series.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/sewershed_series.py preprocess/tests/test_sewershed_series.py
git commit -m "feat: per-sewershed hourly pathogen series"
```

---

### Task 4: Per-sewershed resident SEIR series

**Files:**
- Modify: `preprocess/poop_simcity_preprocess/sewershed_series.py`
- Test: `preprocess/tests/test_sewershed_series.py`

**Interfaces:**
- Consumes: `seir_hourly` from `aggregates_v2.py`; `OUTSIDE` from `sewersheds.py`.
- Produces: `sewershed_seir_hourly(transitions, home_shed, agent_ids, n_sheds, window, cadence_sec=3600) -> np.ndarray` — `int64`, shape `(n_sheds + 1, 4, num_bins)`, state axis ordered `S, E, I, R`. `home_shed` is `home_shed_by_agent`'s output; `agent_ids` is the parallel list of agent ids from `stay_index`.

Reuses the existing, already-tested `seir_hourly` by calling it once per sewershed with that shed's residents. Because homes partition the population exactly, the rows sum to the global SEIR for free.

- [ ] **Step 1: Write the failing test**

```python
# append to preprocess/tests/test_sewershed_series.py
from poop_simcity_preprocess.aggregates_v2 import seir_hourly
from poop_simcity_preprocess.sewershed_series import sewershed_seir_hourly

STATES = ["S", "E", "I", "R"]


def test_residents_are_counted_in_their_own_shed_only():
    # Agent 10 lives in shed 0 and is Exposed from tick 6; agent 20 lives in
    # shed 1 and never transitions.
    transitions = {10: [(6, 1)]}
    home = np.array([0, 1], dtype=np.int8)
    m = sewershed_seir_hourly(transitions, home, [10, 20], n_sheds=3, window=WINDOW)
    assert m.shape == (4, 4, 3)
    assert m[0][STATES.index("E")].tolist() == [1, 1, 1]   # shed 0: the exposed agent
    assert m[0][STATES.index("S")].tolist() == [0, 0, 0]
    assert m[1][STATES.index("S")].tolist() == [1, 1, 1]   # shed 1: the susceptible one
    assert m[2].sum() == 0                                  # shed 2 has no residents
    assert m[3].sum() == 0                                  # nobody lives Outside


def test_outside_residents_land_in_the_last_row():
    transitions = {}
    home = np.array([-1, -1], dtype=np.int8)
    m = sewershed_seir_hourly(transitions, home, [1, 2], n_sheds=3, window=WINDOW)
    assert m[3][STATES.index("S")].tolist() == [2, 2, 2]
    assert m[0].sum() == 0


def test_rows_sum_to_the_global_seir_series():
    """Same invariant as the wastewater series: homes partition the population,
    so summing the per-shed rows must reproduce the global SEIR exactly."""
    transitions = {1: [(6, 1)], 2: [(6, 1), (18, 2)], 3: [(30, 3)]}
    home = np.array([0, 1, 2, -1, 0], dtype=np.int8)
    agent_ids = [1, 2, 3, 4, 5]
    m = sewershed_seir_hourly(transitions, home, agent_ids, n_sheds=3, window=WINDOW)
    global_seir = seir_hourly(transitions, len(agent_ids), WINDOW)
    for s, name in enumerate(STATES):
        assert m[:, s, :].sum(axis=0).tolist() == global_seir[name]


def test_every_bin_sums_to_the_population():
    transitions = {1: [(6, 2)]}
    home = np.array([0, 1, -1], dtype=np.int8)
    m = sewershed_seir_hourly(transitions, home, [1, 2, 3], n_sheds=3, window=WINDOW)
    assert m.sum(axis=(0, 1)).tolist() == [3, 3, 3]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd preprocess && python -m pytest tests/test_sewershed_series.py -k seir -v`
Expected: FAIL with `ImportError: cannot import name 'sewershed_seir_hourly'`

- [ ] **Step 3: Write the implementation**

Append to `preprocess/poop_simcity_preprocess/sewershed_series.py`:

```python
from .aggregates_v2 import seir_hourly

STATE_ORDER = ["S", "E", "I", "R"]


def sewershed_seir_hourly(transitions, home_shed, agent_ids, n_sheds, window,
                          cadence_sec=3600):
    """Resident SEIR per sewershed per hourly bin; shape (n_sheds + 1, 4, num_bins).

    Delegates to `seir_hourly` once per sewershed, passing only that shed's
    residents and its resident count. Reusing it keeps one implementation of the
    bin-close sampling convention rather than a second copy that could drift.

    Because `home_shed` partitions the population — every agent has exactly one
    home, Outside included — the rows sum to the global SEIR by construction.
    """
    home_shed = np.asarray(home_shed)
    outside_row = n_sheds
    rows = []
    for row in range(n_sheds + 1):
        member = home_shed == (OUTSIDE if row == outside_row else row)
        residents = {
            agent_ids[i]: transitions[agent_ids[i]]
            for i in np.flatnonzero(member)
            if agent_ids[i] in transitions
        }
        counts = seir_hourly(residents, int(member.sum()), window, cadence_sec)
        rows.append([counts[s] for s in STATE_ORDER])
    return np.array(rows, dtype="int64")
```

Add `OUTSIDE` to the module's existing import from `.sewersheds`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd preprocess && python -m pytest tests/test_sewershed_series.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/sewershed_series.py preprocess/tests/test_sewershed_series.py
git commit -m "feat: per-sewershed resident SEIR series"
```

---

### Task 5: Encode the artifacts and wire them into the build

**Files:**
- Modify: `preprocess/poop_simcity_preprocess/sewershed_series.py`
- Modify: `preprocess/poop_simcity_preprocess/build_v2.py`
- Modify: `preprocess/poop_simcity_preprocess/cli.py`
- Test: `preprocess/tests/test_build_v2_integration.py`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `encode_sewersheds(sheds, ww, seir, home_shed, venue_shed) -> tuple[dict, dict[str, bytes]]` returning `(sewersheds_json, {filename: bytes})` for `sewershed_ww.bin`, `sewershed_seir.bin`, `agent_home_shed.u8`. `build_bundle_v2` gains a keyword argument `shapefile_dir=None`; when it is `None` the four artifacts are skipped entirely and the manifest gains no sewershed keys.

- [ ] **Step 1: Write the failing test**

```python
# append to preprocess/tests/test_build_v2_integration.py
import numpy as np
import shapefile


def _write_sewersheds(shed_dir, boxes):
    shed_dir.mkdir(parents=True, exist_ok=True)
    for name, (x0, y0, x1, y1) in boxes.items():
        w = shapefile.Writer(str(shed_dir / f"{name}_sewershed"), shapeType=shapefile.POLYGON)
        w.field("ZCTA5CE20", "C")
        w.poly([[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]])
        w.record("00000")
        w.close()


def test_sewershed_artifacts_sum_to_the_global_series(tmp_path):
    dataset_dir = tmp_path / "src"
    out_dir = tmp_path / "bundle"
    _write_synthetic(dataset_dir)
    # The synthetic fixture's venues sit near (32.70,-117.20) and (32.75,-117.10);
    # this box contains the first and excludes the second.
    _write_sewersheds(tmp_path / "sheds", {
        "encina": (-117.25, 32.65, -117.15, 32.72),
        "point_loma": (-100.0, 10.0, -99.0, 11.0),
        "south_bay": (-90.0, 10.0, -89.0, 11.0),
    })

    manifest = build_bundle_v2(
        str(dataset_dir), str(out_dir), run_id="test-run",
        window_start=WINDOW_START, window_end=WINDOW_END, profile=SDC_10K,
        clean_keep_fraction=1.0, shapefile_dir=str(tmp_path / "sheds"),
    )

    assert manifest["sewershedKind"] == "zcta-union"
    for key in ("sewersheds", "sewershedWw", "sewershedSeir", "agentHomeShed"):
        assert key in manifest["artifacts"]
        assert (out_dir / manifest["artifacts"][key]).exists()

    sheds = json.loads((out_dir / "sewersheds.json").read_text())
    assert [s["id"] for s in sheds["sewersheds"]] == ["encina", "point_loma", "south_bay"]
    n_rows = len(sheds["sewersheds"]) + 1

    agg = json.loads((out_dir / "aggregates.json").read_text())
    num_bins = len(agg["gridTicks"])

    ww = np.frombuffer((out_dir / "sewershed_ww.bin").read_bytes(),
                       dtype="<f4").reshape(n_rows, num_bins)
    np.testing.assert_allclose(ww.sum(axis=0), agg["pathogenInflow"], rtol=1e-5)

    seir = np.frombuffer((out_dir / "sewershed_seir.bin").read_bytes(),
                         dtype="<u2").reshape(n_rows, 4, num_bins)
    for s, name in enumerate("SEIR"):
        assert seir[:, s, :].sum(axis=0).tolist() == agg["seir"][name]

    home = np.frombuffer((out_dir / "agent_home_shed.u8").read_bytes(), dtype="<u1")
    assert len(home) == manifest["numAgents"]
    assert set(np.unique(home)).issubset({0, 1, 2, 255})


def test_bundle_without_shapefiles_has_no_sewershed_artifacts(tmp_path):
    dataset_dir = tmp_path / "src"
    out_dir = tmp_path / "bundle"
    _write_synthetic(dataset_dir)
    manifest = build_bundle_v2(
        str(dataset_dir), str(out_dir), run_id="r",
        window_start=WINDOW_START, window_end=WINDOW_END, profile=SDC_10K,
    )
    assert "sewershedKind" not in manifest
    for key in ("sewersheds", "sewershedWw", "sewershedSeir", "agentHomeShed"):
        assert key not in manifest["artifacts"]
    assert not (out_dir / "sewersheds.json").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd preprocess && python -m pytest tests/test_build_v2_integration.py -k sewershed -v`
Expected: FAIL — `build_bundle_v2()` got an unexpected keyword argument `shapefile_dir`

- [ ] **Step 3: Write the encoder**

Append to `preprocess/poop_simcity_preprocess/sewershed_series.py`:

```python
from .sewersheds import OUTSIDE_U8, simplified_rings

SEWERSHED_ARTIFACTS = {
    "sewersheds": "sewersheds.json",
    "sewershedWw": "sewershed_ww.bin",
    "sewershedSeir": "sewershed_seir.bin",
    "agentHomeShed": "agent_home_shed.u8",
}


def encode_sewersheds(sheds, ww, seir, home_shed, venue_shed):
    """Serialize the sewershed artifacts.

    Returns (sewersheds_json, {filename: bytes}). `sewersheds.json` describes only
    the real sewersheds; Outside is the remainder and appears only as the final
    row of each matrix.
    """
    home_shed = np.asarray(home_shed)
    venue_shed = np.asarray(venue_shed)
    meta = {
        "kind": "zcta-union",
        "sewersheds": [
            {
                "id": shed.id,
                "label": shed.label,
                "residents": int((home_shed == i).sum()),
                "venues": int((venue_shed == i).sum()),
                "polygons": simplified_rings(shed),
            }
            for i, shed in enumerate(sheds)
        ],
        "outside": {
            "label": "Outside sewersheds",
            "residents": int((home_shed == OUTSIDE).sum()),
            "venues": int((venue_shed == OUTSIDE).sum()),
        },
    }
    seir_u16 = seir.astype("<u2")
    if not np.array_equal(seir_u16.astype("int64"), seir):
        raise ValueError("sewershed SEIR counts do not fit in uint16")
    home_u8 = np.where(home_shed == OUTSIDE, OUTSIDE_U8, home_shed).astype("<u1")
    return meta, {
        "sewershed_ww.bin": np.ascontiguousarray(ww, dtype="<f4").tobytes(),
        "sewershed_seir.bin": np.ascontiguousarray(seir_u16).tobytes(),
        "agent_home_shed.u8": home_u8.tobytes(),
    }
```

- [ ] **Step 4: Wire it into the build**

In `build_v2.py`, add these imports:

```python
from .sewersheds import assign_points, home_shed_by_agent, load_sewersheds
from .sewershed_series import (
    SEWERSHED_ARTIFACTS, encode_sewersheds, sewershed_pathogen_hourly,
    sewershed_seir_hourly,
)
```

`venue_arrays` is already imported. Then add the optional stage. Add `shapefile_dir=None` to `build_bundle_v2`'s keyword arguments, and insert this **after** `aggregates` is written and **before** the manifest is assembled (it needs `scan.transitions`, `stay_index`, `venues` and `venue_arrays`):

```python
    if shapefile_dir:
        sheds = load_sewersheds(shapefile_dir)
        venue_shed = assign_points(
            sheds,
            venues["longitude"].to_numpy(),
            venues["latitude"].to_numpy(),
        )
        # Reuse the array `venue_arrays` already built and validated, rather than
        # re-mapping venue_type here — that function raises on an unmapped type.
        home_shed = home_shed_by_agent(
            stay_arrays, stay_index,
            venue_arrays(venues)["venues_type.u8"],
            venue_shed,
        )
        ww = sewershed_pathogen_hourly(dataset_dir, profile, window, sheds,
                                       batch_size=batch_size)
        seir = sewershed_seir_hourly(
            scan.transitions, home_shed, [e["agentId"] for e in stay_index],
            len(sheds), window,
        )
        meta, blobs = encode_sewersheds(sheds, ww, seir, home_shed, venue_shed)
        _write_json(out_dir, "sewersheds.json", meta)
        for name, payload in blobs.items():
            _write_bytes(out_dir, name, payload)
        artifacts = {**ARTIFACTS_V2, **SEWERSHED_ARTIFACTS}
    else:
        artifacts = dict(ARTIFACTS_V2)
```

Then use `artifacts` where the manifest currently uses `dict(ARTIFACTS_V2)`, and add `"sewershedKind": "zcta-union"` to the manifest **only** when `shapefile_dir` is set.

- [ ] **Step 5: Add the CLI flag**

In `cli.py`, add:

```python
    parser.add_argument("--shapefile-dir", default=None,
                        help="Directory of <shed>_sewershed.shp files "
                             "(schemaVersion 2 only); omitted = no sewershed artifacts")
```

and pass `shapefile_dir=args.shapefile_dir` in the v2 branch of the dispatch.

- [ ] **Step 6: Run the tests**

Run: `cd preprocess && python -m pytest -q`
Expected: all pass, including the two new integration tests and every pre-existing test

- [ ] **Step 7: Commit**

```bash
git add preprocess/poop_simcity_preprocess/sewershed_series.py preprocess/poop_simcity_preprocess/build_v2.py preprocess/poop_simcity_preprocess/cli.py preprocess/tests/test_build_v2_integration.py
git commit -m "feat: emit sewershed artifacts from the v2 build"
```

---

### Task 6: Regenerate the bundle and extend the verifier

**Files:**
- Modify: `preprocess/verify_bundle_v2.py`
- Modify: `README.md`
- Regenerate: `app/public/data/dataset_sdc-10k/` (gitignored)

- [ ] **Step 1: Rebuild the bundle**

```bash
cd preprocess && python -m poop_simcity_preprocess.cli \
  --dataset ../dataset_sdc-10k \
  --out ../app/public/data/dataset_sdc-10k \
  --run-id dataset_sdc-10k \
  --profile dataset_sdc-10k \
  --window-start 2024-01-01T00:00:00 \
  --window-end 2024-07-31T23:55:00 \
  --clean-keep-fraction 0.3 \
  --shapefile-dir ../san_diego_shapefiles
```

The preprocessor never removes files it no longer produces, so if a previous bundle is present, delete the output directory first and rebuild clean.

- [ ] **Step 2: Confirm the figures match the audit**

```bash
cd preprocess && python -c "
import json
m = json.load(open('../app/public/data/dataset_sdc-10k/sewersheds.json'))
for s in m['sewersheds']: print(s['id'], 'venues', s['venues'], 'residents', s['residents'])
print('outside', m['outside'])
"
```

Expected exactly: encina 2758 / 2324, point_loma 7743 / 6420, south_bay 397 / 127, outside 1236 venues / 1129 residents. **If any number differs, stop and report** — it means assignment changed, not that the expectation was loose.

- [ ] **Step 3: Add verifier checks**

Add to `preprocess/verify_bundle_v2.py`, guarded so a bundle without sewersheds still verifies:

```python
    if "sewersheds" in manifest["artifacts"]:
        meta = json.loads(open(os.path.join(args.bundle, "sewersheds.json")).read())
        n_rows = len(meta["sewersheds"]) + 1
        num_bins = len(agg["gridTicks"])

        ww = _read(args.bundle, "sewershed_ww.bin", "<f4").reshape(n_rows, num_bins)
        check("sewershed pathogen sums to the global inflow",
              bool(np.allclose(ww.sum(axis=0), agg["pathogenInflow"], rtol=1e-4)),
              f"max rel diff {np.max(np.abs(ww.sum(axis=0) - agg['pathogenInflow']) / np.maximum(np.array(agg['pathogenInflow']), 1e-12)):.2e}")

        seir = _read(args.bundle, "sewershed_seir.bin", "<u2").reshape(n_rows, 4, num_bins)
        ok = all(seir[:, s, :].sum(axis=0).tolist() == agg["seir"][name]
                 for s, name in enumerate("SEIR"))
        check("sewershed resident SEIR sums to the global SEIR", ok)

        home = _read(args.bundle, "agent_home_shed.u8", "<u1")
        check("one home sewershed per agent", len(home) == manifest["numAgents"])
        check("home indices are valid or the Outside sentinel",
              bool(set(np.unique(home)).issubset(set(range(len(meta["sewersheds"]))) | {255})))
        check("resident counts in sewersheds.json match agent_home_shed.u8",
              all(int((home == i).sum()) == s["residents"]
                  for i, s in enumerate(meta["sewersheds"])))
```

- [ ] **Step 4: Run the verifier**

Run: `cd preprocess && python verify_bundle_v2.py --bundle ../app/public/data/dataset_sdc-10k --dataset ../dataset_sdc-10k --profile dataset_sdc-10k`
Expected: every check PASS, including the five new ones

- [ ] **Step 5: Document the flag**

In `README.md`'s `dataset_sdc-10k` build section, add `--shapefile-dir ../san_diego_shapefiles` to the documented command and note that omitting it produces a bundle with no sewershed layer.

- [ ] **Step 6: Commit**

```bash
git add preprocess/verify_bundle_v2.py README.md
git commit -m "feat: verify the sewershed sum invariants against the bundle"
```

---

### Task 7: App — types and loader

**Files:**
- Modify: `app/src/types2.ts`
- Modify: `app/src/data/loadBundleV2.ts`
- Test: `app/tests/loadBundleV2.test.ts`

**Interfaces:**
- Consumes: the artifacts from Task 5.
- Produces: `SewershedMeta` (`{ id, label, residents, venues, polygons: number[][][][] }`); `Sewersheds` (`{ kind: string; sheds: SewershedMeta[]; outside: { label: string; residents: number; venues: number }; ww: Float32Array; seir: Uint16Array; homeShed: Uint8Array; numBins: number; rows: number }`); `BundleV2.sewersheds?: Sewersheds` — **optional**, absent when the bundle has no sewershed artifacts.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/tests/loadBundleV2.test.ts
describe("sewersheds", () => {
  const SHED_FILES: Record<string, unknown> = {
    "sewersheds.json": {
      kind: "zcta-union",
      sewersheds: [
        { id: "encina", label: "Encina", residents: 2, venues: 3,
          polygons: [[[[0, 0], [0, 1], [1, 1], [0, 0]]]] },
      ],
      outside: { label: "Outside sewersheds", residents: 1, venues: 1 },
    },
    // 2 rows (1 shed + Outside) x 1 bin
    "sewershed_ww.bin": bin(new Float32Array([5, 7])),
    // 2 rows x 4 states x 1 bin
    "sewershed_seir.bin": bin(new Uint16Array([2, 0, 0, 0, 1, 0, 0, 0])),
    "agent_home_shed.u8": bin(new Uint8Array([0, 0, 255])),
  };
  const SHED_ARTIFACTS = {
    sewersheds: "sewersheds.json", sewershedWw: "sewershed_ww.bin",
    sewershedSeir: "sewershed_seir.bin", agentHomeShed: "agent_home_shed.u8",
  };

  it("decodes the sewershed artifacts when present", async () => {
    const manifest = {
      ...MANIFEST,
      artifacts: { ...ARTIFACTS, ...SHED_ARTIFACTS },
    };
    const b = await loadBundleV2("/data/t", fakeFetch({ "manifest.json": manifest, ...SHED_FILES }));
    expect(b.sewersheds).toBeDefined();
    expect(b.sewersheds!.sheds.map((s) => s.id)).toEqual(["encina"]);
    expect(b.sewersheds!.rows).toBe(2);        // one shed plus Outside
    expect(b.sewersheds!.numBins).toBe(1);
    expect(Array.from(b.sewersheds!.ww)).toEqual([5, 7]);
    expect(b.sewersheds!.outside.residents).toBe(1);
  });

  it("is undefined when the bundle declares no sewershed artifacts", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.sewersheds).toBeUndefined();
  });

  it("rejects a sewershed matrix whose length disagrees with the row count", async () => {
    const manifest = { ...MANIFEST, artifacts: { ...ARTIFACTS, ...SHED_ARTIFACTS } };
    const fetchFn = fakeFetch({
      "manifest.json": manifest, ...SHED_FILES,
      "sewershed_ww.bin": bin(new Float32Array([1, 2, 3])),   // not a multiple of rows
    });
    await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/sewershed_ww/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/loadBundleV2.test.ts`
Expected: FAIL — `b.sewersheds` is undefined in the first case

- [ ] **Step 3: Add the types**

Append to `app/src/types2.ts`:

```ts
export interface SewershedMeta {
  id: string;
  label: string;
  residents: number;
  venues: number;
  /** polygons -> rings -> [lon, lat]. Simplified for rendering only. */
  polygons: number[][][][];
}

export interface Sewersheds {
  /** Provenance of the boundaries; "zcta-union" means ZIP-code unions, not pipe networks. */
  kind: string;
  sheds: SewershedMeta[];
  outside: { label: string; residents: number; venues: number };
  /** float32 [row][bin], row-major. Rows are `sheds` order with Outside last. */
  ww: Float32Array;
  /** uint16 [row][state][bin], states ordered S, E, I, R. */
  seir: Uint16Array;
  /** One byte per agent, index-aligned with `agentIds`; 255 means Outside. */
  homeShed: Uint8Array;
  numBins: number;
  /** sheds.length + 1 — the extra row is Outside. */
  rows: number;
}
```

and add to `BundleV2`:

```ts
  /** Absent when the bundle ships no sewershed artifacts (e.g. dataset_00). */
  sewersheds?: Sewersheds;
```

- [ ] **Step 4: Load them**

In `loadBundleV2.ts`, after the existing artifacts are decoded, add:

```ts
  let sewersheds: Sewersheds | undefined;
  if (a.sewersheds) {
    const [metaRaw, wwBuf, seirBuf, homeBuf] = await Promise.all([
      json("sewersheds"), buf("sewershedWw"), buf("sewershedSeir"), buf("agentHomeShed"),
    ]);
    // The artifact's key is `sewersheds`; the in-memory field is `sheds`. Map it
    // explicitly rather than spreading, so the two names can never silently diverge.
    const meta = metaRaw as {
      kind: string;
      sewersheds: SewershedMeta[];
      outside: { label: string; residents: number; venues: number };
    };
    const rows = meta.sewersheds.length + 1;
    const ww = new Float32Array(wwBuf);
    if (ww.length % rows !== 0) {
      throw new Error(
        `sewershed_ww.bin has ${ww.length} values, not a multiple of ${rows} rows`,
      );
    }
    const numBins = ww.length / rows;
    const seir = new Uint16Array(seirBuf);
    assertEqual("sewershed_seir.bin", seir.length, rows * 4 * numBins);
    sewersheds = {
      kind: meta.kind,
      sheds: meta.sewersheds,
      outside: meta.outside,
      ww, seir, homeShed: new Uint8Array(homeBuf), numBins, rows,
    };
  }
```

Add `sewersheds` to the returned bundle object, and import `SewershedMeta` and `Sewersheds` from `../types2`.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd app && npx vitest run tests/loadBundleV2.test.ts && npx tsc --noEmit`
Expected: all pass, typecheck clean

- [ ] **Step 6: Commit**

```bash
git add app/src/types2.ts app/src/data/loadBundleV2.ts app/tests/loadBundleV2.test.ts
git commit -m "feat: load the optional sewershed artifacts"
```

---

### Task 8: App — scoped aggregates and the selector

**Files:**
- Create: `app/src/sim/sewershedScope.ts`
- Create: `app/src/ui/SewershedSelector.tsx`
- Modify: `app/src/ui/PlaybackV2.tsx`
- Modify: `app/src/ui/Hud.tsx`
- Modify: `app/src/App.css`
- Test: `app/tests/sewershedScope.test.ts`

**Interfaces:**
- Consumes: `Sewersheds`, `BundleV2` (Task 7); `Aggregates` from `types.ts`.
- Produces: `ALL_SCOPE = "all"`; `OUTSIDE_SCOPE = "outside"`; `type ScopeId = string`; `scopeOptions(bundle) -> { id: ScopeId; label: string; residents: number | null }[]`; `scopedAggregates(bundle, scope: ScopeId) -> Aggregates`; `scopeHeading(bundle, scope) -> string`.

`scopedAggregates` returns the bundle's own `aggregates` object unchanged for `ALL_SCOPE`, so the default path is byte-identical to today. For a sewershed it builds a new `Aggregates` with the same `cadenceSec`, `startTime`, `gridTicks` and `seirSampledAt`, but per-shed series — which is why `SeirChart` and `WastewaterChart` need no changes.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/sewershedScope.test.ts
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
  it("names the scope and its resident count", () => {
    expect(scopeHeading(makeBundle(), "encina")).toMatch(/Encina.*6/);
  });

  it("says nothing extra for All", () => {
    expect(scopeHeading(makeBundle(), ALL_SCOPE)).toMatch(/all/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/sewershedScope.test.ts`
Expected: FAIL — cannot resolve `../src/sim/sewershedScope`

- [ ] **Step 3: Write the implementation**

```ts
// app/src/sim/sewershedScope.ts
import type { Aggregates } from "../types";
import type { BundleV2 } from "../types2";

export const ALL_SCOPE = "all";
export const OUTSIDE_SCOPE = "outside";

export type ScopeId = string;

export interface ScopeOption {
  id: ScopeId;
  label: string;
  /** Resident agents in this scope, or null for All. */
  residents: number | null;
}

const STATES = ["S", "E", "I", "R"] as const;

export function scopeOptions(bundle: BundleV2): ScopeOption[] {
  const opts: ScopeOption[] = [{ id: ALL_SCOPE, label: "All", residents: null }];
  const s = bundle.sewersheds;
  if (!s) return opts;
  for (const shed of s.sheds) {
    opts.push({ id: shed.id, label: shed.label, residents: shed.residents });
  }
  opts.push({ id: OUTSIDE_SCOPE, label: s.outside.label, residents: s.outside.residents });
  return opts;
}

/** Row index for a scope, or -1 for All / unknown. */
function rowFor(bundle: BundleV2, scope: ScopeId): number {
  const s = bundle.sewersheds;
  if (!s || scope === ALL_SCOPE) return -1;
  if (scope === OUTSIDE_SCOPE) return s.rows - 1;
  const i = s.sheds.findIndex((shed) => shed.id === scope);
  return i;
}

/**
 * The aggregates the charts should draw for `scope`.
 *
 * For All this is the bundle's own object, returned by reference — the default
 * view stays exactly what it was before sewersheds existed. For a sewershed it
 * is a fresh `Aggregates` with the same time axis and that shed's own series,
 * which is what lets `SeirChart` and `WastewaterChart` stay unchanged.
 */
export function scopedAggregates(bundle: BundleV2, scope: ScopeId): Aggregates {
  const s = bundle.sewersheds;
  const row = rowFor(bundle, scope);
  if (!s || row < 0) return bundle.aggregates;

  const { numBins } = s;
  const inflow = Array.from(s.ww.subarray(row * numBins, (row + 1) * numBins));
  const seir = {} as Aggregates["seir"];
  STATES.forEach((name, si) => {
    const start = (row * 4 + si) * numBins;
    seir[name] = Array.from(s.seir.subarray(start, start + numBins));
  });
  return {
    ...bundle.aggregates,
    seir,
    pathogenInflow: inflow,
  };
}

/** Chart heading that states the scope and how many people it covers. */
export function scopeHeading(bundle: BundleV2, scope: ScopeId): string {
  const opt = scopeOptions(bundle).find((o) => o.id === scope);
  if (!opt || opt.id === ALL_SCOPE) return "all sewersheds";
  return `${opt.label} (${opt.residents!.toLocaleString()} residents)`;
}
```

- [ ] **Step 4: Write the selector component**

```tsx
// app/src/ui/SewershedSelector.tsx
import type { ScopeId, ScopeOption } from "../sim/sewershedScope";

/**
 * Scope control for the HUD charts. Rendered only when the bundle has
 * sewersheds, so `dataset_00` never sees it.
 */
export function SewershedSelector({
  options, selected, onChange, kind,
}: {
  options: ScopeOption[];
  selected: ScopeId;
  onChange: (id: ScopeId) => void;
  kind: string;
}) {
  return (
    <div className="shed-selector">
      <div className="shed-selector-label">
        Sewershed
        {kind === "zcta-union" && (
          <span
            className="shed-selector-note"
            title="Boundaries are unions of Census ZIP Code Tabulation Areas, not pipe networks."
          >
            {" "}· ZIP-code approximation
          </span>
        )}
      </div>
      <div className="shed-selector-options">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={o.id === selected ? "shed-chip shed-chip-on" : "shed-chip"}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

Add to `app/src/App.css`:

```css
.shed-selector { position: absolute; left: 10px; bottom: 64px; z-index: 3; max-width: 220px;
  background: rgba(20,20,26,0.72); border-radius: 12px; color: #eee;
  backdrop-filter: blur(6px); padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; }
.shed-selector-label { font: 700 10px system-ui; letter-spacing: 0.05em;
  text-transform: uppercase; opacity: 0.6; }
.shed-selector-note { text-transform: none; letter-spacing: 0; }
.shed-selector-options { display: flex; flex-wrap: wrap; gap: 4px; }
.shed-chip { border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.08);
  color: #eee; border-radius: 999px; padding: 3px 9px; font: 600 11px system-ui; cursor: pointer; }
.shed-chip-on { background: #e0e0e8; color: #16161c; border-color: #e0e0e8; }
```

- [ ] **Step 5: Wire into PlaybackV2 and Hud**

In `PlaybackV2.tsx`'s `ReadyV2`: add `const [scope, setScope] = useState<ScopeId>(ALL_SCOPE);`, compute `const options = useMemo(() => scopeOptions(bundle), [bundle]);` and `const agg = useMemo(() => scopedAggregates(bundle, scope), [bundle, scope]);`, pass `agg={agg}` to `Hud` instead of `bundle.aggregates`, pass `scopeLine={scopeHeading(bundle, scope)}`, and render `{bundle.sewersheds && <SewershedSelector options={options} selected={scope} onChange={setScope} kind={bundle.sewersheds.kind} />}`.

In `Hud.tsx`: accept an optional `scopeLine?: string` and render it under the coverage line as `<div className="hud-scope">Showing {scopeLine}</div>` when present. Add `.hud-scope { font: 600 11px system-ui; opacity: 0.75; }` to `App.css`.

- [ ] **Step 6: Run the suite, typecheck and build**

Run: `cd app && npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests pass, typecheck clean, build succeeds

- [ ] **Step 7: Commit**

```bash
git add app/src/sim/sewershedScope.ts app/src/ui/SewershedSelector.tsx app/src/ui/PlaybackV2.tsx app/src/ui/Hud.tsx app/src/App.css app/tests/sewershedScope.test.ts
git commit -m "feat: re-scope the HUD charts to a selected sewershed"
```

---

### Task 9: App — the sewershed boundary layer

**Files:**
- Modify: `app/src/render/layersV2.ts`
- Modify: `app/src/ui/MapViewV2.tsx`
- Modify: `app/src/ui/LayerToggles.tsx`
- Modify: `app/src/ui/PlaybackV2.tsx`
- Test: `app/tests/layersV2.test.ts`

**Interfaces:**
- Consumes: `Sewersheds` (Task 7), `ScopeId`/`ALL_SCOPE`/`OUTSIDE_SCOPE` (Task 8).
- Produces: `sewershedPolygonData(sewersheds) -> SewershedPolygonDatum[]` where `SewershedPolygonDatum` is `{ id: string; label: string; rings: number[][][] }` (one entry per polygon, so a multipolygon shed contributes several); `makeSewershedLayer(data, selectedId, onSelect)`.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/tests/layersV2.test.ts
import { sewershedPolygonData } from "../src/render/layersV2";
import type { Sewersheds } from "../src/types2";

function sheds(): Sewersheds {
  return {
    kind: "zcta-union",
    sheds: [
      { id: "a", label: "A", residents: 1, venues: 1,
        polygons: [[[[0, 0], [0, 1], [1, 1], [0, 0]]], [[[5, 5], [5, 6], [6, 6], [5, 5]]]] },
      { id: "b", label: "B", residents: 1, venues: 1,
        polygons: [[[[9, 9], [9, 10], [10, 10], [9, 9]]]] },
    ],
    outside: { label: "Outside sewersheds", residents: 0, venues: 0 },
    ww: new Float32Array(), seir: new Uint16Array(),
    homeShed: new Uint8Array(), numBins: 0, rows: 3,
  };
}

describe("sewershedPolygonData", () => {
  it("emits one datum per polygon, tagged with its sewershed", () => {
    const data = sewershedPolygonData(sheds());
    expect(data).toHaveLength(3);                       // A has two polygons, B one
    expect(data.map((d) => d.id)).toEqual(["a", "a", "b"]);
    expect(data[0].label).toBe("A");
  });

  it("keeps rings intact so holes survive to the renderer", () => {
    const withHole = sheds();
    withHole.sheds[1].polygons = [[
      [[0, 0], [0, 10], [10, 10], [0, 0]],
      [[4, 4], [4, 5], [5, 5], [4, 4]],
    ]];
    const data = sewershedPolygonData(withHole);
    const b = data.find((d) => d.id === "b")!;
    expect(b.rings).toHaveLength(2);
  });

  it("returns nothing for a bundle with no sewersheds", () => {
    expect(sewershedPolygonData(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/layersV2.test.ts`
Expected: FAIL — `sewershedPolygonData` is not exported

- [ ] **Step 3: Write the implementation**

Append to `app/src/render/layersV2.ts`:

```ts
export interface SewershedPolygonDatum {
  id: string;
  label: string;
  /** rings -> [lon, lat]; ring 0 is the exterior, any others are holes. */
  rings: number[][][];
}

/**
 * One datum per polygon rather than per sewershed, because deck.gl's PolygonLayer
 * takes a single polygon (with optional holes) per row. A sewershed made of
 * several disjoint pieces contributes several rows sharing its id.
 */
export function sewershedPolygonData(
  sewersheds: Sewersheds | undefined,
): SewershedPolygonDatum[] {
  if (!sewersheds) return [];
  const out: SewershedPolygonDatum[] = [];
  for (const shed of sewersheds.sheds) {
    for (const rings of shed.polygons) {
      out.push({ id: shed.id, label: shed.label, rings });
    }
  }
  return out;
}

export function makeSewershedLayer(
  data: SewershedPolygonDatum[],
  selectedId: string,
  onSelect: (id: string) => void,
) {
  return new PolygonLayer<SewershedPolygonDatum>({
    id: "sewersheds",
    data,
    getPolygon: (d) => d.rings,
    // Selected shed reads as filled; the others are outline-first so they never
    // compete with the agents underneath.
    getFillColor: (d) =>
      d.id === selectedId ? [120, 170, 235, 60] : [120, 170, 235, 18],
    getLineColor: (d) =>
      d.id === selectedId ? [150, 200, 255, 235] : [140, 180, 230, 120],
    getLineWidth: (d) => (d.id === selectedId ? 3 : 1.5),
    lineWidthUnits: "pixels",
    stroked: true,
    filled: true,
    pickable: true,
    onClick: (info) => {
      const d = info.object as SewershedPolygonDatum | undefined;
      if (d) onSelect(d.id);
    },
    updateTriggers: {
      getFillColor: selectedId, getLineColor: selectedId, getLineWidth: selectedId,
    },
  });
}
```

Import `Sewersheds` from `../types2` in that file.

- [ ] **Step 4: Wire the layer and its toggle**

In `LayerToggles.tsx` add `sewersheds: boolean` to `LayerFlags`, `sewersheds: "Sewersheds"` to `LAYER_LABELS`, and `"sewersheds"` to the `items` array (place it after `"wastewater"`).

In `PlaybackV2.tsx` add `sewersheds: true` to the initial `flags` — the boundaries are cheap (a handful of polygons) and are the point of this feature — and pass `scope`, `setScope` and `sewersheds` down to `MapViewV2`.

In `MapViewV2.tsx` accept `sewersheds`, `scope` and `onSelectScope` props and add, **before** the agent layers so boundaries sit under the agents:

```tsx
  if (flags.sewersheds && bundle.sewersheds) {
    layers.push(makeSewershedLayer(
      sewershedPolygonData(bundle.sewersheds), scope, onSelectScope,
    ));
  }
```

- [ ] **Step 5: Run the suite, typecheck and build**

Run: `cd app && npx vitest run && npx tsc --noEmit && npm run build`
Expected: all pass

- [ ] **Step 6: Verify in the browser**

Run `cd app && npm run dev` and confirm, concretely:

- the three boundaries draw over San Diego and roughly match the coastline and inland extent
- clicking Point Loma selects it: the chip highlights, both charts change, and the heading reads its resident count (6,420)
- selecting South Bay shows a visibly noisier wastewater curve than its case curve — the mismatch this feature exists to show
- switching to `All` restores the original curves
- switching the dataset to Atlanta hides the selector and the Sewersheds toggle entirely

Save a screenshot of a selected sewershed to the scratchpad. If any of these is wrong, report it rather than adjusting the expectation.

- [ ] **Step 7: Commit**

```bash
git add app/src/render/layersV2.ts app/src/ui/MapViewV2.tsx app/src/ui/LayerToggles.tsx app/src/ui/PlaybackV2.tsx app/tests/layersV2.test.ts
git commit -m "feat: draw sewershed boundaries and select one by clicking"
```

---

## Notes for the implementer

- **The sum invariant is the point.** If per-shed rows stop summing to the global series, something is being dropped or double-counted — do not relax the tolerance to make it pass.
- **Never simplify before assigning.** `simplified_rings` exists for the browser only.
- **Wastewater is assigned by event location, residence by home.** They are different questions; sharing a rule would silently answer the wrong one.
- Atlanta (`dataset_00`) has no sewersheds. Every new UI element must be conditional on `bundle.sewersheds` existing.
- The preprocessor does not clean its output directory, so delete the bundle directory before a full rebuild.
