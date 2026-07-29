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
