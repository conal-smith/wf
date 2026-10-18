"""Fetch the pilot areas' inputs again, and cut them as build.py reads them.

The pilots (areas.json) were first built on 10 October 2026 from LiDAR tiles
and INFOMAR survey grids fetched by hand into /tmp, which macOS emptied. This
fetches the same files from the same portals (the tile and survey lists were
read back out of that build's session), and cuts them the way it did:

    downloads/lidar/<tile>.zip         GSI/OPW/TII LiDAR 2 m tiles (DTM, ITM, OD Malin)
    downloads/infomar/<survey>.zip     INFOMAR survey grids (LAT, positive up)
    emodnet/<area>.tif, .sources.json  EMODnet DTM and its source references
    coastlines/<area>.json             EMODnet satellite waterlines
    lidar/tiles/<tile>/                the tiles' zips, unpacked (flat)
    lidar/{dub,mal,bran}/mosaic_DTM_<x>_ITM_ODMalin_2m.tif
    infomar/clipped/<box>__<grid>.tif  each survey cut to the pilots' boxes
    manifest.json                      every download (file, URL, size, sha256)
                                       and every file cut from them

Usage (the venv of README.md; downloads are untrusted, so `python -I`, and
the data directory is not where the script is):

    python -I fetch_pilots.py --data /Volumes/workdrive/foildepth-gradient/pilot-data [fetch] [cut] [manifest]

With no step, all three. Each skips what is already on disk, so a run can be
resumed. `cut` needs rasterio and pyproj; `fetch` only the standard library
(and `unzip`, for the one survey zip packed with Deflate64, which Python's
zipfile cannot read). build.py also needs `infomar10/` (the national
download's merged 10 m grid), `osm/` and `satellite/` in the same directory:
links to the national build's copies are fine.

Sources, all CC BY 4.0: Geological Survey Ireland, the Office of Public
Works, Transport Infrastructure Ireland (LiDAR, gsi.geodata.gov.ie/downloads);
Geological Survey Ireland & Marine Institute (INFOMAR); EMODnet Bathymetry.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone

USER_AGENT = "wingfoil.ie foildepth build (scripts/foildepth)"
GSI = "https://gsi.geodata.gov.ie/downloads"
EMODNET = "https://ows.emodnet-bathymetry.eu"

# The LiDAR tiles, by the GSI coverage layers' DATA_NAME. The first build took
# every tile of OPW_NASC (2011), OPW (2006–07 coastal) and TII (2010–11) that
# touched its boxes (the two NYU 2015 1 m tiles it also fetched were never in
# a mosaic); the Sandymount extension of 10 October added the OPW_NASC and TII
# tiles from Sandymount to Dún Laoghaire.
OPW_NASC = [3229, 3230, 3231, 3232, 3233, 3234, 3251, 3252, 3253, 3254, 3255, 3256,
            3276, 3277, 3278, 3279, 3280, 3281, 3305, 3306, 3307, 3308, 3309, 3310,
            3331, 3332, 3333, 3334, 3353, 3354, 3376, 3377,
            # Sandymount to Dún Laoghaire
            3235, 3236, 3237, 3257, 3258, 3259, 3282, 3283, 3284, 3311, 3312,
            3335, 3336, 3355, 3356,
            # Brandon Bay's east end (2011)
            44, 45]
OPW_2006 = [101, 103, 180, 182, 209, 210, 242, 243, 245, 246, 248, 250, 334, 339,
            401, 405, 406, 409, 410, 411, 414, 418, 420, 422, 473, 475, 476, 478,
            480, 545, 548, 550, 551, 553, 578, 579, 580]
TII = [2467, 2468, 2469, 2470, 2471, 2488, 2489, 2490, 2491, 2492, 2501,
       # Sandymount to Dún Laoghaire
       2472, 2493, 2494, 2502, 2503, 2509, 2510, 2522,
       # the Malahide estuary's west end (the M1)
       2485, 2486, 2487]


def lidar_tiles():
    """{tile name: URL}"""
    t = {}
    for n in OPW_NASC:
        t[f"OPW_{n}"] = f"{GSI}/LiDAR/OPW_NASC/OPW_{n}.zip"
    for n in OPW_2006:
        t[f"OPW_{n}"] = f"{GSI}/lidar/OPW_{n}.zip"
    for n in TII:
        t[f"TII_{n}"] = f"{GSI}/LIDAR/TII_{n}.zip"
    return t


# Which tiles go into which mosaic, in the order rasterio's merge (method
# "first") takes them where they overlap: OPW before TII round Dublin, the 2006
# coastal flight before the 2011 one at Brandon.
MOSAICS = {
    "dub": {"bbox": (-6.27, 53.285, -6.05, 53.44),
            "groups": [[f"OPW_{n}" for n in OPW_NASC if n > 1000],
                       [f"TII_{n}" for n in TII if n not in (2485, 2486, 2487)]]},
    "mal": {"bbox": (-6.20, 53.44, -6.08, 53.50),
            "groups": [[f"TII_{n}" for n in (2485, 2486, 2487, 2488)]]},
    "bran": {"bbox": (-10.15, 52.22, -9.85, 52.32),
             "groups": [[f"OPW_{n}" for n in OPW_2006], ["OPW_44", "OPW_45"]]},
}

# The INFOMAR survey grids (the 2 m / 5 m UTM LAT GeoTIFF zips), with the
# sizes the first build downloaded (a different size means GSI republished it).
INFOMAR = {
    "2003/CV03_01/BY_CV03_01_Dublin_5m_U29N_LAT_TIFF_Inshore_Ireland.zip": 16449091,
    "2009/KRY09_02/BY_KRY09_02_Dublin_2m_Inshore_IE_U29N_LAT_TIFF.zip": 53341393,
    "2010/KRY10_01/BY_KRY10_01_Dublin_2m_Inshore_IE_U29N_LAT_TIFF.zip": 66993769,
    "2011/GEO11_01/BY_GEO11_01_DunLaoghaire_5m_U29N_LAT_TIFF_Inshore_Ireland.zip": 149105,
    "2013/CB13_01/BY_CB13_01_LambayIsland_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 54544671,
    "2013/GEO13_01/BY_GEO13_01_Malahide_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 7993347,
    "2016/TON16_01/BY_TON16_01_DublinWicklow_2m_U30N_LAT_TIFF_Inshore_Ireland.zip": 27576853,
    "2017/GEO17_01/BY_GEO17_01_Malahide_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 9447695,
    "2017/KRY17_01/BY_KRY17_01_Skerries_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 53920224,
    "2017/LIR17_02/BY_LIR17_02_DublinBay_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 1428701,
    "2021/GEO21_06/BY_GEO21_06_Dublin_2m_Inshore_IE_U29N_LAT_TIFF.zip": 4935887,
    "2008/Li_08/BY_LiDAR_2008_TraleeBay_5m_U29N_LAT_TIFF_Inshore_Ireland.zip": 22664280,
    "2014/CB14_05/BY_CB14_05_BrandonBayTraleeBay_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 61962686,
    "2014/CV14_02/BY_CV14_02_GalwayKillaryTralee_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 194857165,
    "2014/GEO14_03/BY_GEO14_03_Kerry_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 19548253,
    "2014/KRY14_05/BY_KRY14_05_BallyheigueBay_2m_U29N_LAT_TIFF_Inshore_Ireland.zip": 43479017,
    "2017/GEO17_03/BY_GEO17_03_BrandonBay_5m_U29N_LAT_TIFF_Inshore_Ireland.zip": 831258,
}

# The boxes the surveys are cut to (the names areas.json globs). A grid with
# no sounding in a box writes no file for it. a4 is the band south of 53.34° N
# added for Sandymount, cut from the Dublin surveys that reach it.
CLIP_BOXES = {
    "a1_malahide": (-6.20, 53.44, -6.08, 53.50),
    "a2_dublinbay_north": (-6.24, 53.33, -6.05, 53.44),
    "a3_brandon_bay": (-10.15, 52.22, -9.85, 52.32),
}
SOUTH_BOX = ("a4_dublinbay_south", (-6.27, 53.28, -5.99, 53.34))
SOUTH_SURVEYS = ("CV03_01", "GEO11_01", "GEO21_06", "KRY09_02", "KRY10_01", "LIR17_02", "TON16_01")

# EMODnet over each pilot's box (as fetch-emodnet.sh and fetch-coastlines.sh).
# Dublin's reach to 53.57° N, as the 12 October build's did: its merged grid
# (build.py --debug), which the regions round it take as a source, runs on
# past the box's north edge towards Rogerstown.
EMODNET_BOXES = {"dublin-north": (-6.30, 53.27, -5.96, 53.57), "brandon": (-10.22, 52.18, -9.78, 52.38)}
COASTLINE_BOXES = {"dublin-north": (-6.27, 53.28, -5.99, 53.57), "brandon": (-10.18, 52.22, -9.83, 52.35)}
DTM_STEP = 0.00104166666666667  # 1/16 arc-minute


def emodnet_urls():
    out = {}
    for area, (w, s, e, n) in EMODNET_BOXES.items():
        out[f"emodnet/{area}.tif"] = (
            f"{EMODNET}/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean&crs=EPSG:4326"
            f"&BBOX={w},{s},{e},{n}&format=image/tiff&interpolation=nearest&resx={DTM_STEP}&resy={DTM_STEP}")
        out[f"emodnet/{area}.sources.json"] = (
            f"{EMODNET}/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:source_references"
            f"&outputFormat=application/json&srsName=EPSG:4326&bbox={w},{s},{e},{n},EPSG:4326")
    for area, (w, s, e, n) in COASTLINE_BOXES.items():
        out[f"coastlines/{area}.json"] = (
            f"{EMODNET}/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:coastlines"
            f"&outputFormat=application/json&srsName=EPSG:4326&bbox={w},{s},{e},{n},EPSG:4326")
    return out


def downloads():
    """[(path under --data, URL)] for every file fetched."""
    d = [(f"downloads/lidar/{name}.zip", url) for name, url in sorted(lidar_tiles().items())]
    d += [(f"downloads/infomar/{os.path.basename(p)}", f"{GSI}/Marine/Data/Downloads/{p}") for p in sorted(INFOMAR)]
    d += sorted(emodnet_urls().items())
    return d


def fetch_one(url, path, attempts=4, timeout=900):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, "wb") as fh:
                expected = r.headers.get("Content-Length")
                shutil.copyfileobj(r, fh, 1 << 20)
            got = os.path.getsize(tmp)
            if expected is not None and int(expected) != got:
                raise ConnectionError(f"{got} of {expected} bytes")
            os.replace(tmp, path)
            return got
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                raise
            if attempt == attempts - 1:
                raise
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(3 * 2 ** attempt)


def fetch(data):
    missing = []
    for rel, url in downloads():
        path = os.path.join(data, rel)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        try:
            n = fetch_one(url, path)
        except urllib.error.HTTPError as e:
            print(f"  {rel}: HTTP {e.code} {url}", file=sys.stderr)
            missing.append((rel, url, f"HTTP {e.code}"))
            continue
        note = ""
        key = url.split("/Marine/Data/Downloads/", 1)[-1]
        if key in INFOMAR and INFOMAR[key] != n:
            note = f" (the first build's was {INFOMAR[key]} bytes)"
        print(f"{rel}: {n} bytes{note}", flush=True)
    if missing:
        print(f"{len(missing)} not fetched:", *(f"  {r} {u} {why}" for r, u, why in missing), sep="\n", file=sys.stderr)
    return missing


SAFE_NAME = re.compile(r"^[A-Za-z0-9_.+-]+$")


def unpack_lidar(data):
    """Each tile's zip into lidar/tiles/<tile>/, flat (no paths from the archive)."""
    for name in sorted(lidar_tiles()):
        z = os.path.join(data, "downloads", "lidar", f"{name}.zip")
        out = os.path.join(data, "lidar", "tiles", name)
        if os.path.isdir(out) and os.listdir(out):
            continue
        tmp = out + ".part"
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        with zipfile.ZipFile(z) as zf:
            for m in zf.infolist():
                base = os.path.basename(m.filename)
                if m.is_dir() or not base or base.lower() == "thumbs.db":
                    continue
                if not SAFE_NAME.match(base):
                    raise ValueError(f"{z}: unexpected member {m.filename!r}")
                with zf.open(m) as src, open(os.path.join(tmp, base), "wb") as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
        os.replace(tmp, out)


def tile_dtm(data, name):
    """The DTM GeoTIFF of an unpacked tile (OPW_n_DTM.tif, OPW_n_dtm.tif or TII_n.tif)."""
    d = os.path.join(data, "lidar", "tiles", name)
    want = re.compile(rf"^{name}(_DTM|_dtm)?\.tif$" if name.startswith("TII_") else rf"^{name}_(DTM|dtm)\.tif$")
    found = sorted(f for f in os.listdir(d) if want.match(f))
    if len(found) != 1:
        raise ValueError(f"{d}: expected one DTM, found {found}")
    return os.path.join(d, found[0])


def mosaic_lidar(data):
    import numpy as np
    import rasterio
    from rasterio.crs import CRS
    from rasterio.io import MemoryFile
    from rasterio.merge import merge
    from pyproj import Transformer

    itm = CRS.from_epsg(2157)
    nd = -9999.0
    to_itm = Transformer.from_crs(4326, 2157, always_xy=True)

    def clean(f):
        with rasterio.open(f) as ds:
            a = ds.read(1).astype("float32")
            prof = ds.profile.copy()
        n = os.path.basename(f)
        bad = ~np.isfinite(a) | (a < -1e30) | (a == -9999)
        if n.startswith("TII_"):
            bad |= (a == -99.0) | (a == 0.0)
        if n.startswith("OPW_") and n.endswith("_dtm.tif"):  # the 2006 Blom coastal flight: 0.0 is its fill
            bad |= (a == 0.0)
        a[bad] = nd
        prof.update(crs=itm, nodata=nd, dtype="float32")
        mf = MemoryFile()
        with mf.open(**prof) as d:
            d.write(a, 1)
        return mf

    for area, spec in MOSAICS.items():
        out = os.path.join(data, "lidar", area, f"mosaic_DTM_{area}_ITM_ODMalin_2m.tif")
        if os.path.exists(out):
            continue
        files = [tile_dtm(data, n) for group in spec["groups"] for n in sorted(group)]
        mfs = [clean(f) for f in files]
        srcs = [m.open() for m in mfs]
        x0, y0, x1, y1 = spec["bbox"]
        xs, ys = zip(*[to_itm.transform(x, y) for x in (x0, x1) for y in (y0, y1)])
        bounds = (np.floor(min(xs) / 2) * 2, np.floor(min(ys) / 2) * 2,
                  np.ceil(max(xs) / 2) * 2, np.ceil(max(ys) / 2) * 2)
        arr, tr = merge(srcs, bounds=bounds, res=2.0, nodata=nd, method="first")
        for s in srcs:
            s.close()
        a = arr[0]
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with rasterio.open(out + ".part", "w", driver="GTiff", width=a.shape[1], height=a.shape[0], count=1,
                           dtype="float32", crs=itm, transform=tr, nodata=nd, compress="deflate", predictor=3,
                           tiled=True) as d:
            d.write(a, 1)
        os.replace(out + ".part", out)
        v = a[a != nd]
        print(f"lidar/{area}: {len(files)} tiles, {a.shape[1]}x{a.shape[0]}, {v.size / a.size:.1%} valid, "
              f"{v.min():.2f}..{v.max():.2f} m OD, {os.path.getsize(out) / 1e6:.1f} MB", flush=True)


def survey_of(zip_name):
    m = re.match(r"BY_(?:LiDAR_2008|([A-Z]+\d\d_\d\d))_", zip_name)
    return (m.group(1) or "Li_08") if m else None


def grids_of(data, zip_path, scratch):
    """[(member's base name, a path rasterio opens)] for each GeoTIFF in a survey zip.
    Deflate64 members (Python's zipfile and GDAL's /vsizip cannot stream them)
    are unpacked with `unzip` into scratch first."""
    out = []
    with zipfile.ZipFile(zip_path) as zf:
        for m in zf.infolist():
            if not m.filename.lower().endswith(".tif"):
                continue
            base = os.path.basename(m.filename)
            if not SAFE_NAME.match(base):
                raise ValueError(f"{zip_path}: unexpected member {m.filename!r}")
            if m.compress_type == 9:
                os.makedirs(scratch, exist_ok=True)
                dst = os.path.join(scratch, base)
                if not os.path.exists(dst):
                    subprocess.run(["unzip", "-o", "-q", "-j", zip_path, m.filename, "-d", scratch], check=True)
                out.append((base, dst))
            else:
                out.append((base, f"/vsizip/{zip_path}/{m.filename}"))
    return out


def clip_infomar(data):
    import numpy as np
    import rasterio
    from rasterio.windows import Window, from_bounds
    from pyproj import Transformer

    outdir = os.path.join(data, "infomar", "clipped")
    done = os.path.join(outdir, "_done.json")
    if os.path.exists(done):
        return
    os.makedirs(outdir, exist_ok=True)
    scratch = os.path.join(data, "work", "unzip")
    log = []
    for zp in sorted(glob.glob(os.path.join(data, "downloads", "infomar", "*.zip"))):
        survey = survey_of(os.path.basename(zp))
        for base, path in grids_of(data, zp, scratch):
            stem = os.path.splitext(base)[0]
            with rasterio.open(path) as ds:
                tr = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)

                def window(box):
                    w, s, e, n = box
                    xs, ys = tr.transform([w, e, w, e], [s, s, n, n])
                    l, b = max(min(xs), ds.bounds.left), max(min(ys), ds.bounds.bottom)
                    r, t = min(max(xs), ds.bounds.right), min(max(ys), ds.bounds.top)
                    if l >= r or b >= t:
                        return None
                    return from_bounds(l, b, r, t, ds.transform).round_offsets().round_lengths()

                # a1–a3: cut to the box, then trimmed to the soundings in it.
                for name, box in CLIP_BOXES.items():
                    win = window(box)
                    if win is None:
                        continue
                    win = win.intersection(Window(0, 0, ds.width, ds.height))
                    arr = ds.read(1, window=win)
                    valid = np.isfinite(arr) & (np.abs(arr) < 1e6)
                    if ds.nodata is not None:
                        valid &= arr != ds.nodata
                    if not valid.any():
                        continue
                    rows = np.where(valid.any(axis=1))[0]
                    cols = np.where(valid.any(axis=0))[0]
                    sub = Window(win.col_off + cols[0], win.row_off + rows[0],
                                 cols[-1] - cols[0] + 1, rows[-1] - rows[0] + 1)
                    a = ds.read(1, window=sub)
                    prof = ds.profile.copy()
                    prof.update(driver="GTiff", height=int(sub.height), width=int(sub.width),
                                transform=ds.window_transform(sub), compress="deflate",
                                predictor=3 if a.dtype.kind == "f" else 2, tiled=True, blockxsize=256,
                                blockysize=256, nodata=ds.nodata if ds.nodata is not None else -9999.0,
                                BIGTIFF="IF_SAFER")
                    out = os.path.join(outdir, f"{name}__{stem}.tif")
                    with rasterio.open(out, "w", **prof) as dst:
                        dst.write(a, 1)
                        dst.update_tags(SOURCE_ZIP=os.path.basename(zp), SOURCE_MEMBER=base)
                    log.append({"file": os.path.relpath(out, data), "from": os.path.relpath(zp, data),
                                "soundings": int(valid.sum())})
                    print(f"{os.path.relpath(out, data)}: {int(valid.sum())} px", flush=True)
                # a4: the Dublin surveys that reach south of 53.34° N, cut to the band.
                name, box = SOUTH_BOX
                if survey in SOUTH_SURVEYS:
                    win = window(box)
                    if win is not None:
                        a = ds.read(1, window=win)
                        ok = np.isfinite(a) & (a != 0) & (a != -99999)
                        if ds.nodata is not None:
                            ok &= a != ds.nodata
                        if ok.any():
                            prof = ds.profile.copy()
                            tiled = a.shape[0] >= 256 and a.shape[1] >= 256
                            prof.update(width=a.shape[1], height=a.shape[0], transform=ds.window_transform(win),
                                        compress="deflate", predictor=3, tiled=tiled, BIGTIFF="IF_SAFER")
                            if not tiled:
                                prof.pop("blockxsize", None)
                                prof.pop("blockysize", None)
                            out = os.path.join(outdir, f"{name}__{base}")
                            with rasterio.open(out, "w", **prof) as dst:
                                dst.write(a, 1)
                            log.append({"file": os.path.relpath(out, data), "from": os.path.relpath(zp, data),
                                        "soundings": int(ok.sum())})
                            print(f"{os.path.relpath(out, data)}: {int(ok.sum())} px", flush=True)
    shutil.rmtree(scratch, ignore_errors=True)  # the 4 GB Deflate64 grid, unpacked
    with open(done, "w") as fh:
        json.dump(log, fh, indent=1)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def manifest(data):
    entries = []
    for rel, url in downloads():
        path = os.path.join(data, rel)
        if os.path.exists(path):
            entries.append({"file": rel, "url": url, "size": os.path.getsize(path), "sha256": sha256(path)})
    derived = []
    for pat in ("lidar/*/mosaic_*.tif", "infomar/clipped/*.tif"):
        for path in sorted(glob.glob(os.path.join(data, pat))):
            derived.append({"file": os.path.relpath(path, data), "size": os.path.getsize(path), "sha256": sha256(path)})
    m = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "by": "scripts/foildepth/fetch_pilots.py",
        "licence": "CC BY 4.0 (GSI, OPW, TII, Marine Institute; EMODnet Bathymetry)",
        "downloads": entries,
        "derived": derived,
    }
    with open(os.path.join(data, "manifest.json"), "w") as fh:
        json.dump(m, fh, indent=1)
    total = sum(e["size"] for e in entries)
    print(f"manifest: {len(entries)} downloads ({total / 1e6:.0f} MB), {len(derived)} files cut from them")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True, help="the pilots' data directory (outside the repo, not under /tmp)")
    p.add_argument("steps", nargs="*", choices=["fetch", "cut", "manifest"], default=None)
    a = p.parse_args()
    steps = a.steps or ["fetch", "cut", "manifest"]
    data = os.path.abspath(a.data)
    if "fetch" in steps:
        if fetch(data):
            sys.exit(1)
    if "cut" in steps:
        unpack_lidar(data)
        mosaic_lidar(data)
        clip_infomar(data)
    if "manifest" in steps:
        manifest(data)


if __name__ == "__main__":
    main()
