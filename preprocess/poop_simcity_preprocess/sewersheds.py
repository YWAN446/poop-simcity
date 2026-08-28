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
