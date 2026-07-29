# dataset_sdc-10k Dwell-Time Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play back the 10,000-agent San Diego simulation run in the existing Poop SimCity visualizer, with agents dwelling at venues for their real check-in→check-out durations.

**Architecture:** A new bundle format (schemaVersion 2) written by a streaming Python preprocessor that never materializes a full parquet file, consumed by the existing Vite/React/deck.gl app through a new loader. Agent tracks become `(checkInTick, dwellTicks, venueIndex)` triples referencing a shared venue table, which halves their size and makes dwell explicit. The `dataset_00` v1 pipeline keeps working unchanged behind a dataset-profile indirection.

**Tech Stack:** Python 3.12 + pyarrow/pandas/numpy (preprocessor, pytest); TypeScript + React 18 + deck.gl 9 + MapLibre + uPlot (app, vitest).

## Global Constraints

- **Playback window:** `2024-01-01T00:00:00` → `2024-07-31T23:55:00` inclusive, 213 days, **61,344 ticks** at 300 s per tick. Highest tick index is 61,343.
- **All tick, dwell and venue-index fields are `uint16`.** The preprocessor must raise `ValueError` — never truncate — if any value exceeds 65,535. This is what makes the window bound load-bearing.
- **All 10,000 agents are included.** No population subsampling.
- **Binary artifacts are little-endian struct-of-arrays**, one file per field, so the browser wraps each buffer in a typed array with no per-record loop.
- **Venue index** is assigned by ascending `venue_id`. 12,134 venues.
- **Clean-poop downsampling affects only the render stream.** `pathogenInflow` and the wastewater grid are computed from every in-window event, pre-downsampling. Default `clean_keep_fraction = 0.3`.
- **`dataset_00` output must not change.** Its bundle stays schemaVersion 1 and byte-identical.
- **Jitter radius is 30 m**, derived purely from `agentId`.
- Venue types in fixed order `["Apartment", "Workplace", "Restaurant", "Pub"]`; disease codes `S=0, E=1, I=2, R=3`.
- Source data lives at `dataset_sdc-10k/` (gitignored); the bundle is written to `app/public/data/dataset_sdc-10k/`.
- Run pytest from `preprocess/` (`pytest.ini` sets `pythonpath = .`); run vitest from `app/` (`npm test`).

---

### Task 1: Dataset profiles

Replaces hardcoded filenames and column names with one descriptor per run, so both datasets share the same code paths.

**Files:**
- Create: `preprocess/poop_simcity_preprocess/profiles.py`
- Modify: `preprocess/poop_simcity_preprocess/build.py`
- Modify: `preprocess/poop_simcity_preprocess/disease.py`
- Test: `preprocess/tests/test_profiles.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `DatasetProfile` dataclass with fields `name: str`, `schema_version: int`, `checkin_file: str`, `disease_file: str`, `poop_file: str`, `source_agent_col: str`, `checkout_col: str | None`; `get_profile(name: str) -> DatasetProfile`; module constants `DATASET_00` and `SDC_10K`.

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_profiles.py
import pytest
from poop_simcity_preprocess.profiles import DATASET_00, SDC_10K, get_profile


def test_dataset_00_profile_matches_v1_layout():
    p = get_profile("dataset_00")
    assert p is DATASET_00
    assert p.schema_version == 1
    assert p.checkin_file == "check_in"
    assert p.disease_file == "disease_status"
    assert p.poop_file == "poop_in"
    assert p.source_agent_col == "source_agent_id"
    assert p.checkout_col is None


def test_sdc_10k_profile_has_checkout_and_capitalised_names():
    p = get_profile("dataset_sdc-10k")
    assert p is SDC_10K
    assert p.schema_version == 2
    assert p.checkin_file == "Checkin"
    assert p.disease_file == "DiseasesStatus"
    assert p.poop_file == "Poopin"
    assert p.source_agent_col == "SourceAgentId"
    assert p.checkout_col == "CheckoutTime"


def test_unknown_profile_lists_known_names():
    with pytest.raises(ValueError, match="dataset_sdc-10k"):
        get_profile("nope")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd preprocess && python -m pytest tests/test_profiles.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.profiles'`

- [ ] **Step 3: Write minimal implementation**

```python
# preprocess/poop_simcity_preprocess/profiles.py
"""Per-run descriptions of file and column naming.

The two simulation runs shipped with this project name the same logical tables
differently, so every reader takes a profile instead of hardcoding names.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class DatasetProfile:
    name: str
    schema_version: int
    checkin_file: str
    disease_file: str
    poop_file: str
    source_agent_col: str
    checkout_col: str | None


DATASET_00 = DatasetProfile(
    name="dataset_00",
    schema_version=1,
    checkin_file="check_in",
    disease_file="disease_status",
    poop_file="poop_in",
    source_agent_col="source_agent_id",
    checkout_col=None,
)

SDC_10K = DatasetProfile(
    name="dataset_sdc-10k",
    schema_version=2,
    checkin_file="Checkin",
    disease_file="DiseasesStatus",
    poop_file="Poopin",
    source_agent_col="SourceAgentId",
    checkout_col="CheckoutTime",
)

PROFILES = {p.name: p for p in (DATASET_00, SDC_10K)}


def get_profile(name: str) -> DatasetProfile:
    try:
        return PROFILES[name]
    except KeyError:
        known = ", ".join(sorted(PROFILES))
        raise ValueError(f"Unknown dataset profile {name!r}; known profiles are {known}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd preprocess && python -m pytest tests/test_profiles.py -v`
Expected: 3 passed

- [ ] **Step 5: Thread the profile through the v1 build so it keeps working**

In `build.py`, change `_read` and `build_bundle` to take a profile. `build_disease` in `disease.py` and `build_transmissions` must use `profile.source_agent_col` instead of the literal `"source_agent_id"`.

```python
# build.py — replace the module-level _read and the top of build_bundle
from .profiles import DATASET_00, DatasetProfile


def _read(dataset_dir, name):
    return pq.read_table(os.path.join(dataset_dir, f"{name}.parquet")).to_pandas()


def build_bundle(dataset_dir, out_dir, run_id="dataset_00",
                 clean_keep_fraction=1.0, cell_size_deg=0.02,
                 profile: DatasetProfile = DATASET_00):
    os.makedirs(out_dir, exist_ok=True)

    check_in = _read(dataset_dir, profile.checkin_file)
    disease_df = _read(dataset_dir, profile.disease_file)
    poop_df = _read(dataset_dir, profile.poop_file)
```

Then change the disease call site to `build_disease(disease_df, start_time, profile.source_agent_col)`.

```python
# disease.py — signature changes only; body logic unchanged
def build_transmissions(disease_df, start_time, source_col="source_agent_id"):
    df = disease_df[
        (disease_df["disease_status"] == "Exposed")
        & (disease_df[source_col] != -1)
    ].copy()
    if df.empty:
        return []
    df["tick"] = time_to_tick(df["time"], start_time)
    df = df.sort_values("tick", kind="stable").groupby("agent_id", as_index=False).first()
    df = df.sort_values("tick", kind="stable")
    return [
        [int(t), int(src), int(aid)]
        for t, src, aid in zip(df["tick"], df[source_col], df["agent_id"])
    ]


def build_disease(disease_df, start_time, source_col="source_agent_id"):
    transitions = build_transitions(disease_df, start_time)
    samples = build_pathogen_samples(disease_df, start_time)
    transmissions = build_transmissions(disease_df, start_time, source_col)
    agents = [
        {
            "agentId": aid,
            "transitions": transitions[aid],
            "pathogenSamples": samples.get(aid, []),
        }
        for aid in sorted(transitions)
    ]
    return {
        "stateCodes": dict(STATE_CODE_NAMES),
        "agents": agents,
        "transmissions": transmissions,
    }
```

- [ ] **Step 6: Verify the whole existing suite still passes**

Run: `cd preprocess && python -m pytest -v`
Expected: all previously passing tests still pass, including `test_build_integration.py` and `test_disease.py`

- [ ] **Step 7: Commit**

```bash
git add preprocess/poop_simcity_preprocess/profiles.py preprocess/poop_simcity_preprocess/build.py preprocess/poop_simcity_preprocess/disease.py preprocess/tests/test_profiles.py
git commit -m "refactor: describe dataset file/column naming with profiles"
```

---

### Task 2: Playback window and uint16 guards

Every later task converts timestamps to ticks and asserts they fit `uint16`. This centralizes both.

**Files:**
- Create: `preprocess/poop_simcity_preprocess/window.py`
- Test: `preprocess/tests/test_window.py`

**Interfaces:**
- Consumes: `TICK_INTERVAL_SEC` from `constants.py`.
- Produces: `Window` frozen dataclass with `start: pd.Timestamp`, `end: pd.Timestamp`, `num_ticks: int`; `make_window(start, end) -> Window`; `ticks_of(times: pd.Series, window: Window) -> np.ndarray` (int64); `mask_in_window(times: pd.Series, window: Window) -> np.ndarray` (bool); `to_u16(arr: np.ndarray, label: str) -> np.ndarray` (uint16, raises on overflow).

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_window.py
import numpy as np
import pandas as pd
import pytest

from poop_simcity_preprocess.window import (
    make_window, mask_in_window, ticks_of, to_u16,
)


def test_window_tick_count_is_inclusive_of_the_last_tick():
    w = make_window("2024-01-01 00:00:00", "2024-01-01 00:55:00")
    assert w.num_ticks == 12          # 00:00 .. 00:55 inclusive, 5-minute steps


def test_production_window_is_61344_ticks_and_fits_u16():
    w = make_window("2024-01-01 00:00:00", "2024-07-31 23:55:00")
    assert w.num_ticks == 61344
    assert w.num_ticks - 1 <= 65535


def test_ticks_of_floors_to_the_containing_tick():
    w = make_window("2024-01-01 00:00:00", "2024-01-01 00:55:00")
    t = ticks_of(pd.to_datetime(pd.Series(
        ["2024-01-01 00:00:00", "2024-01-01 00:04:59", "2024-01-01 00:05:00"])), w)
    assert t.tolist() == [0, 0, 1]


def test_mask_in_window_excludes_both_ends_correctly():
    w = make_window("2024-01-01 00:00:00", "2024-01-01 00:55:00")
    times = pd.to_datetime(pd.Series([
        "2023-12-31 23:55:00",   # before
        "2024-01-01 00:00:00",   # first tick
        "2024-01-01 00:55:00",   # last tick
        "2024-01-01 01:00:00",   # past the end
    ]))
    assert mask_in_window(times, w).tolist() == [False, True, True, False]


def test_to_u16_round_trips_in_range_values():
    out = to_u16(np.array([0, 61343, 65535]), "tick")
    assert out.dtype == np.uint16
    assert out.tolist() == [0, 61343, 65535]


def test_to_u16_raises_on_overflow_naming_the_field():
    with pytest.raises(ValueError, match="tick"):
        to_u16(np.array([0, 65536]), "tick")


def test_to_u16_raises_on_negative():
    with pytest.raises(ValueError, match="dwell"):
        to_u16(np.array([-1, 5]), "dwell")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd preprocess && python -m pytest tests/test_window.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.window'`

- [ ] **Step 3: Write minimal implementation**

```python
# preprocess/poop_simcity_preprocess/window.py
"""Playback window arithmetic and the uint16 encoding guard.

Bundle v2 stores ticks, dwell lengths and venue indices as uint16, which is only
safe while the window stays under 65,536 ticks. `to_u16` is the single place that
enforces it, and it raises rather than truncating: a silently wrapped tick would
put agents in the wrong place with no visible error.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .constants import TICK_INTERVAL_SEC

U16_MAX = 65535


@dataclass(frozen=True)
class Window:
    start: pd.Timestamp
    end: pd.Timestamp        # timestamp of the last included tick, inclusive
    num_ticks: int


def make_window(start, end) -> Window:
    start = pd.Timestamp(start)
    end = pd.Timestamp(end)
    if end < start:
        raise ValueError(f"window end {end} precedes start {start}")
    span = (end - start).total_seconds()
    return Window(start=start, end=end, num_ticks=int(span // TICK_INTERVAL_SEC) + 1)


def ticks_of(times, window: Window) -> np.ndarray:
    delta = pd.to_datetime(times) - window.start
    return (delta.dt.total_seconds() // TICK_INTERVAL_SEC).to_numpy(dtype="int64")


def mask_in_window(times, window: Window) -> np.ndarray:
    t = pd.to_datetime(times)
    return ((t >= window.start) & (t <= window.end)).to_numpy(dtype=bool)


def to_u16(arr: np.ndarray, label: str) -> np.ndarray:
    arr = np.asarray(arr)
    if arr.size:
        hi = int(arr.max())
        lo = int(arr.min())
        if hi > U16_MAX or lo < 0:
            raise ValueError(
                f"{label} out of uint16 range: min={lo} max={hi} "
                f"(limit {U16_MAX}); narrow the playback window"
            )
    return arr.astype(np.uint16)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd preprocess && python -m pytest tests/test_window.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/window.py preprocess/tests/test_window.py
git commit -m "feat: playback window arithmetic with uint16 encoding guard"
```

---

### Task 3: Venue table

The shared table every agent stay references. Built by streaming the check-in file, because it is 134 MB and only four columns are needed.

**Files:**
- Create: `preprocess/poop_simcity_preprocess/venues.py`
- Test: `preprocess/tests/test_venues.py`

**Interfaces:**
- Consumes: `DatasetProfile` (Task 1), `VENUE_TYPE_TO_ID` from `constants.py`.
- Produces: `build_venue_table(dataset_dir, profile, batch_size=2_000_000) -> pandas.DataFrame` with columns `venue_id, venue_type, latitude, longitude` sorted ascending by `venue_id`, `RangeIndex` giving the venue index; `venue_index_map(venues) -> dict[int, int]`; `venue_arrays(venues) -> dict[str, numpy.ndarray]` keyed by artifact filename.

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_venues.py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.venues import (
    build_venue_table, venue_arrays, venue_index_map,
)


def _write_checkin(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "CheckoutTime", "venue_id", "venue_type",
        "latitude", "longitude",
    ])
    df["time"] = pd.to_datetime(df["time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Checkin.parquet")


def test_venue_table_is_deduped_and_sorted_by_venue_id(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 7, "Pub", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 3, "Apartment", 32.8, -117.2),
        (0, "2024-01-01 00:15:00", "2024-01-01 00:20:00", 7, "Pub", 32.7, -117.1),
    ])
    v = build_venue_table(str(tmp_path), SDC_10K, batch_size=2)
    assert v["venue_id"].tolist() == [3, 7]
    assert v["venue_type"].tolist() == ["Apartment", "Pub"]
    assert list(v.index) == [0, 1]


def test_venue_index_map_points_at_row_positions(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 7, "Pub", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 3, "Apartment", 32.8, -117.2),
    ])
    v = build_venue_table(str(tmp_path), SDC_10K)
    assert venue_index_map(v) == {3: 0, 7: 1}


def test_venue_arrays_have_the_expected_dtypes_and_order(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 7, "Pub", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 00:10:00", 3, "Apartment", 32.8, -117.2),
    ])
    a = venue_arrays(build_venue_table(str(tmp_path), SDC_10K))
    assert a["venues_id.i32"].dtype == np.int32
    assert a["venues_id.i32"].tolist() == [3, 7]
    assert a["venues_type.u8"].tolist() == [0, 3]        # Apartment=0, Pub=3
    assert a["venues_lon.f32"].dtype == np.float32
    np.testing.assert_allclose(a["venues_lat.f32"], [32.8, 32.7], rtol=1e-6)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd preprocess && python -m pytest tests/test_venues.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.venues'`

- [ ] **Step 3: Write minimal implementation**

```python
# preprocess/poop_simcity_preprocess/venues.py
"""The shared venue table that agent stays reference by index.

Built by streaming the check-in file: it is the only place venue geometry
appears, and `venue_id -> (type, lat, lon)` is single-valued in both runs, so the
first sighting of each id wins.
"""

import os

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from .constants import VENUE_TYPE_TO_ID

VENUE_COLUMNS = ["venue_id", "venue_type", "latitude", "longitude"]


def build_venue_table(dataset_dir, profile, batch_size=2_000_000) -> pd.DataFrame:
    path = os.path.join(dataset_dir, f"{profile.checkin_file}.parquet")
    seen = {}
    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=VENUE_COLUMNS):
        df = batch.to_pandas()
        df = df.drop_duplicates("venue_id")
        for vid, vtype, lat, lon in zip(df["venue_id"], df["venue_type"],
                                        df["latitude"], df["longitude"]):
            seen.setdefault(int(vid), (str(vtype), float(lat), float(lon)))

    rows = [(vid, *seen[vid]) for vid in sorted(seen)]
    return pd.DataFrame(rows, columns=VENUE_COLUMNS)


def venue_index_map(venues: pd.DataFrame) -> dict:
    return {int(v): i for i, v in enumerate(venues["venue_id"])}


def venue_arrays(venues: pd.DataFrame) -> dict:
    return {
        "venues_id.i32": venues["venue_id"].to_numpy(dtype=np.int32),
        "venues_lon.f32": venues["longitude"].to_numpy(dtype=np.float32),
        "venues_lat.f32": venues["latitude"].to_numpy(dtype=np.float32),
        "venues_type.u8": venues["venue_type"].map(VENUE_TYPE_TO_ID)
                                              .to_numpy(dtype=np.uint8),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd preprocess && python -m pytest tests/test_venues.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/venues.py preprocess/tests/test_venues.py
git commit -m "feat: streaming venue table keyed by ascending venue_id"
```

---

### Task 4: Agent stays with dwell

The core new artifact. Each check-in becomes `(checkInTick, dwellTicks, venueIndex)`.

**Files:**
- Create: `preprocess/poop_simcity_preprocess/stays.py`
- Test: `preprocess/tests/test_stays.py`

**Interfaces:**
- Consumes: `Window`, `ticks_of`, `mask_in_window`, `to_u16` (Task 2); `DatasetProfile` (Task 1); `venue_index_map` output (Task 3).
- Produces: `build_stays(dataset_dir, profile, window, venue_index, batch_size=2_000_000) -> tuple[dict[str, numpy.ndarray], list[dict]]`. The dict is keyed by artifact filename (`stays_tick.u16`, `stays_dwell.u16`, `stays_venue.u16`); the list is `[{"agentId": int, "offset": int, "count": int}, …]` in ascending `agentId`, with offsets in record units.

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_stays.py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.stays import build_stays
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 23:55:00")   # 288 ticks


def _write_checkin(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "CheckoutTime", "venue_id", "venue_type",
        "latitude", "longitude",
    ])
    df["time"] = pd.to_datetime(df["time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Checkin.parquet")


def test_dwell_is_the_checkout_minus_checkin_in_ticks(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, index = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    assert arrays["stays_tick.u16"].tolist() == [0]
    assert arrays["stays_dwell.u16"].tolist() == [12]        # 60 min / 5 min
    assert arrays["stays_venue.u16"].tolist() == [0]
    assert index == [{"agentId": 0, "offset": 0, "count": 1}]


def test_records_are_sorted_by_agent_then_tick_with_matching_index(tmp_path):
    _write_checkin(tmp_path, [
        (1, "2024-01-01 02:00:00", "2024-01-01 02:30:00", 7, "Pub", 32.7, -117.1),
        (0, "2024-01-01 01:00:00", "2024-01-01 01:30:00", 5, "Apartment", 32.8, -117.2),
        (0, "2024-01-01 00:00:00", "2024-01-01 00:30:00", 7, "Pub", 32.7, -117.1),
    ])
    arrays, index = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0, 7: 1}, batch_size=2)
    assert arrays["stays_tick.u16"].tolist() == [0, 12, 24]
    assert arrays["stays_venue.u16"].tolist() == [1, 0, 1]
    assert index == [
        {"agentId": 0, "offset": 0, "count": 2},
        {"agentId": 1, "offset": 2, "count": 1},
    ]


def test_stay_running_past_the_window_end_is_clipped(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 23:00:00", "2024-01-03 00:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, _ = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    # check-in at tick 276; window's last tick is 287, so dwell clips to 12.
    assert arrays["stays_tick.u16"].tolist() == [276]
    assert arrays["stays_dwell.u16"].tolist() == [12]


def test_stays_outside_the_window_are_dropped_and_agents_may_vanish(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-02-01 00:00:00", "2024-02-01 01:00:00", 5, "Apartment", 32.7, -117.1),
        (1, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, index = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    assert [e["agentId"] for e in index] == [1]
    assert len(arrays["stays_tick.u16"]) == 1


def test_dwell_is_at_least_one_tick(tmp_path):
    # A checkout in the same tick as the check-in must still occupy the venue.
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 00:02:00", 5, "Apartment", 32.7, -117.1),
    ])
    arrays, _ = build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})
    assert arrays["stays_dwell.u16"].tolist() == [1]


def test_unknown_venue_id_raises(tmp_path):
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 999, "Pub", 32.7, -117.1),
    ])
    with pytest.raises(ValueError, match="999"):
        build_stays(str(tmp_path), SDC_10K, WINDOW, {5: 0})


def test_missing_checkout_column_raises(tmp_path):
    from poop_simcity_preprocess.profiles import DATASET_00
    _write_checkin(tmp_path, [
        (0, "2024-01-01 00:00:00", "2024-01-01 01:00:00", 5, "Apartment", 32.7, -117.1),
    ])
    with pytest.raises(ValueError, match="check-out"):
        build_stays(str(tmp_path), DATASET_00, WINDOW, {5: 0})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd preprocess && python -m pytest tests/test_stays.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.stays'`

- [ ] **Step 3: Write minimal implementation**

```python
# preprocess/poop_simcity_preprocess/stays.py
"""Agent stays: one record per check-in, carrying its dwell length.

Streamed per batch into small int64 blocks, concatenated once, then sorted by
(agent, tick). The concatenated form is ~140 MB for the production run, which is
affordable; a per-agent Python list of 8.7M tuples would not be.
"""

import os

import numpy as np
import pyarrow.parquet as pq

from .window import mask_in_window, ticks_of, to_u16


def build_stays(dataset_dir, profile, window, venue_index, batch_size=2_000_000):
    if profile.checkout_col is None:
        raise ValueError(
            f"profile {profile.name!r} has no check-out column; "
            "dwell-based stays need one"
        )

    path = os.path.join(dataset_dir, f"{profile.checkin_file}.parquet")
    columns = ["agent_id", "time", profile.checkout_col, "venue_id"]
    last_tick = window.num_ticks - 1
    blocks = []

    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=columns):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        if df.empty:
            continue

        unknown = set(df["venue_id"].unique()) - set(venue_index)
        if unknown:
            raise ValueError(
                f"check-in references venue_id(s) absent from the venue table: "
                f"{sorted(unknown)[:5]}"
            )

        tick = ticks_of(df["time"], window)
        checkout_tick = ticks_of(df[profile.checkout_col], window)
        dwell = np.clip(checkout_tick - tick, 1, None)
        dwell = np.minimum(dwell, last_tick - tick + 1)
        venue = df["venue_id"].map(venue_index).to_numpy(dtype="int64")

        blocks.append(np.stack(
            [df["agent_id"].to_numpy(dtype="int64"), tick, dwell, venue], axis=1))

    if not blocks:
        empty = np.zeros(0, dtype=np.uint16)
        return ({"stays_tick.u16": empty, "stays_dwell.u16": empty.copy(),
                 "stays_venue.u16": empty.copy()}, [])

    rows = np.concatenate(blocks)
    rows = rows[np.lexsort((rows[:, 1], rows[:, 0]))]

    agent_ids, counts = np.unique(rows[:, 0], return_counts=True)
    offsets = np.concatenate(([0], np.cumsum(counts)[:-1]))
    index = [
        {"agentId": int(a), "offset": int(o), "count": int(c)}
        for a, o, c in zip(agent_ids, offsets, counts)
    ]

    return ({
        "stays_tick.u16": to_u16(rows[:, 1], "stay tick"),
        "stays_dwell.u16": to_u16(rows[:, 2], "stay dwell"),
        "stays_venue.u16": to_u16(rows[:, 3], "stay venue index"),
    }, index)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd preprocess && python -m pytest tests/test_stays.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/stays.py preprocess/tests/test_stays.py
git commit -m "feat: extract agent stays with dwell lengths from check-out times"
```

---

### Task 5: Quantized poop render stream

**Files:**
- Create: `preprocess/poop_simcity_preprocess/poop_stream.py`
- Test: `preprocess/tests/test_poop_stream.py`

**Interfaces:**
- Consumes: `Window`, `ticks_of`, `mask_in_window`, `to_u16` (Task 2); `DatasetProfile` (Task 1).
- Produces: `quantize(values, lo, hi) -> numpy.ndarray` (uint16); `dequantize(q, lo, hi) -> numpy.ndarray` (float64); `iter_poop_batches(dataset_dir, profile, window, columns, batch_size=2_000_000)` generator of in-window DataFrames; `build_poop_stream(dataset_dir, profile, window, bbox, clean_keep_fraction=0.3, batch_size=2_000_000) -> dict[str, numpy.ndarray]` keyed by `poops_tick.u16`, `poops_lon.u16`, `poops_lat.u16`, `poops_pathogen.f32`.

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_poop_stream.py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.poop_stream import (
    build_poop_stream, dequantize, quantize,
)
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 23:55:00")
BBOX = [-118.0, 32.0, -116.0, 34.0]


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def test_quantize_round_trips_within_one_step():
    lo, hi = -118.0, -116.0
    vals = np.array([-118.0, -117.3, -116.0])
    back = dequantize(quantize(vals, lo, hi), lo, hi)
    np.testing.assert_allclose(back, vals, atol=(hi - lo) / 65535)


def test_quantize_pins_the_endpoints():
    q = quantize(np.array([-118.0, -116.0]), -118.0, -116.0)
    assert q.tolist() == [0, 65535]


def _row(agent, time, pathogen):
    return (agent, time, 32.5, -117.0, "Apartment", pathogen,
            "Infectious" if pathogen else "Susceptible", None)


def test_stream_is_sorted_by_tick(tmp_path):
    _write_poops(tmp_path, [
        _row(0, "2024-01-01 02:00:00", 0.0),
        _row(1, "2024-01-01 00:00:00", 5.0),
    ])
    a = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, clean_keep_fraction=1.0)
    assert a["poops_tick.u16"].tolist() == [0, 24]
    np.testing.assert_allclose(a["poops_pathogen.f32"], [5.0, 0.0])


def test_out_of_window_events_are_dropped(tmp_path):
    _write_poops(tmp_path, [
        _row(0, "2024-01-01 00:00:00", 1.0),
        _row(0, "2024-02-01 00:00:00", 1.0),
    ])
    a = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, clean_keep_fraction=1.0)
    assert len(a["poops_tick.u16"]) == 1


def test_downsampling_keeps_every_infected_event_and_thins_clean_ones(tmp_path):
    rows = [_row(a, "2024-01-01 00:00:00", 0.0) for a in range(10)]
    rows += [_row(a, "2024-01-01 00:05:00", 3.0) for a in range(10)]
    _write_poops(tmp_path, rows)
    a = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, clean_keep_fraction=0.5)
    pathogen = a["poops_pathogen.f32"]
    assert (pathogen > 0).sum() == 10          # every infected event survives
    assert (pathogen == 0).sum() == 5          # agents 0,2,4,6,8 (id % 2 == 0)


def test_downsampling_is_deterministic(tmp_path):
    rows = [_row(a, "2024-01-01 00:00:00", 0.0) for a in range(20)]
    _write_poops(tmp_path, rows)
    first = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.25)
    second = build_poop_stream(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.25)
    np.testing.assert_array_equal(first["poops_lon.u16"], second["poops_lon.u16"])
    assert len(first["poops_tick.u16"]) == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd preprocess && python -m pytest tests/test_poop_stream.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.poop_stream'`

- [ ] **Step 3: Write minimal implementation**

```python
# preprocess/poop_simcity_preprocess/poop_stream.py
"""The poop event stream the map renders.

Coordinates are quantized to uint16 across the bbox (~2 m) rather than joined to
a venue index: `Poopin` carries no venue_id, and reverse-joining on coordinates is
ambiguous because several venues share a (lat, lon, type) key.

This stream is downsampled for render budget. Anything quantitative — pathogen
inflow, the wastewater grid — must read the parquet directly instead.
"""

import os

import numpy as np
import pyarrow.parquet as pq

from .window import mask_in_window, ticks_of, to_u16

U16_MAX = 65535


def quantize(values, lo, hi) -> np.ndarray:
    span = hi - lo
    if span <= 0:
        raise ValueError(f"empty quantization range [{lo}, {hi}]")
    scaled = (np.asarray(values, dtype="float64") - lo) / span
    return np.rint(np.clip(scaled, 0.0, 1.0) * U16_MAX).astype(np.uint16)


def dequantize(q, lo, hi) -> np.ndarray:
    return lo + (np.asarray(q, dtype="float64") / U16_MAX) * (hi - lo)


def iter_poop_batches(dataset_dir, profile, window, columns, batch_size=2_000_000):
    path = os.path.join(dataset_dir, f"{profile.poop_file}.parquet")
    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=columns):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        if not df.empty:
            yield df


def build_poop_stream(dataset_dir, profile, window, bbox,
                      clean_keep_fraction=0.3, batch_size=2_000_000):
    min_lon, min_lat, max_lon, max_lat = bbox
    keep_mod = 0 if clean_keep_fraction >= 1.0 else max(1, round(1.0 / clean_keep_fraction))
    blocks = []

    columns = ["agent_id", "time", "latitude", "longitude", "pathogen_level"]
    for df in iter_poop_batches(dataset_dir, profile, window, columns, batch_size):
        infected = df["pathogen_level"].to_numpy() > 0
        if keep_mod:
            keep = infected | ((df["agent_id"].to_numpy() % keep_mod) == 0)
            df = df[keep]
            if df.empty:
                continue

        blocks.append({
            "tick": ticks_of(df["time"], window),
            "lon": quantize(df["longitude"], min_lon, max_lon),
            "lat": quantize(df["latitude"], min_lat, max_lat),
            "pathogen": df["pathogen_level"].to_numpy(dtype=np.float32),
        })

    if not blocks:
        return {"poops_tick.u16": np.zeros(0, np.uint16),
                "poops_lon.u16": np.zeros(0, np.uint16),
                "poops_lat.u16": np.zeros(0, np.uint16),
                "poops_pathogen.f32": np.zeros(0, np.float32)}

    tick = np.concatenate([b["tick"] for b in blocks])
    order = np.argsort(tick, kind="stable")
    return {
        "poops_tick.u16": to_u16(tick[order], "poop tick"),
        "poops_lon.u16": np.concatenate([b["lon"] for b in blocks])[order],
        "poops_lat.u16": np.concatenate([b["lat"] for b in blocks])[order],
        "poops_pathogen.f32": np.concatenate([b["pathogen"] for b in blocks])[order],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd preprocess && python -m pytest tests/test_poop_stream.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/poop_stream.py preprocess/tests/test_poop_stream.py
git commit -m "feat: quantized tick-sorted poop render stream"
```

---

### Task 6: Disease timelines from exact onset times

**Files:**
- Create: `preprocess/poop_simcity_preprocess/disease_v2.py`
- Test: `preprocess/tests/test_disease_v2.py`

**Interfaces:**
- Consumes: `Window`, `ticks_of`, `to_u16` (Task 2); `DatasetProfile` (Task 1); `STATE_CODES` from `constants.py`.
- Produces: `scan_disease(dataset_dir, profile, window, sample_cadence_sec=604800, batch_size=2_000_000) -> DiseaseScan`, a dataclass with `transitions: dict[int, list[tuple[int, int]]]`, `samples: dict[int, list[tuple[int, float]]]`, `transmissions: list[tuple[int, int, int]]`; `encode_disease(scan) -> tuple[bytes, bytes, list[dict]]` returning `(disease_bin, transmissions_bin, index)` where index entries are `{"agentId", "transOffset", "transCount", "sampleOffset", "sampleCount"}`.

The transition rules, restated because they are the subtle part: S→E at `exposed_started_time`, E→I at `infectious_started_time`, I→R at the first snapshot whose `disease_status` is `Recovered`. Ticks below 0 clamp to 0 (seed agents carry a midnight date that predates the window start). When two transitions land on the same tick, the later state wins — this is what collapses a seed agent's simultaneous E and I into a single `(0, 2)`.

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_disease_v2.py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.disease_v2 import encode_disease, scan_disease
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-08 23:55:00")   # 2304 ticks


def _write_disease(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "time", "agent_id", "exposed_started_time", "infectious_started_time",
        "pathogen_level", "disease_status", "SourceAgentId",
        "latitude", "longitude",
    ])
    for c in ["time", "exposed_started_time", "infectious_started_time"]:
        df[c] = pd.to_datetime(df[c])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "DiseasesStatus.parquet")


def test_transitions_use_exact_onset_times_not_snapshot_times(tmp_path):
    # Snapshots are daily, but exposure happened at 09:25 on Jan 1 (tick 113).
    _write_disease(tmp_path, [
        ("2024-01-01", 0, None, None, 0.0, "Susceptible", -1, 32.5, -117.0),
        ("2024-01-02", 0, "2024-01-01 09:25:00", None, 0.0, "Exposed", 7, 32.5, -117.0),
        ("2024-01-03", 0, "2024-01-01 09:25:00", "2024-01-02 12:00:00",
         5.0, "Infectious", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert scan.transitions[0] == [(113, 1), (432, 2)]


def test_recovery_comes_from_the_first_recovered_snapshot(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-02", 0, "2024-01-01 00:00:00", "2024-01-01 00:00:00",
         5.0, "Infectious", 7, 32.5, -117.0),
        ("2024-01-04", 0, "2024-01-01 00:00:00", "2024-01-01 00:00:00",
         1.0, "Recovered", 7, 32.5, -117.0),
        ("2024-01-05", 0, "2024-01-01 00:00:00", "2024-01-01 00:00:00",
         1.0, "Recovered", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    # Jan 4 00:00 is tick 864; the later Recovered snapshot must not override it.
    assert scan.transitions[0][-1] == (864, 3)


def test_seed_agent_collapses_to_a_single_infectious_transition_at_tick_zero(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-01", 0, "2024-01-01", "2024-01-01", 0.0, "Infectious", -1, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert scan.transitions[0] == [(0, 2)]


def test_never_infected_agents_are_absent_from_the_scan(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-01", 4, None, None, 0.0, "Susceptible", -1, 32.5, -117.0),
        ("2024-01-02", 4, None, None, 0.0, "Susceptible", -1, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert 4 not in scan.transitions


def test_transmissions_are_exact_and_sorted_by_tick(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-03", 2, "2024-01-02 00:00:00", None, 0.0, "Exposed", 9, 32.5, -117.0),
        ("2024-01-02", 1, "2024-01-01 00:30:00", None, 0.0, "Exposed", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    assert scan.transmissions == [(6, 7, 1), (288, 9, 2)]


def test_pathogen_samples_are_one_per_cadence_bin(tmp_path):
    rows = [
        ("2024-01-01", 0, "2024-01-01", "2024-01-01", 10.0, "Infectious", -1, 32.5, -117.0),
        ("2024-01-02", 0, "2024-01-01", "2024-01-01", 20.0, "Infectious", -1, 32.5, -117.0),
        ("2024-01-08", 0, "2024-01-01", "2024-01-01", 30.0, "Infectious", -1, 32.5, -117.0),
    ]
    _write_disease(tmp_path, rows)
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW, sample_cadence_sec=604800)
    # Week 0 keeps its first sample (10.0); Jan 8 falls in week 1.
    assert scan.samples[0] == [(0, 10.0), (2016, 30.0)]


def test_encode_disease_lays_out_both_sections_with_matching_offsets(tmp_path):
    _write_disease(tmp_path, [
        ("2024-01-02", 1, "2024-01-01 00:00:00", None, 4.0, "Exposed", 7, 32.5, -117.0),
        ("2024-01-02", 2, "2024-01-01 00:05:00", None, 0.0, "Exposed", 7, 32.5, -117.0),
    ])
    scan = scan_disease(str(tmp_path), SDC_10K, WINDOW)
    disease_bin, trans_bin, index = encode_disease(scan)

    trans_dtype = np.dtype([("tick", "<u2"), ("code", "<u1")])
    sample_dtype = np.dtype([("tick", "<u2"), ("level", "<f4")])
    total_trans = sum(e["transCount"] for e in index)
    total_samples = sum(e["sampleCount"] for e in index)
    assert len(disease_bin) == total_trans * 3 + total_samples * 6

    trans = np.frombuffer(disease_bin[: total_trans * 3], dtype=trans_dtype)
    a1 = next(e for e in index if e["agentId"] == 1)
    assert trans[a1["transOffset"]]["tick"] == 0
    assert trans[a1["transOffset"]]["code"] == 1

    samples = np.frombuffer(disease_bin[total_trans * 3:], dtype=sample_dtype)
    assert samples[a1["sampleOffset"]]["level"] == np.float32(4.0)

    tx = np.frombuffer(trans_bin, dtype=np.dtype(
        [("tick", "<u2"), ("source", "<u2"), ("target", "<u2")]))
    assert len(tx) == 2
    assert tx[0]["source"] == 7
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd preprocess && python -m pytest tests/test_disease_v2.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.disease_v2'`

- [ ] **Step 3: Write minimal implementation**

```python
# preprocess/poop_simcity_preprocess/disease_v2.py
"""Per-agent disease timelines for bundle v2.

This run records exact `exposed_started_time` and `infectious_started_time`, so
S->E and E->I come from those rather than from the ~hourly-per-day snapshot grid.
Recovery has no timestamp anywhere in the data and is therefore only resolvable to
the first snapshot showing Recovered — a limitation the manifest advertises.
"""

import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from .constants import STATE_CODES, TICK_INTERVAL_SEC
from .window import mask_in_window, ticks_of, to_u16

TRANS_DTYPE = np.dtype([("tick", "<u2"), ("code", "<u1")])
SAMPLE_DTYPE = np.dtype([("tick", "<u2"), ("level", "<f4")])
TRANSMISSION_DTYPE = np.dtype([("tick", "<u2"), ("source", "<u2"), ("target", "<u2")])


@dataclass
class DiseaseScan:
    transitions: dict = field(default_factory=dict)
    samples: dict = field(default_factory=dict)
    transmissions: list = field(default_factory=list)


def _tick_of_scalar(ts, window):
    delta = (pd.Timestamp(ts) - window.start).total_seconds()
    return max(0, int(delta // TICK_INTERVAL_SEC))


def scan_disease(dataset_dir, profile, window, sample_cadence_sec=604800,
                 batch_size=2_000_000):
    path = os.path.join(dataset_dir, f"{profile.disease_file}.parquet")
    columns = ["time", "agent_id", "exposed_started_time",
               "infectious_started_time", "pathogen_level", "disease_status",
               profile.source_agent_col]
    bin_ticks = sample_cadence_sec // TICK_INTERVAL_SEC

    exposed_at, infectious_at, recovered_at, source_of = {}, {}, {}, {}
    samples = {}

    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_size,
                                                   columns=columns):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        if df.empty:
            continue
        tick = ticks_of(df["time"], window)

        for i, agent in enumerate(df["agent_id"].to_numpy(dtype="int64")):
            agent = int(agent)
            row_exp = df["exposed_started_time"].iat[i]
            if pd.notna(row_exp):
                t = _tick_of_scalar(row_exp, window)
                if agent not in exposed_at or t < exposed_at[agent]:
                    exposed_at[agent] = t
                    source_of[agent] = int(df[profile.source_agent_col].iat[i])
            row_inf = df["infectious_started_time"].iat[i]
            if pd.notna(row_inf):
                t = _tick_of_scalar(row_inf, window)
                if agent not in infectious_at or t < infectious_at[agent]:
                    infectious_at[agent] = t
            if df["disease_status"].iat[i] == "Recovered":
                t = int(tick[i])
                if agent not in recovered_at or t < recovered_at[agent]:
                    recovered_at[agent] = t

            level = float(df["pathogen_level"].iat[i])
            if level > 0:
                key = int(tick[i]) // bin_ticks
                per_agent = samples.setdefault(agent, {})
                if key not in per_agent:
                    per_agent[key] = (int(tick[i]), level)

    scan = DiseaseScan()
    for agent in sorted(set(exposed_at) | set(infectious_at) | set(recovered_at)):
        by_tick = {}
        if agent in exposed_at:
            by_tick[exposed_at[agent]] = STATE_CODES["Exposed"]
        if agent in infectious_at:
            by_tick[infectious_at[agent]] = STATE_CODES["Infectious"]
        if agent in recovered_at:
            by_tick[recovered_at[agent]] = STATE_CODES["Recovered"]
        # Same tick -> later state wins, which collapses seed agents to Infectious.
        merged = {}
        for t, code in sorted(by_tick.items()):
            merged[t] = max(code, merged.get(t, code))
        scan.transitions[agent] = sorted(merged.items())

    for agent in sorted(samples):
        scan.samples[agent] = [samples[agent][k] for k in sorted(samples[agent])]

    scan.transmissions = sorted(
        (exposed_at[a], source_of[a], a)
        for a in exposed_at if source_of.get(a, -1) >= 0
    )
    return scan


def encode_disease(scan: DiseaseScan):
    agents = sorted(set(scan.transitions) | set(scan.samples))

    index, trans_rows, sample_rows = [], [], []
    for agent in agents:
        trans = scan.transitions.get(agent, [])
        samples = scan.samples.get(agent, [])
        index.append({
            "agentId": agent,
            "transOffset": len(trans_rows), "transCount": len(trans),
            "sampleOffset": len(sample_rows), "sampleCount": len(samples),
        })
        trans_rows.extend(trans)
        sample_rows.extend(samples)

    trans_arr = np.zeros(len(trans_rows), dtype=TRANS_DTYPE)
    if trans_rows:
        trans_arr["tick"] = to_u16(np.array([t for t, _ in trans_rows]),
                                   "transition tick")
        trans_arr["code"] = np.array([c for _, c in trans_rows], dtype=np.uint8)

    sample_arr = np.zeros(len(sample_rows), dtype=SAMPLE_DTYPE)
    if sample_rows:
        sample_arr["tick"] = to_u16(np.array([t for t, _ in sample_rows]),
                                    "pathogen sample tick")
        sample_arr["level"] = np.array([v for _, v in sample_rows], dtype=np.float32)

    tx = np.zeros(len(scan.transmissions), dtype=TRANSMISSION_DTYPE)
    if scan.transmissions:
        tx["tick"] = to_u16(np.array([t for t, _, _ in scan.transmissions]),
                            "transmission tick")
        tx["source"] = to_u16(np.array([s for _, s, _ in scan.transmissions]),
                              "transmission source")
        tx["target"] = to_u16(np.array([g for _, _, g in scan.transmissions]),
                              "transmission target")

    return trans_arr.tobytes() + sample_arr.tobytes(), tx.tobytes(), index
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd preprocess && python -m pytest tests/test_disease_v2.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/disease_v2.py preprocess/tests/test_disease_v2.py
git commit -m "feat: disease timelines from exact onset times, binary encoded"
```

---

### Task 7: Streaming aggregates and binary wastewater grid

Both read the poop parquet directly so downsampling cannot affect them.

**Files:**
- Create: `preprocess/poop_simcity_preprocess/aggregates_v2.py`
- Create: `preprocess/poop_simcity_preprocess/wastewater_v2.py`
- Test: `preprocess/tests/test_aggregates_v2.py`
- Test: `preprocess/tests/test_wastewater_v2.py`

**Interfaces:**
- Consumes: `Window`, `ticks_of` (Task 2); `iter_poop_batches` (Task 5); `DiseaseScan.transitions` (Task 6).
- Produces: `seir_hourly(transitions, num_agents, window, cadence_sec=3600) -> dict[str, list[int]]` keyed `S/E/I/R`; `pathogen_inflow_hourly(dataset_dir, profile, window, cadence_sec=3600) -> list[float]`; `build_aggregates_v2(dataset_dir, profile, window, transitions, num_agents, cadence_sec=3600) -> dict` with keys `cadenceSec, startTime, gridTicks, seir, pathogenInflow`; `build_wastewater_v2(dataset_dir, profile, window, bbox, cell_size_deg=0.02, cadence_sec=3600) -> tuple[numpy.ndarray, dict]` returning a C-contiguous `float32` matrix of shape `(num_regions, num_bins)` and a regions dict `{kind, cadenceSec, numBins, regions}`.

- [ ] **Step 1: Write the failing tests**

```python
# preprocess/tests/test_aggregates_v2.py
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.aggregates_v2 import (
    build_aggregates_v2, pathogen_inflow_hourly, seir_hourly,
)
from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 02:55:00")   # 36 ticks, 3 bins


def test_seir_counts_agents_by_last_transition_at_or_before_each_bin():
    # Agent 0 exposed at tick 6 (bin 0), infectious at tick 18 (bin 1).
    seir = seir_hourly({0: [(6, 1), (18, 2)]}, num_agents=3, window=WINDOW)
    assert seir["S"] == [2, 2, 2]        # agents 1 and 2 never transition
    assert seir["E"] == [1, 0, 0]
    assert seir["I"] == [0, 1, 1]
    assert seir["R"] == [0, 0, 0]


def test_agents_before_their_first_transition_count_as_susceptible():
    seir = seir_hourly({0: [(30, 1)]}, num_agents=1, window=WINDOW)
    assert seir["S"] == [1, 1, 0]
    assert seir["E"] == [0, 0, 1]


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def test_inflow_sums_pathogen_per_hourly_bin(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.5, -117.0, "Apartment", 5.0, "Infectious", None),
        (1, "2024-01-01 00:50:00", 32.5, -117.0, "Apartment", 3.0, "Infectious", None),
        (2, "2024-01-01 02:00:00", 32.5, -117.0, "Apartment", 7.0, "Infectious", None),
    ])
    assert pathogen_inflow_hourly(str(tmp_path), SDC_10K, WINDOW) == [8.0, 0.0, 7.0]


def test_aggregates_bundle_shape(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.5, -117.0, "Apartment", 5.0, "Infectious", None),
    ])
    agg = build_aggregates_v2(str(tmp_path), SDC_10K, WINDOW, {0: [(6, 1)]}, 2)
    assert agg["cadenceSec"] == 3600
    assert agg["gridTicks"] == [0, 12, 24]
    assert len(agg["pathogenInflow"]) == 3
    assert agg["seir"]["E"][0] == 1
```

```python
# preprocess/tests/test_wastewater_v2.py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.profiles import SDC_10K
from poop_simcity_preprocess.wastewater_v2 import build_wastewater_v2
from poop_simcity_preprocess.window import make_window

WINDOW = make_window("2024-01-01 00:00:00", "2024-01-01 02:55:00")   # 3 hourly bins
BBOX = [-117.10, 32.50, -117.00, 32.60]


def _write_poops(dataset_dir, rows):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=[
        "agent_id", "time", "latitude", "longitude", "venue_type",
        "pathogen_level", "disease_status", "infectious_started_time",
    ])
    df["time"] = pd.to_datetime(df["time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    pq.write_table(pa.Table.from_pandas(df), dataset_dir / "Poopin.parquet")


def test_only_pathogen_bearing_events_populate_cells(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.51, -117.09, "Apartment", 4.0, "Infectious", None),
        (1, "2024-01-01 00:20:00", 32.55, -117.05, "Apartment", 0.0, "Susceptible", None),
    ])
    matrix, regions = build_wastewater_v2(str(tmp_path), SDC_10K, WINDOW, BBOX,
                                          cell_size_deg=0.02)
    assert len(regions["regions"]) == 1
    assert matrix.shape == (1, 3)
    assert matrix.dtype == np.float32
    np.testing.assert_allclose(matrix[0], [4.0, 0.0, 0.0])


def test_events_in_the_same_cell_and_bin_are_summed(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.51, -117.09, "Apartment", 4.0, "Infectious", None),
        (1, "2024-01-01 00:40:00", 32.515, -117.095, "Apartment", 6.0, "Infectious", None),
    ])
    matrix, regions = build_wastewater_v2(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.02)
    assert len(regions["regions"]) == 1
    np.testing.assert_allclose(matrix[0], [10.0, 0.0, 0.0])


def test_regions_carry_geometry_and_ids_in_matrix_row_order(tmp_path):
    _write_poops(tmp_path, [
        (0, "2024-01-01 00:10:00", 32.51, -117.09, "Apartment", 4.0, "Infectious", None),
        (1, "2024-01-01 01:10:00", 32.59, -117.01, "Apartment", 9.0, "Infectious", None),
    ])
    matrix, regions = build_wastewater_v2(str(tmp_path), SDC_10K, WINDOW, BBOX, 0.02)
    assert regions["kind"] == "grid"
    assert regions["numBins"] == 3
    ids = [r["id"] for r in regions["regions"]]
    assert ids == sorted(ids)
    assert len(regions["regions"][0]["polygon"]) == 4
    assert matrix.shape == (2, 3)
    np.testing.assert_allclose(matrix[:, 1].sum(), 9.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd preprocess && python -m pytest tests/test_aggregates_v2.py tests/test_wastewater_v2.py -v`
Expected: FAIL with `ModuleNotFoundError` for `aggregates_v2` and `wastewater_v2`

- [ ] **Step 3: Write minimal implementations**

```python
# preprocess/poop_simcity_preprocess/aggregates_v2.py
"""Hourly SEIR counts and pathogen inflow for bundle v2.

Inflow streams the poop parquet rather than the render stream, so clean-event
downsampling can never distort it.
"""

import bisect

import numpy as np

from .constants import TICK_INTERVAL_SEC
from .poop_stream import iter_poop_batches
from .window import ticks_of

STATE_NAMES = ["S", "E", "I", "R"]


def _grid(window, cadence_sec):
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    num_bins = (window.num_ticks + bin_ticks - 1) // bin_ticks
    return [i * bin_ticks for i in range(num_bins)], bin_ticks


def seir_hourly(transitions, num_agents, window, cadence_sec=3600):
    grid_ticks, _ = _grid(window, cadence_sec)
    counts = {name: [0] * len(grid_ticks) for name in STATE_NAMES}

    for trans in transitions.values():
        ticks = [t for t, _ in trans]
        for gi, gt in enumerate(grid_ticks):
            idx = bisect.bisect_right(ticks, gt) - 1
            code = trans[idx][1] if idx >= 0 else 0
            counts[STATE_NAMES[code]][gi] += 1

    missing = num_agents - len(transitions)
    if missing:
        for gi in range(len(grid_ticks)):
            counts["S"][gi] += missing
    return counts


def pathogen_inflow_hourly(dataset_dir, profile, window, cadence_sec=3600,
                           batch_size=2_000_000):
    grid_ticks, bin_ticks = _grid(window, cadence_sec)
    totals = np.zeros(len(grid_ticks), dtype="float64")
    for df in iter_poop_batches(dataset_dir, profile, window,
                                ["time", "pathogen_level"], batch_size):
        bins = ticks_of(df["time"], window) // bin_ticks
        np.add.at(totals, bins, df["pathogen_level"].to_numpy(dtype="float64"))
    return [float(v) for v in totals]


def build_aggregates_v2(dataset_dir, profile, window, transitions, num_agents,
                        cadence_sec=3600, batch_size=2_000_000):
    grid_ticks, _ = _grid(window, cadence_sec)
    return {
        "cadenceSec": cadence_sec,
        "startTime": window.start.isoformat(),
        "gridTicks": grid_ticks,
        "seir": seir_hourly(transitions, num_agents, window, cadence_sec),
        "pathogenInflow": pathogen_inflow_hourly(dataset_dir, profile, window,
                                                 cadence_sec, batch_size),
    }
```

```python
# preprocess/poop_simcity_preprocess/wastewater_v2.py
"""Pathogen load per spatial grid cell per hour, as a float32 matrix.

Same regions x time-series interface as v1, so real sewershed polygons can replace
the grid later without touching the app. Values go to a binary matrix because a
JSON object of 633 x 5,112 numbers would be ~28 MB of text.
"""

import numpy as np

from .constants import TICK_INTERVAL_SEC
from .poop_stream import iter_poop_batches
from .window import ticks_of


def build_wastewater_v2(dataset_dir, profile, window, bbox, cell_size_deg=0.02,
                        cadence_sec=3600, batch_size=2_000_000):
    min_lon, min_lat, max_lon, max_lat = bbox
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    num_bins = (window.num_ticks + bin_ticks - 1) // bin_ticks

    cells = {}
    columns = ["time", "latitude", "longitude", "pathogen_level"]
    for df in iter_poop_batches(dataset_dir, profile, window, columns, batch_size):
        df = df[df["pathogen_level"] > 0]
        if df.empty:
            continue
        ix = ((df["longitude"].to_numpy() - min_lon) // cell_size_deg).astype("int64")
        iy = ((df["latitude"].to_numpy() - min_lat) // cell_size_deg).astype("int64")
        bins = ticks_of(df["time"], window) // bin_ticks
        levels = df["pathogen_level"].to_numpy(dtype="float64")
        for x, y, b, v in zip(ix, iy, bins, levels):
            row = cells.get((int(x), int(y)))
            if row is None:
                row = np.zeros(num_bins, dtype="float64")
                cells[(int(x), int(y))] = row
            row[int(b)] += v

    keys = sorted(cells)
    matrix = np.zeros((len(keys), num_bins), dtype=np.float32)
    regions = []
    for i, (x, y) in enumerate(keys):
        matrix[i] = cells[(x, y)]
        x0 = min_lon + x * cell_size_deg
        y0 = min_lat + y * cell_size_deg
        x1, y1 = x0 + cell_size_deg, y0 + cell_size_deg
        regions.append({
            "id": f"{x}_{y}",
            "centroid": [x0 + cell_size_deg / 2, y0 + cell_size_deg / 2],
            "polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        })

    return np.ascontiguousarray(matrix), {
        "kind": "grid", "cadenceSec": cadence_sec,
        "numBins": num_bins, "regions": regions,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd preprocess && python -m pytest tests/test_aggregates_v2.py tests/test_wastewater_v2.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/aggregates_v2.py preprocess/poop_simcity_preprocess/wastewater_v2.py preprocess/tests/test_aggregates_v2.py preprocess/tests/test_wastewater_v2.py
git commit -m "feat: streaming hourly aggregates and binary wastewater matrix"
```

---

### Task 8: Bundle v2 orchestration, manifest and CLI

**Files:**
- Create: `preprocess/poop_simcity_preprocess/build_v2.py`
- Modify: `preprocess/poop_simcity_preprocess/cli.py`
- Test: `preprocess/tests/test_build_v2_integration.py`

**Interfaces:**
- Consumes: every module from Tasks 1–7.
- Produces: `build_bundle_v2(dataset_dir, out_dir, *, run_id, window_start, window_end, profile, clean_keep_fraction=0.3, cell_size_deg=0.02, batch_size=2_000_000) -> dict` (the manifest); `ARTIFACTS_V2` mapping manifest keys to filenames.

- [ ] **Step 1: Write the failing test**

```python
# preprocess/tests/test_build_v2_integration.py
import json

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.build_v2 import build_bundle_v2
from poop_simcity_preprocess.profiles import SDC_10K

WINDOW_START = "2024-01-01 00:00:00"
WINDOW_END = "2024-01-02 23:55:00"


def _write_synthetic(dataset_dir):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    checkin = pd.DataFrame({
        "agent_id": [0, 0, 1],
        "time": pd.to_datetime(["2024-01-01 00:00:00", "2024-01-01 06:00:00",
                                "2024-01-01 00:00:00"]),
        "CheckoutTime": ["2024-01-01T05:00:00", "2024-01-01T12:00:00",
                         "2024-01-01T08:00:00"],
        "venue_id": [10, 11, 11],
        "venue_type": ["Apartment", "Workplace", "Workplace"],
        "latitude": [32.70, 32.75, 32.75],
        "longitude": [-117.20, -117.10, -117.10],
    })
    disease = pd.DataFrame({
        "time": pd.to_datetime(["2024-01-01 00:00:00", "2024-01-02 00:00:00",
                                "2024-01-01 00:00:00"]),
        "agent_id": [0, 0, 1],
        "exposed_started_time": pd.to_datetime(
            [None, "2024-01-01 09:00:00", None]),
        "infectious_started_time": pd.to_datetime([None, None, None]),
        "pathogen_level": [0.0, 12.0, 0.0],
        "disease_status": ["Susceptible", "Exposed", "Susceptible"],
        "SourceAgentId": [-1, 1, -1],
        "latitude": [32.70, 32.75, 32.75],
        "longitude": [-117.20, -117.10, -117.10],
    })
    poops = pd.DataFrame({
        "agent_id": [0, 1],
        "time": pd.to_datetime(["2024-01-01 10:00:00", "2024-01-01 02:00:00"]),
        "latitude": [32.75, 32.70],
        "longitude": [-117.10, -117.20],
        "venue_type": ["Workplace", "Apartment"],
        "pathogen_level": [50.0, 0.0],
        "disease_status": ["Exposed", "Susceptible"],
        "infectious_started_time": pd.to_datetime([None, None]),
    })
    for name, df in [("Checkin", checkin), ("DiseasesStatus", disease),
                     ("Poopin", poops)]:
        pq.write_table(pa.Table.from_pandas(df), dataset_dir / f"{name}.parquet")


def test_build_v2_writes_a_self_consistent_bundle(tmp_path):
    dataset_dir = tmp_path / "src"
    out_dir = tmp_path / "bundle"
    _write_synthetic(dataset_dir)

    manifest = build_bundle_v2(
        str(dataset_dir), str(out_dir), run_id="test-run",
        window_start=WINDOW_START, window_end=WINDOW_END, profile=SDC_10K,
        clean_keep_fraction=1.0,
    )

    assert manifest["schemaVersion"] == 2
    assert manifest["numTicks"] == 576              # 2 days
    assert manifest["numAgents"] == 2
    assert manifest["numVenues"] == 2
    assert manifest["coverage"]["cleanPoopKeepFraction"] == 1.0
    assert manifest["coverage"]["recoveryTimeResolution"] == "daily"

    on_disk = json.loads((out_dir / "manifest.json").read_text())
    assert on_disk == manifest

    # Every declared artifact exists.
    for name in manifest["artifacts"].values():
        assert (out_dir / name).exists(), name

    # Stays: 3 records, index sums to 3, venue indices in range.
    tick = np.frombuffer((out_dir / "stays_tick.u16").read_bytes(), dtype="<u2")
    dwell = np.frombuffer((out_dir / "stays_dwell.u16").read_bytes(), dtype="<u2")
    venue = np.frombuffer((out_dir / "stays_venue.u16").read_bytes(), dtype="<u2")
    assert len(tick) == len(dwell) == len(venue) == 3
    assert venue.max() < manifest["numVenues"]
    index = json.loads((out_dir / "stays_index.json").read_text())
    assert sum(e["count"] for e in index) == 3

    # Agent 0's first stay: tick 0, dwell 60 ticks (00:00 -> 05:00).
    a0 = next(e for e in index if e["agentId"] == 0)
    assert tick[a0["offset"]] == 0
    assert dwell[a0["offset"]] == 60

    # Venue table is index-aligned with venue ids ascending.
    vid = np.frombuffer((out_dir / "venues_id.i32").read_bytes(), dtype="<i4")
    assert vid.tolist() == [10, 11]

    # Poops sorted by tick, both kept at keep_fraction 1.0.
    ptick = np.frombuffer((out_dir / "poops_tick.u16").read_bytes(), dtype="<u2")
    assert ptick.tolist() == sorted(ptick.tolist())
    assert len(ptick) == 2

    # Wastewater matrix shape matches the regions sidecar.
    regions = json.loads((out_dir / "wastewater_regions.json").read_text())
    values = np.frombuffer((out_dir / "wastewater.bin").read_bytes(), dtype="<f4")
    assert len(values) == len(regions["regions"]) * regions["numBins"]

    # Aggregates cover the window at hourly cadence.
    agg = json.loads((out_dir / "aggregates.json").read_text())
    assert len(agg["gridTicks"]) == 48
    assert len(agg["pathogenInflow"]) == 48
    assert all(len(agg["seir"][k]) == 48 for k in "SEIR")


def test_downsampling_does_not_change_aggregates_or_wastewater(tmp_path):
    dataset_dir = tmp_path / "src"
    _write_synthetic(dataset_dir)

    full = tmp_path / "full"
    thin = tmp_path / "thin"
    for out, keep in [(full, 1.0), (thin, 0.01)]:
        build_bundle_v2(str(dataset_dir), str(out), run_id="r",
                        window_start=WINDOW_START, window_end=WINDOW_END,
                        profile=SDC_10K, clean_keep_fraction=keep)

    assert (json.loads((full / "aggregates.json").read_text())["pathogenInflow"]
            == json.loads((thin / "aggregates.json").read_text())["pathogenInflow"])
    assert ((full / "wastewater.bin").read_bytes()
            == (thin / "wastewater.bin").read_bytes())
    # The render stream, however, did shrink.
    assert len((thin / "poops_tick.u16").read_bytes()) \
        < len((full / "poops_tick.u16").read_bytes())


def test_window_too_wide_for_uint16_raises(tmp_path):
    dataset_dir = tmp_path / "src"
    _write_synthetic(dataset_dir)
    import pytest
    with pytest.raises(ValueError, match="uint16"):
        build_bundle_v2(str(dataset_dir), str(tmp_path / "out"), run_id="r",
                        window_start="2024-01-01 00:00:00",
                        window_end="2024-12-31 23:55:00", profile=SDC_10K)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd preprocess && python -m pytest tests/test_build_v2_integration.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poop_simcity_preprocess.build_v2'`

- [ ] **Step 3: Write minimal implementation**

```python
# preprocess/poop_simcity_preprocess/build_v2.py
"""Orchestrate the bundle v2 build: parquet in, struct-of-arrays bundle out."""

import json
import os

import numpy as np

from .aggregates_v2 import build_aggregates_v2
from .constants import TICK_INTERVAL_SEC, VENUE_TYPES
from .disease_v2 import encode_disease, scan_disease
from .outbreak import detect_outbreak_window
from .poop_stream import build_poop_stream
from .stays import build_stays
from .venues import build_venue_table, venue_arrays, venue_index_map
from .wastewater_v2 import build_wastewater_v2
from .window import make_window

ARTIFACTS_V2 = {
    "venuesLon": "venues_lon.f32", "venuesLat": "venues_lat.f32",
    "venuesType": "venues_type.u8", "venuesId": "venues_id.i32",
    "staysTick": "stays_tick.u16", "staysDwell": "stays_dwell.u16",
    "staysVenue": "stays_venue.u16", "staysIndex": "stays_index.json",
    "poopsTick": "poops_tick.u16", "poopsLon": "poops_lon.u16",
    "poopsLat": "poops_lat.u16", "poopsPathogen": "poops_pathogen.f32",
    "disease": "disease.bin", "diseaseIndex": "disease_index.json",
    "transmissions": "transmissions.bin",
    "aggregates": "aggregates.json",
    "wastewater": "wastewater.bin",
    "wastewaterRegions": "wastewater_regions.json",
}


def _write_json(out_dir, name, obj):
    with open(os.path.join(out_dir, name), "w") as f:
        json.dump(obj, f, separators=(",", ":"))


def _write_bytes(out_dir, name, payload):
    with open(os.path.join(out_dir, name), "wb") as f:
        f.write(payload)


def build_bundle_v2(dataset_dir, out_dir, *, run_id, window_start, window_end,
                    profile, clean_keep_fraction=0.3, cell_size_deg=0.02,
                    batch_size=2_000_000):
    os.makedirs(out_dir, exist_ok=True)
    window = make_window(window_start, window_end)

    venues = build_venue_table(dataset_dir, profile, batch_size)
    unknown = sorted(set(venues["venue_type"]) - set(VENUE_TYPES))
    if unknown:
        raise ValueError(f"venue_type contains unmapped values {unknown}")
    for name, arr in venue_arrays(venues).items():
        _write_bytes(out_dir, name, arr.tobytes())

    bbox = [
        float(venues["longitude"].min()), float(venues["latitude"].min()),
        float(venues["longitude"].max()), float(venues["latitude"].max()),
    ]

    stay_arrays, stay_index = build_stays(dataset_dir, profile, window,
                                          venue_index_map(venues), batch_size)
    for name, arr in stay_arrays.items():
        _write_bytes(out_dir, name, arr.tobytes())
    _write_json(out_dir, "stays_index.json", stay_index)

    for name, arr in build_poop_stream(dataset_dir, profile, window, bbox,
                                       clean_keep_fraction, batch_size).items():
        _write_bytes(out_dir, name, arr.tobytes())

    scan = scan_disease(dataset_dir, profile, window, batch_size=batch_size)
    disease_bin, transmissions_bin, disease_index = encode_disease(scan)
    _write_bytes(out_dir, "disease.bin", disease_bin)
    _write_bytes(out_dir, "transmissions.bin", transmissions_bin)
    _write_json(out_dir, "disease_index.json", disease_index)

    num_agents = len(stay_index)
    aggregates = build_aggregates_v2(dataset_dir, profile, window,
                                     scan.transitions, num_agents,
                                     batch_size=batch_size)
    _write_json(out_dir, "aggregates.json", aggregates)

    matrix, regions = build_wastewater_v2(dataset_dir, profile, window, bbox,
                                          cell_size_deg, batch_size=batch_size)
    _write_bytes(out_dir, "wastewater.bin", matrix.tobytes())
    _write_json(out_dir, "wastewater_regions.json", regions)

    outbreak = detect_outbreak_window(aggregates["seir"], aggregates["gridTicks"])
    exposed_agents = len(scan.transmissions)
    manifest = {
        "schemaVersion": 2,
        "runId": run_id,
        "tickIntervalSec": TICK_INTERVAL_SEC,
        "windowStart": window.start.isoformat(),
        "windowEnd": window.end.isoformat(),
        "numTicks": window.num_ticks,
        "numAgents": num_agents,
        "numVenues": int(len(venues)),
        "bbox": bbox,
        "outbreakWindow": {"startTick": int(outbreak[0]), "endTick": int(outbreak[1])},
        "venueTypes": list(VENUE_TYPES),
        "coverage": {
            "transmissionsInWindow": exposed_agents,
            "recoveryTimeResolution": "daily",
            "cleanPoopKeepFraction": float(clean_keep_fraction),
        },
        "artifacts": dict(ARTIFACTS_V2),
    }
    _write_json(out_dir, "manifest.json", manifest)
    return manifest
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd preprocess && python -m pytest tests/test_build_v2_integration.py -v`
Expected: 3 passed

- [ ] **Step 5: Add the CLI flags**

Replace `cli.py` entirely so both bundle versions are reachable:

```python
# preprocess/poop_simcity_preprocess/cli.py
"""Command-line entry point: build a bundle from a dataset directory."""

import argparse

from .build import build_bundle
from .build_v2 import build_bundle_v2
from .profiles import get_profile


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the Poop SimCity data bundle.")
    parser.add_argument("--dataset", required=True, help="Path to the dataset directory")
    parser.add_argument("--out", required=True, help="Output bundle directory")
    parser.add_argument("--run-id", default="dataset_00")
    parser.add_argument("--profile", default="dataset_00",
                        help="Dataset profile name (dataset_00 or dataset_sdc-10k)")
    parser.add_argument("--window-start", default="2024-01-01T00:00:00",
                        help="First tick's timestamp (schemaVersion 2 only)")
    parser.add_argument("--window-end", default="2024-07-31T23:55:00",
                        help="Last tick's timestamp, inclusive (schemaVersion 2 only)")
    parser.add_argument("--clean-keep-fraction", type=float, default=1.0,
                        help="Fraction of clean (non-pathogen) poop events to keep")
    parser.add_argument("--cell-size-deg", type=float, default=0.02,
                        help="Wastewater grid cell size in degrees")
    parser.add_argument("--batch-size", type=int, default=2_000_000,
                        help="Parquet rows per streaming batch (schemaVersion 2 only)")
    args = parser.parse_args(argv)

    profile = get_profile(args.profile)
    if profile.schema_version == 1:
        manifest = build_bundle(args.dataset, args.out, run_id=args.run_id,
                                clean_keep_fraction=args.clean_keep_fraction,
                                cell_size_deg=args.cell_size_deg, profile=profile)
    else:
        manifest = build_bundle_v2(
            args.dataset, args.out, run_id=args.run_id,
            window_start=args.window_start, window_end=args.window_end,
            profile=profile, clean_keep_fraction=args.clean_keep_fraction,
            cell_size_deg=args.cell_size_deg, batch_size=args.batch_size)

    print(f"Wrote schemaVersion {manifest['schemaVersion']} bundle to {args.out}: "
          f"{manifest['numAgents']} agents, {manifest['numTicks']} ticks, "
          f"outbreak {manifest['outbreakWindow']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Verify the entire preprocessor suite passes**

Run: `cd preprocess && python -m pytest -v`
Expected: all tests pass, including the untouched v1 suite

- [ ] **Step 7: Commit**

```bash
git add preprocess/poop_simcity_preprocess/build_v2.py preprocess/poop_simcity_preprocess/cli.py preprocess/tests/test_build_v2_integration.py
git commit -m "feat: bundle v2 orchestration, manifest and CLI"
```

---

### Task 9: Build the real bundle

No new code — running the pipeline on 585 MB of parquet and verifying the output. Expect roughly 10–25 minutes.

**Files:**
- Create: `app/public/data/dataset_sdc-10k/` (19 artifacts)
- Modify: `preprocess/verify_bundle.py`
- Modify: `README.md`

- [ ] **Step 1: Run the build**

```bash
cd preprocess && python -m poop_simcity_preprocess.cli \
  --dataset ../dataset_sdc-10k \
  --out ../app/public/data/dataset_sdc-10k \
  --run-id dataset_sdc-10k \
  --profile dataset_sdc-10k \
  --window-start 2024-01-01T00:00:00 \
  --window-end 2024-07-31T23:55:00 \
  --clean-keep-fraction 0.3
```

Expected printed summary: `schemaVersion 2`, `10000 agents`, `61344 ticks`.

- [ ] **Step 2: Verify the bundle against the source data**

Add a v2 verifier alongside the existing v1 one. It re-derives facts from the parquet and compares them against the bundle, so a silently wrong encoding cannot pass.

```python
# preprocess/verify_bundle_v2.py
"""Cross-check a schemaVersion 2 bundle against the parquet it came from."""

import argparse
import json
import os

import numpy as np
import pyarrow.parquet as pq

from poop_simcity_preprocess.profiles import get_profile
from poop_simcity_preprocess.window import make_window, mask_in_window

FAILURES = []


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


def _read(bundle, name, dtype):
    return np.fromfile(os.path.join(bundle, name), dtype=dtype)


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--bundle", required=True)
    p.add_argument("--dataset", required=True)
    p.add_argument("--profile", required=True)
    args = p.parse_args(argv)

    profile = get_profile(args.profile)
    manifest = json.loads(open(os.path.join(args.bundle, "manifest.json")).read())
    window = make_window(manifest["windowStart"], manifest["windowEnd"])

    check("schemaVersion is 2", manifest["schemaVersion"] == 2)
    check("numTicks matches the window", manifest["numTicks"] == window.num_ticks,
          f"{manifest['numTicks']}")

    tick = _read(args.bundle, "stays_tick.u16", "<u2")
    dwell = _read(args.bundle, "stays_dwell.u16", "<u2")
    venue = _read(args.bundle, "stays_venue.u16", "<u2")
    index = json.loads(open(os.path.join(args.bundle, "stays_index.json")).read())

    check("stay arrays are equal length",
          len(tick) == len(dwell) == len(venue), f"{len(tick)}")
    check("stay index covers every record",
          sum(e["count"] for e in index) == len(tick))
    check("index agent count matches manifest",
          len(index) == manifest["numAgents"], f"{len(index)}")
    check("venue indices are in range", int(venue.max()) < manifest["numVenues"])
    check("every dwell is at least one tick", int(dwell.min()) >= 1)
    check("no stay runs past the window end",
          int((tick.astype("int64") + dwell.astype("int64")).max()) <= manifest["numTicks"])
    for e in index:
        seg = tick[e["offset"]: e["offset"] + e["count"]]
        if np.any(np.diff(seg.astype("int64")) < 0):
            check(f"agent {e['agentId']} stays ascend by tick", False)
            break
    else:
        check("every agent's stays ascend by tick", True)

    vid = _read(args.bundle, "venues_id.i32", "<i4")
    check("venue ids strictly ascend", bool(np.all(np.diff(vid) > 0)),
          f"{len(vid)} venues")
    check("venue count matches manifest", len(vid) == manifest["numVenues"])

    # Re-derive the in-window check-in count straight from the parquet.
    checkin_rows = 0
    pf = pq.ParquetFile(os.path.join(args.dataset, f"{profile.checkin_file}.parquet"))
    for batch in pf.iter_batches(batch_size=2_000_000, columns=["time"]):
        checkin_rows += int(mask_in_window(batch.to_pandas()["time"], window).sum())
    check("stay count equals in-window check-ins",
          len(tick) == checkin_rows, f"bundle={len(tick)} parquet={checkin_rows}")

    ptick = _read(args.bundle, "poops_tick.u16", "<u2")
    ppath = _read(args.bundle, "poops_pathogen.f32", "<f4")
    check("poops are sorted by tick",
          bool(np.all(np.diff(ptick.astype("int64")) >= 0)))
    check("poop arrays are equal length", len(ptick) == len(ppath))

    infected_parquet = 0
    pf = pq.ParquetFile(os.path.join(args.dataset, f"{profile.poop_file}.parquet"))
    for batch in pf.iter_batches(batch_size=2_000_000,
                                 columns=["time", "pathogen_level"]):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        infected_parquet += int((df["pathogen_level"] > 0).sum())
    check("every pathogen-bearing poop survived downsampling",
          int((ppath > 0).sum()) == infected_parquet,
          f"bundle={(ppath > 0).sum()} parquet={infected_parquet}")

    regions = json.loads(open(os.path.join(args.bundle,
                                           "wastewater_regions.json")).read())
    values = _read(args.bundle, "wastewater.bin", "<f4")
    check("wastewater matrix matches its regions sidecar",
          len(values) == len(regions["regions"]) * regions["numBins"],
          f"{len(regions['regions'])} regions x {regions['numBins']} bins")

    agg = json.loads(open(os.path.join(args.bundle, "aggregates.json")).read())
    totals = {sum(v) for v in zip(*(agg["seir"][k] for k in "SEIR"))}
    check("SEIR sums to the population in every bin",
          totals == {manifest["numAgents"]}, f"{sorted(totals)[:3]}")
    check("inflow has one value per hourly bin",
          len(agg["pathogenInflow"]) == len(agg["gridTicks"]))

    tx = _read(args.bundle, "transmissions.bin", "<u2")
    check("transmissions.bin holds whole records", len(tx) % 3 == 0)
    check("transmission count matches the manifest",
          len(tx) // 3 == manifest["coverage"]["transmissionsInWindow"])

    print()
    if FAILURES:
        raise SystemExit(f"{len(FAILURES)} check(s) failed: {FAILURES}")
    print("All checks passed.")


if __name__ == "__main__":
    main()
```

Run: `cd preprocess && python verify_bundle_v2.py --bundle ../app/public/data/dataset_sdc-10k --dataset ../dataset_sdc-10k --profile dataset_sdc-10k`
Expected: every line PASS, ending in `All checks passed.`

- [ ] **Step 3: Record the actual artifact sizes**

Run: `ls -l app/public/data/dataset_sdc-10k`

If the total materially exceeds ~100 MB, note it — the v1 convention is that bundles are committed so the app runs from a fresh clone, and a total this large is worth flagging to the repo owner before committing rather than silently adding ~100 MB of history.

- [ ] **Step 4: Document the build command**

Add a `dataset_sdc-10k` section to `README.md` giving the exact command from Step 1, the window rationale (99.3% of exposures; ticks must stay under 65,536), and a note that `--clean-keep-fraction` only affects rendering.

- [ ] **Step 5: Commit**

```bash
git add preprocess/verify_bundle.py README.md app/public/data/dataset_sdc-10k
git commit -m "feat: build the dataset_sdc-10k bundle (Jan-Jul window, 10k agents)"
```

---

### Task 10: App-side v2 loader

**Files:**
- Create: `app/src/types2.ts`
- Create: `app/src/data/loadBundleV2.ts`
- Test: `app/tests/loadBundleV2.test.ts`

**Interfaces:**
- Consumes: manifest and artifacts from Task 8.
- Produces: types `ManifestV2`, `Venues`, `Stays`, `StaySlice`, `StayIndexEntry`, `PoopsV2`, `Transmissions`, `WastewaterV2`, `BundleV2`; `loadBundleV2(base: string, fetchFn?: typeof fetch) => Promise<BundleV2>`. Poop coordinate dequantization is exposed as the bundle methods `poopLon(i: number) => number` and `poopLat(i: number) => number`, closed over the manifest bbox, so callers never have to carry the bbox around.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/loadBundleV2.test.ts
import { describe, it, expect } from "vitest";
import { loadBundleV2 } from "../src/data/loadBundleV2";
import type { ManifestV2 } from "../src/types2";

const ARTIFACTS = {
  venuesLon: "venues_lon.f32", venuesLat: "venues_lat.f32",
  venuesType: "venues_type.u8", venuesId: "venues_id.i32",
  staysTick: "stays_tick.u16", staysDwell: "stays_dwell.u16",
  staysVenue: "stays_venue.u16", staysIndex: "stays_index.json",
  poopsTick: "poops_tick.u16", poopsLon: "poops_lon.u16",
  poopsLat: "poops_lat.u16", poopsPathogen: "poops_pathogen.f32",
  disease: "disease.bin", diseaseIndex: "disease_index.json",
  transmissions: "transmissions.bin",
  aggregates: "aggregates.json",
  wastewater: "wastewater.bin", wastewaterRegions: "wastewater_regions.json",
};

const MANIFEST: ManifestV2 = {
  schemaVersion: 2, runId: "t", tickIntervalSec: 300,
  windowStart: "2024-01-01T00:00:00", windowEnd: "2024-01-01T00:55:00",
  numTicks: 12, numAgents: 2, numVenues: 2,
  bbox: [-118, 32, -116, 34],
  outbreakWindow: { startTick: 0, endTick: 11 },
  venueTypes: ["Apartment", "Workplace", "Restaurant", "Pub"],
  coverage: { transmissionsInWindow: 1, recoveryTimeResolution: "daily", cleanPoopKeepFraction: 1 },
  artifacts: ARTIFACTS,
};

function bin(arr: ArrayBufferView): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

// Two transitions for agent 0 (3 bytes each), then one sample (6 bytes).
function diseaseBin(): ArrayBuffer {
  const buf = new ArrayBuffer(2 * 3 + 6);
  const dv = new DataView(buf);
  dv.setUint16(0, 4, true); dv.setUint8(2, 1);
  dv.setUint16(3, 9, true); dv.setUint8(5, 2);
  dv.setUint16(6, 4, true); dv.setFloat32(8, 2.5, true);
  return buf;
}

const FILES: Record<string, unknown> = {
  "manifest.json": MANIFEST,
  "venues_lon.f32": bin(new Float32Array([-117.2, -117.1])),
  "venues_lat.f32": bin(new Float32Array([32.7, 32.8])),
  "venues_type.u8": bin(new Uint8Array([0, 1])),
  "venues_id.i32": bin(new Int32Array([10, 11])),
  "stays_tick.u16": bin(new Uint16Array([0, 6, 0])),
  "stays_dwell.u16": bin(new Uint16Array([4, 6, 12])),
  "stays_venue.u16": bin(new Uint16Array([0, 1, 1])),
  "stays_index.json": [
    { agentId: 0, offset: 0, count: 2 },
    { agentId: 1, offset: 2, count: 1 },
  ],
  "poops_tick.u16": bin(new Uint16Array([1, 5])),
  "poops_lon.u16": bin(new Uint16Array([0, 65535])),
  "poops_lat.u16": bin(new Uint16Array([32768, 0])),
  "poops_pathogen.f32": bin(new Float32Array([0, 9])),
  "disease.bin": diseaseBin(),
  "disease_index.json": [
    { agentId: 0, transOffset: 0, transCount: 2, sampleOffset: 0, sampleCount: 1 },
  ],
  "transmissions.bin": bin(new Uint16Array([3, 1, 0])),
  "aggregates.json": {
    cadenceSec: 3600, startTime: "2024-01-01T00:00:00", gridTicks: [0],
    seir: { S: [2], E: [0], I: [0], R: [0] }, pathogenInflow: [9],
  },
  "wastewater.bin": bin(new Float32Array([1, 2])),
  "wastewater_regions.json": {
    kind: "grid", cadenceSec: 3600, numBins: 1,
    regions: [
      { id: "0_0", centroid: [-117.2, 32.7], polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { id: "1_0", centroid: [-117.1, 32.8], polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    ],
  },
};

function fakeFetch(overrides: Record<string, unknown> = {}): typeof fetch {
  const files = { ...FILES, ...overrides };
  return (async (url: string) => {
    const name = url.split("/").pop()!;
    const body = files[name];
    if (body === undefined) return { ok: false, status: 404 } as Response;
    if (body instanceof ArrayBuffer) {
      return { ok: true, status: 200, arrayBuffer: async () => body } as Response;
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe("loadBundleV2", () => {
  it("decodes artifacts into typed arrays without copying record by record", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.venues.count).toBe(2);
    expect(b.venues.lon[0]).toBeCloseTo(-117.2, 4);
    expect(b.stays.count).toBe(3);
    expect(b.stays.dwell[2]).toBe(12);
    expect(b.poops.count).toBe(2);
    expect(b.wastewater.values.length).toBe(2);
  });

  it("indexes stays by agent id", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.stayIndex.get(0)).toEqual({ offset: 0, count: 2 });
    expect(b.stayIndex.get(1)).toEqual({ offset: 2, count: 1 });
  });

  it("splits disease.bin into per-agent transitions", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.transitionsByAgent.get(0)).toEqual([[4, 1], [9, 2]]);
    expect(b.transitionsByAgent.get(1)).toBeUndefined();
  });

  it("dequantizes poop coordinates back across the bbox", async () => {
    const b = await loadBundleV2("/data/t", fakeFetch());
    expect(b.poopLon(0)).toBeCloseTo(-118, 4);
    expect(b.poopLon(1)).toBeCloseTo(-116, 4);
    expect(b.poopLat(0)).toBeCloseTo(33, 3);
  });

  it("rejects a schemaVersion it does not implement", async () => {
    const fetchFn = fakeFetch({ "manifest.json": { ...MANIFEST, schemaVersion: 1 } });
    await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/schemaVersion/);
  });

  it("reports which artifact failed to load", async () => {
    const fetchFn = fakeFetch({ "stays_tick.u16": undefined });
    await expect(loadBundleV2("/data/t", fetchFn)).rejects.toThrow(/stays_tick/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/loadBundleV2.test.ts`
Expected: FAIL — cannot resolve `../src/data/loadBundleV2`

- [ ] **Step 3: Write the types**

```ts
// app/src/types2.ts
import type { Aggregates, WastewaterRegion } from "./types";

export interface ManifestV2 {
  schemaVersion: 2;
  runId: string;
  tickIntervalSec: number;
  windowStart: string;
  windowEnd: string;
  numTicks: number;
  numAgents: number;
  numVenues: number;
  bbox: [number, number, number, number];
  outbreakWindow: { startTick: number; endTick: number };
  venueTypes: string[];
  coverage: {
    transmissionsInWindow: number;
    recoveryTimeResolution: string;
    cleanPoopKeepFraction: number;
  };
  artifacts: Record<string, string>;
}

export interface Venues {
  lon: Float32Array;
  lat: Float32Array;
  type: Uint8Array;
  id: Int32Array;
  count: number;
}

/** Agent stays, sorted by (agent, tick). `dwell` is in ticks and is always >= 1. */
export interface Stays {
  tick: Uint16Array;
  dwell: Uint16Array;
  venue: Uint16Array;
  count: number;
}

export interface StaySlice {
  offset: number;
  count: number;
}

/** A row of stays_index.json. */
export interface StayIndexEntry extends StaySlice {
  agentId: number;
}

export interface PoopsV2 {
  tick: Uint16Array;
  lonQ: Uint16Array;
  latQ: Uint16Array;
  pathogen: Float32Array;
  count: number;
}

export interface Transmissions {
  tick: Uint16Array;
  source: Uint16Array;
  target: Uint16Array;
  count: number;
}

export interface WastewaterV2 {
  kind: string;
  cadenceSec: number;
  numBins: number;
  regions: WastewaterRegion[];
  values: Float32Array; // row-major [region][bin]
}

export interface BundleV2 {
  base: string;
  manifest: ManifestV2;
  venues: Venues;
  stays: Stays;
  stayIndex: Map<number, StaySlice>;
  agentIds: Int32Array;
  poops: PoopsV2;
  transitionsByAgent: Map<number, [number, number][]>;
  transmissions: Transmissions;
  aggregates: Aggregates;
  wastewater: WastewaterV2;
  poopLon(i: number): number;
  poopLat(i: number): number;
}
```

- [ ] **Step 4: Write the loader**

```ts
// app/src/data/loadBundleV2.ts
import type { Aggregates } from "../types";
import type {
  BundleV2, ManifestV2, PoopsV2, Stays, StayIndexEntry, StaySlice,
  Transmissions, Venues, WastewaterV2,
} from "../types2";

const U16_MAX = 65535;
const TRANSITION_BYTES = 3;

interface DiseaseIndexEntry {
  agentId: number;
  transOffset: number;
  transCount: number;
  sampleOffset: number;
  sampleCount: number;
}

export async function loadBundleV2(
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<BundleV2> {
  const manifest = (await getJson(fetchFn, `${base}/manifest.json`)) as ManifestV2;
  if (manifest.schemaVersion !== 2) {
    throw new Error(
      `Unsupported bundle schemaVersion ${manifest.schemaVersion} (expected 2)`,
    );
  }
  const a = manifest.artifacts;
  const buf = (key: string) => getBuffer(fetchFn, `${base}/${a[key]}`);
  const json = (key: string) => getJson(fetchFn, `${base}/${a[key]}`);

  const [
    venuesLon, venuesLat, venuesType, venuesId,
    staysTick, staysDwell, staysVenue, staysIndex,
    poopsTick, poopsLon, poopsLat, poopsPathogen,
    diseaseBuf, diseaseIndex, transmissionsBuf,
    aggregates, wastewaterBuf, wastewaterRegions,
  ] = await Promise.all([
    buf("venuesLon"), buf("venuesLat"), buf("venuesType"), buf("venuesId"),
    buf("staysTick"), buf("staysDwell"), buf("staysVenue"), json("staysIndex"),
    buf("poopsTick"), buf("poopsLon"), buf("poopsLat"), buf("poopsPathogen"),
    buf("disease"), json("diseaseIndex"), buf("transmissions"),
    json("aggregates"), buf("wastewater"), json("wastewaterRegions"),
  ]);

  const venues: Venues = {
    lon: new Float32Array(venuesLon),
    lat: new Float32Array(venuesLat),
    type: new Uint8Array(venuesType),
    id: new Int32Array(venuesId),
    count: venuesType.byteLength,
  };

  const stays: Stays = {
    tick: new Uint16Array(staysTick),
    dwell: new Uint16Array(staysDwell),
    venue: new Uint16Array(staysVenue),
    count: staysTick.byteLength / 2,
  };

  const indexEntries = staysIndex as StayIndexEntry[];
  const stayIndex = new Map<number, StaySlice>();
  const agentIds = new Int32Array(indexEntries.length);
  indexEntries.forEach((e, i) => {
    agentIds[i] = e.agentId;
    stayIndex.set(e.agentId, { offset: e.offset, count: e.count });
  });

  const poops: PoopsV2 = {
    tick: new Uint16Array(poopsTick),
    lonQ: new Uint16Array(poopsLon),
    latQ: new Uint16Array(poopsLat),
    pathogen: new Float32Array(poopsPathogen),
    count: poopsTick.byteLength / 2,
  };

  const transmissionsRaw = new Uint16Array(transmissionsBuf);
  const txCount = transmissionsRaw.length / 3;
  const transmissions: Transmissions = {
    tick: new Uint16Array(txCount),
    source: new Uint16Array(txCount),
    target: new Uint16Array(txCount),
    count: txCount,
  };
  for (let i = 0; i < txCount; i++) {
    transmissions.tick[i] = transmissionsRaw[i * 3];
    transmissions.source[i] = transmissionsRaw[i * 3 + 1];
    transmissions.target[i] = transmissionsRaw[i * 3 + 2];
  }

  const transitionsByAgent = decodeTransitions(
    diseaseBuf, diseaseIndex as DiseaseIndexEntry[],
  );

  const regionsMeta = wastewaterRegions as Omit<WastewaterV2, "values">;
  const wastewater: WastewaterV2 = {
    ...regionsMeta,
    values: new Float32Array(wastewaterBuf),
  };

  const [minLon, minLat, maxLon, maxLat] = manifest.bbox;
  return {
    base,
    manifest,
    venues,
    stays,
    stayIndex,
    agentIds,
    poops,
    transitionsByAgent,
    transmissions,
    aggregates: aggregates as Aggregates,
    wastewater,
    poopLon: (i) => minLon + (poops.lonQ[i] / U16_MAX) * (maxLon - minLon),
    poopLat: (i) => minLat + (poops.latQ[i] / U16_MAX) * (maxLat - minLat),
  };
}

/** disease.bin is [all transitions][all samples]; only transitions are needed per frame. */
function decodeTransitions(
  buffer: ArrayBuffer,
  index: DiseaseIndexEntry[],
): Map<number, [number, number][]> {
  const dv = new DataView(buffer);
  const out = new Map<number, [number, number][]>();
  for (const e of index) {
    if (e.transCount === 0) continue;
    const list: [number, number][] = [];
    for (let i = 0; i < e.transCount; i++) {
      const o = (e.transOffset + i) * TRANSITION_BYTES;
      list.push([dv.getUint16(o, true), dv.getUint8(o + 2)]);
    }
    out.set(e.agentId, list);
  }
  return out;
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

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run tests/loadBundleV2.test.ts`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add app/src/types2.ts app/src/data/loadBundleV2.ts app/tests/loadBundleV2.test.ts
git commit -m "feat: bundle v2 loader decoding struct-of-arrays artifacts"
```

---

### Task 11: Dwell/travel pose resolution and venue jitter

**Files:**
- Create: `app/src/sim/jitter.ts`
- Create: `app/src/sim/dwell.ts`
- Test: `app/tests/jitter.test.ts`
- Test: `app/tests/dwell.test.ts`

**Interfaces:**
- Consumes: `Stays`, `Venues` (Task 10).
- Produces: `Presence` enum (`Absent = 0, Dwelling = 1, Travelling = 2`); `AgentPose` interface `{ lon: number; lat: number; presence: Presence; venue: number }`; `resolvePose(stays, venues, slice, queryTick, out) => Presence` writing into `out`; `JITTER_RADIUS_M = 30`; `jitterDegrees(agentId, lat) => [number, number]`.

Note on `resolvePose` semantics: `venue` in the output is the venue index the agent is dwelling at, or `-1` while travelling. Jitter is *not* applied inside `resolvePose` — the caller applies it, so occupancy counting and position writing stay separable.

- [ ] **Step 1: Write the failing tests**

```ts
// app/tests/jitter.test.ts
import { describe, it, expect } from "vitest";
import { JITTER_RADIUS_M, jitterDegrees } from "../src/sim/jitter";

const M_PER_DEG_LAT = 111_320;

describe("jitterDegrees", () => {
  it("is a pure function of agentId", () => {
    expect(jitterDegrees(42, 32.7)).toEqual(jitterDegrees(42, 32.7));
  });

  it("gives different agents different offsets", () => {
    const a = jitterDegrees(1, 32.7);
    const b = jitterDegrees(2, 32.7);
    expect(a).not.toEqual(b);
  });

  it("stays inside the 30 m radius", () => {
    for (let id = 0; id < 500; id++) {
      const [dLon, dLat] = jitterDegrees(id, 32.7);
      const north = dLat * M_PER_DEG_LAT;
      const east = dLon * M_PER_DEG_LAT * Math.cos((32.7 * Math.PI) / 180);
      expect(Math.hypot(east, north)).toBeLessThanOrEqual(JITTER_RADIUS_M + 1e-6);
    }
  });

  it("spreads agents around rather than clustering on one bearing", () => {
    const lons = Array.from({ length: 200 }, (_, i) => jitterDegrees(i, 32.7)[0]);
    expect(Math.min(...lons)).toBeLessThan(0);
    expect(Math.max(...lons)).toBeGreaterThan(0);
  });

  it("compensates longitude for latitude so the disc stays round", () => {
    const [equatorLon] = jitterDegrees(7, 0);
    const [highLon] = jitterDegrees(7, 60);
    expect(Math.abs(highLon)).toBeGreaterThan(Math.abs(equatorLon));
  });
});
```

```ts
// app/tests/dwell.test.ts
import { describe, it, expect } from "vitest";
import { Presence, resolvePose, type AgentPose } from "../src/sim/dwell";
import type { Stays, Venues } from "../src/types2";

// Venue 0 at (-117.0, 32.0); venue 1 at (-116.0, 33.0).
const venues: Venues = {
  lon: new Float32Array([-117.0, -116.0]),
  lat: new Float32Array([32.0, 33.0]),
  type: new Uint8Array([0, 1]),
  id: new Int32Array([10, 11]),
  count: 2,
};

// Agent A (slice 0..2): venue 0 from tick 10 for 10 ticks, then venue 1 from tick 30.
// Agent B (slice 2..3): a single stay at venue 1 from tick 0 for 5 ticks.
const stays: Stays = {
  tick: new Uint16Array([10, 30, 0]),
  dwell: new Uint16Array([10, 10, 5]),
  venue: new Uint16Array([0, 1, 1]),
  count: 3,
};

const A = { offset: 0, count: 2 };
const B = { offset: 2, count: 1 };
const pose = (): AgentPose => ({ lon: 0, lat: 0, presence: Presence.Absent, venue: -1 });

describe("resolvePose", () => {
  it("reports Absent before the first check-in", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 9, out)).toBe(Presence.Absent);
  });

  it("parks the agent at its venue for the whole dwell", () => {
    const out = pose();
    for (const t of [10, 15, 19]) {
      expect(resolvePose(stays, venues, A, t, out)).toBe(Presence.Dwelling);
      expect(out.lon).toBeCloseTo(-117.0, 5);
      expect(out.lat).toBeCloseTo(32.0, 5);
      expect(out.venue).toBe(0);
    }
  });

  it("starts travelling on the tick the dwell ends", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 20, out)).toBe(Presence.Travelling);
    expect(out.lon).toBeCloseTo(-117.0, 5);   // alpha 0, still at the origin venue
    expect(out.venue).toBe(-1);
  });

  it("interpolates linearly across the travel gap", () => {
    const out = pose();
    resolvePose(stays, venues, A, 25, out);   // halfway between tick 20 and 30
    expect(out.lon).toBeCloseTo(-116.5, 5);
    expect(out.lat).toBeCloseTo(32.5, 5);
  });

  it("arrives exactly at the next venue on its check-in tick", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 30, out)).toBe(Presence.Dwelling);
    expect(out.lon).toBeCloseTo(-116.0, 5);
    expect(out.venue).toBe(1);
  });

  it("holds at the last venue after its dwell ends", () => {
    const out = pose();
    expect(resolvePose(stays, venues, A, 999, out)).toBe(Presence.Dwelling);
    expect(out.lon).toBeCloseTo(-116.0, 5);
    expect(out.venue).toBe(1);
  });

  it("handles a single-stay agent", () => {
    const out = pose();
    expect(resolvePose(stays, venues, B, 2, out)).toBe(Presence.Dwelling);
    expect(out.venue).toBe(1);
    expect(resolvePose(stays, venues, B, 500, out)).toBe(Presence.Dwelling);
  });

  it("reports Absent for an empty slice", () => {
    const out = pose();
    expect(resolvePose(stays, venues, { offset: 0, count: 0 }, 5, out))
      .toBe(Presence.Absent);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/jitter.test.ts tests/dwell.test.ts`
Expected: FAIL — cannot resolve `../src/sim/jitter` and `../src/sim/dwell`

- [ ] **Step 3: Write the jitter module**

```ts
// app/src/sim/jitter.ts
/**
 * Deterministic per-agent displacement around a venue centroid.
 *
 * 10,000 agents share 12,134 venues, so without this a crowded apartment block
 * and an empty one render identically — every occupant lands on the same pixel.
 * The offset must be a pure function of agentId: anything time-varying makes
 * parked agents vibrate in place.
 */

export const JITTER_RADIUS_M = 30;

const M_PER_DEG_LAT = 111_320;

/** 32-bit integer hash (xorshift-multiply); spreads sequential ids apart. */
function hash(n: number): number {
  let x = n | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  x = Math.imul(x, 0x9e3779b1);
  return x >>> 0;
}

/** [dLon, dLat] in degrees, uniformly distributed on a JITTER_RADIUS_M disc. */
export function jitterDegrees(agentId: number, lat: number): [number, number] {
  const h = hash(agentId);
  const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2;
  // sqrt keeps the distribution uniform by area instead of bunching at the centre.
  const radius = JITTER_RADIUS_M * Math.sqrt(((h >>> 16) & 0xffff) / 0xffff);
  const north = radius * Math.sin(angle);
  const east = radius * Math.cos(angle);
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return [east / (M_PER_DEG_LAT * cosLat), north / M_PER_DEG_LAT];
}
```

- [ ] **Step 4: Write the dwell module**

```ts
// app/src/sim/dwell.ts
import type { Stays, StaySlice, Venues } from "../types2";

export const enum Presence {
  Absent = 0,
  Dwelling = 1,
  Travelling = 2,
}

export interface AgentPose {
  lon: number;
  lat: number;
  presence: Presence;
  /** Venue index while dwelling, -1 while travelling or absent. */
  venue: number;
}

/**
 * Resolve an agent's pose at `queryTick`, writing into `out` to avoid allocating
 * 10,000 objects per frame.
 *
 * A stay owns ticks [tick, tick + dwell). After it ends the agent travels toward
 * the next stay's venue, arriving exactly on that stay's check-in tick. The source
 * data guarantees at least one tick of travel between stays, so the span is never
 * zero.
 */
export function resolvePose(
  stays: Stays,
  venues: Venues,
  slice: StaySlice,
  queryTick: number,
  out: AgentPose,
): Presence {
  const { offset, count } = slice;
  if (count <= 0 || queryTick < stays.tick[offset]) {
    out.presence = Presence.Absent;
    out.venue = -1;
    return Presence.Absent;
  }

  // Last stay whose check-in is at or before queryTick.
  let lo = offset;
  let hi = offset + count - 1;
  let i = offset;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (stays.tick[mid] <= queryTick) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const venue = stays.venue[i];
  const departTick = stays.tick[i] + stays.dwell[i];
  const isLast = i === offset + count - 1;

  if (queryTick < departTick || isLast) {
    out.lon = venues.lon[venue];
    out.lat = venues.lat[venue];
    out.venue = venue;
    out.presence = Presence.Dwelling;
    return Presence.Dwelling;
  }

  const nextVenue = stays.venue[i + 1];
  const arriveTick = stays.tick[i + 1];
  const span = arriveTick - departTick;
  const alpha = span <= 0 ? 1 : (queryTick - departTick) / span;
  out.lon = venues.lon[venue] + (venues.lon[nextVenue] - venues.lon[venue]) * alpha;
  out.lat = venues.lat[venue] + (venues.lat[nextVenue] - venues.lat[venue]) * alpha;
  out.venue = -1;
  out.presence = Presence.Travelling;
  return Presence.Travelling;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/jitter.test.ts tests/dwell.test.ts`
Expected: 13 passed

- [ ] **Step 6: Commit**

```bash
git add app/src/sim/jitter.ts app/src/sim/dwell.ts app/tests/jitter.test.ts app/tests/dwell.test.ts
git commit -m "feat: dwell/travel pose resolution with deterministic venue jitter"
```

---

### Task 12: Typed-array frame builder with occupancy

Replaces the per-frame object array and comparison sort with reused typed arrays, and counts venue occupancy in the same pass.

**Files:**
- Create: `app/src/render/agentFrame.ts`
- Test: `app/tests/agentFrame.test.ts`

**Interfaces:**
- Consumes: `BundleV2` (Task 10), `resolvePose`/`Presence` and `jitterDegrees` (Task 11), `stateAtTick` from `src/sim/diseaseState.ts`.
- Produces: `AgentFrame` interface `{ positions: Float32Array; codes: Uint8Array; presence: Uint8Array; order: Uint32Array; visible: number; occupancy: Uint16Array }`; `createAgentFrame(bundle) => AgentFrame`; `updateAgentFrame(frame, bundle, tick) => void`.

`positions` is packed `[lon0, lat0, lon1, lat1, …]` indexed by *agent slot* (the position of the agent in `bundle.agentIds`), not by agent id. `order` lists the first `visible` slots, grouped so state code 0 then 3 then 1 then 2 — matching the existing `DRAW_PRIORITY` so Exposed and Infectious draw over the calm crowd.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/agentFrame.test.ts
import { describe, it, expect } from "vitest";
import { createAgentFrame, updateAgentFrame } from "../src/render/agentFrame";
import { Presence } from "../src/sim/dwell";
import type { BundleV2 } from "../src/types2";

function makeBundle(): BundleV2 {
  const venues = {
    lon: new Float32Array([-117.0, -116.0]),
    lat: new Float32Array([32.0, 33.0]),
    type: new Uint8Array([0, 1]),
    id: new Int32Array([10, 11]),
    count: 2,
  };
  // Agent 0: venue 0 tick 0 dwell 10, then venue 1 tick 20 dwell 10.
  // Agent 1: venue 0 tick 0 dwell 100.
  // Agent 2: venue 1 tick 50 dwell 10  (absent before tick 50).
  const stays = {
    tick: new Uint16Array([0, 20, 0, 50]),
    dwell: new Uint16Array([10, 10, 100, 10]),
    venue: new Uint16Array([0, 1, 0, 1]),
    count: 4,
  };
  const stayIndex = new Map([
    [0, { offset: 0, count: 2 }],
    [1, { offset: 2, count: 1 }],
    [2, { offset: 3, count: 1 }],
  ]);
  return {
    base: "/x",
    manifest: { numVenues: 2 } as BundleV2["manifest"],
    venues,
    stays,
    stayIndex,
    agentIds: new Int32Array([0, 1, 2]),
    poops: { tick: new Uint16Array(), lonQ: new Uint16Array(),
             latQ: new Uint16Array(), pathogen: new Float32Array(), count: 0 },
    transitionsByAgent: new Map([[1, [[0, 2]]]]),   // agent 1 infectious from tick 0
    transmissions: { tick: new Uint16Array(), source: new Uint16Array(),
                     target: new Uint16Array(), count: 0 },
    aggregates: {} as BundleV2["aggregates"],
    wastewater: { kind: "grid", cadenceSec: 3600, numBins: 0, regions: [],
                  values: new Float32Array() },
    poopLon: () => 0,
    poopLat: () => 0,
  };
}

describe("agentFrame", () => {
  it("allocates arrays sized to the agent and venue counts", () => {
    const f = createAgentFrame(makeBundle());
    expect(f.positions.length).toBe(6);
    expect(f.codes.length).toBe(3);
    expect(f.occupancy.length).toBe(2);
  });

  it("omits agents that have not checked in yet", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    expect(f.visible).toBe(2);
    expect(f.presence[2]).toBe(Presence.Absent);
  });

  it("counts venue occupancy only for dwelling agents", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    expect(Array.from(f.occupancy)).toEqual([2, 0]);   // agents 0 and 1 in venue 0
    updateAgentFrame(f, b, 15);                        // agent 0 now travelling
    expect(Array.from(f.occupancy)).toEqual([1, 0]);
  });

  it("resets occupancy between frames instead of accumulating", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    updateAgentFrame(f, b, 5);
    expect(Array.from(f.occupancy)).toEqual([2, 0]);
  });

  it("applies jitter so co-located agents get distinct positions", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    expect(f.positions[0]).not.toBe(f.positions[2]);
    expect(f.positions[0]).toBeCloseTo(-117.0, 2);   // still essentially at the venue
  });

  it("does not jitter travelling agents", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 25);                       // agent 0 halfway to venue 1
    expect(f.positions[0]).toBeCloseTo(-116.5, 5);
    expect(f.positions[1]).toBeCloseTo(32.5, 5);
  });

  it("orders visible slots so infectious agents draw last", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const order = Array.from(f.order.slice(0, f.visible));
    expect(f.codes[order[order.length - 1]]).toBe(2);   // agent 1 is Infectious
    expect(f.codes[order[0]]).toBe(0);
  });

  it("reuses the same array instances across frames", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    const positions = f.positions;
    updateAgentFrame(f, b, 5);
    updateAgentFrame(f, b, 60);
    expect(f.positions).toBe(positions);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/agentFrame.test.ts`
Expected: FAIL — cannot resolve `../src/render/agentFrame`

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/render/agentFrame.ts
import { Presence, resolvePose, type AgentPose } from "../sim/dwell";
import { jitterDegrees } from "../sim/jitter";
import { stateAtTick } from "../sim/diseaseState";
import type { BundleV2 } from "../types2";

/**
 * Per-frame agent state in reusable typed arrays.
 *
 * The v1 path allocated an object per agent and sorted the array every frame. At
 * 10,000 agents and 60 fps that is 600k allocations per second; here nothing is
 * allocated after setup and draw order comes from four fixed buckets rather than a
 * comparison sort.
 *
 * Arrays are indexed by *slot* — the agent's position in `bundle.agentIds` — not by
 * agent id.
 */
export interface AgentFrame {
  positions: Float32Array;   // packed [lon, lat] per slot
  codes: Uint8Array;         // disease state code per slot
  presence: Uint8Array;      // Presence per slot
  order: Uint32Array;        // first `visible` entries are slots in draw order
  visible: number;
  occupancy: Uint16Array;    // agents currently inside each venue
}

// S and R form the calm backdrop; E then I draw over them.
const DRAW_BUCKETS = [0, 3, 1, 2];

export function createAgentFrame(bundle: BundleV2): AgentFrame {
  const n = bundle.agentIds.length;
  return {
    positions: new Float32Array(n * 2),
    codes: new Uint8Array(n),
    presence: new Uint8Array(n),
    order: new Uint32Array(n),
    visible: 0,
    occupancy: new Uint16Array(bundle.manifest.numVenues),
  };
}

const pose: AgentPose = { lon: 0, lat: 0, presence: Presence.Absent, venue: -1 };
const buckets: number[][] = [[], [], [], []];

export function updateAgentFrame(
  frame: AgentFrame,
  bundle: BundleV2,
  tick: number,
): void {
  const { stays, venues, stayIndex, agentIds, transitionsByAgent } = bundle;
  frame.occupancy.fill(0);
  for (const b of buckets) b.length = 0;

  for (let slot = 0; slot < agentIds.length; slot++) {
    const agentId = agentIds[slot];
    const slice = stayIndex.get(agentId);
    if (!slice) {
      frame.presence[slot] = Presence.Absent;
      continue;
    }

    const presence = resolvePose(stays, venues, slice, tick, pose);
    frame.presence[slot] = presence;
    if (presence === Presence.Absent) continue;

    let lon = pose.lon;
    let lat = pose.lat;
    if (presence === Presence.Dwelling) {
      frame.occupancy[pose.venue]++;
      const [dLon, dLat] = jitterDegrees(agentId, lat);
      lon += dLon;
      lat += dLat;
    }
    frame.positions[slot * 2] = lon;
    frame.positions[slot * 2 + 1] = lat;

    const code = stateAtTick(transitionsByAgent.get(agentId) ?? [], tick);
    frame.codes[slot] = code;
    buckets[code].push(slot);
  }

  let w = 0;
  for (const code of DRAW_BUCKETS) {
    for (const slot of buckets[code]) frame.order[w++] = slot;
  }
  frame.visible = w;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/agentFrame.test.ts`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/render/agentFrame.ts app/tests/agentFrame.test.ts
git commit -m "feat: typed-array agent frame with venue occupancy counting"
```

---

### Task 13: v2 deck.gl layers

**Files:**
- Create: `app/src/render/layersV2.ts`
- Test: `app/tests/layersV2.test.ts`

**Interfaces:**
- Consumes: `AgentFrame` (Task 12), `BundleV2` (Task 10), `STATE_COLORS`/`VENUE_COLORS`/`dayNightTint`/`scaleRgb` from `src/render/theme.ts`.
- Produces: `agentBinaryData(frame, hour) => { length, attributes }` for deck.gl binary input; `makeAgentLayerV2(frame, hour)`; `makeTravelTrailLayer(frame, bundle, tick)`; `venueOccupancyData(bundle, frame) => VenueOccupancyDatum[]` where `VenueOccupancyDatum` is `{ position: [number, number]; type: number; occupancy: number }`; `makeVenueOccupancyLayer(data)`; `poopDataV2(bundle, tick) => PoopDatumV2[]` where `PoopDatumV2` is `{ position: [number, number]; age: number; infected: number }`; `countVenuesByTypeV2(bundle) => Record<number, number>`.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/layersV2.test.ts
import { describe, it, expect } from "vitest";
import {
  agentBinaryData, countVenuesByTypeV2, poopDataV2, venueOccupancyData,
} from "../src/render/layersV2";
import { createAgentFrame, updateAgentFrame } from "../src/render/agentFrame";
import type { BundleV2 } from "../src/types2";

function makeBundle(): BundleV2 {
  return {
    base: "/x",
    manifest: {
      numVenues: 2, bbox: [-118, 32, -116, 34],
      venueTypes: ["Apartment", "Workplace", "Restaurant", "Pub"],
    } as BundleV2["manifest"],
    venues: {
      lon: new Float32Array([-117.0, -116.5]),
      lat: new Float32Array([32.0, 33.0]),
      type: new Uint8Array([0, 3]),
      id: new Int32Array([10, 11]),
      count: 2,
    },
    stays: {
      tick: new Uint16Array([0, 0]),
      dwell: new Uint16Array([100, 100]),
      venue: new Uint16Array([0, 0]),
      count: 2,
    },
    stayIndex: new Map([[0, { offset: 0, count: 1 }], [1, { offset: 1, count: 1 }]]),
    agentIds: new Int32Array([0, 1]),
    poops: {
      tick: new Uint16Array([0, 10, 40]),
      lonQ: new Uint16Array([0, 32768, 65535]),
      latQ: new Uint16Array([0, 32768, 65535]),
      pathogen: new Float32Array([0, 5, 0]),
      count: 3,
    },
    transitionsByAgent: new Map(),
    transmissions: { tick: new Uint16Array(), source: new Uint16Array(),
                     target: new Uint16Array(), count: 0 },
    aggregates: {} as BundleV2["aggregates"],
    wastewater: { kind: "grid", cadenceSec: 3600, numBins: 0, regions: [],
                  values: new Float32Array() },
    poopLon: (i) => -118 + (i === 0 ? 0 : i === 1 ? 1 : 2),
    poopLat: (i) => 32 + (i === 0 ? 0 : i === 1 ? 1 : 2),
  };
}

describe("agentBinaryData", () => {
  it("exposes packed positions and a 4-channel colour attribute", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const data = agentBinaryData(f, 12);
    expect(data.length).toBe(2);
    expect(data.attributes.getPosition.size).toBe(2);
    expect(data.attributes.getColor.size).toBe(4);
    expect(data.attributes.getColor.value.length).toBe(2 * 4);
  });

  it("orders vertices by draw priority, not slot order", () => {
    const b = makeBundle();
    b.transitionsByAgent = new Map([[0, [[0, 2]]]]);   // agent 0 Infectious
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const data = agentBinaryData(f, 12);
    // Agent 0 must be drawn last, so its position occupies the final vertex.
    const lastLon = data.attributes.getPosition.value[2];
    expect(lastLon).toBeCloseTo(f.positions[0], 5);
  });
});

describe("venueOccupancyData", () => {
  it("emits one row per venue carrying its live occupancy", () => {
    const b = makeBundle();
    const f = createAgentFrame(b);
    updateAgentFrame(f, b, 5);
    const rows = venueOccupancyData(b, f);
    expect(rows).toHaveLength(2);
    expect(rows[0].occupancy).toBe(2);
    expect(rows[1].occupancy).toBe(0);
    expect(rows[0].position[0]).toBeCloseTo(-117.0, 5);
    expect(rows[1].type).toBe(3);
  });
});

describe("poopDataV2", () => {
  it("includes only events inside the fade window and ages them", () => {
    const rows = poopDataV2(makeBundle(), 10);
    expect(rows).toHaveLength(2);            // ticks 0 and 10, not 40
    expect(rows[1].age).toBeCloseTo(0, 5);   // tick 10 just happened
    expect(rows[0].age).toBeGreaterThan(0);
  });

  it("marks pathogen-bearing events as infected", () => {
    const rows = poopDataV2(makeBundle(), 10);
    expect(rows[1].infected).toBe(1);
    expect(rows[0].infected).toBe(0);
  });

  it("dequantizes coordinates through the bundle helpers", () => {
    const rows = poopDataV2(makeBundle(), 10);
    expect(rows[0].position).toEqual([-118, 32]);
  });
});

describe("countVenuesByTypeV2", () => {
  it("counts from the venue table rather than deduping waypoints", () => {
    expect(countVenuesByTypeV2(makeBundle())).toEqual({ 0: 1, 1: 0, 2: 0, 3: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/layersV2.test.ts`
Expected: FAIL — cannot resolve `../src/render/layersV2`

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/render/layersV2.ts
import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { AgentFrame } from "./agentFrame";
import { Presence } from "../sim/dwell";
import { STATE_COLORS, VENUE_COLORS, dayNightTint, scaleRgb } from "./theme";
import type { BundleV2 } from "../types2";

export interface AgentBinaryData {
  length: number;
  attributes: {
    getPosition: { value: Float32Array; size: 2 };
    getColor: { value: Uint8Array; size: 4 };
  };
}

// Reused across frames; grown only when the visible count exceeds capacity.
let positionScratch = new Float32Array(0);
let colorScratch = new Uint8Array(0);

/**
 * Repack the frame's visible slots into contiguous deck.gl binary attributes.
 * Vertices follow `frame.order`, so Exposed/Infectious agents land last and draw
 * on top of the calm crowd.
 */
export function agentBinaryData(frame: AgentFrame, hour: number): AgentBinaryData {
  const n = frame.visible;
  if (positionScratch.length < n * 2) {
    positionScratch = new Float32Array(n * 2);
    colorScratch = new Uint8Array(n * 4);
  }
  const tint = dayNightTint(hour);

  for (let v = 0; v < n; v++) {
    const slot = frame.order[v];
    positionScratch[v * 2] = frame.positions[slot * 2];
    positionScratch[v * 2 + 1] = frame.positions[slot * 2 + 1];
    const [r, g, b, a] = scaleRgb(STATE_COLORS[frame.codes[slot]], tint);
    colorScratch[v * 4] = r;
    colorScratch[v * 4 + 1] = g;
    colorScratch[v * 4 + 2] = b;
    colorScratch[v * 4 + 3] = a;
  }

  return {
    length: n,
    attributes: {
      getPosition: { value: positionScratch.subarray(0, n * 2), size: 2 },
      getColor: { value: colorScratch.subarray(0, n * 4), size: 4 },
    },
  };
}

const AGENT_ICON_MAPPING = {
  marker: { x: 0, y: 0, width: 128, height: 128, mask: true, anchorY: 116 },
};

export function makeAgentLayerV2(data: AgentBinaryData, updateTrigger: number) {
  return new IconLayer({
    id: "agents",
    data,
    iconAtlas: "/sprites/agent.png",
    iconMapping: AGENT_ICON_MAPPING,
    getIcon: () => "marker",
    getSize: 1500,
    sizeUnits: "meters",
    sizeMinPixels: 5,
    sizeMaxPixels: 34,
    billboard: true,
    alphaCutoff: 0.05,
    updateTriggers: { getPosition: updateTrigger, getColor: updateTrigger },
  });
}

/**
 * A faint dot behind each travelling agent. Travel occupies only a few percent of
 * an agent's timeline, so without a distinct treatment commute waves are invisible
 * against the parked majority.
 */
export function makeTravelTrailLayer(frame: AgentFrame, tick: number) {
  const moving: { position: [number, number] }[] = [];
  for (let v = 0; v < frame.visible; v++) {
    const slot = frame.order[v];
    if (frame.presence[slot] === Presence.Travelling) {
      moving.push({
        position: [frame.positions[slot * 2], frame.positions[slot * 2 + 1]],
      });
    }
  }
  return new ScatterplotLayer<{ position: [number, number] }>({
    id: "travel-trails",
    data: moving,
    getPosition: (d) => d.position,
    getFillColor: [255, 255, 255, 60],
    getRadius: 900,
    radiusUnits: "meters",
    radiusMinPixels: 3,
    radiusMaxPixels: 18,
    stroked: false,
    pickable: false,
    updateTriggers: { getPosition: tick },
  });
}

export interface VenueOccupancyDatum {
  position: [number, number];
  type: number;
  occupancy: number;
}

export function venueOccupancyData(
  bundle: BundleV2,
  frame: AgentFrame,
): VenueOccupancyDatum[] {
  const { venues } = bundle;
  const rows: VenueOccupancyDatum[] = new Array(venues.count);
  for (let i = 0; i < venues.count; i++) {
    rows[i] = {
      position: [venues.lon[i], venues.lat[i]],
      type: venues.type[i],
      occupancy: frame.occupancy[i],
    };
  }
  return rows;
}

export function makeVenueOccupancyLayer(data: VenueOccupancyDatum[], tick: number) {
  return new ScatterplotLayer<VenueOccupancyDatum>({
    id: "venues",
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => VENUE_COLORS[d.type],
    // Radius grows with the square root of occupancy so a busy venue reads as busy
    // without a full apartment block swamping the map.
    getRadius: (d) => 25 + 55 * Math.sqrt(d.occupancy),
    radiusUnits: "meters",
    radiusMinPixels: 1.5,
    radiusMaxPixels: 22,
    opacity: 0.5,
    stroked: false,
    updateTriggers: { getRadius: tick },
  });
}

export interface PoopDatumV2 {
  position: [number, number];
  age: number;
  infected: number;
}

const SPLASH_WINDOW_TICKS = 24; // ~2 hours of fade

export function poopDataV2(bundle: BundleV2, tick: number): PoopDatumV2[] {
  const { poops } = bundle;
  const lowTick = tick - SPLASH_WINDOW_TICKS;
  let lo = 0;
  let hi = poops.count - 1;
  let startIdx = poops.count;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (poops.tick[mid] >= lowTick) {
      startIdx = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const out: PoopDatumV2[] = [];
  for (let i = startIdx; i < poops.count && poops.tick[i] <= tick; i++) {
    out.push({
      position: [bundle.poopLon(i), bundle.poopLat(i)],
      age: (tick - poops.tick[i]) / SPLASH_WINDOW_TICKS,
      infected: poops.pathogen[i] > 0 ? 1 : 0,
    });
  }
  return out;
}

export function countVenuesByTypeV2(bundle: BundleV2): Record<number, number> {
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < bundle.venues.count; i++) {
    counts[bundle.venues.type[i]]++;
  }
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/layersV2.test.ts`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/render/layersV2.ts app/tests/layersV2.test.ts
git commit -m "feat: v2 deck.gl layers with venue occupancy and travel trails"
```

---

### Task 14: Wire the app to the v2 bundle

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/ui/MapView.tsx`
- Modify: `app/src/ui/Hud.tsx`
- Modify: `app/src/ui/Timeline.tsx`
- Create: `app/src/hooks/useBundleV2.ts`
- Modify: `app/vite.config.ts`
- Test: `app/tests/useBundleV2.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 10–13.
- Produces: `useBundleV2(base) => { status: "loading" } | { status: "error"; message: string } | { status: "ready"; bundle: BundleV2 }`.

- [ ] **Step 1: Read the current components before editing**

Read `app/src/hooks/useBundle.ts`, `app/src/ui/MapView.tsx`, `app/src/ui/Hud.tsx` and `app/src/ui/Timeline.tsx` in full. They are written against `Manifest` (v1) and `Bundle`; each reference to `manifest.startTime` / `manifest.endTime` becomes `manifest.windowStart` / `manifest.windowEnd`.

- [ ] **Step 2: Write the failing test**

The genuinely new logic in this task is the loading state machine, so that is what gets a test. Create it as its own file rather than appending to the smoke test.

```ts
// app/tests/useBundleV2.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBundleV2 } from "../src/hooks/useBundleV2";

const loadBundleV2 = vi.hoisted(() => vi.fn());
vi.mock("../src/data/loadBundleV2", () => ({ loadBundleV2 }));

beforeEach(() => loadBundleV2.mockReset());

describe("useBundleV2", () => {
  it("starts in the loading state", () => {
    loadBundleV2.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useBundleV2("/data/x"));
    expect(result.current.status).toBe("loading");
  });

  it("exposes the bundle once it resolves", async () => {
    const bundle = { manifest: { runId: "x" } };
    loadBundleV2.mockResolvedValue(bundle);
    const { result } = renderHook(() => useBundleV2("/data/x"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ status: "ready", bundle });
  });

  it("surfaces the failure message rather than throwing", async () => {
    loadBundleV2.mockRejectedValue(new Error("stays_tick.u16 404"));
    const { result } = renderHook(() => useBundleV2("/data/x"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ message: "stays_tick.u16 404" });
  });

  it("ignores a resolution that lands after unmount", async () => {
    let resolve!: (v: unknown) => void;
    loadBundleV2.mockReturnValue(new Promise((r) => { resolve = r; }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useBundleV2("/data/x"));
    unmount();
    resolve({ manifest: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.status).toBe("loading");   // never advanced post-unmount
    expect(errors).not.toHaveBeenCalled();           // no setState-after-unmount warning
    errors.mockRestore();
  });
});
```

This needs the React testing helpers:

```bash
cd app && npm install --save-dev @testing-library/react @testing-library/dom jsdom
```

and `jsdom` as the vitest environment. Add to `vite.config.ts`:

```ts
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom" },
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/useBundleV2.test.ts`
Expected: FAIL — cannot resolve `../src/hooks/useBundleV2`

- [ ] **Step 4: Add the v2 hook**

```ts
// app/src/hooks/useBundleV2.ts
import { useEffect, useState } from "react";
import { loadBundleV2 } from "../data/loadBundleV2";
import type { BundleV2 } from "../types2";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bundle: BundleV2 };

export function useBundleV2(base: string): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadBundleV2(base)
      .then((bundle) => {
        if (!cancelled) setState({ status: "ready", bundle });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  return state;
}
```

- [ ] **Step 5: Point the app at the new bundle**

In `App.tsx`: change `BUNDLE_BASE` to `"/data/dataset_sdc-10k"`, swap `useBundle` for `useBundleV2`, and replace `countVenuesByType` with `countVenuesByTypeV2`. Create the agent frame once with `useMemo(() => createAgentFrame(bundle), [bundle])` and pass it to `MapView`.

In `MapView.tsx`, replace the layer assembly with the v2 equivalents. The frame is mutated in place and then read by every layer, so the update must happen before any of them are built:

```tsx
// inside MapView, replacing the v1 layer construction
const hour = hourOfDay(bundle.manifest.windowStart, tick, bundle.manifest.tickIntervalSec);

updateAgentFrame(frame, bundle, tick);

const layers = [
  flags.venues &&
    makeVenueOccupancyLayer(venueOccupancyData(bundle, frame), tick),
  flags.poops && makePoopLayer(poopDataV2(bundle, tick)),
  flags.agents && makeTravelTrailLayer(frame, tick),
  flags.agents && makeAgentLayerV2(agentBinaryData(frame, hour), tick),
].filter(Boolean);
```

Keep whatever the existing file names its poop layer factory and its hour helper — only the data sources change. If `MapView` currently derives the hour from `manifest.startTime`, repoint it at `windowStart`.

In `Hud.tsx`: add a line reading the manifest's coverage, worded so it neither overstates the window nor the precision — for example `Jan 1 – Jul 31 2024 · recovery times resolved to the day`. Derive the dates from `manifest.windowStart` / `manifest.windowEnd` rather than hardcoding them.

In `Timeline.tsx`: replace `manifest.startTime` / `manifest.endTime` with `windowStart` / `windowEnd`.

- [ ] **Step 6: Typecheck, test and build**

Run: `cd app && npx tsc --noEmit && npm test && npm run build`
Expected: no type errors, all tests pass, build succeeds

- [ ] **Step 7: Verify in the browser**

Run: `cd app && npm run dev`

Confirm by looking at the running app: agents visibly sit at venues rather than gliding constantly; venue markers grow where agents cluster; a commute wave shows moving agents around 08:00 and 17:00 sim-time; splashes appear and fade; the SEIR chart peaks in late April; the timeline spans Jan 1 to Jul 31. Note the observed frame rate — if it is below ~30 fps with all layers on, record the number rather than declaring success.

- [ ] **Step 8: Commit**

```bash
git add app/src/App.tsx app/src/ui/MapView.tsx app/src/ui/Hud.tsx app/src/ui/Timeline.tsx app/src/hooks/useBundleV2.ts app/tests/useBundleV2.test.ts app/vite.config.ts app/package.json app/package-lock.json
git commit -m "feat: render the dataset_sdc-10k bundle with dwell and occupancy"
```

---

## Notes for the implementer

- **`dataset_00` is the regression canary.** Its bundle must stay byte-identical. If `test_build_integration.py` changes behaviour, something in Task 1 leaked.
- **Never widen the window without widening the field types.** `to_u16` raises for a reason; the fix is a narrower window or a deliberate move to `uint32`, not a silenced guard.
- **Aggregates and wastewater must never read the render stream.** If a test shows inflow changing when `--clean-keep-fraction` changes, that coupling has been reintroduced.
- **Jitter must stay a pure function of `agentId`.** Adding tick or randomness makes parked agents vibrate.
- The preprocessor run in Task 9 takes 10–25 minutes on 585 MB of parquet; it is not hung.
