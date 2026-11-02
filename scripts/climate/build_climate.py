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

Waves are read at the open-water cell nearest the spot: wet on all eight sides and
5 m deep or more, so a cell wedged against the coastline (whose waves can only come
from one side) is never used. Where there is none within 8 km, as off a shallow
bay's beach, a cell that is water on six sides and 3 m deep within 7 km will do; a
spot with neither (a harbour, a lough, a lake) has no wave statistics rather than
the open sea's beyond its mouth. Wind is read at the nearest sea cell of the wind grid
for a spot on the coast and at the nearest cell of any kind inland.

The wave figures are the whole sea's height, peak period and direction: the same
quantities the forecast on the spot page shows, so a rider can hold a forecast's
"1.2 m at 12 s" against how often that has happened.

    pip install copernicusmarine xarray netCDF4 numpy
    copernicusmarine login
    python scripts/climate/build_climate.py --cache <dir> --out public/climate

The spots are the site's own list, public/riding-locations.json (`npm run spots:export`).
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
import xarray as xr

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
    w = xr.open_dataset(static)
    depth = w["deptho"].values
    wet = np.isfinite(depth) & (np.nan_to_num(w["mask"].values.squeeze()) > 0)
    v = xr.open_dataset(wind)
    return (w["latitude"].values, w["longitude"].values, wet, depth), (v["latitude"].values, v["longitude"].values)


def wave_cell(spot, wave):
    """The nearest open-water cell, or (a shallow bay's beach) the nearest cell that is
    water on six of its eight sides and 3 m deep, closer in; None in a harbour or lake."""
    la, lo, wet, depth = wave
    i0, j0 = int(np.abs(la - spot["lat"]).argmin()), int(np.abs(lo - spot["lon"]).argmin())

    def nearest(open_sides, min_depth, limit):
        best = None
        for i in range(max(1, i0 - 12), min(len(la) - 1, i0 + 13)):
            for j in range(max(1, j0 - 6), min(len(lo) - 1, j0 + 7)):
                if not wet[i, j] or wet[i - 1:i + 2, j - 1:j + 2].sum() - 1 < open_sides or not depth[i, j] >= min_depth:
                    continue
                d = km(spot["lat"], spot["lon"], la[i], lo[j])
                if d <= limit and (best is None or d < best[0]):
                    best = (d, float(la[i]), float(lo[j]))
        return best

    return nearest(8, WAVE_MIN_DEPTH, WAVE_SEARCH_KM) or nearest(6, BAY_MIN_DEPTH, BAY_SEARCH_KM)


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
    ds = xr.open_dataset(path).squeeze()
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


def wave_stats(path):
    ds = xr.open_dataset(path).squeeze()
    t = ds["time"].values.astype("datetime64[s]").astype(np.int64)
    hs, tp, frm = ds["VHM0"].values, ds["VTPK"].values, ds["VMDR"].values
    ok = np.isfinite(hs) & np.isfinite(tp) & np.isfinite(frm)
    t, hs, tp, frm = t[ok], hs[ok], tp[ok], frm[ok]
    mon = months_of(t)
    day = day_keys(t)
    # Years of record each month has, to turn counts into days a month.
    ym = {(datetime.fromtimestamp(x, timezone.utc).year, m) for x, m in zip(t[::8], mon[::8])}
    years_in = np.array([sum(1 for _, mm in ym if mm == m) for m in range(1, 13)])

    height = []
    for m in range(1, 13):
        v = hs[mon == m]
        height.append([round(float(np.percentile(v, q)), 2) for q in (10, 50, 90)])

    big = hs >= MIN_M
    sec = sector16(frm)
    pband = np.searchsorted(ROSE_PERIODS, tp, side="right")
    rose = [[per_mille(((pband == b) & big & (sec == s)).sum() / len(hs)) for b in range(4)] for s in range(16)]

    def days_a_month(mask):
        u = np.unique(day[mask])
        um = months_of(u * 86400 + 43200)
        return [round(float((um == m).sum() / years_in[m - 1]), 1) for m in range(1, 13)]

    swell = []
    for lo_m, hi_m in SIZE_BANDS:
        swell.append([days_a_month((tp >= lo) & (tp < hi) & (hs >= lo_m) & (hs < hi_m)) for lo, hi in PERIOD_BANDS])

    candles = []
    for lo, hi in PERIOD_BANDS:
        k = (tp >= lo) & (tp < hi) & (hs >= MIN_M)
        u, inv = np.unique(day[k], return_inverse=True)
        # A day's size: its typical reading with that period, not its biggest.
        sums = np.zeros(len(u)); counts = np.zeros(len(u))
        np.add.at(sums, inv, hs[k]); np.add.at(counts, inv, 1)
        daily = sums / counts
        um = months_of(u * 86400 + 43200)
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

    plan = []
    for s in spots:
        wc = wave_cell(s, wave)
        nc = wind_cell(s, wind, wave, coastal=wc is not None)
        plan.append((s, wc, nc))

    def job(item):
        s, wc, nc = item
        out = {"id": s["id"], "credit": "Generated using E.U. Copernicus Marine Service Information"}
        wpath = fetch(WIND_DATASET, ["eastward_wind", "northward_wind"], nc[1], nc[2], WIND_START, WIND_END,
                      os.path.join(a.cache, f"wind_{nc[1]:.4f}_{nc[2]:.4f}.nc"))
        out["wind"] = {"at": [round(nc[1], 3), round(nc[2], 3)], **wind_stats(wpath)}
        if wc is not None:
            vpath = fetch(WAVE_DATASET, ["VHM0", "VTPK", "VMDR"], wc[1], wc[2], WAVE_START, WAVE_END,
                          os.path.join(a.cache, f"wave_{wc[1]:.4f}_{wc[2]:.4f}.nc"))
            out["waves"] = {"at": [round(wc[1], 4), round(wc[2], 4)], "km": round(wc[0], 1), **wave_stats(vpath)}
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
