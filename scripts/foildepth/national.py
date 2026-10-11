"""Build the national foilable-depth regions: one archive per tide station.

The tide differs round the coast, and the map colours an archive by one
station's tide. So the coast is cut into regions, one per station of
public/marine/tides.json (its Voronoi cell: every pixel goes to its nearest
station, within `maxStationKm`), and each region's archive is drawn with its
own station's ramp, as a pilot area is. A region's waterline levels (MSL and
MHW above LAT) and dry ceiling (HAT + margin) are its station's
(stations.json, written by `fetch_national.py tides`).

The coast is built chunk by chunk (one z`chunkZoom` tile each, with a margin
of whole tiles round it so the waterlines, the sea mask and the feathering
see past its edges), with build.py's steps 1-5 and a level and ceiling per
pixel. Each chunk writes its tiles z`chunkZoom`..z`maxzoom` per region, and
its region grids at z`chunkZoom` from which `assemble` makes the overviews
down to z`minzoom` and packs one PMTiles archive per region.

The pilot areas (areas.json, build.py) win where they are: their boxes are
cut out of the regions at the pilots' min zoom and above.

    python -I national.py --data /tmp/wf-foildepth-national/data --work /tmp/wf-foildepth-national/work chunks [--jobs 4] [--only x,y]
    python -I national.py --data ... --work ... assemble --out /tmp/wf-foildepth-national/out
    python -I national.py --data ... --work ... index --out /tmp/wf-foildepth-national/out --pilots /tmp/wf-foildepth/out

`index` writes out/index.json: the pilots' entries (build.py's pilots.json)
then the regions', with urls relative to the index. publish.py versions the
folder and uploads it.
"""
import argparse
import json
import math
import multiprocessing as mp
import os
import pickle
import sys
import time
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # `python -I` leaves the script's own folder off the path
import build  # noqa: E402
from pmtiles.tile import zxy_to_tileid  # noqa: E402

EARTH_KM = 6371.0088


def load_config(path=None):
    return json.load(open(path or os.path.join(HERE, "national.json")))


def round_up(value, step=0.1):
    return round(math.ceil(round(value / step, 6)) * step, 3)


def load_stations(cfg, path=None):
    """The tide stations, sorted by id, with each one's levels above LAT."""
    doc = json.load(open(path or os.path.join(HERE, "stations.json")))
    out = []
    for sid, s in sorted(doc["stations"].items()):
        out.append({
            "id": sid, "name": s["name"], "lon": float(s["lon"]), "lat": float(s["lat"]),
            "msl": s["mslMetres"], "mhw": s["mhwMetres"], "hat": s["hatMetres"],
            "ceiling": round_up(s["hatMetres"] + cfg["ceilingMarginMetres"]),
        })
    return out


def region_id(cfg, station_id):
    return cfg["regionPrefix"] + station_id.removesuffix("_MODELLED").lower().replace("_", "-")


def nearest_station(lon, lat, stations):
    """Index of the nearest station and its distance in km (haversine), for
    arrays of lon/lat."""
    lon, lat = np.broadcast_arrays(np.radians(np.asarray(lon, dtype=np.float64)),
                                   np.radians(np.asarray(lat, dtype=np.float64)))
    best = np.full(lon.shape, np.inf)
    index = np.full(lon.shape, -1, dtype=np.int16)
    for i, s in enumerate(stations):
        slon, slat = math.radians(s["lon"]), math.radians(s["lat"])
        a = np.sin((lat - slat) / 2) ** 2 + np.cos(lat) * math.cos(slat) * np.sin((lon - slon) / 2) ** 2
        d = 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
        closer = d < best
        best[closer] = d[closer]
        index[closer] = i
    return index, best


def pixel_lonlat(transform, shape):
    """Lon of each column's centre and lat of each row's centre."""
    h, w = shape
    xs = transform.c + (np.arange(w) + 0.5) * transform.a
    ys = transform.f - (np.arange(h) + 0.5) * transform.a
    lon, _ = build.lonlat_of(xs, np.zeros_like(xs))
    _, lat = build.lonlat_of(np.zeros_like(ys), ys)
    return lon, lat


def partition(transform, shape, stations, block=4):
    """Each pixel's station (Voronoi cell) and its distance, decided per
    `block`×`block` pixels at the block's centre: the grid is whole tiles, so
    a pixel gets the same answer in any chunk."""
    h, w = shape
    lon, lat = pixel_lonlat(transform, shape)
    lon_b = lon.reshape(w // block, block).mean(axis=1)
    lat_b = lat.reshape(h // block, block).mean(axis=1)
    idx, km = nearest_station(lon_b[None, :], lat_b[:, None], stations)
    return (np.repeat(np.repeat(idx, block, axis=0), block, axis=1),
            np.repeat(np.repeat(km, block, axis=0), block, axis=1))


def pilot_boxes(path=None):
    """The pilot areas' boxes and min zooms (areas.json)."""
    cfg = json.load(open(path or os.path.join(HERE, "areas.json")))
    return [(a["id"], a["bbox"], a.get("minzoom", cfg["minzoom"])) for a in cfg["areas"]]


def in_boxes(lon, lat, boxes):
    m = np.zeros((lat.size, lon.size), dtype=bool)
    for _, (w, s, e, n), _ in boxes:
        m |= ((lon >= w) & (lon <= e))[None, :] & ((lat >= s) & (lat <= n))[:, None]
    return m


def chunk_list(cfg, data_dir):
    """The z`chunkZoom` tiles over the coast: those touching a box the fetch
    found coastal (fetch_national.dtm_coastal_boxes names the coastline files)."""
    zc = cfg["chunkZoom"]
    x0, x1, y0, y1 = build.tile_range(cfg["bbox"], zc)
    boxes = []
    for f in os.listdir(os.path.join(data_dir, "coastlines")):
        try:
            boxes.append(tuple(float(v) for v in f[:-5].split("_")))
        except ValueError:
            continue
    out = []
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            t, _, _ = build.tile_grid(x, x, y, y, zc, 1)
            w, s, e, n = build.grid_lonlat_bounds(t, (1, 1))
            if any(bw < e and be > w and bs < n and bn > s for bw, bs, be, bn in boxes):
                out.append((x, y))
    return out


def build_chunk(cx, cy, cfg, data_dir, work_dir, stations, boxes, method=6):
    """One chunk: the merged grid, cut into its regions' tiles. Writes
    work/chunks/<cx>_<cy>.pkl; returns a summary."""
    t0 = time.time()
    size, zmax, zc, m = cfg["tileSize"], cfg["maxzoom"], cfg["chunkZoom"], cfg["marginTiles"]
    k = 2 ** (zmax - zc)
    tx0, ty0, tx1, ty1 = cx * k, cy * k, cx * k + k - 1, cy * k + k - 1
    transform, width, height = build.tile_grid(tx0 - m, tx1 + m, ty0 - m, ty1 + m, zmax, size)
    shape = (height, width)
    idx, km = partition(transform, shape, stations)
    msl = np.array([s["msl"] for s in stations], dtype=np.float32)
    mhw = np.array([s["mhw"] for s in stations], dtype=np.float32)
    ceil = np.array([s["ceiling"] for s in stations], dtype=np.float32)
    levels = {"LAT": 0.0, "MSL": msl[idx], "MHW": mhw[idx]}
    ceiling = ceil[idx]
    print(f"chunk {cx},{cy}: {width}×{height} px")
    z, wet_at_lat, bathy, above_mhw, used = build.merge_sources(cfg["sources"], cfg, data_dir, transform, shape,
                                                                offset=0.0, levels=levels)
    result = {"chunk": [cx, cy], "regions": {}}
    if used:
        lat_mid = build.grid_lonlat_bounds(transform, shape)
        mpp = transform.a * math.cos(math.radians((lat_mid[1] + lat_mid[3]) / 2))
        out, stats = build.finish(z, wet_at_lat, bathy, above_mhw, np.zeros(shape, dtype=bool), ceiling, cfg, mpp,
                                  levels["MHW"])
        result["stats"] = stats
        del z, bathy, wet_at_lat, above_mhw
        inner = (slice(m * size, (m + k) * size), slice(m * size, (m + k) * size))
        out = out[inner]
        region = idx[inner].astype(np.int16)
        region[km[inner] > cfg["maxStationKm"]] = -1
        itr, _, _ = build.tile_grid(tx0, tx1, ty0, ty1, zmax, size)
        lon, lat = pixel_lonlat(itr, out.shape)
        pilot = in_boxes(lon, lat, boxes)
        pilot_min = min((b[2] for b in boxes), default=99)
        edge = build.edge_value(out, cfg)
        content = (out > cfg["deepMetres"] + 1) & (out < cfg["landMetres"] - 1)
        names = [s["name"] for s in used]
        for r in np.unique(region[(region >= 0) & content]):
            mine = region == r
            grid = np.where(mine, out, edge)
            if not build.has_content(np.where(mine, out, cfg["landMetres"]), cfg):
                continue
            cut = np.where(pilot, edge, grid) if pilot.any() else grid
            tiles = []
            z10 = None
            plain = {(zz, x, y): t for zz, x, y, t in build.pyramid(grid, (tx0, ty0, tx1, ty1), size, zc, zmax, cfg)}
            masked = ({(zz, x, y): t for zz, x, y, t in build.pyramid(cut, (tx0, ty0, tx1, ty1), size, zc, zmax, cfg)}
                      if pilot.any() else plain)
            for key, tile in plain.items():
                zz, x, y = key
                use = masked[key] if zz >= pilot_min else tile
                if build.has_content(use, cfg):
                    tiles.append((zxy_to_tileid(zz, x, y), build.encode(use, method)))
                if zz == zc and build.has_content(tile, cfg):
                    z10 = tile.copy()
            rows = np.flatnonzero((mine & content).any(axis=1))
            cols = np.flatnonzero((mine & content).any(axis=0))
            bbox = [float(lon[cols[0]]), float(lat[rows[-1]]), float(lon[cols[-1]]), float(lat[rows[0]])]
            result["regions"][stations[r]["id"]] = {
                "tiles": tiles, "z10": z10, "bbox": bbox, "sources": names,
                "pixels": int((mine & content).sum()),
                "intertidal": int((mine & content & (out > 0) & (out < 20)).sum()),
                "unsurveyed": int((mine & (out == cfg["noSurveyMetres"])).sum()),
            }
    os.makedirs(os.path.join(work_dir, "chunks"), exist_ok=True)
    path = os.path.join(work_dir, "chunks", f"{cx}_{cy}.pkl")
    with open(path + ".part", "wb") as fh:
        pickle.dump(result, fh, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(path + ".part", path)
    summary = {r: (len(v["tiles"]), v["pixels"]) for r, v in result["regions"].items()}
    print(f"chunk {cx},{cy}: {summary} in {time.time() - t0:.0f} s", flush=True)
    return cx, cy, summary


def _worker(job):
    cx, cy, cfg, data_dir, work_dir, stations, boxes, method = job
    try:
        return build_chunk(cx, cy, cfg, data_dir, work_dir, stations, boxes, method)
    except Exception as e:  # report and go on: the chunk is rebuilt on the next run
        import traceback
        traceback.print_exc()
        return cx, cy, f"failed: {e}"


def run_chunks(cfg, data_dir, work_dir, jobs, only=None, method=6, force=False):
    stations = load_stations(cfg)
    boxes = pilot_boxes()
    todo = only or chunk_list(cfg, data_dir)
    if not force:
        todo = [c for c in todo if not os.path.exists(os.path.join(work_dir, "chunks", f"{c[0]}_{c[1]}.pkl"))]
    print(f"{len(todo)} chunks to build, {jobs} at a time", flush=True)
    args = [(cx, cy, cfg, data_dir, work_dir, stations, boxes, method) for cx, cy in todo]
    if jobs <= 1:
        for a in args:
            _worker(a)
        return
    with mp.get_context("spawn").Pool(jobs, maxtasksperchild=4) as pool:
        for done, (cx, cy, summary) in enumerate(pool.imap_unordered(_worker, args), 1):
            print(f"[{done}/{len(args)}] {cx},{cy} {summary}", flush=True)


def assemble(cfg, work_dir, out_dir, method=6):
    """Each region's tiles from every chunk, its overviews below the chunk
    zoom from the chunks' grids, and one archive per region."""
    stations = {s["id"]: s for s in load_stations(cfg)}
    size, zc, zmin = cfg["tileSize"], cfg["chunkZoom"], cfg["minzoom"]
    regions = {}
    chunk_dir = os.path.join(work_dir, "chunks")
    for f in sorted(os.listdir(chunk_dir)):
        if not f.endswith(".pkl"):
            continue
        cx, cy = (int(v) for v in f[:-4].split("_"))
        with open(os.path.join(chunk_dir, f), "rb") as fh:
            chunk = pickle.load(fh)
        for sid, r in chunk["regions"].items():
            g = regions.setdefault(sid, {"tiles": [], "z10": {}, "bbox": None, "sources": set(),
                                         "pixels": 0, "intertidal": 0, "unsurveyed": 0})
            g["tiles"] += r["tiles"]
            if r["z10"] is not None:
                g["z10"][(cx, cy)] = r["z10"]
            b = r["bbox"]
            g["bbox"] = b if g["bbox"] is None else [min(g["bbox"][0], b[0]), min(g["bbox"][1], b[1]),
                                                       max(g["bbox"][2], b[2]), max(g["bbox"][3], b[3])]
            g["sources"] |= set(r["sources"])
            for k in ("pixels", "intertidal", "unsurveyed"):
                g[k] += r[k]
    os.makedirs(out_dir, exist_ok=True)
    entries = []
    land = cfg["landMetres"]
    for sid in sorted(regions):
        g = regions[sid]
        level = g["z10"]
        tiles = list(g["tiles"])
        for zoom in range(zc - 1, zmin - 1, -1):
            parents = {}
            for (x, y), grid in level.items():
                parents.setdefault((x // 2, y // 2), {})[(x % 2, y % 2)] = grid
            nxt = {}
            for (px, py), kids in parents.items():
                big = np.full((2 * size, 2 * size), land, dtype=np.float32)
                for (ox, oy), grid in kids.items():
                    big[oy * size:(oy + 1) * size, ox * size:(ox + 1) * size] = grid
                tile = build.downsample(big, cfg)
                if build.has_content(tile, cfg):
                    nxt[(px, py)] = tile
                    tiles.append((zxy_to_tileid(zoom, px, py), build.encode(tile, method)))
            level = nxt
        rid = region_id(cfg, sid)
        st = stations[sid]
        src_meta = [{k: s[k] for k in ("name", "role", "years", "resolution", "licence")}
                    for s in cfg["sources"] if s["name"] in g["sources"]]
        attribution = "; ".join(s["attribution"] for s in cfg["sources"] if s["name"] in g["sources"])
        bbox = [round(v, 4) for v in g["bbox"]]
        # A pixel's worth of slack round the content, so the box holds every tile's edge.
        bbox = [round(bbox[0] - 0.001, 4), round(bbox[1] - 0.001, 4), round(bbox[2] + 0.001, 4), round(bbox[3] + 0.001, 4)]
        path = os.path.join(out_dir, f"{rid}.pmtiles")
        mb = build.write_pmtiles(path, tiles, zmin, cfg["maxzoom"], bbox, build.archive_metadata(rid, cfg, attribution))
        print(f"{rid}: {len(tiles)} tiles, {mb:.2f} MB, {g['pixels']} px ({g['intertidal']} intertidal, "
              f"{g['unsurveyed']} unsurveyed), sources {sorted(g['sources'])}")
        entries.append({
            "id": rid, "kind": "region", "name": f"Coast on the {st['name']} tide", "url": f"{rid}.pmtiles",
            "bounds": bbox, "minzoom": zmin, "maxzoom": cfg["maxzoom"], "tileSize": size,
            "station": sid, "stationLonLat": [st["lon"], st["lat"]], "dryCeilingMetres": st["ceiling"],
            "sources": src_meta,
            "stats": {"tiles": len(tiles), "bytes": os.path.getsize(path), "pixels": g["pixels"],
                      "intertidalPixels": g["intertidal"], "unsurveyedPixels": g["unsurveyed"]},
        })
    with open(os.path.join(out_dir, "regions.json"), "w") as fh:
        json.dump({"regions": entries}, fh, indent=2)
        fh.write("\n")
    return entries


def write_index(cfg, out_dir, pilots_dir, pilots_cfg=None):
    """index.json beside the archives: the pilots (basins first), then the
    regions, with archive urls relative to the index."""
    regions = json.load(open(os.path.join(out_dir, "regions.json")))["regions"]
    pilots = json.load(open(os.path.join(pilots_dir, "pilots.json")))["areas"]
    areas_cfg = json.load(open(pilots_cfg or os.path.join(HERE, "areas.json")))
    for a in pilots:
        a["kind"] = "pilot"
        a["url"] = os.path.basename(a["url"])
        src = os.path.join(pilots_dir, a["url"])
        dst = os.path.join(out_dir, a["url"])
        if os.path.abspath(src) != os.path.abspath(dst):
            with open(src, "rb") as fi, open(dst, "wb") as fo:
                fo.write(fi.read())
    if areas_cfg["floorMetres"] != cfg["floorMetres"] or areas_cfg.get("deepMetres") != cfg["deepMetres"]:
        raise SystemExit("areas.json and national.json disagree on the floor or the deep value")
    for r in regions:
        r.pop("stats", None)
    index = {
        "schemaVersion": 2, "kind": "foildepth",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "datum": "LAT", "encoding": "terrarium",
        "floorMetres": cfg["floorMetres"], "deepMetres": cfg["deepMetres"],
        "landMetres": cfg["landMetres"], "noSurveyMetres": cfg["noSurveyMetres"],
        "areas": pilots + regions,
        "attribution": f"{areas_cfg['attribution']} {cfg['attribution']}",
    }
    with open(os.path.join(out_dir, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)
        fh.write("\n")
    print(f"index: {len(pilots)} pilot and {len(regions)} region entries → {out_dir}/index.json")
    return index


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True)
    p.add_argument("--work", required=True)
    p.add_argument("--config")
    p.add_argument("step", choices=["chunks", "assemble", "index", "list"])
    p.add_argument("--jobs", type=int, default=4)
    p.add_argument("--only", action="append", help="x,y of a chunk (z chunkZoom); repeatable")
    p.add_argument("--force", action="store_true", help="rebuild chunks already built")
    p.add_argument("--method", type=int, default=6, help="WebP effort, 0-6 (lossless either way)")
    p.add_argument("--out")
    p.add_argument("--pilots", help="build.py's --out (pilots.json and the pilot archives)")
    a = p.parse_args()
    cfg = load_config(a.config)
    if a.step == "list":
        chunks = chunk_list(cfg, a.data)
        print(len(chunks), chunks)
    elif a.step == "chunks":
        only = [tuple(int(v) for v in o.split(",")) for o in a.only] if a.only else None
        run_chunks(cfg, a.data, a.work, a.jobs, only, a.method, a.force)
    elif a.step == "assemble":
        assemble(cfg, a.work, a.out, a.method)
    elif a.step == "index":
        write_index(cfg, a.out, a.pilots)


if __name__ == "__main__":
    main()
