"""List every Sentinel-2 L2A acquisition over Ireland, per MGRS tile.

Microsoft Planetary Computer's STAC (public; the COG URLs are signed per read
by planetary_computer, no account). One search per month over the island's
box, every tile, tile cloud under `maxTileCloud`. The same datatake is
sometimes listed twice (a reprocessing): one granule per tile and minute is
kept, the newest processing.

Writes <root>/downloads/catalog/<tile>.json: the tile's grid (EPSG, bounds)
and its acquisitions (id, time, tile cloud, processing baseline, band URLs),
oldest first. Resumable: a month already listed is skipped.

    python -I catalog.py [--months 2024-06 ...]
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys
import time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
BANDS = ("B02", "B03", "B04", "B08", "SCL")


def months(start, end):
    y, m = int(start[:4]), int(start[5:7])
    while (y, m) <= (int(end[:4]), int(end[5:7])):
        yield f"{y:04d}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def month_range(month, end):
    y, m = int(month[:4]), int(month[5:7])
    first = date(y, m, 1)
    last = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    stop = min(last.isoformat(), end)
    return f"{first.isoformat()}T00:00:00Z/{stop}T00:00:00Z"


def record(item):
    p = item.properties
    b03 = item.assets["B03"].extra_fields
    return {
        "id": item.id,
        "tile": p.get("s2:mgrs_tile"),
        "datetime": item.datetime.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stamp": common.stamp_of(item.datetime),
        "cloud": p.get("eo:cloud_cover"),
        "nodata": p.get("s2:nodata_pixel_percentage"),
        "baseline": p.get("s2:processing_baseline"),
        "orbit": p.get("sat:relative_orbit"),
        "epsg": int(str(p.get("proj:code") or p.get("proj:epsg")).split(":")[-1]),
        "bbox10": b03.get("proj:bbox"),
        "href": {b: item.assets[b].href for b in BANDS},
    }


def search_month(month, cfg, out_dir):
    import pystac_client
    done = os.path.join(out_dir, "months", f"{month}.json")
    if os.path.exists(done):
        return month, common.read_json(done)
    for attempt in range(5):
        try:
            cat = pystac_client.Client.open(STAC)
            search = cat.search(collections=["sentinel-2-l2a"], bbox=cfg["bbox"],
                                datetime=month_range(month, cfg["end"]),
                                query={"eo:cloud_cover": {"lt": cfg["maxTileCloud"]}}, limit=500)
            items = [record(i) for i in search.items()]
            common.write_json(done, items, indent=None)
            return month, items
        except Exception as e:  # STAC hiccups: back off and retry
            print(f"  {month}: retry {attempt + 1}: {e!r}"[:200], flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{month}: STAC search failed")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--months", nargs="*")
    p.add_argument("--workers", type=int, default=6)
    a = p.parse_args()
    cfg = common.config()
    out_dir = common.path("downloads", "catalog")
    os.makedirs(os.path.join(out_dir, "months"), exist_ok=True)
    todo = a.months or list(months(cfg["start"], cfg["end"]))
    every = []
    with cf.ThreadPoolExecutor(a.workers) as pool:
        for n, (month, items) in enumerate(pool.map(lambda m: search_month(m, cfg, out_dir), todo), 1):
            every += items
            if n % 12 == 0:
                print(f"  {n}/{len(todo)} months, {len(every)} items", flush=True)
    # One granule per tile and minute: the newest processing (ids end in the processing time).
    best = {}
    for it in every:
        key = (it["tile"], it["stamp"][:13])
        if key not in best or it["id"] > best[key]["id"]:
            best[key] = it
    tiles = {}
    for it in best.values():
        tiles.setdefault(it["tile"], []).append(it)
    for tile, items in sorted(tiles.items()):
        items.sort(key=lambda r: r["stamp"])
        grids = {(r["epsg"], tuple(r["bbox10"] or ())) for r in items}
        epsg, bbox10 = max(grids, key=lambda g: sum((r["epsg"], tuple(r["bbox10"] or ())) == g for r in items))
        common.write_json(os.path.join(out_dir, f"{tile}.json"),
                          {"tile": tile, "epsg": epsg, "bbox10": list(bbox10), "items": items}, indent=None)
        print(f"{tile}: {len(items)} acquisitions, EPSG:{epsg}")
    print(f"{len(best)} acquisitions over {len(tiles)} tiles")


if __name__ == "__main__":
    sys.exit(main())
