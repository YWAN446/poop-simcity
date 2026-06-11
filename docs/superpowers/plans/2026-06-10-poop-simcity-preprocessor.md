# Poop SimCity Preprocessor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python preprocessor that reads the `dataset_00/` parquet files once and emits a compact, static, web-ready **data bundle** (`app/public/data/dataset_00/`) consumed by the Poop SimCity web app.

**Architecture:** A small pure-function library (one module per artifact) plus a `build` orchestrator and CLI. Each transform takes pandas DataFrames and returns plain Python structures or `bytes`; the orchestrator wires them to parquet input and writes JSON/binary outputs plus a `manifest.json`. Heavy parquet → compact bundle is run rarely at build time.

**Tech Stack:** Python 3.11+, pandas, pyarrow, numpy, pytest.

This is **Plan 1 of 2**. Plan 2 (the React web app) is written after this preprocessor runs against the real dataset, so it can target the concrete bundle on disk.

**Spec:** `docs/superpowers/specs/2026-06-10-poop-simcity-visualizer-design.md` (sections 2 and 4 define the inputs and the exact bundle format this plan implements).

---

## File Structure

```
preprocess/
  requirements.txt
  pytest.ini
  poop_simcity_preprocess/
    __init__.py
    constants.py        # VENUE_TYPES, STATE_CODES, TICK_INTERVAL_SEC
    timeutil.py         # time -> integer tick conversion (scalar + Series)
    encoding.py         # numpy binary dtypes for agents.bin / poops.bin
    agents.py           # check_in -> agent track bytes + index
    disease.py          # disease_status -> transitions, pathogen samples, transmissions
    poops.py            # poop_in -> poop event bytes
    aggregates.py       # hourly SEIR counts + pathogen inflow
    outbreak.py         # outbreak window detection
    wastewater.py       # spatial grid binning of pathogen
    manifest.py         # manifest.json assembly
    build.py            # orchestrator: parquet dir -> bundle dir
    cli.py              # `python -m poop_simcity_preprocess.cli ...`
  tests/
    test_timeutil.py
    test_encoding.py
    test_agents.py
    test_disease.py
    test_poops.py
    test_aggregates.py
    test_outbreak.py
    test_wastewater.py
    test_manifest.py
    test_build_integration.py
```

Each artifact module is independently testable with tiny synthetic DataFrames. The orchestrator is covered by one integration test on a synthetic dataset, then run for real against `dataset_00/`.

---

### Task 0: Project scaffolding & constants

**Files:**
- Create: `preprocess/requirements.txt`
- Create: `preprocess/pytest.ini`
- Create: `preprocess/poop_simcity_preprocess/__init__.py`
- Create: `preprocess/poop_simcity_preprocess/constants.py`
- Test: `preprocess/tests/test_constants_smoke.py`

- [ ] **Step 1: Create dependency and config files**

`preprocess/requirements.txt`:
```
pandas>=2.0
pyarrow>=14.0
numpy>=1.24
pytest>=7.0
```

`preprocess/pytest.ini`:
```ini
[pytest]
testpaths = tests
pythonpath = .
```

`preprocess/poop_simcity_preprocess/__init__.py`:
```python
__version__ = "0.1.0"
```

`preprocess/poop_simcity_preprocess/constants.py`:
```python
"""Shared constants for the Poop SimCity preprocessor."""

# Seconds per simulation tick (5 minutes).
TICK_INTERVAL_SEC = 300

# Venue type order is the source of truth for venue_type_id encoding.
VENUE_TYPES = ["Apartment", "Workplace", "Restaurant", "Pub"]
VENUE_TYPE_TO_ID = {name: i for i, name in enumerate(VENUE_TYPES)}

# Disease state string -> integer code used throughout the bundle.
STATE_CODES = {"Susceptible": 0, "Exposed": 1, "Infectious": 2, "Recovered": 3}
STATE_CODE_NAMES = {"S": 0, "E": 1, "I": 2, "R": 3}
```

- [ ] **Step 2: Write the smoke test**

`preprocess/tests/test_constants_smoke.py`:
```python
from poop_simcity_preprocess import constants


def test_venue_ids_are_dense_and_ordered():
    assert constants.VENUE_TYPE_TO_ID["Apartment"] == 0
    assert constants.VENUE_TYPE_TO_ID["Pub"] == 3
    assert set(constants.VENUE_TYPE_TO_ID.values()) == {0, 1, 2, 3}


def test_state_codes():
    assert constants.STATE_CODES["Susceptible"] == 0
    assert constants.STATE_CODES["Recovered"] == 3
    assert constants.TICK_INTERVAL_SEC == 300
```

- [ ] **Step 3: Install deps and run the test**

Run (from `preprocess/`):
```
pip install -r requirements.txt
python -m pytest tests/test_constants_smoke.py -v
```
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add preprocess/
git commit -m "chore: scaffold preprocessor package and constants"
```

---

### Task 1: Tick conversion (`timeutil`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/timeutil.py`
- Test: `preprocess/tests/test_timeutil.py`

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_timeutil.py`:
```python
import pandas as pd
from poop_simcity_preprocess.timeutil import time_to_tick


def test_scalar_tick_is_zero_at_start():
    start = pd.Timestamp("2024-01-01 00:05:00")
    assert time_to_tick(pd.Timestamp("2024-01-01 00:05:00"), start) == 0


def test_scalar_tick_counts_five_minute_steps():
    start = pd.Timestamp("2024-01-01 00:05:00")
    assert time_to_tick(pd.Timestamp("2024-01-01 00:10:00"), start) == 1
    assert time_to_tick(pd.Timestamp("2024-01-01 01:05:00"), start) == 12


def test_series_tick_conversion():
    start = pd.Timestamp("2024-01-01 00:05:00")
    s = pd.Series(pd.to_datetime(
        ["2024-01-01 00:05:00", "2024-01-01 00:10:00", "2024-01-02 00:05:00"]
    ))
    out = time_to_tick(s, start)
    assert list(out) == [0, 1, 288]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_timeutil.py -v`
Expected: FAIL with `ModuleNotFoundError: ... timeutil`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/timeutil.py`:
```python
"""Convert wall-clock timestamps to integer simulation ticks."""

import pandas as pd

from .constants import TICK_INTERVAL_SEC


def time_to_tick(times, start_time):
    """Return integer tick index = floor((time - start) / 300s).

    Accepts a single Timestamp (returns int) or a Series (returns int64 Series).
    """
    start = pd.Timestamp(start_time)
    if isinstance(times, pd.Series):
        delta = pd.to_datetime(times) - start
        return (delta.dt.total_seconds() // TICK_INTERVAL_SEC).astype("int64")
    delta = pd.Timestamp(times) - start
    return int(delta.total_seconds() // TICK_INTERVAL_SEC)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_timeutil.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/timeutil.py preprocess/tests/test_timeutil.py
git commit -m "feat: add time-to-tick conversion"
```

---

### Task 2: Binary encoding dtypes (`encoding`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/encoding.py`
- Test: `preprocess/tests/test_encoding.py`

The bundle stores agent waypoints and poop events as tightly packed binary records the browser decodes with a `DataView`. These numpy dtypes are the contract; the web-app plan must mirror these exact field offsets.

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_encoding.py`:
```python
import numpy as np
from poop_simcity_preprocess.encoding import (
    AGENT_WAYPOINT_DTYPE,
    POOP_EVENT_DTYPE,
    records_to_bytes,
)


def test_dtype_itemsizes_are_stable():
    # Field layout is a wire contract with the browser; lock the sizes.
    assert AGENT_WAYPOINT_DTYPE.itemsize == 13
    assert POOP_EVENT_DTYPE.itemsize == 18


def test_agent_record_roundtrip():
    arr = np.zeros(2, dtype=AGENT_WAYPOINT_DTYPE)
    arr[0] = (5, -84.4, 33.7, 2)
    arr[1] = (17, -84.39, 33.71, 0)
    raw = records_to_bytes(arr)
    back = np.frombuffer(raw, dtype=AGENT_WAYPOINT_DTYPE)
    assert back[0]["tick"] == 5
    assert abs(back[1]["lon"] - (-84.39)) < 1e-4
    assert back[0]["vtype"] == 2


def test_poop_record_roundtrip():
    arr = np.zeros(1, dtype=POOP_EVENT_DTYPE)
    arr[0] = (9, -84.5, 33.6, 1, 1, 1.0e7)
    raw = records_to_bytes(arr)
    back = np.frombuffer(raw, dtype=POOP_EVENT_DTYPE)
    assert back[0]["tick"] == 9
    assert back[0]["infected"] == 1
    assert abs(back[0]["pathogen"] - 1.0e7) / 1.0e7 < 1e-3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_encoding.py -v`
Expected: FAIL with `ModuleNotFoundError: ... encoding`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/encoding.py`:
```python
"""Binary record layouts shared with the browser (decoded via DataView).

Tightly packed, little-endian. Field order and offsets are a wire contract:
AGENT_WAYPOINT (13 bytes): tick u32, lon f32, lat f32, vtype u8
POOP_EVENT     (18 bytes): tick u32, lon f32, lat f32, vtype u8, infected u8, pathogen f32
"""

import numpy as np

AGENT_WAYPOINT_DTYPE = np.dtype(
    [("tick", "<u4"), ("lon", "<f4"), ("lat", "<f4"), ("vtype", "<u1")]
)

POOP_EVENT_DTYPE = np.dtype(
    [
        ("tick", "<u4"),
        ("lon", "<f4"),
        ("lat", "<f4"),
        ("vtype", "<u1"),
        ("infected", "<u1"),
        ("pathogen", "<f4"),
    ]
)


def records_to_bytes(arr: np.ndarray) -> bytes:
    """Serialize a structured array to tightly packed little-endian bytes."""
    return arr.tobytes()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_encoding.py -v`
Expected: 3 passed.

> Note: numpy packs these dtypes without padding (`align=False` default), so itemsizes are 13 and 18. The `test_dtype_itemsizes_are_stable` test guards against accidental change.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/encoding.py preprocess/tests/test_encoding.py
git commit -m "feat: add binary record dtypes for agent/poop bundle data"
```

---

### Task 3: Agent tracks (`agents`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/agents.py`
- Test: `preprocess/tests/test_agents.py`

Produces `agents.bin` bytes (waypoints sorted by agent, then tick) plus an index list `[{agentId, offset, count}]` where `offset`/`count` are in *records* (not bytes).

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_agents.py`:
```python
import numpy as np
import pandas as pd
from poop_simcity_preprocess.agents import build_agent_tracks
from poop_simcity_preprocess.encoding import AGENT_WAYPOINT_DTYPE


def _check_in(rows):
    return pd.DataFrame(
        rows,
        columns=["agent_id", "time", "venue_id", "venue_type", "latitude", "longitude"],
    ).assign(time=lambda d: pd.to_datetime(d["time"]))


def test_tracks_are_sorted_and_indexed():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _check_in([
        (2, "2024-01-01 00:10:00", 10, "Pub", 33.7, -84.4),
        (1, "2024-01-01 00:10:00", 11, "Workplace", 33.8, -84.3),
        (1, "2024-01-01 00:05:00", 12, "Apartment", 33.9, -84.2),
    ])
    raw, index = build_agent_tracks(df, start)
    arr = np.frombuffer(raw, dtype=AGENT_WAYPOINT_DTYPE)

    # Index covers both agents, in ascending agent_id order.
    assert [e["agentId"] for e in index] == [1, 2]
    a1 = next(e for e in index if e["agentId"] == 1)
    assert a1["offset"] == 0 and a1["count"] == 2

    # Agent 1's first waypoint is the earlier (Apartment) one.
    first = arr[a1["offset"]]
    assert first["tick"] == 0
    assert first["vtype"] == 0  # Apartment
    second = arr[a1["offset"] + 1]
    assert second["tick"] == 1
    assert second["vtype"] == 1  # Workplace

    a2 = next(e for e in index if e["agentId"] == 2)
    assert a2["offset"] == 2 and a2["count"] == 1
    assert arr[a2["offset"]]["vtype"] == 3  # Pub
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_agents.py -v`
Expected: FAIL with `ModuleNotFoundError: ... agents`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/agents.py`:
```python
"""Build per-agent movement tracks from check-in events."""

import numpy as np

from .constants import VENUE_TYPE_TO_ID
from .encoding import AGENT_WAYPOINT_DTYPE, records_to_bytes
from .timeutil import time_to_tick


def build_agent_tracks(check_in_df, start_time):
    """Return (bytes, index) for agent waypoints.

    bytes: AGENT_WAYPOINT_DTYPE records sorted by (agent_id, tick).
    index: list of {"agentId", "offset", "count"} in record units.
    """
    df = check_in_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["vtype"] = df["venue_type"].map(VENUE_TYPE_TO_ID).astype("uint8")
    df = df.sort_values(["agent_id", "tick"], kind="stable").reset_index(drop=True)

    arr = np.zeros(len(df), dtype=AGENT_WAYPOINT_DTYPE)
    arr["tick"] = df["tick"].to_numpy()
    arr["lon"] = df["longitude"].to_numpy()
    arr["lat"] = df["latitude"].to_numpy()
    arr["vtype"] = df["vtype"].to_numpy()

    index = []
    offset = 0
    for agent_id, count in df.groupby("agent_id").size().items():
        index.append({"agentId": int(agent_id), "offset": offset, "count": int(count)})
        offset += int(count)

    return records_to_bytes(arr), index
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_agents.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/agents.py preprocess/tests/test_agents.py
git commit -m "feat: build agent movement tracks from check-ins"
```

---

### Task 4: Disease timelines (`disease`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/disease.py`
- Test: `preprocess/tests/test_disease.py`

Collapses ~2-hourly snapshots into per-agent S→E→I→R transitions, samples pathogen level daily during infection, and extracts transmission events from the first `Exposed` snapshot per agent (keying the tick off the snapshot `time`, since `exposed_started_time` is 93% null in real data).

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_disease.py`:
```python
import pandas as pd
from poop_simcity_preprocess.disease import (
    build_transitions,
    build_transmissions,
    build_disease,
)


def _disease(rows):
    cols = ["time", "agent_id", "exposed_started_time", "infectious_started_time",
            "pathogen_level", "disease_status", "source_agent_id",
            "latitude", "longitude"]
    df = pd.DataFrame(rows, columns=cols)
    df["time"] = pd.to_datetime(df["time"])
    df["exposed_started_time"] = pd.to_datetime(df["exposed_started_time"])
    df["infectious_started_time"] = pd.to_datetime(df["infectious_started_time"])
    return df


def test_transitions_collapse_repeated_status():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _disease([
        ("2024-01-01 00:05:00", 7, None, None, 0.0, "Susceptible", -1, 33.7, -84.4),
        ("2024-01-01 02:05:00", 7, None, None, 0.0, "Susceptible", -1, 33.7, -84.4),
        ("2024-01-01 04:05:00", 7, None, None, 0.0, "Exposed", 3, 33.7, -84.4),
        ("2024-01-01 06:05:00", 7, None, None, 5.0, "Infectious", 3, 33.7, -84.4),
    ])
    trans = build_transitions(df, start)
    # Only the *changes* are recorded: S at tick 0, E at tick 48, I at tick 72.
    assert trans[7] == [[0, 0], [48, 1], [72, 2]]


def test_transmissions_use_first_exposed_snapshot_time():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _disease([
        ("2024-01-01 04:05:00", 7, None, None, 0.0, "Exposed", 3, 33.7, -84.4),
        ("2024-01-01 06:05:00", 7, None, None, 0.0, "Exposed", 3, 33.7, -84.4),
        ("2024-01-01 02:05:00", 9, None, None, 0.0, "Infectious", -1, 33.7, -84.4),
    ])
    out = build_transmissions(df, start)
    # Agent 7 exposed by source 3 at tick 48; agent 9 has no source (-1).
    assert out == [[48, 3, 7]]


def test_build_disease_assembles_agents_and_codes():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _disease([
        ("2024-01-01 00:05:00", 7, None, None, 0.0, "Susceptible", -1, 33.7, -84.4),
        ("2024-01-01 04:05:00", 7, None, None, 9.0, "Infectious", 3, 33.7, -84.4),
    ])
    out = build_disease(df, start)
    assert out["stateCodes"] == {"S": 0, "E": 1, "I": 2, "R": 3}
    agent = next(a for a in out["agents"] if a["agentId"] == 7)
    assert agent["transitions"] == [[0, 0], [48, 2]]
    assert agent["pathogenSamples"] == [[48, 9.0]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_disease.py -v`
Expected: FAIL with `ModuleNotFoundError: ... disease`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/disease.py`:
```python
"""Collapse disease snapshots into compact per-agent timelines."""

from .constants import STATE_CODES, TICK_INTERVAL_SEC
from .timeutil import time_to_tick


def build_transitions(disease_df, start_time):
    """Return {agent_id: [[tick, state_code], ...]} of state *changes* only."""
    df = disease_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["code"] = df["disease_status"].map(STATE_CODES).astype(int)
    df = df.sort_values(["agent_id", "tick"], kind="stable")

    result = {}
    for agent_id, g in df.groupby("agent_id"):
        trans = []
        prev = None
        for tick, code in zip(g["tick"], g["code"]):
            if code != prev:
                trans.append([int(tick), int(code)])
                prev = code
        result[int(agent_id)] = trans
    return result


def build_pathogen_samples(disease_df, start_time, cadence_sec=86400):
    """Return {agent_id: [[tick, level], ...]}, one sample per cadence bin."""
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    df = disease_df[disease_df["pathogen_level"] > 0].copy()
    if df.empty:
        return {}
    df["tick"] = time_to_tick(df["time"], start_time)
    df["bin"] = (df["tick"] // bin_ticks).astype(int)
    df = df.sort_values(["agent_id", "tick"], kind="stable")
    df = df.groupby(["agent_id", "bin"], as_index=False).first()

    result = {}
    for agent_id, g in df.groupby("agent_id"):
        result[int(agent_id)] = [
            [int(t), float(p)] for t, p in zip(g["tick"], g["pathogen_level"])
        ]
    return result


def build_transmissions(disease_df, start_time):
    """Return [[tick, source_agent_id, target_agent_id], ...].

    One per agent that entered Exposed with a known source; tick comes from the
    first Exposed snapshot's `time` (exposed_started_time is mostly null).
    """
    df = disease_df[
        (disease_df["disease_status"] == "Exposed")
        & (disease_df["source_agent_id"] != -1)
    ].copy()
    if df.empty:
        return []
    df["tick"] = time_to_tick(df["time"], start_time)
    df = df.sort_values("tick", kind="stable").groupby("agent_id", as_index=False).first()
    df = df.sort_values("tick", kind="stable")
    return [
        [int(t), int(src), int(aid)]
        for t, src, aid in zip(df["tick"], df["source_agent_id"], df["agent_id"])
    ]


def build_disease(disease_df, start_time):
    """Assemble the full disease.json structure."""
    transitions = build_transitions(disease_df, start_time)
    samples = build_pathogen_samples(disease_df, start_time)
    transmissions = build_transmissions(disease_df, start_time)
    agents = [
        {
            "agentId": aid,
            "transitions": transitions[aid],
            "pathogenSamples": samples.get(aid, []),
        }
        for aid in sorted(transitions)
    ]
    return {
        "stateCodes": {"S": 0, "E": 1, "I": 2, "R": 3},
        "agents": agents,
        "transmissions": transmissions,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_disease.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/disease.py preprocess/tests/test_disease.py
git commit -m "feat: collapse disease snapshots into transitions and transmissions"
```

---

### Task 5: Poop events (`poops`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/poops.py`
- Test: `preprocess/tests/test_poops.py`

Produces `poops.bin` bytes (sorted by tick for the browser's forward stream pointer). `infected` = `pathogen_level > 0`. Optional clean-event downsampling keeps file size bounded; infected events are always kept.

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_poops.py`:
```python
import numpy as np
import pandas as pd
from poop_simcity_preprocess.poops import build_poop_events
from poop_simcity_preprocess.encoding import POOP_EVENT_DTYPE


def _poops(rows):
    cols = ["agent_id", "time", "latitude", "longitude", "venue_type",
            "pathogen_level", "disease_status", "infectious_started_time"]
    df = pd.DataFrame(rows, columns=cols)
    df["time"] = pd.to_datetime(df["time"])
    return df


def test_events_sorted_by_tick_with_infected_flag():
    start = pd.Timestamp("2024-01-01 00:05:00")
    df = _poops([
        (1, "2024-01-01 00:15:00", 33.7, -84.4, "Apartment", 0.0, "Susceptible", None),
        (2, "2024-01-01 00:05:00", 33.8, -84.3, "Workplace", 5.0, "Infectious", None),
    ])
    raw = build_poop_events(df, start)
    arr = np.frombuffer(raw, dtype=POOP_EVENT_DTYPE)
    assert list(arr["tick"]) == [0, 2]          # sorted ascending
    assert arr[0]["infected"] == 1              # pathogen 5.0 -> infected
    assert arr[0]["vtype"] == 1                 # Workplace
    assert arr[1]["infected"] == 0              # clean


def test_clean_downsample_keeps_all_infected():
    start = pd.Timestamp("2024-01-01 00:05:00")
    rows = []
    for i in range(10):
        rows.append((i, "2024-01-01 00:10:00", 33.7, -84.4, "Apartment", 0.0,
                     "Susceptible", None))
    rows.append((99, "2024-01-01 00:10:00", 33.7, -84.4, "Apartment", 7.0,
                 "Infectious", None))
    df = _poops(rows)
    raw = build_poop_events(df, start, clean_keep_fraction=0.5)
    arr = np.frombuffer(raw, dtype=POOP_EVENT_DTYPE)
    assert (arr["infected"] == 1).sum() == 1          # the infected one survives
    assert 4 <= (arr["infected"] == 0).sum() <= 6     # ~half the clean ones kept
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_poops.py -v`
Expected: FAIL with `ModuleNotFoundError: ... poops`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/poops.py`:
```python
"""Build the tick-sorted poop event stream."""

import numpy as np

from .constants import VENUE_TYPE_TO_ID
from .encoding import POOP_EVENT_DTYPE, records_to_bytes
from .timeutil import time_to_tick


def build_poop_events(poop_df, start_time, clean_keep_fraction=1.0):
    """Return POOP_EVENT_DTYPE bytes sorted by tick.

    clean_keep_fraction < 1.0 deterministically downsamples non-pathogen events
    (by agent_id modulo) while keeping every infected (pathogen > 0) event.
    """
    df = poop_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["vtype"] = df["venue_type"].map(VENUE_TYPE_TO_ID).astype("uint8")
    df["infected"] = (df["pathogen_level"] > 0).astype("uint8")

    if clean_keep_fraction < 1.0:
        keep_mod = max(1, round(1.0 / clean_keep_fraction))
        clean_mask = df["infected"] == 0
        drop = clean_mask & ((df["agent_id"] % keep_mod) != 0)
        df = df[~drop]

    df = df.sort_values("tick", kind="stable").reset_index(drop=True)

    arr = np.zeros(len(df), dtype=POOP_EVENT_DTYPE)
    arr["tick"] = df["tick"].to_numpy()
    arr["lon"] = df["longitude"].to_numpy()
    arr["lat"] = df["latitude"].to_numpy()
    arr["vtype"] = df["vtype"].to_numpy()
    arr["infected"] = df["infected"].to_numpy()
    arr["pathogen"] = df["pathogen_level"].to_numpy()
    return records_to_bytes(arr)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_poops.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/poops.py preprocess/tests/test_poops.py
git commit -m "feat: build tick-sorted poop event stream"
```

---

### Task 6: Hourly aggregates (`aggregates`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/aggregates.py`
- Test: `preprocess/tests/test_aggregates.py`

Reconstructs S/E/I/R population counts on an hourly grid from per-agent transitions (reusing `build_transitions`), and sums poop pathogen per hour. Returns the `aggregates.json` structure and exposes the hourly grid + E+I active counts for outbreak detection.

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_aggregates.py`:
```python
import pandas as pd
from poop_simcity_preprocess.aggregates import seir_counts_over_time, build_aggregates


def test_seir_counts_step_function():
    # Agent 1: S at tick 0, I at tick 12. Agent 2: no transitions -> S throughout.
    transitions = {1: [[0, 0], [12, 2]], 2: []}
    grid = [0, 12, 24]  # hourly ticks
    counts = seir_counts_over_time(transitions, num_agents=2, grid_ticks=grid)
    assert counts["S"] == [2, 1, 1]   # both S at t0; agent1 leaves S after t12
    assert counts["I"] == [0, 1, 1]


def test_build_aggregates_shape_and_inflow():
    start = pd.Timestamp("2024-01-01 00:05:00")
    disease = pd.DataFrame({
        "time": pd.to_datetime(["2024-01-01 00:05:00", "2024-01-01 01:05:00"]),
        "agent_id": [0, 0],
        "disease_status": ["Susceptible", "Infectious"],
        "pathogen_level": [0.0, 3.0],
        "source_agent_id": [-1, -1],
        "exposed_started_time": [pd.NaT, pd.NaT],
        "infectious_started_time": [pd.NaT, pd.NaT],
        "latitude": [33.7, 33.7],
        "longitude": [-84.4, -84.4],
    })
    poops = pd.DataFrame({
        "agent_id": [0],
        "time": pd.to_datetime(["2024-01-01 01:10:00"]),  # tick 13 -> hour bin 1
        "latitude": [33.7], "longitude": [-84.4],
        "venue_type": ["Apartment"], "pathogen_level": [50.0],
        "disease_status": ["Infectious"], "infectious_started_time": [pd.NaT],
    })
    end = pd.Timestamp("2024-01-01 01:05:00")
    agg = build_aggregates(disease, poops, start, end, num_agents=1)
    assert agg["cadenceSec"] == 3600
    assert len(agg["seir"]["S"]) == 2          # hour bins 0 and 1
    assert agg["seir"]["I"][1] == 1            # agent infectious by hour 1
    assert agg["pathogenInflow"][1] == 50.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_aggregates.py -v`
Expected: FAIL with `ModuleNotFoundError: ... aggregates`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/aggregates.py`:
```python
"""Hourly SEIR counts and pathogen inflow aggregates."""

import bisect

from .constants import TICK_INTERVAL_SEC
from .disease import build_transitions
from .timeutil import time_to_tick

STATE_NAMES = ["S", "E", "I", "R"]


def seir_counts_over_time(transitions_by_agent, num_agents, grid_ticks):
    """Count agents in each state at each grid tick.

    transitions_by_agent: {agent_id: [[tick, code], ...]} (may omit agents).
    Agents absent from the dict, or before their first transition, count as S.
    """
    counts = {name: [0] * len(grid_ticks) for name in STATE_NAMES}
    present = transitions_by_agent

    for trans in present.values():
        ticks = [t for t, _ in trans]
        for gi, gt in enumerate(grid_ticks):
            idx = bisect.bisect_right(ticks, gt) - 1
            code = trans[idx][1] if idx >= 0 else 0
            counts[STATE_NAMES[code]][gi] += 1

    # Agents with no transition entry are Susceptible at every grid tick.
    missing = num_agents - len(present)
    if missing:
        for gi in range(len(grid_ticks)):
            counts["S"][gi] += missing
    return counts


def _hourly_grid(start_time, end_time, cadence_sec=3600):
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    max_tick = time_to_tick(end_time, start_time)
    num_bins = int(max_tick // bin_ticks) + 1
    return [i * bin_ticks for i in range(num_bins)], bin_ticks


def pathogen_inflow_over_time(poop_df, start_time, num_bins, bin_ticks):
    df = poop_df.copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["bin"] = (df["tick"] // bin_ticks).astype(int)
    sums = df.groupby("bin")["pathogen_level"].sum()
    return [float(sums.get(i, 0.0)) for i in range(num_bins)]


def build_aggregates(disease_df, poop_df, start_time, end_time, num_agents,
                     cadence_sec=3600):
    grid_ticks, bin_ticks = _hourly_grid(start_time, end_time, cadence_sec)
    transitions = build_transitions(disease_df, start_time)
    seir = seir_counts_over_time(transitions, num_agents, grid_ticks)
    inflow = pathogen_inflow_over_time(poop_df, start_time, len(grid_ticks), bin_ticks)
    return {
        "cadenceSec": cadence_sec,
        "startTime": str(start_time),
        "gridTicks": grid_ticks,
        "seir": seir,
        "pathogenInflow": inflow,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_aggregates.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/aggregates.py preprocess/tests/test_aggregates.py
git commit -m "feat: compute hourly SEIR counts and pathogen inflow"
```

---

### Task 7: Outbreak window detection (`outbreak`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/outbreak.py`
- Test: `preprocess/tests/test_outbreak.py`

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_outbreak.py`:
```python
from poop_simcity_preprocess.outbreak import detect_outbreak_window


def test_window_brackets_active_period():
    seir = {"E": [0, 0, 2, 1, 0], "I": [0, 1, 3, 0, 0]}
    grid_ticks = [0, 12, 24, 36, 48]
    # Active (E+I>0) at indices 1,2,3 -> ticks 12..36.
    assert detect_outbreak_window(seir, grid_ticks) == (12, 36)


def test_no_activity_returns_full_span():
    seir = {"E": [0, 0], "I": [0, 0]}
    grid_ticks = [0, 12]
    assert detect_outbreak_window(seir, grid_ticks) == (0, 12)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_outbreak.py -v`
Expected: FAIL with `ModuleNotFoundError: ... outbreak`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/outbreak.py`:
```python
"""Detect the active outbreak window from hourly SEIR counts."""


def detect_outbreak_window(seir, grid_ticks):
    """Return (start_tick, end_tick) bracketing all bins where E+I > 0.

    Falls back to the full span when there is no infection activity.
    """
    active = [i for i in range(len(grid_ticks)) if seir["E"][i] + seir["I"][i] > 0]
    if not active:
        return (grid_ticks[0], grid_ticks[-1])
    return (grid_ticks[active[0]], grid_ticks[active[-1]])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_outbreak.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/outbreak.py preprocess/tests/test_outbreak.py
git commit -m "feat: detect outbreak window from SEIR counts"
```

---

### Task 8: Wastewater grid (`wastewater`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/wastewater.py`
- Test: `preprocess/tests/test_wastewater.py`

Bins pathogen-bearing poop events into square grid cells over the bbox, producing the generic `regions × series` structure (swappable for real sewershed GeoJSON later).

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_wastewater.py`:
```python
import pandas as pd
from poop_simcity_preprocess.wastewater import build_wastewater_grid


def _poops(rows):
    cols = ["agent_id", "time", "latitude", "longitude", "venue_type",
            "pathogen_level", "disease_status", "infectious_started_time"]
    df = pd.DataFrame(rows, columns=cols)
    df["time"] = pd.to_datetime(df["time"])
    return df


def test_grid_bins_pathogen_by_cell_and_hour():
    start = pd.Timestamp("2024-01-01 00:05:00")
    end = pd.Timestamp("2024-01-01 01:05:00")
    bbox = [-84.50, 33.60, -84.40, 33.70]  # 0.10 x 0.10 deg
    df = _poops([
        # Two infected events in the same cell, hour bin 0.
        (1, "2024-01-01 00:10:00", 33.61, -84.49, "Apartment", 10.0, "Infectious", None),
        (2, "2024-01-01 00:20:00", 33.62, -84.48, "Apartment", 5.0, "Infectious", None),
        # A clean event contributes no signal.
        (3, "2024-01-01 00:20:00", 33.61, -84.49, "Apartment", 0.0, "Susceptible", None),
    ])
    out = build_wastewater_grid(df, bbox, start, end, cell_size_deg=0.05)
    assert out["kind"] == "grid"
    assert out["cadenceSec"] == 3600
    # One active cell, summing 10 + 5 in hour bin 0.
    assert len(out["regions"]) == 1
    region_id = out["regions"][0]["id"]
    assert out["series"][region_id][0] == 15.0
    centroid = out["regions"][0]["centroid"]
    assert -84.50 <= centroid[0] <= -84.40
    assert len(out["regions"][0]["polygon"]) == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wastewater.py -v`
Expected: FAIL with `ModuleNotFoundError: ... wastewater`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/wastewater.py`:
```python
"""Aggregate pathogen-bearing poop into a spatial grid of regions over time."""

from .constants import TICK_INTERVAL_SEC
from .timeutil import time_to_tick


def build_wastewater_grid(poop_df, bbox, start_time, end_time,
                          cadence_sec=3600, cell_size_deg=0.02):
    """Return {kind, cadenceSec, regions, series}.

    Only pathogen-bearing events contribute. Region ids are "ix_iy" grid indices.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    bin_ticks = cadence_sec // TICK_INTERVAL_SEC
    num_bins = int(time_to_tick(end_time, start_time) // bin_ticks) + 1

    df = poop_df[poop_df["pathogen_level"] > 0].copy()
    df["tick"] = time_to_tick(df["time"], start_time)
    df["bin"] = (df["tick"] // bin_ticks).astype(int)
    df["ix"] = ((df["longitude"] - min_lon) / cell_size_deg).astype(int)
    df["iy"] = ((df["latitude"] - min_lat) / cell_size_deg).astype(int)

    regions = []
    series = {}
    for (ix, iy), g in df.groupby(["ix", "iy"]):
        cid = f"{ix}_{iy}"
        x0 = min_lon + ix * cell_size_deg
        y0 = min_lat + iy * cell_size_deg
        x1 = x0 + cell_size_deg
        y1 = y0 + cell_size_deg
        arr = [0.0] * num_bins
        for b, v in g.groupby("bin")["pathogen_level"].sum().items():
            if 0 <= int(b) < num_bins:
                arr[int(b)] = float(v)
        regions.append({
            "id": cid,
            "centroid": [float(x0 + cell_size_deg / 2), float(y0 + cell_size_deg / 2)],
            "polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        })
        series[cid] = arr

    return {"kind": "grid", "cadenceSec": cadence_sec, "regions": regions, "series": series}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wastewater.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/wastewater.py preprocess/tests/test_wastewater.py
git commit -m "feat: aggregate pathogen into spatial wastewater grid"
```

---

### Task 9: Manifest assembly (`manifest`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/manifest.py`
- Test: `preprocess/tests/test_manifest.py`

- [ ] **Step 1: Write the failing test**

`preprocess/tests/test_manifest.py`:
```python
import pandas as pd
from poop_simcity_preprocess.manifest import build_manifest


def test_manifest_fields():
    start = pd.Timestamp("2024-01-01 00:05:00")
    end = pd.Timestamp("2024-01-01 01:05:00")  # 12 ticks later
    m = build_manifest(
        run_id="dataset_00",
        start_time=start,
        end_time=end,
        num_agents=1000,
        bbox=[-84.78, 33.51, -84.16, 34.19],
        outbreak_window=(0, 12),
    )
    assert m["schemaVersion"] == 1
    assert m["runId"] == "dataset_00"
    assert m["tickIntervalSec"] == 300
    assert m["numTicks"] == 13           # ticks 0..12 inclusive
    assert m["numAgents"] == 1000
    assert m["outbreakWindow"] == {"startTick": 0, "endTick": 12}
    assert m["venueTypes"] == ["Apartment", "Workplace", "Restaurant", "Pub"]
    assert m["artifacts"]["agents"] == "agents.bin"
    assert m["artifacts"]["agentsIndex"] == "agents_index.json"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: ... manifest`.

- [ ] **Step 3: Write the implementation**

`preprocess/poop_simcity_preprocess/manifest.py`:
```python
"""Assemble manifest.json describing the bundle."""

import pandas as pd

from .constants import TICK_INTERVAL_SEC, VENUE_TYPES
from .timeutil import time_to_tick

ARTIFACTS = {
    "agents": "agents.bin",
    "agentsIndex": "agents_index.json",
    "disease": "disease.json",
    "poops": "poops.bin",
    "aggregates": "aggregates.json",
    "wastewater": "wastewater.json",
}


def build_manifest(run_id, start_time, end_time, num_agents, bbox, outbreak_window):
    start = pd.Timestamp(start_time)
    end = pd.Timestamp(end_time)
    return {
        "schemaVersion": 1,
        "runId": run_id,
        "tickIntervalSec": TICK_INTERVAL_SEC,
        "startTime": start.isoformat(),
        "endTime": end.isoformat(),
        "numTicks": int(time_to_tick(end, start)) + 1,
        "numAgents": int(num_agents),
        "bbox": [float(x) for x in bbox],
        "outbreakWindow": {
            "startTick": int(outbreak_window[0]),
            "endTick": int(outbreak_window[1]),
        },
        "venueTypes": list(VENUE_TYPES),
        "artifacts": dict(ARTIFACTS),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_manifest.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add preprocess/poop_simcity_preprocess/manifest.py preprocess/tests/test_manifest.py
git commit -m "feat: assemble bundle manifest"
```

---

### Task 10: Build orchestrator + CLI (`build`, `cli`)

**Files:**
- Create: `preprocess/poop_simcity_preprocess/build.py`
- Create: `preprocess/poop_simcity_preprocess/cli.py`
- Test: `preprocess/tests/test_build_integration.py`

Wires the transforms to parquet input and writes all artifacts. The integration test builds a tiny synthetic dataset on disk, runs `build_bundle`, and asserts the bundle is complete and internally consistent.

- [ ] **Step 1: Write the failing integration test**

`preprocess/tests/test_build_integration.py`:
```python
import json
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from poop_simcity_preprocess.build import build_bundle
from poop_simcity_preprocess.encoding import AGENT_WAYPOINT_DTYPE, POOP_EVENT_DTYPE


def _write_synthetic(dataset_dir):
    dataset_dir.mkdir(parents=True, exist_ok=True)
    check_in = pd.DataFrame({
        "agent_id": [0, 0, 1],
        "time": pd.to_datetime(["2024-01-01 00:05:00", "2024-01-01 01:05:00",
                                "2024-01-01 00:05:00"]),
        "venue_id": [10, 11, 12],
        "venue_type": ["Apartment", "Workplace", "Pub"],
        "latitude": [33.70, 33.71, 33.72],
        "longitude": [-84.40, -84.39, -84.38],
    })
    disease = pd.DataFrame({
        "time": pd.to_datetime(["2024-01-01 00:05:00", "2024-01-01 01:05:00",
                                "2024-01-01 00:05:00"]),
        "agent_id": [0, 0, 1],
        "exposed_started_time": pd.to_datetime([None, None, None]),
        "infectious_started_time": pd.to_datetime([None, None, None]),
        "pathogen_level": [0.0, 8.0, 0.0],
        "disease_status": ["Susceptible", "Infectious", "Susceptible"],
        "source_agent_id": [-1, -1, -1],
        "latitude": [33.70, 33.71, 33.72],
        "longitude": [-84.40, -84.39, -84.38],
    })
    poops = pd.DataFrame({
        "agent_id": [0, 1],
        "time": pd.to_datetime(["2024-01-01 01:10:00", "2024-01-01 00:10:00"]),
        "latitude": [33.71, 33.72],
        "longitude": [-84.39, -84.38],
        "venue_type": ["Workplace", "Pub"],
        "pathogen_level": [100.0, 0.0],
        "disease_status": ["Infectious", "Susceptible"],
        "infectious_started_time": pd.to_datetime([None, None]),
    })
    social = pd.DataFrame({"time": pd.to_datetime(["2024-01-01"]), "from": [0], "to": [1]})
    for name, df in [("check_in", check_in), ("disease_status", disease),
                     ("poop_in", poops), ("social_links", social)]:
        pq.write_table(pa.Table.from_pandas(df), dataset_dir / f"{name}.parquet")


def test_build_bundle_writes_consistent_artifacts(tmp_path):
    dataset_dir = tmp_path / "dataset_00"
    out_dir = tmp_path / "bundle"
    _write_synthetic(dataset_dir)

    build_bundle(str(dataset_dir), str(out_dir), run_id="dataset_00")

    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["numAgents"] == 2
    assert manifest["schemaVersion"] == 1

    index = json.loads((out_dir / "agents_index.json").read_text())
    agents_bin = np.frombuffer((out_dir / "agents.bin").read_bytes(),
                               dtype=AGENT_WAYPOINT_DTYPE)
    assert sum(e["count"] for e in index) == len(agents_bin) == 3

    poops_bin = np.frombuffer((out_dir / "poops.bin").read_bytes(),
                              dtype=POOP_EVENT_DTYPE)
    assert len(poops_bin) == 2
    assert (poops_bin["infected"] == 1).sum() == 1

    disease = json.loads((out_dir / "disease.json").read_text())
    agent0 = next(a for a in disease["agents"] if a["agentId"] == 0)
    assert agent0["transitions"][0] == [0, 0]      # starts Susceptible

    agg = json.loads((out_dir / "aggregates.json").read_text())
    assert agg["seir"]["I"][-1] == 1               # agent 0 infectious by last hour

    ww = json.loads((out_dir / "wastewater.json").read_text())
    assert ww["kind"] == "grid"
    assert len(ww["regions"]) >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_build_integration.py -v`
Expected: FAIL with `ModuleNotFoundError: ... build`.

- [ ] **Step 3: Write the orchestrator and CLI**

`preprocess/poop_simcity_preprocess/build.py`:
```python
"""Orchestrate parquet -> bundle conversion."""

import json
import os

import pyarrow.parquet as pq

from .agents import build_agent_tracks
from .aggregates import build_aggregates
from .disease import build_disease
from .manifest import build_manifest
from .outbreak import detect_outbreak_window
from .poops import build_poop_events
from .wastewater import build_wastewater_grid


def _read(dataset_dir, name):
    return pq.read_table(os.path.join(dataset_dir, f"{name}.parquet")).to_pandas()


def build_bundle(dataset_dir, out_dir, run_id="dataset_00",
                 clean_keep_fraction=1.0, cell_size_deg=0.02):
    os.makedirs(out_dir, exist_ok=True)

    check_in = _read(dataset_dir, "check_in")
    disease_df = _read(dataset_dir, "disease_status")
    poop_df = _read(dataset_dir, "poop_in")

    start_time = check_in["time"].min()
    end_time = check_in["time"].max()
    num_agents = int(check_in["agent_id"].nunique())
    bbox = [
        float(check_in["longitude"].min()), float(check_in["latitude"].min()),
        float(check_in["longitude"].max()), float(check_in["latitude"].max()),
    ]

    # Agents
    agents_bytes, agents_index = build_agent_tracks(check_in, start_time)
    with open(os.path.join(out_dir, "agents.bin"), "wb") as f:
        f.write(agents_bytes)
    _write_json(out_dir, "agents_index.json", agents_index)

    # Disease
    _write_json(out_dir, "disease.json", build_disease(disease_df, start_time))

    # Poops
    poops_bytes = build_poop_events(poop_df, start_time, clean_keep_fraction)
    with open(os.path.join(out_dir, "poops.bin"), "wb") as f:
        f.write(poops_bytes)

    # Aggregates + outbreak window
    aggregates = build_aggregates(disease_df, poop_df, start_time, end_time, num_agents)
    _write_json(out_dir, "aggregates.json", aggregates)
    outbreak_window = detect_outbreak_window(aggregates["seir"], aggregates["gridTicks"])

    # Wastewater
    _write_json(out_dir, "wastewater.json",
                build_wastewater_grid(poop_df, bbox, start_time, end_time,
                                      cell_size_deg=cell_size_deg))

    # Manifest
    manifest = build_manifest(run_id, start_time, end_time, num_agents, bbox,
                              outbreak_window)
    _write_json(out_dir, "manifest.json", manifest)
    return manifest


def _write_json(out_dir, name, obj):
    with open(os.path.join(out_dir, name), "w") as f:
        json.dump(obj, f, separators=(",", ":"))
```

`preprocess/poop_simcity_preprocess/cli.py`:
```python
"""Command-line entry point: build a bundle from a dataset directory."""

import argparse

from .build import build_bundle


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the Poop SimCity data bundle.")
    parser.add_argument("--dataset", required=True, help="Path to dataset_00/ directory")
    parser.add_argument("--out", required=True, help="Output bundle directory")
    parser.add_argument("--run-id", default="dataset_00")
    parser.add_argument("--clean-keep-fraction", type=float, default=1.0,
                        help="Fraction of clean (non-pathogen) poop events to keep")
    parser.add_argument("--cell-size-deg", type=float, default=0.02,
                        help="Wastewater grid cell size in degrees")
    args = parser.parse_args(argv)

    manifest = build_bundle(args.dataset, args.out, run_id=args.run_id,
                            clean_keep_fraction=args.clean_keep_fraction,
                            cell_size_deg=args.cell_size_deg)
    print(f"Wrote bundle to {args.out}: "
          f"{manifest['numAgents']} agents, {manifest['numTicks']} ticks, "
          f"outbreak {manifest['outbreakWindow']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the integration test**

Run: `python -m pytest tests/test_build_integration.py -v`
Expected: 1 passed.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -v`
Expected: all tests pass (Tasks 0–10).

- [ ] **Step 6: Commit**

```bash
git add preprocess/poop_simcity_preprocess/build.py preprocess/poop_simcity_preprocess/cli.py preprocess/tests/test_build_integration.py
git commit -m "feat: add build orchestrator and CLI"
```

---

### Task 11: Generate the real bundle from `dataset_00`

**Files:**
- Output: `app/public/data/dataset_00/` (gitignored; not committed)

This task validates the preprocessor against the real data and produces the bundle the web app will consume.

- [ ] **Step 1: Run the CLI on the real dataset**

Run (from repo root):
```
python -m poop_simcity_preprocess.cli --dataset dataset_00 --out app/public/data/dataset_00 --clean-keep-fraction 0.25
```
(Run from `preprocess/` with `PYTHONPATH` set to that dir, or `pip install -e preprocess`.)
Expected: prints `Wrote bundle to app/public/data/dataset_00: 1000 agents, ~105120 ticks, outbreak {...}`.

- [ ] **Step 2: Spot-check the bundle**

Run this verification script (`preprocess/verify_bundle.py`):
```python
import json
import numpy as np
from pathlib import Path
from poop_simcity_preprocess.encoding import AGENT_WAYPOINT_DTYPE, POOP_EVENT_DTYPE

b = Path("app/public/data/dataset_00")
m = json.loads((b / "manifest.json").read_text())
assert m["numAgents"] == 1000, m["numAgents"]
assert m["schemaVersion"] == 1

idx = json.loads((b / "agents_index.json").read_text())
agents = np.frombuffer((b / "agents.bin").read_bytes(), dtype=AGENT_WAYPOINT_DTYPE)
assert len(idx) == 1000
assert sum(e["count"] for e in idx) == len(agents)
assert agents["tick"].min() == 0

poops = np.frombuffer((b / "poops.bin").read_bytes(), dtype=POOP_EVENT_DTYPE)
assert np.all(np.diff(poops["tick"].astype(np.int64)) >= 0), "poops must be tick-sorted"

dis = json.loads((b / "disease.json").read_text())
assert len(dis["transmissions"]) > 0

agg = json.loads((b / "aggregates.json").read_text())
n = len(agg["seir"]["S"])
for t in range(n):
    total = sum(agg["seir"][k][t] for k in "SEIR")
    assert total == 1000, (t, total)  # population conserved every hour

ow = m["outbreakWindow"]
assert ow["startTick"] < ow["endTick"]

print("Bundle OK:",
      f"{len(agents)} waypoints, {len(poops)} poops,",
      f"{len(dis['transmissions'])} transmissions,",
      f"outbreak ticks {ow['startTick']}..{ow['endTick']}")
print("Bundle size (MB):",
      round(sum(f.stat().st_size for f in b.iterdir()) / 1e6, 1))
```
Run: `python verify_bundle.py`
Expected: prints `Bundle OK: ...` with population conserved (each hourly SEIR sum == 1000) and a total bundle size printed. If the bundle is larger than ~40 MB, lower `--clean-keep-fraction` and re-run Step 1.

- [ ] **Step 3: Commit the verification script**

```bash
git add preprocess/verify_bundle.py
git commit -m "test: add real-bundle verification script"
```

---

## Self-Review

**Spec coverage** (spec §4 bundle format ↔ tasks):
- manifest.json → Task 9 ✓ ; agents.bin + index → Task 3 ✓ ; disease.json (transitions, pathogen samples, transmissions) → Task 4 ✓ ; poops.bin (tick-sorted, infected flag, clean downsample) → Task 5 ✓ ; aggregates.json (hourly SEIR, pathogen inflow) → Task 6 ✓ ; wastewater regions×series → Task 8 ✓ ; outbreak window in manifest → Tasks 7 + 9 ✓ ; tick model → Task 1 ✓ ; binary contract → Task 2 ✓ ; orchestration + real run → Tasks 10–11 ✓. Edge cases from spec §8 covered: agents with no transitions count as S (Task 6 `missing` handling, tested); `output_matrix.csv` never read (build only reads check_in/disease/poop) ✓.
- Not in this plan (correctly deferred to Plan 2 / future): the web app, day/night skin, social-network layer, real sewershed swap. The `social_links` file is written in the synthetic fixture but intentionally unused by `build_bundle` (v1 doesn't render the social layer).

**Placeholder scan:** No TBD/TODO; every code step has complete code; every test has concrete assertions.

**Type consistency:** `time_to_tick`, `records_to_bytes`, `AGENT_WAYPOINT_DTYPE`/`POOP_EVENT_DTYPE`, `build_agent_tracks`, `build_transitions`, `build_disease`, `build_poop_events`, `seir_counts_over_time`/`build_aggregates` (returns `gridTicks` consumed by `detect_outbreak_window` and the orchestrator), `build_wastewater_grid`, `build_manifest`, `build_bundle` signatures are used consistently across Tasks 1–11. Artifact filenames in `manifest.ARTIFACTS` match the files written by `build_bundle` and read by `verify_bundle.py`.

---

## Done When

- `python -m pytest -v` passes in `preprocess/` (all tasks).
- `app/public/data/dataset_00/` contains `manifest.json`, `agents.bin`, `agents_index.json`, `disease.json`, `poops.bin`, `aggregates.json`, `wastewater.json`.
- `verify_bundle.py` prints `Bundle OK` with population conserved and a reasonable bundle size (target < 40 MB).

**Next:** Plan 2 — the React/MapLibre/deck.gl web app — written against this concrete bundle.
