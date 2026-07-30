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
from .window import make_window, to_u16

ARTIFACTS_V2 = {
    "venuesLon": "venues_lon.f32", "venuesLat": "venues_lat.f32",
    "venuesType": "venues_type.u8", "venuesId": "venues_id.i32",
    "staysTick": "stays_tick.u16", "staysDwell": "stays_dwell.u16",
    "staysVenue": "stays_venue.u16", "staysIndex": "stays_index.json",
    "poopsTick": "poops_tick.u16", "poopsLon": "poops_lon.u16",
    "poopsLat": "poops_lat.u16", "poopsPathogen": "poops_pathogen.f32",
    "poopsInfected": "poops_infected.u8",
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
    # Fail fast on a window too wide to encode as uint16 ticks, instead of
    # relying on some downstream array happening to contain a boundary value
    # to_u16 would catch. `to_u16` is the single place that enforces this
    # invariant (see window.py's docstring), so route the whole-window check
    # through it too rather than duplicating its bounds logic here.
    to_u16(np.array([window.num_ticks - 1], dtype="int64"), "window span")

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

    # `stay_index` (from Checkin) and `scan.transitions`/`scan.samples` (from
    # DiseasesStatus) are each masked against the window independently, on
    # different tables' own `time` columns. Nothing upstream guarantees they
    # agree on which agents are "in the window": an agent whose check-in
    # predates the window vanishes from `stay_index` (see stays.py) even if
    # its disease timeline has in-window rows. Left unchecked, that agent
    # would count toward `len(transitions)` but have no stay - and, further
    # downstream, `seir_hourly`'s `num_agents - len(transitions)` bulk-add
    # would go negative, silently writing negative Susceptible counts into
    # aggregates.json. Catch it here, at the source, with a clear message.
    stay_agent_ids = {entry["agentId"] for entry in stay_index}
    disease_agent_ids = set(scan.transitions) | set(scan.samples)
    orphaned = sorted(disease_agent_ids - stay_agent_ids)
    if orphaned:
        raise ValueError(
            f"{len(orphaned)} agent(s) have disease records inside the window "
            f"but no check-in stay inside it - the disease and check-in "
            f"tables disagree about which agents are in the window; sample "
            f"agent id(s): {orphaned[:5]}"
        )

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
