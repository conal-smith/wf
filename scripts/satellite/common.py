"""Shared pieces of the satellite pipeline: config, paths, stations and their
cells, the tile grid, and the reflectance encoding of the working files."""
import json
import math
import os
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
EARTH_KM = 6371.0088
EARTH = 2 * math.pi * 6378137.0
# SCL: 0 no data, 1 saturated, 3 cloud shadow, 8/9 cloud medium/high, 10 cirrus, 11 snow.
SCL_BAD = (0, 1, 3, 8, 9, 10, 11)
SCL_CLOUD = (3, 8, 9, 10)
# Working-file reflectance: 8 bits on a square-root scale up to REFL_MAX, so
# dark water keeps about 0.001 of precision and bright sand still fits. The
# median of encoded values is the encoding of the median (it is monotonic).
REFL_MAX = 0.5


def config(path=None):
    with open(path or os.path.join(HERE, "config.json")) as fh:
        return json.load(fh)


def root():
    return os.environ.get("SATELLITE_ROOT", "/Volumes/workdrive/satellite")


def path(*parts):
    return os.path.join(root(), *parts)


def write_json(p, doc, indent=1):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".part"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, indent=indent)
        fh.write("\n")
    os.replace(tmp, p)


def read_json(p):
    with open(p) as fh:
        return json.load(fh)


def stamp_of(dt):
    return dt.strftime("%Y%m%dT%H%M%S")


def time_of(stamp):
    return datetime.strptime(stamp, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)


# ---- stations -----------------------------------------------------------------


def stations(foil_stations=None, ni_stations=None):
    """Every tide station, sorted: the Marine Institute's 33 (the foil-depth
    regions' stations, scripts/foildepth/stations.json) then Northern
    Ireland's (stations_ni.json). Each has id, name, lon, lat, `ni`, and the
    point EOT20 is evaluated at."""
    foil = read_json(foil_stations or os.path.join(REPO, "scripts", "foildepth", "stations.json"))["stations"]
    ni = read_json(ni_stations or os.path.join(HERE, "stations_ni.json"))["stations"]
    out = []
    for sid, s in sorted(foil.items()):
        out.append({"id": sid, "name": s["name"], "lon": float(s["lon"]), "lat": float(s["lat"]), "ni": False,
                    "model": [float(s["lon"]), float(s["lat"])], "modelled": bool(s.get("modelled")),
                    "hat": s.get("hatMetres"), "msl": s.get("mslMetres")})
    for sid, s in sorted(ni.items()):
        out.append({"id": sid, "name": s["name"], "lon": float(s["lon"]), "lat": float(s["lat"]), "ni": True,
                    "model": [float(v) for v in s["model"]], "modelled": "gauge" not in s,
                    "gauge": s.get("gauge")})
    return out


def region_id(station_id, prefix="tide-"):
    """As scripts/foildepth/national.py names a station's region."""
    return prefix + station_id.removesuffix("_MODELLED").lower().replace("_", "-")


def station_distances(lon, lat, stations_):
    """Haversine km from every point to every station: shape (n_stations,) + lon.shape."""
    lon, lat = np.broadcast_arrays(np.radians(np.asarray(lon, dtype=np.float64)),
                                   np.radians(np.asarray(lat, dtype=np.float64)))
    out = np.empty((len(stations_),) + lon.shape, dtype=np.float32)
    for i, s in enumerate(stations_):
        slon, slat = math.radians(s["lon"]), math.radians(s["lat"])
        a = np.sin((lat - slat) / 2) ** 2 + np.cos(lat) * math.cos(slat) * np.sin((lon - slon) / 2) ** 2
        out[i] = 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    return out


def nearest_station(lon, lat, stations_, max_station_km):
    """Index of each point's station under the foil-depth regions' rule: the
    nearest Marine Institute station if one is within max_station_km
    (national.py's maxStationKm) or nearer than any Northern Ireland station,
    else the nearest Northern Ireland station. So the Republic's cells are the
    foil-depth regions' (which stop at max_station_km: past that, an island
    off Kerry or the Shannon at Limerick stays with its nearest station here),
    and Northern Ireland's stations take only the coast nearer them."""
    km = station_distances(lon, lat, stations_)
    ni = np.array([s["ni"] for s in stations_]).reshape((-1,) + (1,) * (km.ndim - 1))
    roi = np.where(ni, np.inf, km)
    north = np.where(ni, km, np.inf)
    use_roi = (roi.min(axis=0) <= max_station_km) | (roi.min(axis=0) <= north.min(axis=0))
    return np.where(use_roi, roi.argmin(axis=0), north.argmin(axis=0)).astype(np.int16)


def station_weights(lon, lat, stations_, max_station_km, blend_km):
    """Each station's share of each point, for blending per-station images
    across the cells' edges: within each group (the Republic's stations, or
    Northern Ireland's) a station's weight falls from 1 at the nearest to 0 at
    blend_km further, then the groups meet on the max_station_km circle over
    blend_km. Shape (n_stations,) + lon.shape; they sum to 1. Where one
    station is nearest by more than blend_km it has the whole point, so the
    blend is only along the cells' edges."""
    km = station_distances(lon, lat, stations_)
    ni = np.array([s["ni"] for s in stations_]).reshape((-1,) + (1,) * (km.ndim - 1))
    group_w, group_min = {}, {}
    for group in (False, True):
        mine = ni & True if group else ~ni
        d = np.where(mine, km, np.inf)
        dmin = d.min(axis=0)
        w = np.where(mine, np.clip(1 - (d - dmin) / blend_km, 0, 1), 0)
        group_w[group] = w / np.maximum(w.sum(axis=0), 1e-9)
        group_min[group] = dmin
    roi, north = group_min[False], group_min[True]
    lead = np.maximum(max_station_km - roi, north - roi)
    share = np.clip(0.5 + lead / blend_km, 0, 1)
    return (group_w[False] * share + group_w[True] * (1 - share)).astype(np.float32)


def merc(lon, lat):
    lon, lat = np.asarray(lon, dtype=np.float64), np.asarray(lat, dtype=np.float64)
    return np.radians(lon) * 6378137.0, np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * 6378137.0


def lonlat_of_merc(x, y):
    return np.degrees(np.asarray(x) / 6378137.0), np.degrees(2 * np.arctan(np.exp(np.asarray(y) / 6378137.0)) - np.pi / 2)


def region_block_lonlat(lon, lat, zoom=13, size=512, block=4):
    """The centre of the `block`×`block` pixel group of the z`zoom` grid each
    point falls in: national.py decides a pixel's station there, so a pixel
    gets the same station here as in the foil-depth regions."""
    x, y = merc(lon, lat)
    px = EARTH / 2 ** zoom / size
    half = EARTH / 2
    col = np.floor((x + half) / px)
    row = np.floor((half - y) / px)
    bc = (np.floor(col / block) * block + block / 2) * px - half
    br = half - (np.floor(row / block) * block + block / 2) * px
    return lonlat_of_merc(bc, br)


# ---- reflectance encoding --------------------------------------------------------


def encode_refl(refl):
    """Reflectance (0-1, float) to the working files' uint8; 0 is kept for "no value"."""
    v = np.sqrt(np.clip(refl, 0, REFL_MAX) / REFL_MAX) * 254 + 1
    return np.round(v).astype(np.uint8)


def decode_refl(code):
    c = (np.asarray(code, dtype=np.float32) - 1) / 254
    return np.where(np.asarray(code) > 0, c * c * REFL_MAX, np.nan)
