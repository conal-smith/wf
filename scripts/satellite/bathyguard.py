"""Leave out "foreshore" that the seabed says is deep water.

A handful of the lowest tide's looks can read open water as dry (glint and
whitecaps the masks missed, or the Bristol Channel's and the Humber's mud
stirred up at spring tides); every pixel there then flips at that one look's
level, and a square of sea far offshore comes out as flat foreshore (west of
Lewis, east of Shetland, off the Blaskets, in Bridgwater Bay). The seabed
decides it: EMODnet Bathymetry's DTM (about 115 m, metres about LAT where
charted, CC BY 4.0). An observed pixel where all of the DTM within a cell
of it (about 300 m: the shallowest of the 3x3 cells round it, so a flat
beside a deep channel stays) is deeper than bathyGuard.metresBelowLAT (20 m)
and that flips within bathyGuard.nearLowestMetres (0.75 m) of the lowest
level its station was seen at (the artefact's own signature: it comes from
the lowest tide's looks) is put down as below the lowest tide seen: heights.tif's class 2 and the
archive's belowSeenMetres. rocky.tif, where there is one, loses its rating
there. Counted in stats.json (bathyGuardKm2, and moved from observed to belowSeen
there, on the tile's own share as compose.py counts). Run after compose.py, before
bedtype.py apply and tiles.py intertidal; once per tile (it records itself).

Why 20 m and not a few: the DTM is coarse and, in places, wrong near the
shore. At 5 m it took 0.7 km² of Sandymount Strand, which the OPW LiDAR has
at 3.1 m above LAT and the satellite within 0.1 m of it, while the DTM had
5-7 m of water there; and even at 20 m it took Castlemaine Harbour's flats
(flipping at 2.2 m) and Trawbreaga Bay's (1.0 m), which the DTM has deep.
The ocean's squares lie in 47-97 m and flip 0.2-0.5 m above the lowest
level seen; real flats in a badly charted bay mostly flip well above it. (Bridgwater Bay's,
in about 11 m of the Bristol Channel's muddy water, are left to another fix.)

`undo` puts a tile back as compose.py left it: a pixel this step moved keeps
its flip level (heights.tif band 2), which no pixel that was wet in every
look has. rocky.tif's ratings there are not restored (bedtype.py apply again).

    python -I bathyguard.py fetch          # <root>/work/emodnet.tif over config bbox
    python -I bathyguard.py apply [--tile 29VNE ...]
    python -I bathyguard.py undo [--tile 29VNE ...]
"""
import argparse
import io
import os
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

WCS = ("https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=2.0.1&request=GetCoverage"
       "&coverageId=emodnet__mean&format=image/tiff")
OBSERVED, BELOW_SEEN = 1, 2


def fetch():
    """The DTM over the config's box, a degree at a time, as one GeoTIFF."""
    import rasterio
    from rasterio.merge import merge
    w, s, e, n = common.config()["bbox"]
    d = common.path("downloads", "emodnet")
    os.makedirs(d, exist_ok=True)
    parts = []
    for lat in np.arange(np.floor(s), np.ceil(n)):
        for lon in np.arange(np.floor(w), np.ceil(e)):
            p = os.path.join(d, f"{lat:+05.0f}_{lon:+06.0f}.tif")
            if not os.path.exists(p):
                url = WCS + f"&subset=Lat({lat},{lat + 1})&subset=Long({lon},{lon + 1})"
                for attempt in range(5):
                    try:
                        data = urllib.request.urlopen(url, timeout=300).read()
                        break
                    except Exception as err:  # the service's hiccups
                        print(f"  {p}: retry {attempt + 1}: {err!r}"[:160], flush=True)
                        time.sleep(10 * (attempt + 1))
                else:
                    raise RuntimeError(f"EMODnet: {url}")
                with rasterio.open(io.BytesIO(data)) as src:
                    if not src.read(1).size:
                        continue
                with open(p + ".part", "wb") as fh:
                    fh.write(data)
                os.replace(p + ".part", p)
            parts.append(p)
            print(f"  {os.path.basename(p)}", flush=True)
    srcs = [rasterio.open(p) for p in parts]
    arr, tf = merge(srcs, nodata=np.nan, dtype="float32")
    prof = dict(driver="GTiff", height=arr.shape[1], width=arr.shape[2], count=1, dtype="float32", crs="EPSG:4326",
                transform=tf, nodata=np.nan, compress="deflate", tiled=True)
    with rasterio.open(common.path("work", "emodnet.tif"), "w", **prof) as dst:
        dst.write(arr)
    print(f"emodnet.tif {arr.shape[1:]}", flush=True)


def apply(tiles, dry_run=False):
    import rasterio
    from rasterio.warp import reproject, Resampling
    from scipy import ndimage
    cfg = common.config()
    g = cfg.get("bathyGuard", {})
    limit = -abs(g.get("metresBelowLAT", 20.0))
    near = g.get("nearLowestMetres", 0.75)
    stations = common.stations()
    plan = common.read_json(common.path("work", "plan.json"))
    # Each station's lowest level seen, by station index (NaN where the plan has none).
    lowest = np.array([plan["stations"].get(st["id"], {}).get("range", [np.nan])[0] for st in stations] + [np.nan])
    below = cfg["intertidalArchive"]["belowSeenMetres"]
    with rasterio.open(common.path("work", "emodnet.tif")) as src:
        dtm = src.read(1)
        dtm_tf, dtm_crs = src.transform, src.crs
    # The shallowest within a cell either way; no data (land, or uncharted) counts as shallow.
    shallow = ndimage.maximum_filter(np.where(np.isfinite(dtm), dtm, 99.0), size=3)
    for tile in tiles:
        d = common.path("work", "tiles", tile)
        stats_p = os.path.join(d, "stats.json")
        stats = common.read_json(stats_p)
        if "bathyGuardKm2" in stats and not dry_run:
            print(f"{tile}: done before ({stats['bathyGuardKm2']} km²)", flush=True)
            continue
        with rasterio.open(os.path.join(d, "heights.tif"), "r+") as hs:
            cls, raw = hs.read(5), hs.read(2)
            stn = common.to_current_stations(hs.read(6), common.station_ids_of(hs), stations)
            sea = np.full(cls.shape, 99.0, np.float32)
            reproject(shallow.astype(np.float32), sea, src_transform=dtm_tf, src_crs=dtm_crs,
                      dst_transform=hs.transform, dst_crs=hs.crs, resampling=Resampling.nearest)
            k = np.where(stn >= 0, stn, len(stations)).astype(int)
            deep = (cls == OBSERVED) & (sea < limit) & (raw < lowest[k] + near)
            if dry_run:
                print(f"{tile}: would take {float(deep.sum()) * 1e-4:.2f} km²", flush=True)
                continue
            if deep.any():
                cls[deep] = BELOW_SEEN
                hs.write(cls, 5)
                z = hs.read(1)
                z[deep] = below
                hs.write(z, 1)
        rp = os.path.join(d, "rocky.tif")
        if deep.any() and os.path.exists(rp):
            with rasterio.open(rp, "r+") as rs:
                r = rs.read(1)
                r[deep] = 255
                rs.write(r, 1)
        # The tile's figures count its own share of the ground (weight over half), as compose.py does.
        with rasterio.open(os.path.join(d, "weight.tif")) as ws:
            mine = ws.read(1) > 127
        km2 = round(float((deep & mine).sum()) * 1e-4, 2)
        c = stats["classesKm2"]
        c["observed"] = round(c["observed"] - km2, 2)
        c["belowSeen"] = round(c["belowSeen"] + km2, 2)
        stats["intertidalKm2"] = c["observed"]
        stats["bathyGuardKm2"] = km2
        common.write_json(stats_p, stats)
        print(f"{tile}: {km2} km² of deep water taken out of the foreshore", flush=True)


def undo(tiles):
    import rasterio
    q = common.config()["intertidalArchive"]["quantumMetres"]
    for tile in tiles:
        d = common.path("work", "tiles", tile)
        stats_p = os.path.join(d, "stats.json")
        stats = common.read_json(stats_p)
        if "bathyGuardKm2" not in stats:
            continue
        with rasterio.open(os.path.join(d, "heights.tif"), "r+") as hs:
            cls, raw = hs.read(5), hs.read(2)
            moved = (cls == BELOW_SEEN) & np.isfinite(raw)
            cls[moved] = OBSERVED
            hs.write(cls, 5)
            z = hs.read(1)
            z[moved] = np.round(raw[moved] / q) * q
            hs.write(z, 1)
        km2 = stats.pop("bathyGuardKm2")
        c = stats["classesKm2"]
        c["observed"] = round(c["observed"] + km2, 2)
        c["belowSeen"] = round(c["belowSeen"] - km2, 2)
        stats["intertidalKm2"] = c["observed"]
        common.write_json(stats_p, stats)
        print(f"{tile}: {int(moved.sum())} px put back ({km2} km² on its own share)", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch")
    for name in ("apply", "undo"):
        sp = sub.add_parser(name)
        sp.add_argument("--tile", action="append")
        sp.add_argument("--dry-run", action="store_true", help="apply: only say what it would take")
    a = p.parse_args()
    if a.cmd == "fetch":
        return fetch()
    tiles = a.tile or sorted(t for t in os.listdir(common.path("work", "tiles"))
                             if os.path.exists(common.path("work", "tiles", t, "stats.json")))
    if a.cmd == "apply":
        apply(tiles, a.dry_run)
    else:
        undo(tiles)


if __name__ == "__main__":
    sys.exit(main())
