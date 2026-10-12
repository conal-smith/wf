"""Cut Sentinel-2 L2A windows over a pilot area from Microsoft Planetary Computer.

No account: the STAC search is public and planetary_computer signs the COG URLs
with a short-lived SAS token. Only the window over the area is read (HTTP
ranges), on the tile's own 10 m grid, so nothing is resampled except the 20 m
bands (SCL nearest, B11 bilinear) up to 10 m.

Each usable scene is written as <out>/<area>/<YYYYmmddTHHMMSS>.npz holding
uint16 bands B02 B03 B04 B08 B11 (surface reflectance x 10000, the 04.00+
processing baselines' +1000 offset removed) and SCL, with a scene list
<out>/<area>/scenes.json. Scenes whose window is mostly cloud, shadow or no
data (by SCL) are listed with the reason and not kept.

    python -I fetch_s2.py --area down --out /Volumes/workdrive/rocks-pilot/downloads/s2
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import planetary_computer
import pystac_client
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
BANDS10 = ["B02", "B03", "B04", "B08"]
BANDS20 = ["B11"]
# SCL: 0 no data, 1 saturated, 3 cloud shadow, 8/9 cloud medium/high, 10 cirrus.
SCL_BAD = (0, 1, 3, 8, 9, 10)

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
os.environ.setdefault("VSI_CACHE", "TRUE")


def area_grid(area):
    """The area's box on the tile's 10 m grid (snapped outwards to 20 m so both resolutions align)."""
    to_utm = Transformer.from_crs(4326, area["epsg"], always_xy=True)
    w, s, e, n = area["bbox"]
    xs, ys = zip(*[to_utm.transform(x, y) for x in (w, e) for y in (s, n)])
    left, bottom = np.floor(min(xs) / 20) * 20, np.floor(min(ys) / 20) * 20
    right, top = np.ceil(max(xs) / 20) * 20, np.ceil(max(ys) / 20) * 20
    return left, bottom, right, top


def read_window(href, bounds, shape, resampling):
    with rasterio.open(href) as src:
        win = from_bounds(*bounds, transform=src.transform)
        return src.read(1, window=win, out_shape=shape, resampling=resampling, boundless=True, fill_value=0)


def offset_for(item):
    baseline = item.properties.get("s2:processing_baseline", "00.00")
    try:
        return 1000 if float(baseline) >= 4.0 else 0
    except ValueError:
        return 0


def process(item, bounds, shape, out_dir, max_bad):
    stamp = item.datetime.strftime("%Y%m%dT%H%M%S")
    record = {"id": item.id, "datetime": item.datetime.isoformat().replace("+00:00", "Z"),
              "stamp": stamp, "baseline": item.properties.get("s2:processing_baseline"),
              "tileCloud": item.properties.get("eo:cloud_cover"),
              "sunElevation": 90 - float(item.properties.get("s2:mean_solar_zenith", 90))}
    path = out_dir / f"{stamp}.npz"
    if path.exists():
        record["status"] = "kept"
        return record
    for attempt in range(3):
        try:
            signed = planetary_computer.sign(item)
            scl = read_window(signed.assets["SCL"].href, bounds, shape, Resampling.nearest).astype(np.uint8)
            bad = float(np.isin(scl, SCL_BAD).mean())
            record["badFraction"] = round(bad, 3)
            if bad > max_bad:
                record["status"] = "cloudy"
                return record
            off = offset_for(item)
            arrays = {"SCL": scl}
            for band in BANDS10:
                arrays[band] = read_window(signed.assets[band].href, bounds, shape, Resampling.nearest)
            for band in BANDS20:
                arrays[band] = read_window(signed.assets[band].href, bounds, shape, Resampling.bilinear)
            for band in BANDS10 + BANDS20:
                a = arrays[band].astype(np.int32)
                if off:
                    a = np.where(a > 0, np.maximum(a - off, 1), 0)
                arrays[band] = a.astype(np.uint16)
            tmp = out_dir / f".{stamp}.tmp.npz"
            np.savez_compressed(tmp, **arrays)
            tmp.rename(path)
            record["status"] = "kept"
            return record
        except Exception as error:  # network hiccups: retry, then record and move on
            record["status"] = "error"
            record["error"] = repr(error)[:300]
            time.sleep(3 * (attempt + 1))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--area", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--start", default="2017-01-01")
    parser.add_argument("--end", default="2026-10-12")
    parser.add_argument("--max-tile-cloud", type=float, default=80)
    parser.add_argument("--max-bad", type=float, default=0.35,
                        help="most of the window that may be cloud, shadow or no data")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    area = json.loads((HERE / "areas.json").read_text())["areas"][args.area]
    left, bottom, right, top = area_grid(area)
    shape = (int((top - bottom) / 10), int((right - left) / 10))
    out_dir = args.out / args.area
    out_dir.mkdir(parents=True, exist_ok=True)

    cat = pystac_client.Client.open(STAC)
    search = cat.search(collections=["sentinel-2-l2a"], bbox=area["bbox"],
                        datetime=f"{args.start}/{args.end}",
                        query={"eo:cloud_cover": {"lt": args.max_tile_cloud},
                               "s2:mgrs_tile": {"eq": area["mgrs"]}})
    items = sorted(search.items(), key=lambda i: i.datetime)
    # One granule per acquisition: the same datatake can be listed twice (reprocessings).
    seen, unique = set(), []
    for item in items:
        key = item.datetime.strftime("%Y%m%dT%H%M")
        if key not in seen:
            seen.add(key)
            unique.append(item)
    print(f"{args.area}: {len(items)} items, {len(unique)} acquisitions, grid {shape} at 10 m", flush=True)

    records = []
    with cf.ThreadPoolExecutor(args.workers) as pool:
        futures = [pool.submit(process, item, (left, bottom, right, top), shape, out_dir, args.max_bad)
                   for item in unique]
        for n, future in enumerate(cf.as_completed(futures), 1):
            records.append(future.result())
            if n % 25 == 0:
                kept = sum(r["status"] == "kept" for r in records)
                print(f"  {n}/{len(unique)} done, {kept} kept", flush=True)
    records.sort(key=lambda r: r["datetime"])
    meta = {"area": args.area, "epsg": area["epsg"], "bounds": [left, bottom, right, top],
            "shape": list(shape), "resolution": 10, "source": "Sentinel-2 L2A, Microsoft Planetary Computer",
            "licence": "Copernicus Sentinel data, free and open (Copernicus licence)", "scenes": records}
    (out_dir / "scenes.json").write_text(json.dumps(meta, indent=1))
    counts = {}
    for r in records:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(args.area, counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
