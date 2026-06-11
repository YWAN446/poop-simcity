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
