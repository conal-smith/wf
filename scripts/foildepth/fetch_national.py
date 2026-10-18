"""Fetch the open data for the national foilable-depth regions.

Everything goes under one download directory outside the repo, each source in
a directory of its own:

    tides/levels.json       per-station tide levels (Marine Institute ERDDAP)
    emodnet/dtm/*.tif       EMODnet Bathymetry DTM (emodnet:mean), 1° tiles
    emodnet/gebco2024.json  the DTM's GEBCO 2024 gap-fill polygons
    coastlines/*.json       EMODnet satellite waterlines (LAT, MSL, MHW) + OSM
    infomar10/*.tif         INFOMAR's merged 10 m inshore bathymetry, LAT
    infomar-surveys/*.tif   INFOMAR surveys the merged grid leaves out (JIBS's
                            Northern Ireland side) or has only at 10 m (Lough Foyle's LiDAR)

Usage (the venv of README.md; downloads are untrusted, so `python -I`):

    python -I fetch_national.py --data /tmp/wf-foildepth-national/data [tides emodnet coastlines infomar surveys]

Each step skips what is already on disk, so a run can be resumed. `tides` also
writes the levels into the repo (scripts/foildepth/stations.json, see
`regions.py`), because the build's waterline levels and dry ceilings come from
them and should be reviewable.

Sources, all CC BY 4.0:
- Marine Institute tidal predictions, ERDDAP `imiTidePrediction` (5-minute
  curve, metres above LAT) and `IMI_TidePrediction_HighLow` (events, OD Malin),
  2026-01-01 to 2029-01-01, aggregated on the server (orderByMean/Max/Min).
- EMODnet Bathymetry WCS `emodnet:mean` (DTM 2024, 1/16') and WFS
  `emodnet:source_references` and `emodnet:coastlines`.
- Geological Survey Ireland & Marine Institute (INFOMAR) ImageServer
  `Marine/IE_GSI_MI_Bathymetry_10m_Inshore_IE_WGS84_LAT_GRID`: F32 heights
  above LAT, positive up, exported at the service's own pixel size.
- INFOMAR's survey downloads (gsi.geodata.gov.ie/downloads/Marine/Data/Downloads/):
  the Joint Irish Bathymetric Survey 2007-08's 10 m XYZ of the north coast,
  Inishowen to Torr Head (its Northern Ireland side is in no merged grid),
  and the 2008 bathymetric LiDAR of Lough Foyle at 5 m.
"""
import argparse
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import warnings
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
USER_AGENT = "wingfoil.ie foildepth build (scripts/foildepth)"

# All of Ireland and its islands, Tearaght to the Copelands, Fastnet to Inishtrahull.
IRELAND = (-10.8, 51.3, -5.3, 55.5)
ERDDAP = "https://erddap.marine.ie/erddap/tabledap"
TIDE_FROM, TIDE_TO = "2026-01-01T00:00:00Z", "2029-01-01T00:00:00Z"
EMODNET = "https://ows.emodnet-bathymetry.eu"
DTM_STEP = 1 / 960  # 1/16 arc-minute: the DTM's own cell
INFOMAR = ("https://gsi.geodata.gov.ie/imagehost/rest/services/Marine/"
           "IE_GSI_MI_Bathymetry_10m_Inshore_IE_WGS84_LAT_GRID/ImageServer")
INFOMAR_PIXEL = (0.000124164982730154, 0.0001303411902280257)  # the service's pixelSizeX/Y
TILE_DEGREES = 0.25
WFS_CAP = 1000  # the coastline WFS answers at most this many features a request


def get(url, attempts=4, timeout=600):
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == attempts - 1:
                raise
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(3 * 2 ** attempt)


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)


def tiles(bbox, step):
    w, s, e, n = bbox
    nx, ny = math.ceil(round((e - w) / step, 9)), math.ceil(round((n - s) / step, 9))
    for j in range(ny):
        for i in range(nx):
            x0, y0 = w + i * step, s + j * step
            yield (round(x0, 6), round(y0, 6), round(min(x0 + step, e), 6), round(min(y0 + step, n), 6))


def name_of(box):
    return "_".join(f"{v:+.3f}" for v in box)


# ---- tides -------------------------------------------------------------------


def erddap_csv(dataset, query):
    text = get(f"{ERDDAP}/{dataset}.csv?{query}").decode()
    lines = [ln for ln in text.splitlines() if ln.strip()]
    header = lines[0].split(",")
    return [dict(zip(header, ln.split(","))) for ln in lines[2:]]


def window():
    return f"&time{quote('>=')}{TIDE_FROM}&time{quote('<')}{TIDE_TO}"


def fetch_tides(data, tides_json):
    """MSL, mean high and low water, HAT and the lowest predicted level per station.

    MSL: the mean of the 5-minute curve over the three years; HAT and the lowest
    level: its max and min (three years of predictions, not the 18.6-year
    nodal cycle, so HAT is a few centimetres low: the build adds a margin);
    MHW and MLW: the mean of the predicted high and low waters (OD Malin,
    brought to LAT with the station's own offset)."""
    out = os.path.join(data, "tides", "levels.json")
    stations = json.load(open(tides_json))["stations"]
    curve = {r["stationID"]: r for r in erddap_csv(
        "imiTidePrediction", f"stationID,Water_Level{window()}&{quote('orderByMean(\"stationID\")')}")}
    top = {r["stationID"]: r for r in erddap_csv(
        "imiTidePrediction", f"stationID,Water_Level{window()}&{quote('orderByMax(\"stationID,Water_Level\")')}")}
    bottom = {r["stationID"]: r for r in erddap_csv(
        "imiTidePrediction", f"stationID,Water_Level{window()}&{quote('orderByMin(\"stationID,Water_Level\")')}")}
    events = {}
    for r in erddap_csv("IMI_TidePrediction_HighLow",
                        f"stationID,tide_time_category,Water_Level_ODMalin{window()}"
                        f"&{quote('orderByMean(\"stationID,tide_time_category\")')}"):
        events[(r["stationID"], r["tide_time_category"].strip().upper())] = float(r["Water_Level_ODMalin"])
    levels = {}
    for sid, st in sorted(stations.items()):
        bare = sid.removesuffix("_MODELLED")
        off = float(st["odMalinOffsetMetres"])
        if sid not in curve or (bare, "HIGH") not in events:
            print(f"  {sid}: no predictions on ERDDAP, skipped", file=sys.stderr)
            continue
        levels[sid] = {
            "name": st["name"], "lat": st["lat"], "lon": st["lon"], "modelled": bool(st.get("modelled")),
            "odMalinOffsetMetres": off,
            "mslMetres": round(float(curve[sid]["Water_Level"]), 3),
            "mhwMetres": round(events[(bare, "HIGH")] + off, 3),
            "mlwMetres": round(events[(bare, "LOW")] + off, 3),
            "hatMetres": round(float(top[sid]["Water_Level"]), 3),
            "lowestMetres": round(float(bottom[sid]["Water_Level"]), 3),
        }
    doc = {
        "source": "Marine Institute ERDDAP imiTidePrediction (5-minute curve, LAT) and "
                  "IMI_TidePrediction_HighLow (OD Malin + odMalinOffsetMetres), CC BY 4.0",
        "window": [TIDE_FROM, TIDE_TO],
        "method": "msl = mean of the curve; hat/lowest = its max/min; mhw/mlw = mean of the predicted "
                  "high/low waters. Metres above LAT.",
        "stations": levels,
    }
    write_atomic(out, (json.dumps(doc, indent=2) + "\n").encode())
    print(f"tides: {len(levels)} stations → {out}")
    return doc


# Basins: a station that takes every pixel inside its polygon and none outside
# (national.station_cells). Strangford Lough inside the Narrows, on Killard
# Point's tide 100 minutes later: the satellite run's basin polygon
# (scripts/satellite/stations_ni.json), with the lough's southern flats down
# to 54.35 N west of the Narrows, which the run's lag survey also read at
# +100 minutes (its Killard_LAG2 cell).
BASIN_POLYGONS = {
    "Strangford_MODELLED": [[-5.53, 54.385], [-5.5, 54.45], [-5.52, 54.55], [-5.62, 54.625], [-5.76, 54.6],
                            [-5.77, 54.5], [-5.72, 54.385], [-5.69, 54.385], [-5.69, 54.35], [-5.605, 54.35],
                            [-5.6, 54.385]],
}


def ni_tides(tides_json):
    """Northern Ireland's stations of tides.json, which the Marine Institute does
    not predict, from the site's own harmonic predictions
    (force5/ingest/tides_ni.py levels: the Environment Agency's gauges at
    Portrush and Bangor, EOT20 elsewhere), over the same three years, in each
    station's own LAT (its constants' 18.6-year lowest). Besides the levels,
    each has its LAT height of Ordnance Datum Belfast (for OSNI's LiDAR): at
    a gauge, the Environment Agency's chart datum under OD plus chart datum
    over LAT; elsewhere the station's MSL less MSL's height over OD at the two
    gauges (about 0.17 m: the sea has risen since OD Belfast was set in the
    1950s). A gauge's `chartDatumAboveLatMetres` is kept for the satellite
    run's heights there, which are in the gauge's chart datum."""
    sys.path.insert(0, os.path.join(REPO, "force5", "ingest"))
    import tides_ni  # the site's own predictions (repo code)
    from datetime import datetime, timezone
    wanted = set(json.load(open(tides_json))["stations"])
    consts = tides_ni.load()
    start, end = (datetime.fromisoformat(v.replace("Z", "+00:00")) for v in (TIDE_FROM, TIDE_TO))
    doc = tides_ni.levels(consts, start, end)
    out = {sid: dict(v, northernIreland=True) for sid, v in doc["stations"].items() if sid in wanted}
    over_od = []
    for sid, v in out.items():
        g = consts["stations"][sid].get("gauge")
        if g and "chartDatumAboveOrdnanceDatumMetres" in g:
            cd_lat = float(g.get("chartDatumAboveLatMetres", 0.0))
            v["chartDatumAboveLatMetres"] = round(cd_lat, 3)
            v["odBelfastOffsetMetres"] = round(-float(g["chartDatumAboveOrdnanceDatumMetres"]) + cd_lat, 3)
            over_od.append(v["mslMetres"] - v["odBelfastOffsetMetres"])
    msl_over_od = float(sum(over_od) / len(over_od)) if over_od else 0.17
    for sid, v in out.items():
        parent = out.get(v.get("lagOf"))
        if "odBelfastOffsetMetres" not in v:
            base = parent if parent is not None else v
            v["odBelfastOffsetMetres"] = base.get("odBelfastOffsetMetres",
                                                  round(base["mslMetres"] - msl_over_od, 3))
        if sid in BASIN_POLYGONS:
            v["polygon"] = BASIN_POLYGONS[sid]
    print(f"tides: {len(out)} Northern Ireland stations from {doc['source'].split(':')[0]}; "
          f"MSL is {msl_over_od:.3f} m over OD Belfast at the gauges")
    return {"source": doc["source"], "method": doc["method"], "mslOverOdBelfastMetres": round(msl_over_od, 3),
            "stations": out}


# ---- EMODnet -----------------------------------------------------------------


def fetch_emodnet(data):
    d = os.path.join(data, "emodnet", "dtm")
    for x in range(-11, -5):
        for y in range(51, 56):
            path = os.path.join(d, f"dtm_{x}_{y}.tif")
            if os.path.exists(path):
                continue
            url = (f"{EMODNET}/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean"
                   f"&crs=EPSG:4326&BBOX={x},{y},{x + 1},{y + 1}&format=image/tiff&interpolation=nearest"
                   f"&resx={DTM_STEP:.17f}&resy={DTM_STEP:.17f}")
            body = get(url)
            if not body.startswith((b"II*\x00", b"MM\x00*")):
                raise SystemExit(f"EMODnet WCS: not a TIFF for {x},{y}: {body[:200]!r}")
            write_atomic(path, body)
            print(f"  dtm {x},{y}: {len(body)} bytes")
    path = os.path.join(data, "emodnet", "gebco2024.json")
    if not os.path.exists(path):
        w, s, e, n = IRELAND
        # CQL's BBOX takes lat/lon order for EPSG:4326 here.
        cql = f"release='2024' AND identifier LIKE 'GEBCO%' AND BBOX(geom,{s},{w},{n},{e})"
        body = get(f"{EMODNET}/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:source_references"
                   f"&outputFormat=application/json&srsName=EPSG:4326&cql_filter={quote(cql)}")
        count = len(json.loads(body)["features"])
        write_atomic(path, body)
        print(f"  gebco 2024 gap-fill: {count} polygons")


def dtm_coastal_boxes(data, step, lo=-15.0, hi=12.0):
    """Tiles of `step` degrees in which the DTM has any cell between lo and hi:
    the shallows and the low ground by the sea (EMODnet fills land with a land
    DEM and the intertidal with 0, so the coast always shows)."""
    import numpy as np
    import rasterio
    boxes = []
    files = sorted(os.listdir(os.path.join(data, "emodnet", "dtm")))
    arrays = []
    for f in files:
        if f.endswith(".tif"):
            ds = rasterio.open(os.path.join(data, "emodnet", "dtm", f))
            arrays.append((ds.bounds, ds.read(1), ds.transform, ds.nodata))
    for box in tiles(IRELAND, step):
        w, s, e, n = box
        hit = False
        for bounds, a, tr, nodata in arrays:
            if bounds.left >= e or bounds.right <= w or bounds.bottom >= n or bounds.top <= s:
                continue
            c0, r0 = ~tr * (max(w, bounds.left), min(n, bounds.top))
            c1, r1 = ~tr * (min(e, bounds.right), max(s, bounds.bottom))
            win = a[max(0, int(r0)):int(math.ceil(r1)), max(0, int(c0)):int(math.ceil(c1))]
            ok = np.isfinite(win) & (win >= lo) & (win <= hi)
            if nodata is not None:
                ok &= win != nodata
            if ok.any():
                hit = True
                break
        if hit:
            boxes.append(box)
    return boxes


# ---- coastlines ------------------------------------------------------------------


def fetch_coastlines(data, boxes):
    d = os.path.join(data, "coastlines")
    queue = list(boxes)
    done = 0
    while queue:
        box = queue.pop(0)
        path = os.path.join(d, f"{name_of(box)}.json")
        if os.path.exists(path):
            done += 1
            continue
        w, s, e, n = box
        body = get(f"{EMODNET}/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:coastlines"
                   f"&outputFormat=application/json&srsName=EPSG:4326&bbox={s},{w},{n},{e},urn:ogc:def:crs:EPSG::4326")
        features = json.loads(body)["features"]
        if len(features) >= WFS_CAP:
            # Capped: quarter it and ask again.
            mx, my = round((w + e) / 2, 6), round((s + n) / 2, 6)
            queue += [(w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)]
            continue
        write_atomic(path, body)
        done += 1
        if done % 25 == 0:
            print(f"  coastlines: {done} boxes")
    print(f"coastlines: {done} boxes in {d}")


# ---- INFOMAR -----------------------------------------------------------------------


def fetch_infomar(data, boxes):
    d = os.path.join(data, "infomar10")
    for k, box in enumerate(boxes):
        path = os.path.join(d, f"{name_of(box)}.tif")
        if os.path.exists(path):
            continue
        w, s, e, n = box
        size = (round((e - w) / INFOMAR_PIXEL[0]), round((n - s) / INFOMAR_PIXEL[1]))
        body = get(f"{INFOMAR}/exportImage?bbox={w},{s},{e},{n}&bboxSR=4326&imageSR=4326"
                   f"&size={size[0]},{size[1]}&format=tiff&pixelType=F32&noData=-9999"
                   f"&interpolation=RSP_NearestNeighbor&compression=LZ77&f=image")
        if not body.startswith((b"II*\x00", b"MM\x00*")):
            raise SystemExit(f"INFOMAR exportImage: not a TIFF for {box}: {body[:200]!r}")
        write_atomic(path, body)
        if (k + 1) % 10 == 0:
            print(f"  infomar10: {k + 1}/{len(boxes)}")
    print(f"infomar10: {len(boxes)} boxes in {d}")


# ---- INFOMAR's surveys where its merged grid has nothing ------------------------------

GSI_DOWNLOADS = "https://gsi.geodata.gov.ie/downloads/Marine/Data/Downloads/"
# Surveys of Northern Ireland's waters that GSI publishes as files but the
# merged 10 m grid leaves out (JIBS's Northern Ireland side) or has only at
# 10 m (the Foyle LiDAR). Heights above LAT, positive up (the files' "LAT
# depth" CRS notwithstanding, as for every INFOMAR grid): checked against the
# merged grid where both are, median 0.00 m.
INFOMAR_SURVEYS = [
    {"name": "jibs-2007-08-north-coast-10m",
     "url": GSI_DOWNLOADS + "2008/JIBS07_08/BY_CV07_CV08_JIBS_NorthCoastIreland_10m_WGS84_LAT_XYZ_Inshore_Ireland.zip",
     "member": ".xyz", "step": 0.000099},
    {"name": "lidar-2008-lough-foyle-5m",
     "url": GSI_DOWNLOADS + "2008/Li_08/BY_LiDAR_2008_LoughFoyle_5m_U29N_LAT_TIFF_Inshore_Ireland.zip",
     "member": ".tif"},
]


def grid_xyz(text_stream, step, out_path, chunk=1 << 26):
    """A regular lon/lat XYZ (one point per cell centre, `step` degrees) as a
    float32 GeoTIFF, NaN where no point: parsed in chunks of text."""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    parts, rest = [], b""
    while True:
        block = text_stream.read(chunk)
        if not block:
            break
        block = rest + block
        cut = block.rfind(b"\n") + 1
        rest = block[cut:]
        parts.append(np.fromstring(block[:cut].decode(), sep=" ").reshape(-1, 3).astype(np.float64))
    if rest.strip():
        parts.append(np.fromstring(rest.decode(), sep=" ").reshape(-1, 3))
    xyz = np.concatenate(parts)
    lon0, lat1 = xyz[:, 0].min(), xyz[:, 1].max()
    cols = np.round((xyz[:, 0] - lon0) / step).astype(np.int64)
    rows = np.round((lat1 - xyz[:, 1]) / step).astype(np.int64)
    grid = np.full((rows.max() + 1, cols.max() + 1), np.nan, dtype=np.float32)
    grid[rows, cols] = xyz[:, 2]
    prof = {"driver": "GTiff", "width": grid.shape[1], "height": grid.shape[0], "count": 1, "dtype": "float32",
            "crs": "EPSG:4326", "transform": from_origin(lon0 - step / 2, lat1 + step / 2, step, step),
            "nodata": np.nan, "compress": "deflate", "tiled": True, "predictor": 3}
    with rasterio.open(out_path + ".part.tif", "w", **prof) as dst:
        dst.write(grid, 1)
    os.replace(out_path + ".part.tif", out_path)
    return len(xyz), grid.shape


def fetch_infomar_surveys(data):
    """INFOMAR_SURVEYS into <data>/infomar-surveys/<name>.tif (the zips kept
    beside them, under zips/, so a rerun reads nothing again)."""
    import zipfile
    d = os.path.join(data, "infomar-surveys")
    for s in INFOMAR_SURVEYS:
        out = os.path.join(d, s["name"] + ".tif")
        if os.path.exists(out):
            continue
        zpath = os.path.join(d, "zips", s["name"] + ".zip")
        if not os.path.exists(zpath):
            write_atomic(zpath, get(s["url"], timeout=1800))
        with zipfile.ZipFile(zpath) as z:
            member = next(n for n in z.namelist() if n.lower().endswith(s["member"]))
            with z.open(member) as fh:
                if s["member"] == ".xyz":
                    n, shape = grid_xyz(fh, s["step"], out)
                    print(f"  {s['name']}: {n} points on a {shape[1]}×{shape[0]} grid")
                else:
                    write_atomic(out, fh.read())
                    print(f"  {s['name']}: {os.path.getsize(out)} bytes")
    print(f"infomar surveys: {len(INFOMAR_SURVEYS)} in {d}")


# ---- OSNI's river-basin LiDAR, where it reaches the shore ------------------------------

ODNI = "https://admin.opendatani.gov.uk/dataset/"
# OSNI Open Data's River Basin LiDAR (Land & Property Services, OGL v3): 1 m
# and 0.5 m DTMs of the flood-study areas, Irish Grid, heights above Ordnance
# Datum Belfast ("Mean Sea Level Belfast"), 2007-2012. These are the areas
# that reach the sea (Londonderry's and Newry's stop at the rivers' quays,
# and the city of Belfast is not published).
OSNI_LIDAR = [
    ("coleraine-portstewart-portrush_15_03_2010", "4ee00ab8-93c6-45dd-95c8-5a2204fd7fad/resource/"
     "e7f9cf45-07b6-41db-bb32-960c933c35cc/download/coleraine-portstewart-portrush_15_03_2010.zip"),
    ("bangor_04_04_2007", "e63b2e1c-b241-493a-827d-a792f5eff16e/resource/d3230fe9-a3dd-42bd-a5a5-584c8b6d5911/"
     "download/bangor_04_04_2007.zip"),
    ("newcastle_15_03_2010", "4ee00ab8-93c6-45dd-95c8-5a2204fd7fad/resource/18a330cf-e52e-4161-8a3a-c011601fbab1/"
     "download/newcastle_15_03_2010.zip"),
    ("newtownards_10_06_2008", "abf2ea3d-0ba2-4235-869c-d2dbcfdfdf4f/resource/b04f7e0d-5ca5-45d4-a550-57466a026686/"
     "download/newtownards_10_06_2008.zip"),
    ("bangor-extension_05_03_2012", "f9d28eea-435d-4d0e-881b-6812441fa37b/resource/"
     "6aa6a774-6a33-499c-a368-73da5f986a79/download/bangor-extension_05_03_2012.zip"),
    ("carrickfergus_04_04_2007", "e63b2e1c-b241-493a-827d-a792f5eff16e/resource/"
     "2a04fd86-503f-4be7-9eb8-1c49aeadcba0/download/carrickfergus_04_04_2007.zip"),
    ("larne_15_03_2010", "4ee00ab8-93c6-45dd-95c8-5a2204fd7fad/resource/9cf24de8-f4d6-4ba7-895a-20fb6a48a705/"
     "download/larne_15_03_2010.zip"),
    ("ballygalley_15_03_2010", "4ee00ab8-93c6-45dd-95c8-5a2204fd7fad/resource/c588569a-890f-45b3-966d-e7d6e23ea054/"
     "download/ballygalley_15_03_2010.zip"),
    ("cushendall_15_03_2010", "4ee00ab8-93c6-45dd-95c8-5a2204fd7fad/resource/2cf608df-1f63-4c71-9258-0a3ee90f1079/"
     "download/cushendall_15_03_2010.zip"),
    ("ballycastle_15_03_2010", "4ee00ab8-93c6-45dd-95c8-5a2204fd7fad/resource/0b066535-70e1-4054-9a07-f7ce483ea4c6/"
     "download/ballycastle_15_03_2010.zip"),
    ("killyleagh__15_03_2010", "4ee00ab8-93c6-45dd-95c8-5a2204fd7fad/resource/1cd38c24-f669-420d-8348-64879b2180bd/"
     "download/killyleagh__15_03_2010.zip"),
    ("downpatrick_05_05_2009", "d179414f-be86-4a8a-9911-708d960fe55b/resource/1cca3913-2aef-4235-a004-d1a79dfd2e2d/"
     "download/downpatrick_05_05_2009.zip"),
]
IRISH_GRID = "EPSG:29903"
LIDAR_CELL = 2.0  # metres: the mosaics' cell (z13 is 5.8 m; the pilots' LiDAR is 2 m)
SEA_BELOW_LAT = -0.5  # EMODnet's cells this deep are water at any tide (give or take a 115 m cell's smear)
NEAREST_LEVEL_M = 3000  # a tile with no sea of its own takes the level of the nearest one this close
# Where neither says, the flight may have seen the sea at any level up to high
# water: only ground over this (above mean high water springs on Northern
# Ireland's coast: +0.7 m OD at Portrush, +1.5 m at Bangor, +2.2 m at Newcastle)
# is taken.
UNKNOWN_WATER_OD = 2.3


def read_asc(text):
    """An ESRI ASCII grid: (values, x of the left edge, y of the top edge, cell)."""
    import numpy as np
    head, pos = {}, 0
    while True:
        nl = text.index("\n", pos)
        parts = text[pos:nl].split()
        if not parts or not parts[0][0].isalpha():
            break
        head[parts[0].lower()] = float(parts[1])
        pos = nl + 1
    body = np.fromstring(text[pos:], sep=" ", dtype=np.float32)
    ncols, nrows = int(head["ncols"]), int(head["nrows"])
    cell = head["cellsize"]
    a = body[:ncols * nrows].reshape(nrows, ncols)
    a[a == np.float32(head.get("nodata_value", -9999))] = np.nan
    x0 = head["xllcorner"] if "xllcorner" in head else head["xllcenter"] - cell / 2
    y0 = head["yllcorner"] if "yllcorner" in head else head["yllcenter"] - cell / 2
    return a, x0, y0 + nrows * cell, cell


_sea_dtm = {}


def sea_on(data, x0, y1, cell, shape):
    """EMODnet's cells deeper than SEA_BELOW_LAT on an Irish Grid window:
    water at every tide, whose LiDAR returns are the water's surface."""
    import glob
    import numpy as np
    import rasterio
    from rasterio.merge import merge
    from rasterio.transform import from_origin
    from rasterio.warp import reproject, Resampling
    if data not in _sea_dtm:
        # Northern Ireland's degrees of the DTM, once.
        files = [f for f in sorted(glob.glob(os.path.join(data, "emodnet", "dtm", "dtm_*.tif")))
                 if -9 <= int(os.path.basename(f)[4:-4].split("_")[0]) <= -6
                 and 53 <= int(os.path.basename(f)[4:-4].split("_")[1]) <= 55]
        srcs = [rasterio.open(f) for f in files]
        arr, tf = merge(srcs, nodata=np.nan, dtype="float32")
        for ds in srcs:
            ds.close()
        _sea_dtm[data] = (arr[0], tf)
    dtm, tf = _sea_dtm[data]
    out = np.full(shape, np.nan, np.float32)
    reproject(dtm, out, src_transform=tf, src_crs="EPSG:4326", dst_transform=from_origin(x0, y1, cell, cell),
              dst_crs=IRISH_GRID, resampling=Resampling.nearest, src_nodata=np.nan, dst_nodata=np.nan)
    with np.errstate(invalid="ignore"):
        return np.isfinite(out) & (out < SEA_BELOW_LAT)


def water_level(values):
    """The sea's surface in a tile's returns over always-wet water: the
    densest 10 cm of them, if it holds a quarter of them (a flat sea); else
    None (the cells are a beach's, smeared by EMODnet's 115 m, or the sea was
    rough)."""
    import numpy as np
    if values.size < 300:
        return None
    lo, hi = np.percentile(values, [1, 99])
    bins = np.arange(lo, hi + 0.02, 0.02)
    if bins.size < 2:
        return float(np.median(values))
    counts, edges = np.histogram(values, bins)
    window = np.convolve(counts, np.ones(5, int), mode="same")
    k = int(np.argmax(window))
    if window[k] < 0.25 * values.size:
        return None
    centre = (edges[k] + edges[k + 1]) / 2
    return float(np.median(values[np.abs(values - centre) <= 0.05]))


def lidar_tile(a, cell, sea_fn):
    """One DTM tile at LIDAR_CELL (the mean of its cells) and the sea's level
    the flight saw there (water_level over EMODnet's always-wet cells), None
    where it cannot say."""
    import numpy as np
    f = int(round(LIDAR_CELL / cell))
    h, w = a.shape[0] // f * f, a.shape[1] // f * f
    b = a[:h, :w].reshape(h // f, f, w // f, f)
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # an empty block is NaN, as meant
        m = np.nanmean(b, axis=(1, 3)).astype(np.float32)
    sea = sea_fn(m.shape)
    return m, water_level(m[sea & np.isfinite(m)])


def fetch_osni_lidar(data):
    """OSNI_LIDAR into <data>/osni-lidar/<flight>.tif (EPSG:29903, LIDAR_CELL,
    metres above OD Belfast) and <flight>.json (each tile's water level).

    A topographic LiDAR over the sea returns the sea's surface, flat at the
    tide's level then (Portrush's flight: +0.1 m OD for kilometres off the
    strand; Bangor's: -1.0 m, near low water): every return at or under the
    level plus 0.1 m is taken out, since the ground under the water could not
    be seen. The level is a tile's own (water_level), else the nearest tile's
    within NEAREST_LEVEL_M, else UNKNOWN_WATER_OD."""
    import json as _json
    import zipfile
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    d = os.path.join(data, "osni-lidar")
    for name, path in OSNI_LIDAR:
        out = os.path.join(d, name + ".tif")
        if os.path.exists(out):
            continue
        zpath = os.path.join(d, "zips", name + ".zip")
        if not os.path.exists(zpath):
            write_atomic(zpath, get(ODNI + path, timeout=3600))
        tiles = {}

        def read_dtms(z):
            for n in z.namelist():
                low = n.lower()
                if low.endswith(".zip") and "dtm" in os.path.basename(low):
                    # Some areas ship their DTM as a zip inside the zip (Downpatrick's).
                    with zipfile.ZipFile(io.BytesIO(z.read(n))) as inner:
                        read_dtms(inner)
                elif low.endswith(".asc") and "dtm" in low:
                    a, x0, y1, cell = read_asc(z.read(n).decode())
                    m, level = lidar_tile(a, cell,
                                          lambda shape, x0=x0, y1=y1: sea_on(data, x0, y1, LIDAR_CELL, shape))
                    tiles[os.path.basename(n)] = (m, x0, y1, level)

        with zipfile.ZipFile(zpath) as z:
            read_dtms(z)
        if not tiles:
            print(f"  {name}: no DTM tiles in the zip, left out", file=sys.stderr)
            continue
        known = [(t[1], t[2], t[3]) for t in tiles.values() if t[3] is not None]
        x0 = min(t[1] for t in tiles.values())
        y1 = max(t[2] for t in tiles.values())
        x1 = max(t[1] + t[0].shape[1] * LIDAR_CELL for t in tiles.values())
        y0 = min(t[2] - t[0].shape[0] * LIDAR_CELL for t in tiles.values())
        W, H = int(round((x1 - x0) / LIDAR_CELL)), int(round((y1 - y0) / LIDAR_CELL))
        mosaic = np.full((H, W), np.nan, np.float32)
        record = {}
        for tname, (m, tx, ty, level) in sorted(tiles.items()):
            use, how = level, "own"
            if use is None:
                near = sorted((math.hypot(kx - tx, ky - ty), lv) for kx, ky, lv in known)
                if near and near[0][0] <= NEAREST_LEVEL_M:
                    use, how = near[0][1], "nearest"
                else:
                    use, how = UNKNOWN_WATER_OD, "unknown"
            with np.errstate(invalid="ignore"):
                m = np.where(m <= use + 0.1, np.nan, m)
            r, c = int(round((y1 - ty) / LIDAR_CELL)), int(round((tx - x0) / LIDAR_CELL))
            sub = mosaic[r:r + m.shape[0], c:c + m.shape[1]]
            mosaic[r:r + m.shape[0], c:c + m.shape[1]] = np.where(np.isfinite(sub), sub,
                                                                   m[:sub.shape[0], :sub.shape[1]])
            record[tname] = {"waterLevelOD": None if level is None else round(level, 3), "from": how,
                             "dropAtOrUnderOD": round(use + 0.1, 3)}
        prof = {"driver": "GTiff", "width": W, "height": H, "count": 1, "dtype": "float32", "crs": IRISH_GRID,
                "transform": from_origin(x0, y1, LIDAR_CELL, LIDAR_CELL), "nodata": np.nan, "compress": "deflate",
                "tiled": True, "predictor": 3}
        os.makedirs(d, exist_ok=True)
        with rasterio.open(out + ".part.tif", "w", **prof) as dst:
            dst.write(mosaic, 1)
            dst.update_tags(DATUM="OD Belfast", SOURCE=f"OSNI Open Data River Basin LiDAR {name} (OGL v3)")
        os.replace(out + ".part.tif", out)
        write_atomic(os.path.join(d, name + ".json"), (_json.dumps({"flight": name, "tiles": record}, indent=1)
                                                       + "\n").encode())
        own = sorted(lv for _, _, lv in known)
        print(f"  {name}: {len(tiles)} tiles; the sea's level seen in {len(own)}"
              + (f", {own[0]:.2f} to {own[-1]:.2f} m OD" if own else ""))
    print(f"osni lidar: {len(OSNI_LIDAR)} flights in {d}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True)
    p.add_argument("--tides-json", default=os.path.join(REPO, "public", "marine", "tides.json"),
                   help="the published tide manifest whose stations the client can load")
    p.add_argument("steps", nargs="*",
                   default=["tides", "emodnet", "coastlines", "infomar", "surveys", "osni-lidar"])
    a = p.parse_args()
    if "tides" in a.steps:
        doc = fetch_tides(a.data, a.tides_json)
        ni = ni_tides(a.tides_json)
        if ni["stations"]:
            doc["stations"].update(ni["stations"])
            doc["northernIreland"] = {k: ni[k] for k in ("source", "method", "mslOverOdBelfastMetres")}
        with open(os.path.join(HERE, "stations.json"), "w") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
    if "tides-ni" in a.steps and "tides" not in a.steps:
        # Northern Ireland's stations alone, the Marine Institute's kept as they are.
        path = os.path.join(HERE, "stations.json")
        doc = json.load(open(path))
        ni = ni_tides(a.tides_json)
        doc["stations"] = {k: v for k, v in doc["stations"].items() if not v.get("northernIreland")}
        doc["stations"].update(ni["stations"])
        doc["northernIreland"] = {k: ni[k] for k in ("source", "method", "mslOverOdBelfastMetres")}
        with open(path, "w") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
    if "emodnet" in a.steps:
        fetch_emodnet(a.data)
    if "surveys" in a.steps:
        fetch_infomar_surveys(a.data)
    if "osni-lidar" in a.steps:
        fetch_osni_lidar(a.data)
    if "coastlines" in a.steps or "infomar" in a.steps:
        boxes = dtm_coastal_boxes(a.data, TILE_DEGREES)
        print(f"{len(boxes)} coastal {TILE_DEGREES}° boxes")
        if "coastlines" in a.steps:
            fetch_coastlines(a.data, boxes)
        if "infomar" in a.steps:
            fetch_infomar(a.data, boxes)


if __name__ == "__main__":
    main()
