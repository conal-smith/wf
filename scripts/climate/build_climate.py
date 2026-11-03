"""Each spot's wind and waves through the year, from Copernicus Marine's records of the past.

Static numbers: worked out once, offline, and published as one small JSON file per
spot that the spot page draws below everything else. Nothing here runs on the site
or in the forecast worker.

Sources, both Copernicus Marine (free, commercial use allowed, credit required:
"Generated using E.U. Copernicus Marine Service Information"):

- Wind: Global Ocean Hourly Reprocessed Sea Surface Wind and Stress
  (WIND_GLO_PHY_L4_MY_012_006, dataset cmems_obs-wind_glo_phy_my_l4_0.125deg_PT1H):
  ECMWF's ERA5 corrected with satellite scatterometers, hourly, 0.125°, from 2007.
- Waves: Atlantic - European North West Shelf - Wave Physics Reanalysis
  (NWSHELF_REANALYSIS_WAV_004_015, dataset MetO-NWS-WAV-RAN): WAVEWATCH III on a
  1.5-3 km grid, every 3 hours, from 1980; this uses 2000 on.

Waves are read at an open-water cell near the spot: wet on all eight sides and 5 m
deep or more, so a cell wedged against the coastline (whose waves can only come from
one side) is never used; where there is none within 8 km, as off a shallow bay's
beach, a cell that is water on six sides and 3 m deep within 7 km will do. Of those,
the nearest the sea reaches the spot from: the straight line from the spot to the
cell has to stay over water as the map's own coastline draws it (sea-view.mjs, from
OpenStreetMap, far finer at the shore than the model's grid), so a lagoon behind a
spit or a lake behind the dunes is never given the waves beyond. A few enclosed
spots the line lets through (inside a harbour's piers, at the head of a narrow
inlet) are named in SHELTERED, and the odd beach whose every line clips a point of
land in OPEN. A spot with no such cell has no wave statistics,
and its file says `"sheltered": true` for the page to say so. Wind is read at the
nearest sea cell of the wind grid for a spot by the sea and at the nearest cell of
any kind inland.

The wave height and the rose are the whole sea's (wind waves and swell together,
the forecast's own figures). The swell is the swell alone: the model's primary and
secondary swell partitions, never its wind sea, banded by each partition's mean
period (Tm01) and sized by its height. A day has a band's swell when it has stayed
0.3 m or more for two readings in a row (6 hours), and the day's size is its typical
reading of it.

    pip install copernicusmarine xarray netCDF4 numpy
    copernicusmarine login
    python scripts/climate/build_climate.py --cache <dir> --out public/climate

The spots are the site's own list, public/riding-locations.json (`npm run spots:export`),
and the line to the sea needs the repository's node packages (`npm ci`) and the
basemap's tiles, fetched once into the system's temporary directory.
The downloads are kept in --cache, so a second run only fetches what is new.
"""
import argparse
import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np

WIND_DATASET = "cmems_obs-wind_glo_phy_my_l4_0.125deg_PT1H"
WAVE_DATASET = "MetO-NWS-WAV-RAN"
WAVE_STATIC = "cmems_mod_nws_wav_my_1.5km-3D_static"
BOX = dict(minimum_latitude=51.0, maximum_latitude=55.8, minimum_longitude=-11.2, maximum_longitude=-5.0)
WIND_START, WIND_END = "2007-01-12T00:00:00", "2026-06-20T23:00:00"
WAVE_START, WAVE_END = "2000-01-01T00:00:00", "2026-06-30T21:00:00"

KNOTS = 1.943844
WIND_BANDS = [12, 16, 22, 30]          # knots: 12-16, 16-22, 22-30, 30 and over
PERIOD_BANDS = [(6, 9), (9, 12), (12, 99)]
ROSE_PERIODS = [6, 9, 12]              # under 6, 6-9, 9-12, 12 and over
# Metres: 1 ft and over, 2-4 ft, 4-6 ft, 6 ft and over. Nothing under a foot counts anywhere:
# on a flat day the peak period can belong to a ripple of a few centimetres, which is no swell.
MIN_M = 0.3
SIZE_BANDS = [(MIN_M, 99), (0.6, 1.2), (1.2, 1.8), (1.8, 99)]
WAVE_SEARCH_KM = 8.0
WAVE_MIN_DEPTH = 5.0
# A shallow bay's beach (Lahinch): a cell mostly in open water, nearer in.
BAY_SEARCH_KM = 7.0
BAY_MIN_DEPTH = 3.0
# A day has a swell when it has lasted two readings in a row (6 hours) at MIN_M or more.
PERSIST = 2
# Enclosed water the straight line lets through, named by hand: inside a harbour's
# walls, or at the head of a narrow inlet, the open sea's waves are mostly spent.
SHELTERED = {
    "dun-laoghaire": "inside the harbour's piers",
    "oysterhaven": "at the head of a narrow inlet",
    "glandore": "up a narrow harbour",
    "schull": "in a harbour behind Long Island",
    "cunnamore": "among the islands of Roaringwater Bay",
    "bantry-bay": "at the head of the bay, behind Whiddy Island",
}
# Open water the straight line misses, named by hand: the line to every model cell
# clips a point of land, but the beach looks out to the sea.
OPEN = {
    "marble-hill": "looks up Sheephaven Bay to the sea past the point north of it",
}


def open_nc(path):
    import xarray as xr  # here, so the tests need numpy only
    return xr.open_dataset(path)


def km(lat1, lon1, lat2, lon2):
    return math.hypot((lat2 - lat1) * 111.2, (lon2 - lon1) * 111.2 * math.cos(math.radians((lat1 + lat2) / 2)))


def grids(cache):
    """The wave model's open water and depth, and the wind grid's cells, over Ireland."""
    import copernicusmarine as cm
    static = os.path.join(cache, "wave_static.nc")
    if not os.path.exists(static):
        cm.subset(dataset_id=WAVE_STATIC, variables=["deptho", "mask"], **BOX,
                  output_directory=cache, output_filename="wave_static.nc", overwrite=True)
    wind = os.path.join(cache, "wind_grid.nc")
    if not os.path.exists(wind):
        cm.subset(dataset_id=WIND_DATASET, variables=["eastward_wind"], **BOX,
                  start_datetime="2020-01-15T12:00:00", end_datetime="2020-01-15T12:00:00",
                  output_directory=cache, output_filename="wind_grid.nc", overwrite=True)
    w = open_nc(static)
    depth = w["deptho"].values
    wet = np.isfinite(depth) & (np.nan_to_num(w["mask"].values.squeeze()) > 0)
    v = open_nc(wind)
    return (w["latitude"].values, w["longitude"].values, wet, depth), (v["latitude"].values, v["longitude"].values)


def wave_candidates(spot, wave):
    """The cells the spot's waves may be read at, best first: open-water cells (wet on
    all eight sides, 5 m deep) within 8 km, nearest first, then, for a shallow bay's
    beach, cells water on six sides and 3 m deep within 7 km. Each is (km, lat, lon)."""
    la, lo, wet, depth = wave
    i0, j0 = int(np.abs(la - spot["lat"]).argmin()), int(np.abs(lo - spot["lon"]).argmin())

    def within(open_sides, min_depth, limit):
        found = []
        for i in range(max(1, i0 - 12), min(len(la) - 1, i0 + 13)):
            for j in range(max(1, j0 - 6), min(len(lo) - 1, j0 + 7)):
                if not wet[i, j] or wet[i - 1:i + 2, j - 1:j + 2].sum() - 1 < open_sides or not depth[i, j] >= min_depth:
                    continue
                d = km(spot["lat"], spot["lon"], la[i], lo[j])
                if d <= limit:
                    found.append((d, float(la[i]), float(lo[j])))
        return sorted(found)

    first = within(8, WAVE_MIN_DEPTH, WAVE_SEARCH_KM)
    return first + [c for c in within(6, BAY_MIN_DEPTH, BAY_SEARCH_KM) if c not in first]


def sea_view(spots, candidates, cache):
    """For each spot, the first of its candidate cells the open sea reaches it from in a
    straight line over water (scripts/climate/sea-view.mjs), or None."""
    import subprocess
    ask = [{"id": s["id"], "lat": s["lat"], "lon": s["lon"], "cells": [[c[1], c[2]] for c in cs]}
           for s, cs in zip(spots, candidates)]
    src, dst = os.path.join(cache, "sea_view_in.json"), os.path.join(cache, "sea_view_out.json")
    with open(src, "w") as f:
        json.dump(ask, f)
    subprocess.run(["node", os.path.join(os.path.dirname(__file__), "sea-view.mjs"), src, dst], check=True)
    seen = json.load(open(dst))
    picks = []
    for s, cs in zip(spots, candidates):
        i = seen[s["id"]]["cell"]
        if s["id"] in OPEN and cs:
            i = 0
        picks.append(None if i is None or s["id"] in SHELTERED else cs[i])
    return picks, seen


def wind_cell(spot, wind, wave, coastal):
    la, lo = wind
    wla, wlo, wet, _ = wave
    best = None
    for a in la:
        for b in lo:
            if coastal:
                # A sea cell: most of the wave model's cells inside it are water.
                ii = np.abs(wla - a) <= 0.0625
                jj = np.abs(wlo - b) <= 0.0625
                block = wet[np.ix_(ii, jj)]
                if block.size == 0 or block.mean() < 0.5:
                    continue
            d = km(spot["lat"], spot["lon"], a, b)
            if best is None or d < best[0]:
                best = (d, float(a), float(b))
    return best


_locks: dict = {}
_locks_lock = threading.Lock()


def fetch(dataset, variables, lat, lon, start, end, path, tries=4):
    """One cell's series, downloaded once however many spots share the cell."""
    with _locks_lock:
        lock = _locks.setdefault(path, threading.Lock())
    with lock:
        if os.path.exists(path):
            return path
        import copernicusmarine as cm
        tmp = path + ".part.nc"
        for attempt in range(tries):
            try:
                cm.subset(dataset_id=dataset, variables=variables, minimum_latitude=lat, maximum_latitude=lat,
                          minimum_longitude=lon, maximum_longitude=lon, start_datetime=start, end_datetime=end,
                          output_directory=os.path.dirname(path), output_filename=os.path.basename(tmp),
                          overwrite=True, service="arco-time-series", disable_progress_bar=True)
                os.replace(tmp, path)
                return path
            except Exception:
                if attempt == tries - 1:
                    raise
                time.sleep(20 * (attempt + 1))


def months_of(times):
    return np.array([datetime.fromtimestamp(t, timezone.utc).month for t in times])


def day_keys(times):
    return (times // 86400).astype(np.int64)


def per_mille(x):
    return int(round(x * 1000))


def sector16(direction):
    return (np.round(direction / 22.5).astype(int)) % 16


def wind_stats(path):
    ds = open_nc(path).squeeze()
    t = ds["time"].values.astype("datetime64[s]").astype(np.int64)
    kn = np.hypot(ds["eastward_wind"].values, ds["northward_wind"].values) * KNOTS
    # Where the wind blows from: the vector points where it blows to.
    frm = (np.degrees(np.arctan2(-ds["eastward_wind"].values, -ds["northward_wind"].values)) + 360) % 360
    ok = np.isfinite(kn)
    t, kn, frm = t[ok], kn[ok], frm[ok]
    band = np.searchsorted(WIND_BANDS, kn, side="right")      # 0 under 12, 1..4 the bands
    mon = months_of(t)
    months = []
    for m in range(1, 13):
        k = mon == m
        n = k.sum()
        months.append([per_mille(((band == b) & k).sum() / n) for b in range(1, 5)])
    sec = sector16(frm)
    rose = [[per_mille(((band == b) & (sec == s)).sum() / len(kn)) for b in range(1, 5)] for s in range(16)]
    years = [int(datetime.fromtimestamp(t[0], timezone.utc).year), int(datetime.fromtimestamp(t[-1], timezone.utc).year)]
    return {"years": years, "months": months, "rose": rose}


WAVE_VARS = ["VHM0", "VTPK", "VMDR", "VHM0_SW1", "VTM01_SW1", "VHM0_SW2", "VTM01_SW2"]
SWELLS = [("VHM0_SW1", "VTM01_SW1"), ("VHM0_SW2", "VTM01_SW2")]


def swell_in_band(heights, periods, lo, hi):
    """Each reading's swell with a period from lo to hi seconds: the swell partitions'
    (primary and secondary, never the wind sea) whose mean period is in the band, their
    heights added as energy. A reading with no swell partition reads 0."""
    energy = np.zeros(len(heights[0]))
    for h, tm in zip(heights, periods):
        h = np.nan_to_num(h)
        energy += np.where((tm >= lo) & (tm < hi), h * h, 0.0)
    return np.sqrt(energy)


def lasting(flag, times, readings=PERSIST, step=3 * 3600):
    """The readings that are part of a run of at least `readings` in a row, every one
    flagged and each `step` seconds after the last: a swell that stays, not a passing
    reading."""
    flag = np.asarray(flag, bool)
    if not flag.any():
        return flag
    joined = np.concatenate([[False], (np.diff(times) == step) & flag[1:] & flag[:-1]])
    run_id = np.cumsum(~joined | ~flag)
    sizes = np.bincount(run_id, weights=flag.astype(float))
    return flag & (sizes[run_id] >= readings)


def wave_stats(path):
    ds = open_nc(path).squeeze()
    t = ds["time"].values.astype("datetime64[s]").astype(np.int64)
    return wave_summary(t, ds["VHM0"].values, ds["VTPK"].values, ds["VMDR"].values,
                        [ds[h].values for h, _ in SWELLS], [ds[tm].values for _, tm in SWELLS])


def wave_summary(t, hs, tp, frm, heights, periods):
    """The waves' year from one cell's 3-hourly series: times (unix seconds), the whole
    sea's height, peak period and direction, and each swell partition's height and mean
    period."""
    ok = np.isfinite(hs) & np.isfinite(tp) & np.isfinite(frm)
    t, hs, tp, frm = t[ok], hs[ok], tp[ok], frm[ok]
    heights = [np.asarray(h)[ok] for h in heights]
    periods = [np.nan_to_num(np.asarray(tm)[ok]) for tm in periods]
    mon = months_of(t)
    day = day_keys(t)
    # Years of record each month has, to turn counts into days a month.
    ym = {(datetime.fromtimestamp(x, timezone.utc).year, m) for x, m in zip(t[::8], mon[::8])}
    years_in = np.array([sum(1 for _, mm in ym if mm == m) for m in range(1, 13)])

    # The whole sea: wind waves and swell together, as the forecast's wave height is.
    height = []
    for m in range(1, 13):
        v = hs[mon == m]
        height.append([round(float(np.percentile(v, q)), 2) for q in (10, 50, 90)])

    big = hs >= MIN_M
    sec = sector16(frm)
    pband = np.searchsorted(ROSE_PERIODS, tp, side="right")
    rose = [[per_mille(((pband == b) & big & (sec == s)).sum() / len(hs)) for b in range(4)] for s in range(16)]

    swell = [[None] * len(PERIOD_BANDS) for _ in SIZE_BANDS]
    candles = []
    for p, (lo, hi) in enumerate(PERIOD_BANDS):
        h = swell_in_band(heights, periods, lo, hi)
        k = lasting(h >= MIN_M, t)
        u, inv = np.unique(day[k], return_inverse=True)
        # A day's size: its typical reading of that swell, not its biggest.
        sums = np.zeros(len(u)); counts = np.zeros(len(u))
        np.add.at(sums, inv, h[k]); np.add.at(counts, inv, 1)
        daily = sums / counts if len(u) else np.zeros(0)
        um = months_of(u * 86400 + 43200)
        for z, (lo_m, hi_m) in enumerate(SIZE_BANDS):
            inside = (daily >= lo_m) & (daily < hi_m)
            swell[z][p] = [round(float(((um == m) & inside).sum() / years_in[m - 1]), 1) for m in range(1, 13)]
        row = []
        for m in range(1, 13):
            v = daily[um == m]
            d = round(float(len(v) / years_in[m - 1]), 1)
            if len(v) >= 5:
                row.append([d] + [round(float(np.percentile(v, q)), 2) for q in (10, 50, 90)])
            else:
                row.append([d, None, None, None])
        candles.append(row)
    years = [int(datetime.fromtimestamp(t[0], timezone.utc).year), int(datetime.fromtimestamp(t[-1], timezone.utc).year)]
    return {"years": years, "height": height, "rose": rose, "swell": swell, "candles": candles}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--spots", default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "riding-locations.json"))
    ap.add_argument("--cache", required=True, help="where downloads are kept between runs")
    ap.add_argument("--out", required=True, help="directory for one <id>.json per spot")
    ap.add_argument("--only", nargs="*", help="spot ids to build")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    spots = json.load(open(a.spots))
    if a.only:
        spots = [s for s in spots if s["id"] in a.only]
    wave, wind = grids(a.cache)

    candidates = [wave_candidates(s, wave) for s in spots]
    picks, _ = sea_view(spots, candidates, a.cache)
    plan = []
    for s, cs, wc in zip(spots, candidates, picks):
        # A spot by the sea keeps the wind of the sea, whether or not its waves reach it.
        nc = wind_cell(s, wind, wave, coastal=bool(cs))
        plan.append((s, wc, nc))

    def job(item):
        s, wc, nc = item
        out = {"id": s["id"], "credit": "Generated using E.U. Copernicus Marine Service Information"}
        wpath = fetch(WIND_DATASET, ["eastward_wind", "northward_wind"], nc[1], nc[2], WIND_START, WIND_END,
                      os.path.join(a.cache, f"wind_{nc[1]:.4f}_{nc[2]:.4f}.nc"))
        out["wind"] = {"at": [round(nc[1], 3), round(nc[2], 3)], **wind_stats(wpath)}
        if wc is not None:
            vpath = fetch(WAVE_DATASET, WAVE_VARS, wc[1], wc[2], WAVE_START, WAVE_END,
                          os.path.join(a.cache, f"swell_{wc[1]:.4f}_{wc[2]:.4f}.nc"))
            out["waves"] = {"at": [round(wc[1], 4), round(wc[2], 4)], "km": round(wc[0], 1), **wave_stats(vpath)}
        else:
            # Sheltered water: the page says so rather than showing the open sea's waves.
            out["sheltered"] = True
        with open(os.path.join(a.out, f"{s['id']}.json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        return s["id"], wc is not None

    done = 0
    with ThreadPoolExecutor(a.workers) as ex:
        for sid, has_waves in ex.map(job, plan):
            done += 1
            print(f"{done}/{len(plan)} {sid}{'' if has_waves else ' (no waves)'}", flush=True)


if __name__ == "__main__":
    main()
