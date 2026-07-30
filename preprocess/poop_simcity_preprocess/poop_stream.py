"""The poop event stream the map renders.

Coordinates are quantized to uint16 across the bbox (~2 m) rather than joined to
a venue index: `Poopin` carries no venue_id, and reverse-joining on coordinates is
ambiguous because several venues share a (lat, lon, type) key.

This stream is downsampled for render budget. Anything quantitative — pathogen
inflow, the wastewater grid — must read the parquet directly instead.

`poops_infected.u8` records `pathogen_level > 0` at source float64 precision,
before `poops_pathogen.f32` narrows the magnitude to float32. The two are NOT
redundant: this dataset's pathogen decay model produces positive values as
small as ~1e-161, far below float32's smallest positive subnormal (~1.4e-45),
so a genuinely infected event's magnitude can legitimately underflow to
`0.0f` on the narrower type. That's fine for magnitude - a level of 1e-161 has
nothing meaningful to display - but a renderer that decided infected-vs-clean
by testing `poops_pathogen.f32 > 0` would silently misclassify it as clean.
`poops_infected.u8` is the exact flag so that decision never depends on
`poops_pathogen.f32`'s precision.
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
    if clean_keep_fraction < 0:
        raise ValueError(
            f"clean_keep_fraction must be >= 0, got {clean_keep_fraction}"
        )
    if clean_keep_fraction >= 1.0:
        keep_mod = 0        # sentinel: keep every event, skip thinning
    elif clean_keep_fraction == 0:
        keep_mod = None     # sentinel: drop every clean event
    else:
        keep_mod = max(1, round(1.0 / clean_keep_fraction))
    blocks = []

    columns = ["agent_id", "time", "latitude", "longitude", "pathogen_level"]
    for df in iter_poop_batches(dataset_dir, profile, window, columns, batch_size):
        # `infected` is computed here, from the source float64 column, before
        # `pathogen` below narrows to float32 - see the module docstring for
        # why the two must be tracked separately rather than one derived from
        # the other downstream.
        infected = df["pathogen_level"].to_numpy() > 0
        if keep_mod is None:
            keep = infected
        elif keep_mod:
            keep = infected | ((df["agent_id"].to_numpy() % keep_mod) == 0)
        else:
            keep = None  # sentinel: keep_mod == 0, keep every event untouched

        if keep is not None:
            df = df[keep]
            infected = infected[keep]
            if df.empty:
                continue

        blocks.append({
            "tick": ticks_of(df["time"], window),
            "lon": quantize(df["longitude"], min_lon, max_lon),
            "lat": quantize(df["latitude"], min_lat, max_lat),
            "infected": infected.astype(np.uint8),
            "pathogen": df["pathogen_level"].to_numpy(dtype=np.float32),
        })

    if not blocks:
        return {"poops_tick.u16": np.zeros(0, np.uint16),
                "poops_lon.u16": np.zeros(0, np.uint16),
                "poops_lat.u16": np.zeros(0, np.uint16),
                "poops_pathogen.f32": np.zeros(0, np.float32),
                "poops_infected.u8": np.zeros(0, np.uint8)}

    tick = np.concatenate([b["tick"] for b in blocks])
    order = np.argsort(tick, kind="stable")
    return {
        "poops_tick.u16": to_u16(tick[order], "poop tick"),
        "poops_lon.u16": np.concatenate([b["lon"] for b in blocks])[order],
        "poops_lat.u16": np.concatenate([b["lat"] for b in blocks])[order],
        "poops_pathogen.f32": np.concatenate([b["pathogen"] for b in blocks])[order],
        "poops_infected.u8": np.concatenate([b["infected"] for b in blocks])[order],
    }
