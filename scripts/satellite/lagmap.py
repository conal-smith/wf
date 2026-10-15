"""The tide's delay behind its station, wherever there are flats to read it from.

lag.py reads one basin's lag (Strangford Lough's 100 minutes) off the looks;
this does it everywhere on a tile, a cell at a time. Per 2.56 km cell (a
quarter of a 512 block) and per station its pixels take: the pixels that are
wet in some looks and dry in others (as lag.py), sorted against the
station's fitted EOT20 shifted by each candidate lag in turn; the lag whose
levels sort them best (the lowest median misfit) is the cell's. A flip fit
depends only on the order of the looks' levels, so no tide table comes into
it; the amplitude cannot be had this way (a scale keeps the order).

A positive lag is later than the station. A cell whose best lag beats no
lag clearly (`clear`) behind a narrows or up an estuary is local knowledge: inside, the water covers and
uncovers its flats that much later than at the station. Those cells are
where a basin station (stations_*.json: a polygon and lagOf/lagMinutes) is
worth adding; lag.py then reads the basin's lag over its whole polygon.

Needs the tile's coastal looks (downloads/s2/<tile>/coast). Writes
<root>/work/lagmap/<tile>.json.

    python -I lagmap.py --tile 30UWC [--tile ...] [--lags -120:241:10] [--step 3]
"""
import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
import composite  # noqa: E402
import compose  # noqa: E402
import tides  # noqa: E402

CELL = 256
MIN_PIXELS = 150


def clear(cell, min_gain=0.02, min_lag=20, max_misfit=0.1):
    """A cell whose lag is worth believing: it sorts the looks clearly better
    than no lag, by a lag worth the name, and then fits about as well as the
    open coast does (a cell that still fits badly at its best lag is noise:
    turbid water, a harbour, waves)."""
    return (cell["misfitAtZero"] - cell["misfitAtBest"] > min_gain and abs(cell["bestLagMinutes"]) >= min_lag
            and cell["misfitAtBest"] < max_misfit)


def _model(args):
    lon, lat, t = args
    return tides.model(lon, lat, t)


def run(tile, lags, step, jobs):
    ctx = compose.Ctx(tile)
    keep = compose.qc(ctx, jobs)
    looks = compose.Looks([p for _, p, _ in ctx.coast])
    cal = common.read_json(common.path("work", "tides", "calibration.json"))["stations"]
    when = np.array([common.time_of(s).timestamp() for s in ctx.stamps])
    max_km = ctx.cfg["intertidalArchive"]["maxStationKm"]
    lags = np.asarray(lags)
    # Each station's fitted levels at every look, at every lag: one call to the model per
    # station, each in a fresh process (pyTMD's memory grows from one call to the next).
    import concurrent.futures as cf
    levels = {}
    with cf.ProcessPoolExecutor(1, max_tasks_per_child=1) as pool:
        for k in ctx.tile_st:
            c = cal[ctx.sid[k]]
            lon, lat = c["model"]
            # A lag of +L: the water here stands where the station's stood L minutes before
            # (calibrate's lagOf: the parent's shift less lagMinutes).
            t = (when[None, :] + (c["shiftMinutes"] - lags[:, None]) * 60).ravel()
            z = pool.submit(_model, (lon, lat, t)).result()
            levels[k] = (c["a"] + c["b"] * z).reshape(len(lags), len(when))
    size = ctx.size
    cells = []
    for i, j in ctx.pt["coastalBlocks"]:
        ks = np.flatnonzero(keep[(i, j)])
        codes = looks.stack(ks, f"c{i:02d}_{j:02d}", (size, size))[:, ::step, ::step]
        st = np.where(codes == 0, -1, np.where((codes & 3) == 2, 1, 0)).astype(np.int8)
        seen = (st >= 0).sum(0)
        freq = (st == 1).sum(0) / np.maximum(seen, 1)
        flips = (seen >= 30) & (freq > 0.1) & (freq < 0.9)
        if flips.sum() < MIN_PIXELS:
            continue
        (lon, lat), _ = compose.block_lonlat(ctx.pt, i, j, size, step=step)
        blon, blat = common.region_block_lonlat(lon, lat)
        nearest = common.nearest_station(blon, blat, ctx.stations, max_km)
        half = CELL // step
        for si in range(0, flips.shape[0], half):
            for sj in range(0, flips.shape[1], half):
                win = (slice(si, si + half), slice(sj, sj + half))
                for k in np.unique(nearest[win][flips[win]]):
                    if k not in levels:
                        continue
                    sel = np.zeros(flips.shape, bool)
                    sel[win] = flips[win] & (nearest[win] == k)
                    if sel.sum() < MIN_PIXELS:
                        continue
                    stack = st[:, sel][:, None, :]
                    curve = []
                    for li in range(len(lags)):
                        lv = levels[k][li][ks]
                        have = np.isfinite(lv)
                        _, misfit, _, state, _ = composite.flip_heights(stack[have], lv[have])
                        curve.append(float(np.nanmedian(misfit[state == 1])) if (state == 1).any() else np.nan)
                    curve = np.array(curve)
                    best = int(np.nanargmin(curve))
                    zero = int(np.argmin(np.abs(lags)))
                    cells.append({"block": [i, j], "cell": [si * step, sj * step],
                                  "lon": round(float(lon[win][sel[win]].mean()), 4),
                                  "lat": round(float(lat[win][sel[win]].mean()), 4),
                                  "station": ctx.sid[k], "pixels": int(sel.sum()) * step * step,
                                  "misfitAtZero": round(float(curve[zero]), 4),
                                  "bestLagMinutes": int(lags[best]), "misfitAtBest": round(float(curve[best]), 4),
                                  "curve": [round(float(v), 4) for v in curve]})
        print(f"{tile} block {i},{j}: {len(cells)} cells so far", flush=True)
    common.write_json(common.path("work", "lagmap", f"{tile}.json"),
                      {"tile": tile, "lagsMinutes": [int(v) for v in lags], "step": step, "cellPixels": CELL,
                       "cells": cells}, indent=None)
    gain = [c for c in cells if clear(c)]
    print(f"{tile}: {len(cells)} cells, {len(gain)} with a clear lag", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tile", required=True, action="append")
    p.add_argument("--lags", default="-120:241:10", help="minutes, start:stop:step")
    p.add_argument("--step", type=int, default=3, help="every n-th pixel each way")
    p.add_argument("--jobs", type=int, default=3, help="for the scene QC, if it has to be redone")
    a = p.parse_args()
    lags = list(range(*[int(v) for v in a.lags.split(":")]))
    for t in a.tile:
        run(t, lags, a.step, a.jobs)


if __name__ == "__main__":
    sys.exit(main())
