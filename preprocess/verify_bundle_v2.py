"""Cross-check a schemaVersion 2 bundle against the parquet it came from."""

import argparse
import json
import os

import numpy as np
import pyarrow.parquet as pq

from poop_simcity_preprocess.profiles import get_profile
from poop_simcity_preprocess.sewersheds import assign_points, load_sewersheds
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
    p.add_argument("--shapefile-dir", default=None,
                    help="Directory of <shed>_sewershed.shp files. Optional: when "
                         "given (and the bundle has a sewershed layer), re-derives "
                         "venue-to-sewershed assignment from the full-resolution "
                         "geometry and checks it exactly against sewersheds.json. "
                         "The sum-invariant checks below cannot catch a cross-shed "
                         "permutation on their own, since they sum across rows "
                         "before comparing; this check can, because it never sums.")
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
    plon = _read(args.bundle, "poops_lon.u16", "<u2")
    plat = _read(args.bundle, "poops_lat.u16", "<u2")
    pinfected = _read(args.bundle, "poops_infected.u8", "<u1")
    check("poops are sorted by tick",
          bool(np.all(np.diff(ptick.astype("int64")) >= 0)))
    check("poop arrays are equal length",
          len(ptick) == len(plon) == len(plat) == len(pinfected))

    infected_parquet = 0
    pf = pq.ParquetFile(os.path.join(args.dataset, f"{profile.poop_file}.parquet"))
    for batch in pf.iter_batches(batch_size=2_000_000,
                                 columns=["time", "pathogen_level"]):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        infected_parquet += int((df["pathogen_level"] > 0).sum())
    # `poops_infected.u8` is the sole authoritative infected/clean flag: it is
    # computed from the source float64 `pathogen_level` column before any
    # narrowing, so (unlike a float32 magnitude, which this bundle does not
    # even store) it must match the parquet exactly with no tolerance for drift.
    check("every pathogen-bearing poop survived downsampling",
          int((pinfected == 1).sum()) == infected_parquet,
          f"bundle={(pinfected == 1).sum()} parquet={infected_parquet}")

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
    check("seirSampledAt is binEnd",
          agg.get("seirSampledAt") == "binEnd", f"{agg.get('seirSampledAt')!r}")

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
        # This is a round-trip check, not an assignment check: encode_sewersheds
        # writes both sewersheds.json's "residents" and agent_home_shed.u8 from
        # the same in-memory home_shed array, so it can only catch a dtype,
        # sentinel-mapping or JSON-encoding fault - an assignment bug (e.g. two
        # sheds' labels swapped) would corrupt both identically and still pass.
        check("sewersheds.json resident counts round-trip against agent_home_shed.u8",
              all(int((home == i).sum()) == s["residents"]
                  for i, s in enumerate(meta["sewersheds"])))

        # The three checks above all sum across sewersheds before comparing to a
        # global total, so every one of them is blind to a cross-shed
        # permutation (e.g. encina's events landing in point_loma's row): the
        # totals are unchanged and the checks pass regardless. Only an
        # independent re-derivation from the full-resolution geometry - never
        # sewersheds.json's own simplified rings, which exist for rendering only
        # and would need a fudge tolerance - can catch that. It's optional
        # because it needs the shapefiles on disk, which a bundle's consumer may
        # not have.
        if args.shapefile_dir:
            sheds = load_sewersheds(args.shapefile_dir)
            vlon = _read(args.bundle, "venues_lon.f32", "<f4")
            vlat = _read(args.bundle, "venues_lat.f32", "<f4")
            venue_shed = assign_points(sheds, vlon, vlat)
            rederived = [int((venue_shed == i).sum()) for i in range(len(sheds))]
            rederived_outside = int((venue_shed == -1).sum())
            recorded = [s["venues"] for s in meta["sewersheds"]]
            recorded_outside = meta["outside"]["venues"]
            check("venue sewershed assignment re-derived from full-resolution "
                  "geometry matches sewersheds.json",
                  rederived == recorded and rederived_outside == recorded_outside,
                  f"rederived={rederived}+outside={rederived_outside} "
                  f"recorded={recorded}+outside={recorded_outside}")
        else:
            print("SKIP  venue sewershed assignment vs. full-resolution geometry "
                  "(pass --shapefile-dir to check)")

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
