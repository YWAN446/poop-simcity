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
