# preprocess/tests/test_sewersheds.py
import numpy as np
import pytest
import shapefile
from shapely.geometry import Polygon

from poop_simcity_preprocess.sewersheds import (
    OUTSIDE, SHED_IDS, assign_points, home_shed_by_agent, load_sewersheds, simplified_rings,
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


# Task 2: Agent residence by most-dwelled Apartment

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
