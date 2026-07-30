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
    pinfected = _read(args.bundle, "poops_infected.u8", "<u1")
    check("poops are sorted by tick",
          bool(np.all(np.diff(ptick.astype("int64")) >= 0)))
    check("poop arrays are equal length",
          len(ptick) == len(ppath) == len(pinfected))

    infected_parquet = 0
    pf = pq.ParquetFile(os.path.join(args.dataset, f"{profile.poop_file}.parquet"))
    for batch in pf.iter_batches(batch_size=2_000_000,
                                 columns=["time", "pathogen_level"]):
        df = batch.to_pandas()
        df = df[mask_in_window(df["time"], window)]
        infected_parquet += int((df["pathogen_level"] > 0).sum())
    # The flag, not the float32 magnitude, is the source of truth for
    # infected-vs-clean: pathogen_level's decay model reaches values (as
    # small as ~1e-161) well below float32's smallest positive subnormal
    # (~1.4e-45), so `poops_pathogen.f32 > 0` legitimately underflows for a
    # real fraction of genuinely infected events. `poops_infected.u8` is
    # computed from the source float64 column before that narrowing, so it
    # must match the parquet exactly with no tolerance for drift.
    check("every pathogen-bearing poop survived downsampling",
          int((pinfected == 1).sum()) == infected_parquet,
          f"bundle={(pinfected == 1).sum()} parquet={infected_parquet}")
    underflowed = int(((pinfected == 1) & (ppath == 0)).sum())
    print(f"INFO  poops_pathogen.f32 underflows to 0.0 for "
          f"{underflowed}/{int((pinfected == 1).sum())} infected events "
          f"(expected and harmless - poops_infected.u8 is authoritative)")

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
