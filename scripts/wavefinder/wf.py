"""Wave Finder's shared pieces: paths, regions, config, and the pure functions
the steps share (sea state, wind against the shore, the foam test, lift).

Everything here but the paths is numpy only, so the tests run on CI's Python.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SATELLITE = os.path.join(os.path.dirname(HERE), "satellite")


REGION = os.environ.get("WAVEFINDER_REGION", "ireland")


def set_region(name):
    """Choose the region (config regions: ireland, with Northern Ireland, or gb) before
    the satellite pipeline's common module is first used: its root and config are the
    region's satellite run's (SATELLITE_ROOT, SATELLITE_CONFIG)."""
    global REGION
    REGION = name
    reg = config()["regions"][name]
    os.environ["SATELLITE_CONFIG"] = reg["satelliteConfig"]
    os.environ["SATELLITE_ROOT"] = os.environ.get(f"WAVEFINDER_SATELLITE_{name.upper()}", reg["satelliteRoot"])
    return reg


def region():
    return config()["regions"][REGION]


def satellite():
    """scripts/satellite's common module (its catalogue, plan, coarse grid and readers),
    on the region's satellite run."""
    if "SATELLITE_ROOT" not in os.environ:
        set_region(REGION)
    if SATELLITE not in sys.path:
        sys.path.insert(0, SATELLITE)
    import common
    return common


def config():
    with open(os.path.join(HERE, "config.json")) as fh:
        return json.load(fh)


def root():
    return os.environ.get("WAVEFINDER_ROOT", "/Volumes/workdrive/wavefinder")


def path(*parts):
    """Shared across regions (the Open-Meteo downloads)."""
    return os.path.join(root(), *parts)


def rpath(*parts):
    """The region's own: <root>/<region>/..."""
    return os.path.join(root(), REGION, *parts)


def write_json(p, doc, indent=None):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    tmp = p + ".part"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, indent=indent, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        fh.write("\n")
    os.replace(tmp, p)


def read_json(p):
    with open(p) as fh:
        return json.load(fh)


# ---- sea state ---------------------------------------------------------------------


def swell_power(hs, tp):
    """Deep-water wave energy flux, kW per metre of crest: rho g^2 / (64 pi) Hs^2 Te,
    Te taken as 0.9 Tp. A 2 m, 12 s swell is about 21 kW/m."""
    hs, tp = np.asarray(hs, dtype=np.float64), np.asarray(tp, dtype=np.float64)
    return 1025 * 9.81 ** 2 / (64 * math.pi) * hs ** 2 * 0.9 * tp / 1000


def big_hs(cfg, hs_p75=None):
    """The height a swell must reach to count as big at a point: seaState.bigHs, or less
    where the point's own 75th percentile is less (the Irish Sea, the North Sea), so a
    sheltered coast's best days count as its big ones."""
    return cfg["bigHs"] if hs_p75 is None else min(cfg["bigHs"], max(hs_p75, cfg["calmHs"] + 0.3))


def sea_class(hs, tp, wind, cfg, hs_p75=None):
    """'big' (a long-period swell of size), 'calm' (small sea, light wind) or 'mid'.
    'none' where any input is missing."""
    if any(v is None or not np.isfinite(v) for v in (hs, tp, wind)):
        return "none"
    if hs >= big_hs(cfg, hs_p75) and tp >= cfg["bigTp"]:
        return "big"
    if hs <= cfg["calmHs"] and wind <= cfg["calmWind"]:
        return "calm"
    return "mid"


def at_time(times, values, t):
    """Linear interpolation of an hourly series (times in hours, ascending) at t (a number
    or an array); NaN outside the series or where either neighbour is NaN."""
    times = np.asarray(times, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)
    out = np.interp(t, times, values, left=np.nan, right=np.nan)
    return float(out) if np.ndim(out) == 0 else out


def at_time_angle(times, values, t):
    """As at_time, for a direction in degrees (interpolated on the circle)."""
    rad = np.radians(np.asarray(values, dtype=np.float64))
    s = np.asarray(at_time(times, np.sin(rad), t))
    c = np.asarray(at_time(times, np.cos(rad), t))
    out = np.degrees(np.arctan2(s, c)) % 360
    out = np.where(np.isfinite(s) & np.isfinite(c), out, np.nan)
    return float(out) if np.ndim(out) == 0 else out


def blend_weights(lon, lat, points, n=3, max_km=80.0, min_km=5.0):
    """Inverse-square-distance weights of the n nearest points (within max_km, the nearest
    always), {id: weight} summing to 1: a block's sea state blended from the points round it,
    so neighbouring blocks that fall to different points do not jump."""
    d = sorted((max(float(haversine_km(lon, lat, p["lon"], p["lat"])), min_km), p["id"]) for p in points)
    near = [x for k, x in enumerate(d[:n]) if k == 0 or x[0] <= max_km]
    w = {pid: 1 / km ** 2 for km, pid in near}
    tot = sum(w.values())
    return {pid: v / tot for pid, v in w.items()}


def blend(values, weights):
    """Weighted [hs, tp, dir, wind, wind from] of several points' [hs, tp, dir, wind, wind from]
    ({id: list}); directions on the circle. A point with a missing value is left out of that
    value's mean; all missing gives None."""
    out = []
    for k in range(5):
        pairs = [(weights[p], v[k]) for p, v in values.items() if p in weights and v and v[k] is not None]
        if not pairs:
            out.append(None)
            continue
        w = np.array([a for a, _ in pairs])
        x = np.array([b for _, b in pairs], dtype=np.float64)
        if k in (2, 4):
            out.append(round(circular_mean(x, w)[0], 1))
        else:
            out.append(round(float((w * x).sum() / w.sum()), 2))
    return out


def angle_diff(a, b):
    """Smallest signed difference a - b in degrees, in [-180, 180)."""
    return (np.asarray(a, dtype=np.float64) - b + 180) % 360 - 180


def onshore(wind_from, facing):
    """How onshore a wind is at a shore that faces `facing` (the bearing from land out to
    sea): +1 straight onshore (blowing from the sea), -1 straight offshore, 0 cross-shore."""
    return np.cos(np.radians(angle_diff(wind_from, facing)))


def wind_kind(speed, wind_from, facing, light=5.0):
    """'light', 'offshore', 'cross' or 'onshore', as a surfer would say it of the wind at a break."""
    if not (np.isfinite(speed) and np.isfinite(wind_from)):
        return "none"
    if speed <= light:
        return "light"
    c = float(onshore(wind_from, facing))
    if c <= -0.5:
        return "offshore"
    if c >= 0.5:
        return "onshore"
    return "cross"


def circular_mean(deg, weights=None):
    """Mean direction (degrees) and its resultant length (0 spread evenly, 1 all one way)."""
    deg = np.asarray(deg, dtype=np.float64)
    w = np.ones_like(deg) if weights is None else np.asarray(weights, dtype=np.float64)
    if deg.size == 0 or w.sum() <= 0:
        return float("nan"), 0.0
    s = (w * np.sin(np.radians(deg))).sum() / w.sum()
    c = (w * np.cos(np.radians(deg))).sum() / w.sum()
    return float(np.degrees(np.arctan2(s, c)) % 360), float(math.hypot(s, c))


# ---- the foam test -----------------------------------------------------------------


def foam(b02, b03, b04, b08, b11, cfg):
    """Whitewater: bright water, white in the visible, dark in the shortwave infrared.

    Breaking foam is near-white from blue to red and still bright in the near infrared,
    but water under it absorbs the shortwave infrared (B11), so B11 stays low. Sand,
    rock and weed are redder than blue (B02 < B04) and bright in B11; cloud and haze
    are bright in B11 too; sun glint is grey from the visible to B11. So:
    B03 over `minGreen`, B08 over `minNir`, B11 under `maxSwirShare` of B03, and blue
    at least `minBlueRed` of red. Reflectances 0-1, any shape."""
    b02, b03, b04, b08, b11 = (np.asarray(v, dtype=np.float32) for v in (b02, b03, b04, b08, b11))
    return ((b03 >= cfg["minGreen"]) & (b08 >= cfg["minNir"])
            & (b11 <= cfg["maxSwirShare"] * b03) & (b02 >= cfg["minBlueRed"] * b04))


def foam_score(b03, b11):
    """How white the foam is, 1-255 (0 left for 'no foam'): B03 less B11, on a square-root
    scale to 0.5 (a thin wash about 0.05 is 80, thick breaking 0.3 is 197)."""
    v = np.clip(np.asarray(b03, dtype=np.float32) - np.asarray(b11, dtype=np.float32), 0, 0.5)
    return np.clip(np.round(np.sqrt(v / 0.5) * 254) + 1, 1, 255).astype(np.uint8)


def cloud_like(b03, b11, cfg):
    """Bright in B11, which foam is not: cloud, haze, glint, and dry land (sand, rock,
    fields). A pixel like this is not water or foam in this look."""
    b03, b11 = np.asarray(b03, dtype=np.float32), np.asarray(b11, dtype=np.float32)
    return (b11 >= cfg["cloudSwir"]) & (b11 > cfg["maxSwirShare"] * b03)


# ---- per-pixel statistics and validation --------------------------------------------


def lift(foam_big, n_big, foam_calm, n_calm, prior=1.0, base=0.002):
    """P(foam | big swell), P(foam | calm) and their ratio, with `prior` pseudo-looks at
    the `base` rate added to each, so a pixel seen in few calm looks does not get an
    infinite lift."""
    foam_big, n_big = np.asarray(foam_big, np.float64), np.asarray(n_big, np.float64)
    foam_calm, n_calm = np.asarray(foam_calm, np.float64), np.asarray(n_calm, np.float64)
    pb = (foam_big + prior * base) / np.maximum(n_big + prior, 1e-9)
    pc = (foam_calm + prior * base) / np.maximum(n_calm + prior, 1e-9)
    return pb, pc, pb / pc


def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = (np.radians(np.asarray(v, dtype=np.float64)) for v in (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def recall(breaks, candidates, km):
    """Which known breaks have a candidate within `km`: [(break, nearest candidate or None, km)]."""
    out = []
    for b in breaks:
        best, best_d = None, float("inf")
        for c in candidates:
            d = float(haversine_km(b["lon"], b["lat"], c["lon"], c["lat"]))
            if d < best_d:
                best, best_d = c, d
        out.append((b, best if best_d <= km else None, best_d))
    return out
