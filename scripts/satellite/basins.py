"""Basin stations from the lag maps: where the tide runs ahead of or behind its station.

lagmap.py gives each 2.56 km cell of flats the lag that best sorts its looks
against its station's tide. Here the clear cells (lagmap.clear) of one
station whose lags agree within --spread minutes and that touch are joined
into a basin: its outline (the cells' union) is the polygon, the lag (the
pixels' median, to 10 minutes) its lagMinutes behind its parent (negative:
ahead). A basin takes every pixel in its polygon (common.basins: the smaller
of two that overlap wins, so a basin inside a basin keeps its own), and its
tide is its parent's fitted model shifted (tides.py calibrate). A group
smaller than --min-pixels is left alone.

The lags are also the product: local knowledge of when the water covers and
uncovers a place, against the tide station a sailor would look up.

Writes the basins into the root's "others" stations file (config stations,
or stations_ni.json for the island), replacing any the last run wrote (id
*_LAG<n>), and work/basins.json: every basin with its cells.

    python -I basins.py [--spread 20] [--min-pixels 15000] [--dry-run]
"""
import argparse
import glob
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
import lagmap  # noqa: E402


def cell_polygon(plan, tile, cell, size, cellpx):
    from pyproj import Transformer
    from shapely.geometry import Polygon
    pt = plan["tiles"][tile]
    l, b, r, t = pt["bbox"]
    i, j = cell["block"]
    si, sj = cell["cell"]
    x0 = l + (j * size + sj) * 10
    y0 = t - (i * size + si) * 10
    x1, y1 = x0 + cellpx * 10, y0 - cellpx * 10
    tr = Transformer.from_crs(f"EPSG:{pt['epsg']}", 4326, always_xy=True)
    return Polygon([tr.transform(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))])


def main():
    from shapely.ops import unary_union
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--spread", type=int, default=20, help="minutes: cells further apart in lag are not joined")
    p.add_argument("--min-pixels", type=int, default=15000, help="10 m pixels of flats a basin needs (1.5 km²)")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    cfg = common.config()
    plan = common.read_json(common.path("work", "plan.json"))
    size = plan["blockSize"]
    stations = {s["id"]: s for s in common.stations(include_inactive=True)}
    cells = []
    for f in sorted(glob.glob(common.path("work", "lagmap", "*.json"))):
        d = common.read_json(f)
        if d["tile"] not in plan["tiles"] or "-" in os.path.basename(f)[:-5]:
            continue
        for c in d["cells"]:
            if lagmap.clear(c):
                c = dict(c, tile=d["tile"], geom=cell_polygon(plan, d["tile"], c, size, d["cellPixels"]))
                cells.append(c)
    # Join touching cells of one station with lags within the spread (single linkage).
    n = len(cells)
    parent = list(range(n))

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for x in range(n):
        for y in range(x + 1, n):
            cx, cy = cells[x], cells[y]
            if (cx["station"] == cy["station"] and abs(cx["bestLagMinutes"] - cy["bestLagMinutes"]) <= a.spread
                    and cx["geom"].buffer(1e-4).intersects(cy["geom"])):
                parent[find(x)] = find(y)
    groups = {}
    for k in range(n):
        groups.setdefault(find(k), []).append(cells[k])
    basins = []
    for g in groups.values():
        px = sum(c["pixels"] for c in g)
        if px < a.min_pixels:
            continue
        lags = np.repeat([c["bestLagMinutes"] for c in g], [c["pixels"] for c in g])
        lag = int(round(float(np.median(lags)) / 10) * 10)
        if lag == 0:
            continue
        shape = unary_union([c["geom"] for c in g]).buffer(1e-4).buffer(-1e-4)
        parts = list(shape.geoms) if shape.geom_type == "MultiPolygon" else [shape]
        for part in parts:
            ring = [[round(x, 5), round(y, 5)] for x, y in part.simplify(2e-4).exterior.coords[:-1]]
            mine = [c for c in g if c["geom"].intersects(part)]
            basins.append({"parent": g[0]["station"], "lagMinutes": lag, "pixels": sum(c["pixels"] for c in mine),
                           "cells": len(mine), "ring": ring,
                           "lon": round(part.centroid.x, 4), "lat": round(part.centroid.y, 4),
                           "misfitAtZero": round(float(np.median([c["misfitAtZero"] for c in mine])), 3),
                           "misfitAtLag": round(float(np.median([c["misfitAtBest"] for c in mine])), 3)})
    basins.sort(key=lambda b: (b["parent"], b["lat"]))
    counts = {}
    for b in basins:
        counts[b["parent"]] = counts.get(b["parent"], 0) + 1
        b["id"] = f"{b['parent'].removesuffix('_MODELLED')}_LAG{counts[b['parent']]}"
        when = "behind" if b["lagMinutes"] > 0 else "ahead of"
        print(f"{b['id']:30s} {b['lat']:.3f},{b['lon']:.3f}: {abs(b['lagMinutes'])} min {when} {b['parent']}, "
              f"{b['cells']} cells, {b['pixels'] * 1e-4:.1f} km² of flats, misfit {b['misfitAtZero']} -> {b['misfitAtLag']}")
    print(f"{len(basins)} basins from {len(cells)} clear cells")
    if a.dry_run:
        return
    common.write_json(common.path("work", "basins.json"), {"spreadMinutes": a.spread, "minPixels": a.min_pixels,
                                                             "basins": basins})
    others = os.path.join(HERE, cfg.get("stations", {}).get("others", "stations_ni.json"))
    doc = common.read_json(others)
    st = {k: v for k, v in doc["stations"].items() if "_LAG" not in k}
    for b in basins:
        par = stations[b["parent"]]
        st[b["id"]] = {"name": f"{par['name']} {'+' if b['lagMinutes'] > 0 else '-'}{abs(b['lagMinutes'])} min",
                       "lon": b["lon"], "lat": b["lat"], "model": par["model"], "lagOf": b["parent"],
                       "lagMinutes": b["lagMinutes"], "polygon": b["ring"], "fromLagmap": True}
    doc["stations"] = st
    with open(others + ".part", "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    os.replace(others + ".part", others)
    print(f"wrote {len(basins)} basins into {os.path.basename(others)}")


if __name__ == "__main__":
    sys.exit(main())
