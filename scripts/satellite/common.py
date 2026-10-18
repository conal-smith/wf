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
    """config.json, or the file SATELLITE_CONFIG names (beside this one if not
    absolute): config-gb.json runs the same steps over Great Britain."""
    with open(path or os.path.join(HERE, os.environ.get("SATELLITE_CONFIG", "config.json"))) as fh:
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


def scout_skips(block, limit):
    """A block scout.py saw clear at both ends of the tide, with next to no foreshore."""
    return min(block["lowLooks"], block["highLooks"]) >= 2 and block["foreshoreKm2"] < limit


def scouted(pt, tile):
    """The plan's tile without the coastal blocks scout.py found next to no
    foreshore in (scout.minKm2): a steep coast, where the tide only climbs the
    rock. As it was planned where the tile has not been scouted."""
    p = path("work", "scout", f"{tile}.json")
    if not os.path.exists(p):
        return pt
    blocks = read_json(p)["blocks"]
    limit = config()["scout"]["minKm2"]
    keep = [b for b in pt["coastalBlocks"]
            if not (f"{b[0]:02d}_{b[1]:02d}" in blocks and scout_skips(blocks[f"{b[0]:02d}_{b[1]:02d}"], limit))]
    return dict(pt, coastalBlocks=keep)


def stamp_of(dt):
    return dt.strftime("%Y%m%dT%H%M%S")


def time_of(stamp):
    return datetime.strptime(stamp, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)


# ---- stations -----------------------------------------------------------------


def stations(foil_stations=None, ni_stations=None, include_inactive=False):
    """Every tide station, sorted: the Marine Institute's 33 (the foil-depth
    regions' stations, scripts/foildepth/stations.json) then Northern
    Ireland's (stations_ni.json). Each has id, name, lon, lat, `ni`, and the
    point EOT20 is evaluated at. The config's `stations` can name other files
    (Great Britain: no Marine Institute stations, and stations_gb.json as the
    others, which take the `ni` group's part: fitted to a UK gauge, or the
    model as it is)."""
    files = config().get("stations", {})
    mi_file = files.get("marineInstitute", "scripts/foildepth/stations.json")
    foil = (read_json(foil_stations or os.path.join(REPO, mi_file))["stations"]
            if foil_stations or mi_file else {})
    ni = read_json(ni_stations or os.path.join(HERE, files.get("others", "stations_ni.json")))["stations"]
    out = []
    for sid, s in sorted(foil.items()):
        if s.get("northernIreland"):
            # The site's own Northern Ireland stations (force5/ingest/tides_ni.py),
            # which the foil regions are drawn on: this run's are stations_ni.json's.
            continue
        out.append({"id": sid, "name": s["name"], "lon": float(s["lon"]), "lat": float(s["lat"]), "ni": False,
                    "model": [float(s["lon"]), float(s["lat"])], "modelled": bool(s.get("modelled")),
                    "hat": s.get("hatMetres"), "msl": s.get("mslMetres")})
    for sid, s in sorted(ni.items()):
        # A station not yet calibrated (a basin before lag.py has read its lag) is left out.
        if s.get("active") is False and not include_inactive:
            continue
        out.append({"id": sid, "name": s["name"], "lon": float(s["lon"]), "lat": float(s["lat"]), "ni": True,
                    "model": [float(v) for v in s["model"]], "modelled": "gauge" not in s,
                    "gauge": s.get("gauge"), "lagOf": s.get("lagOf"), "lagMinutes": s.get("lagMinutes", 0),
                    "polygon": s.get("polygon")})
    return out


def station_lut(ids, stations_):
    """Station indices written under the list `ids` (a block's, or heights.tif's
    STATIONS tag) as indices into `stations_`, the list as it is now: index the
    result with the written index + 1. No station (-1), and one no longer in
    the list, are -1. The list is sorted by id, so a station added (the basin
    stations of 15 October) moves every one after it: an index is only good
    with the list it was written with."""
    now = {s["id"]: k for k, s in enumerate(stations_)}
    return np.array([-1] + [now.get(i, -1) for i in ids], np.int16)


def station_ids_of(ds):
    """The station list a tile's heights.tif was written with (its STATIONS
    tag), or None for one written before the tag (restation.py adds it)."""
    tag = ds.tags().get("STATIONS")
    return None if tag is None else json.loads(tag)


def to_current_stations(values, ids, stations_):
    """heights.tif band 6 values (or any array of them, -1 or NaN for none),
    written under `ids`, as indices into `stations_`. With no `ids` (a tile
    from before the tag) they are taken as they are."""
    v = np.where(np.isfinite(values), values, -1).astype(np.int32)
    if ids is None:
        return v.astype(np.int16)
    lut = station_lut(ids, stations_)
    return lut[np.clip(v, -1, len(lut) - 2) + 1]


def in_polygon(lon, lat, ring):
    """Points in a lon/lat polygon (even-odd rule)."""
    lon, lat = np.broadcast_arrays(np.asarray(lon, dtype=np.float64), np.asarray(lat, dtype=np.float64))
    out = np.zeros(lon.shape, bool)
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        if y0 == y1:
            continue
        out ^= ((y0 > lat) != (y1 > lat)) & (lon < (x1 - x0) * (lat - y0) / (y1 - y0) + x0)
    return out


def ring_area(ring):
    """A lon/lat ring's area in square degrees (shoelace): enough to order basins."""
    x, y = np.asarray(ring, dtype=np.float64).T
    return abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))) / 2


def basins(stations_, lon, lat):
    """[(index, mask)] of the stations with a polygon, over these points, the
    largest first: applied in turn, the smaller of two that overlap wins (a
    basin found inside a basin keeps its own tide)."""
    ks = sorted((k for k, s in enumerate(stations_) if s.get("polygon")),
                key=lambda k: -ring_area(stations_[k]["polygon"]))
    return [(k, in_polygon(lon, lat, stations_[k]["polygon"])) for k in ks]


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
    shape = (-1,) + (1,) * (km.ndim - 1)
    ni = np.array([s["ni"] for s in stations_]).reshape(shape)
    basin = np.array([bool(s.get("polygon")) for s in stations_]).reshape(shape)
    roi = np.where(ni, np.inf, km)
    north = np.where(ni & ~basin, km, np.inf)
    use_roi = (roi.min(axis=0) <= max_station_km) | (roi.min(axis=0) <= north.min(axis=0))
    out = np.where(use_roi, roi.argmin(axis=0), north.argmin(axis=0)).astype(np.int16)
    # A basin's station takes every point in its polygon, and none outside it.
    for k, inside in basins(stations_, *np.broadcast_arrays(lon, lat)):
        out = np.where(inside, k, out).astype(np.int16)
    return out


def station_weights(lon, lat, stations_, max_station_km, blend_km):
    """Each station's share of each point, for blending per-station images
    across the cells' edges: within each group (the Republic's stations, or
    Northern Ireland's) a station's weight falls from 1 at the nearest to 0 at
    blend_km further, then the groups meet on the max_station_km circle over
    blend_km. Shape (n_stations,) + lon.shape; they sum to 1. Where one
    station is nearest by more than blend_km it has the whole point, so the
    blend is only along the cells' edges."""
    km = station_distances(lon, lat, stations_)
    shape = (-1,) + (1,) * (km.ndim - 1)
    ni = np.array([s["ni"] for s in stations_]).reshape(shape)
    basin = np.array([bool(s.get("polygon")) for s in stations_]).reshape(shape)
    group_w, group_min = {}, {}
    for group in (False, True):
        mine = (ni & ~basin) if group else ~ni
        d = np.where(mine, km, np.inf)
        dmin = d.min(axis=0)
        w = np.where(mine, np.clip(1 - (d - dmin) / blend_km, 0, 1), 0)
        group_w[group] = w / np.maximum(w.sum(axis=0), 1e-9)
        group_min[group] = dmin
    roi, north = group_min[False], group_min[True]
    lead = np.maximum(max_station_km - roi, north - roi)
    share = np.clip(0.5 + lead / blend_km, 0, 1)
    out = (group_w[False] * share + group_w[True] * (1 - share)).astype(np.float32)
    # A basin's station has the whole of its polygon (its edge is in a narrows).
    for k, inside in basins(stations_, *np.broadcast_arrays(lon, lat)):
        out = np.where(inside[None], 0, out)
        out[k] = np.where(inside, 1, out[k])
    return out


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
