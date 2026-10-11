"""Fetch the open data for the national foilable-depth regions.

Everything goes under one download directory outside the repo, each source in
a directory of its own:

    tides/levels.json       per-station tide levels (Marine Institute ERDDAP)
    emodnet/dtm/*.tif       EMODnet Bathymetry DTM (emodnet:mean), 1° tiles
    emodnet/gebco2024.json  the DTM's GEBCO 2024 gap-fill polygons
    coastlines/*.json       EMODnet satellite waterlines (LAT, MSL, MHW) + OSM
    infomar10/*.tif         INFOMAR's merged 10 m inshore bathymetry, LAT

Usage (the venv of README.md; downloads are untrusted, so `python -I`):

    python -I fetch_national.py --data /tmp/wf-foildepth-national/data [tides emodnet coastlines infomar]

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
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
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


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True)
    p.add_argument("--tides-json", default=os.path.join(REPO, "public", "marine", "tides.json"),
                   help="the published tide manifest whose stations the client can load")
    p.add_argument("steps", nargs="*", default=["tides", "emodnet", "coastlines", "infomar"])
    a = p.parse_args()
    if "tides" in a.steps:
        doc = fetch_tides(a.data, a.tides_json)
        with open(os.path.join(HERE, "stations.json"), "w") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
    if "emodnet" in a.steps:
        fetch_emodnet(a.data)
    if "coastlines" in a.steps or "infomar" in a.steps:
        boxes = dtm_coastal_boxes(a.data, TILE_DEGREES)
        print(f"{len(boxes)} coastal {TILE_DEGREES}° boxes")
        if "coastlines" in a.steps:
            fetch_coastlines(a.data, boxes)
        if "infomar" in a.steps:
            fetch_infomar(a.data, boxes)


if __name__ == "__main__":
    main()
