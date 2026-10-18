"""Put a composed tile's station indices into the station list as it is now.

compose.py writes each pixel's tide station as an index into common.stations()
(heights.tif band 6), and tiles.py keeps a pixel's height only where that
station is the pixel's own. The list is sorted by id, so adding stations moves
the ones after them: the 31 basin stations of 15 October (Achill_Island_LAG1 …
Union_Hall_LAG1, in stations_ni.json) sorted in among Northern Ireland's, and
every block composed before them still said Ballycastle, Bangor, Killard,
Larne, Portrush and Strangford by their old numbers (33-38), which now name
Achill's, Aranmore's and Ballycastle's. The rebuild recomposed only the blocks
round the new basins, so tiles.py found the rest measured against "another
station" and wrote no fit there: no region at all for Portrush, Ballycastle,
Larne or Bangor, and only the recomposed parts of Killard's and Strangford's.
The heights themselves were right, each against its own (old-numbered) station.

Per block (plan.json's blockSize, as compose.py wrote them), this finds the
list the block was written with: the station each pixel would get under the
list now and under each `--was` list (common.nearest_station, at the z13 4×4
block centres, as compose.py decides it), and the list whose stations match
what is written; then it rewrites the block's indices into the list now, and
tags heights.tif with that list (STATIONS), as compose.py now does itself, so
the indices can never be read against another list again.

    python -I restation.py --tile 30UUF --was stations_ni-before-basins.json [--was ...] [--check]

`--was` is an older stations_ni.json (`git show 7c45f5a:scripts/satellite/stations_ni.json`),
or OTHERS,MARINE_INSTITUTE for an older scripts/foildepth/stations.json too.
A tile already tagged is only moved into the list now. stats.json's
per-station tides (the imagery index's) keep their labels: they were summed
over the old and new numbers alike.
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

MIN_AGREE = 0.95


def lists(was):
    out = [("now", common.stations())]
    for w in was or []:
        ni, _, mi = w.partition(",")
        out.append((w, common.stations(foil_stations=mi or None, ni_stations=ni)))
    return out


def restation(tile, was, check=False, step=8):
    import rasterio
    from pyproj import Transformer
    cfg = common.config()
    max_km = cfg["intertidalArchive"]["maxStationKm"]
    size = common.read_json(common.path("work", "plan.json"))["blockSize"]
    cands = lists(was)
    now = cands[0][1]
    now_ids = [s["id"] for s in now]
    path = common.path("work", "tiles", tile, "heights.tif")
    with rasterio.open(path) as ds:
        st = ds.read(6)
        ok_px = np.isfinite(ds.read(1))
        ids = common.station_ids_of(ds)
        tr, crs = ds.transform, ds.crs
    if ids is not None:
        out = common.to_current_stations(st, ids, now).astype(np.float32)
        out[~np.isfinite(st)] = np.nan
        changed = int((out[np.isfinite(st)] != st[np.isfinite(st)]).sum())
        print(f"{tile}: tagged; {changed} px moved into the list now", flush=True)
        report = {"tile": tile, "tagged": True, "moved": changed}
    else:
        to_ll = Transformer.from_crs(crs, 4326, always_xy=True)
        out = st.copy()
        n = -(-st.shape[0] // size)
        m = -(-st.shape[1] // size)
        counts = {}
        unknown = []
        for i in range(n):
            for j in range(m):
                rows = slice(i * size, (i + 1) * size)
                cols = slice(j * size, (j + 1) * size)
                s = st[rows, cols][::step, ::step]
                ok = (np.nan_to_num(s, nan=-1) >= 0) & ok_px[rows, cols][::step, ::step]
                if not ok.any():
                    continue
                rr, cc = np.meshgrid(i * size + np.arange(s.shape[0]) * step + 0.5,
                                     j * size + np.arange(s.shape[1]) * step + 0.5, indexing="ij")
                lon, lat = to_ll.transform(*(tr * (cc, rr)))
                blon, blat = common.region_block_lonlat(lon, lat)
                agree = []
                for name, sts in cands:
                    exp = common.nearest_station(blon, blat, sts, max_km)
                    agree.append(float((exp[ok] == s[ok]).mean()))
                best = int(np.argmax(agree))
                if agree[0] >= agree[best] - 1e-9:
                    best = 0  # the list now, where it fits as well (the Republic's blocks, every list alike)
                if agree[best] < MIN_AGREE:
                    unknown.append((i, j, [round(a, 3) for a in agree]))
                    continue
                counts[cands[best][0]] = counts.get(cands[best][0], 0) + 1
                if best:
                    blk = st[rows, cols]
                    moved = common.to_current_stations(blk, [x["id"] for x in cands[best][1]], now).astype(np.float32)
                    out[rows, cols] = np.where(np.isfinite(blk), moved, blk)
        changed = int((np.nan_to_num(out, nan=-9) != np.nan_to_num(st, nan=-9)).sum())
        print(f"{tile}: blocks written with {counts}, {changed} px moved into the list now"
              + (f"; {len(unknown)} block(s) matching no list, left as they are: {unknown[:6]}" if unknown else ""),
              flush=True)
        report = {"tile": tile, "tagged": False, "blocks": counts, "moved": changed, "unknown": unknown}
    if not check:
        with rasterio.open(path, "r+") as ds:
            ds.write(out.astype(np.float32), 6)
            ds.update_tags(STATIONS=json.dumps(now_ids))
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tile", action="append", required=True)
    p.add_argument("--was", action="append", help="an older stations_ni.json[,stations.json]; repeatable")
    p.add_argument("--check", action="store_true", help="only say what it would move")
    a = p.parse_args()
    for t in a.tile:
        restation(t, a.was, a.check)


if __name__ == "__main__":
    sys.exit(main())
