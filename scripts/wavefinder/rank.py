"""A region's candidate breaks, ranked, and checked against the known breaks.

Gathers score.py's pieces from every tile of the region, scores each

    score = (P(foam | big) - P(foam | calm)) x area (ha)

the hectares of extra white water a big swell brings there (chosen over
the first try, the same with the square root of the area capped at 20 ha,
and over P(foam | mid) and the bare difference, by how many of Ireland's
first four tiles' known breaks each put among the top places against
chance: 7 of 21 in the top 25 places, 4.2 times chance; Great Britain is
the check that was not looked at). Joins pieces within
rank.placeKm into **places** (each named by its best piece), and writes:

    <root>/candidates-<region>.geojson   every piece: point, score, rank, swell window, wind, looks
    <root>/<region>/work/places.json      the places, best first
    <root>/<region>/work/validation.json  each known break (breaks.json): the nearest piece, its
                                          rank, and whether it is within validateKm

Kinds, from the piece itself: **outer** (its foam is mostly over
rank.outerM from the shore: a reef or bar out in the bay), **bigwave**
(outer, and lit mostly in the biggest swells: P(foam | mid) under a third of
P(foam | big)), else **shore** (the surf zone of a beach or the foot of a rock).

    python -I rank.py --region ireland
"""
import argparse
import glob
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wf  # noqa: E402


def piece_score(c):
    """Hectares of extra white water in a big swell: (P big - P calm) x area."""
    return (c["pBig"] - c["pCalm"]) * c["areaHa"]


def kind_of(c, outer_m):
    if c.get("offshoreM", 0) >= outer_m:
        return "bigwave" if c["pMid"] < c["pBig"] / 3 else "outer"
    return "shore"


def places(cands, km):
    """Greedy: the best piece not yet in a place starts one, and takes every piece within km."""
    order = sorted(range(len(cands)), key=lambda k: -cands[k]["score"])
    lon = np.array([c["lon"] for c in cands])
    lat = np.array([c["lat"] for c in cands])
    taken = np.zeros(len(cands), bool)
    out = []
    for k in order:
        if taken[k]:
            continue
        near = (wf.haversine_km(lon[k], lat[k], lon, lat) <= km) & ~taken
        taken |= near
        members = [cands[i]["id"] for i in np.flatnonzero(near)]
        out.append({"id": cands[k]["id"], "lon": cands[k]["lon"], "lat": cands[k]["lat"], "score": cands[k]["score"],
                    "kind": cands[k]["kind"], "pieces": members})
    return out


def baseline(cands, centres, km, n=3000, seed=1):
    """What recall would chance give: the share of random searched shore cells (on the
    tiles done) with a piece within km, and the same for the top 25, 50, 100 and 200 places'
    pieces. A known break is no more likely to be near a piece than this if the pieces
    were spread at random over the searched coast."""
    import rasterio
    from pyproj import Transformer
    if not cands or not len(centres):
        return {}
    with rasterio.open(wf.rpath("work", "search.tif")) as src:
        f = src.read(1).astype(np.uint8)
        tf, crs = src.transform, src.crs
    rows, cols = np.nonzero(f & 1)
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(rows), size=min(n * 4, len(rows)), replace=False)
    x, y = tf * (cols[pick] + 0.5, rows[pick] + 0.5)
    lon, lat = Transformer.from_crs(crs, 4326, always_xy=True).transform(x, y)
    near_tile = np.array([float(wf.haversine_km(o, a, centres[:, 0], centres[:, 1]).min()) <= 4
                          for o, a in zip(lon, lat)])
    lon, lat = np.asarray(lon)[near_tile][:n], np.asarray(lat)[near_tile][:n]
    out = {"cells": int(len(lon))}
    clon = np.array([c["lon"] for c in cands])
    clat = np.array([c["lat"] for c in cands])
    prank = np.array([c["placeRank"] for c in cands])
    for label, keep in [("all", prank > 0)] + [(str(t), prank <= t) for t in (25, 50, 100, 200)]:
        if not keep.any():
            out[label] = 0.0
            continue
        hit = [float(wf.haversine_km(o, a, clon[keep], clat[keep]).min()) <= km for o, a in zip(lon, lat)]
        out[label] = round(float(np.mean(hit)), 3)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default="ireland")
    a = p.parse_args()
    wf.set_region(a.region)
    cfg = wf.config()
    rk = cfg["rank"]
    cands = []
    tiles = sorted(glob.glob(wf.rpath("work", "score", "*.json")))
    for f in tiles:
        cands += wf.read_json(f)["candidates"]
    for c in cands:
        c["score"] = round(piece_score(c), 3)
        c["kind"] = kind_of(c, rk["outerM"])
    cands.sort(key=lambda c: -c["score"])
    for n, c in enumerate(cands, 1):
        c["rank"] = n
    pl = places(cands, rk["placeKm"])
    rank_of_place = {}
    for n, plc in enumerate(pl, 1):
        plc["rank"] = n
        for pid in plc["pieces"]:
            rank_of_place[pid] = n
    for c in cands:
        c["placeRank"] = rank_of_place[c["id"]]

    # Only the breaks on the coast of the tiles done so far count (a block of theirs within 4 km).
    centres = np.array([c for f in tiles for c in wf.read_json(
        wf.rpath("work", "looks", os.path.basename(f)))["blocks"].values()] or np.zeros((0, 2)))
    breaks = [b for b in wf.read_json(os.path.join(HERE, "breaks.json"))["breaks"] if b["region"] == a.region
              and len(centres) and float(wf.haversine_km(b["lon"], b["lat"], centres[:, 0], centres[:, 1]).min()) <= 4]
    val = []
    for b, best, d in wf.recall(breaks, cands, cfg["validateKm"]):
        near = min(cands, key=lambda c: float(wf.haversine_km(b["lon"], b["lat"], c["lon"], c["lat"]))) if cands else None
        val.append({"name": b["name"], "kind": b["kind"], "east": bool(b.get("east")), "lat": b["lat"], "lon": b["lon"],
                    "found": best is not None, "km": round(d, 2),
                    "piece": near["id"] if near else None,
                    "pieceRank": near["rank"] if near else None,
                    "placeRank": near["placeRank"] if near else None,
                    "pBig": near["pBig"] if near else None,
                    "nBig": near["nBig"] if near else None})
    found = sum(v["found"] for v in val)
    base = baseline(cands, centres, cfg["validateKm"])
    covered = sorted({os.path.basename(f)[:-5] for f in tiles})
    doc = {"region": a.region, "tiles": covered, "breaks": len(val), "found": found,
           "recall": round(found / max(len(val), 1), 3), "km": cfg["validateKm"], "results": val,
           "baseline": base,
           "top": {str(n): sum(1 for v in val if v["found"] and v["placeRank"] <= n) for n in (25, 50, 100, 200)}}
    wf.write_json(wf.rpath("work", "validation.json"), doc, indent=1)
    wf.write_json(wf.rpath("work", "places.json"), {"region": a.region, "places": pl}, indent=None)

    feats = []
    for c in cands:
        props = {k: v for k, v in c.items() if k not in ("looks", "lon", "lat")}
        props["region"] = a.region
        props["nLooks"] = len(c["looks"])
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
                      "properties": props})
    wf.write_json(wf.path(f"candidates-{a.region}.geojson"),
                  {"type": "FeatureCollection", "name": f"wavefinder-{a.region}",
                   "attribution": "Contains modified Copernicus Sentinel data 2017-2026; ERA5 (Copernicus Climate "
                                  "Change Service) via Open-Meteo, CC BY 4.0; EMODnet Bathymetry DTM, CC BY 4.0",
                   "features": feats})
    print(f"{a.region}: {len(cands)} pieces in {len(pl)} places over {len(covered)} tiles; "
          f"{found}/{len(val)} known breaks within {cfg['validateKm']} km; chance {base}; top places {doc['top']}",
          flush=True)
    for v in val:
        print(f"  {'found' if v['found'] else 'MISSED':6s} {v['name']:28s} {v['km']:5.2f} km  place #{v['placeRank']}  "
              f"P(big) {v['pBig']}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
