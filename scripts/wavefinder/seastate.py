"""The sea state at every Sentinel-2 acquisition: swell and wind, 2017 on.

Points: every 0.5° cell of ERA5-Ocean's grid within seaState.pointSeaKmMax of
the coast (coarse.tif's sea_to_land_km) that the wave model has data at.
Per point, hourly since config start:

- Open-Meteo's marine archive, model era5_ocean (ECMWF ERA5's ocean waves,
  0.5°): wave_height (Hs), wave_peak_period (Tp), wave_period (mean),
  wave_direction (mean, where the waves come from). ERA5 through Open-Meteo
  has no swell partition, so Hs is the total sea and a long Tp says swell;
- Open-Meteo's weather archive, model era5 (0.25°): wind_speed_10m (m/s),
  wind_direction_10m.

One request per point and archive (a few seconds each, well inside the free
tier's limits); each answer is cached in <root>/downloads/openmeteo/ and not
asked again. Then, per tile, the sea state at each acquisition's time at
every point, interpolated between the hours:

    <root>/<region>/work/seastate/points.json      the points
    <root>/<region>/work/seastate/<tile>.json      per acquisition stamp: per point [hs, tp, dir, wind, wind_from]

    python -I seastate.py fetch|tiles [--region ireland|gb] [--tile 29UNA ...]
"""
import argparse
import os
import sys
import time
import urllib.parse
import urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wf  # noqa: E402

MARINE = "https://marine-api.open-meteo.com/v1/marine"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
WAVE_VARS = ("wave_height", "wave_peak_period", "wave_period", "wave_direction")
WIND_VARS = ("wind_speed_10m", "wind_direction_10m")


def candidate_points(cfg):
    """0.5° cells over the sea within pointSeaKmMax of land, on coarse.tif."""
    import rasterio
    from pyproj import Transformer
    s = cfg["seaState"]
    with rasterio.open(wf.satellite().path("work", "coarse.tif")) as src:
        sea, dist = src.read(3) > 0, src.read(5)
        inv, crs = ~src.transform, src.crs
    tr = Transformer.from_crs(4326, crs, always_xy=True)
    w, so, e, n = wf.region()["box"]
    out = []
    for lat in np.arange(so, n + 1e-9, s["grid"]):
        for lon in np.arange(w, e + 1e-9, s["grid"]):
            x, y = tr.transform(lon, lat)
            c, r = inv * (x, y)
            r, c = int(r), int(c)
            if 0 <= r < sea.shape[0] and 0 <= c < sea.shape[1] and sea[r, c] and dist[r, c] <= s["pointSeaKmMax"]:
                out.append({"id": f"{lat:.1f}_{lon:.1f}", "lat": round(float(lat), 3), "lon": round(float(lon), 3),
                            "seaKm": round(float(dist[r, c]), 1)})
    return out


def get(url, params, dest):
    """A cached GET: the answer's JSON, from dest if it is there."""
    if os.path.exists(dest):
        return wf.read_json(dest)
    q = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(10):
        try:
            with urllib.request.urlopen(q, timeout=120) as r:
                body = r.read()
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest + ".part", "wb") as fh:
                fh.write(body)
            os.replace(dest + ".part", dest)
            return wf.read_json(dest)
        except Exception as e:  # 429 (the free tier's per-minute, hour and day limits) or a hiccup
            print(f"  {os.path.basename(dest)}: retry {attempt + 1}: {e!r}"[:160], flush=True)
            time.sleep(min(60 * (attempt + 1), 600))
    return None


def fetch(cfg, part=None):
    """Every point's two series; `part` (k, n) fetches only every n-th point from the k-th,
    so two machines (two addresses, two allowances) can share the work. A point that
    still fails after the retries is skipped: run again to fetch it."""
    pts = candidate_points(cfg)
    d = wf.path("downloads", "openmeteo")
    kept, missing = [], []
    for n, p in enumerate(pts):
        if part and n % part[1] != part[0]:
            continue
        common = {"latitude": p["lat"], "longitude": p["lon"], "start_date": cfg["start"], "end_date": cfg["end"],
                  "timezone": "GMT"}
        waves = get(MARINE, dict(common, hourly=",".join(WAVE_VARS), models="era5_ocean"),
                    os.path.join(d, f"waves_{p['id']}.json"))
        if waves is None:
            missing.append(p["id"])
            continue
        h = waves.get("hourly", {})
        hs = np.array([np.nan if v is None else v for v in h.get("wave_height", [])], np.float64)
        if not np.isfinite(hs).any():
            print(f"{p['id']}: no wave data (the model's land)", flush=True)
            continue
        wind = get(ARCHIVE, dict(common, hourly=",".join(WIND_VARS), models="era5", wind_speed_unit="ms"),
                   os.path.join(d, f"wind_{p['id']}.json"))
        if wind is None:
            missing.append(p["id"])
            continue
        p = dict(p, waveCell=[waves["latitude"], waves["longitude"]], windCell=[wind["latitude"], wind["longitude"]],
                 hsP90=round(float(np.nanpercentile(hs, 90)), 2))
        kept.append(p)
        print(f"{p['id']}: Hs p90 {p['hsP90']} m (wave cell {p['waveCell']}, wind cell {p['windCell']})", flush=True)
        time.sleep(1)
    if part:
        print(f"part {part}: {len(kept)} points, {len(missing)} not fetched {missing}")
        return
    wf.write_json(wf.rpath("work", "seastate", "points.json"), {"points": kept}, indent=1)
    print(f"{len(kept)} points of {len(pts)}; not fetched: {missing}")


def hours(stamps):
    """ISO hour strings ('2017-01-01T00:00', UTC) to hours since 1970."""
    return np.array(stamps, dtype="datetime64[m]").astype(np.int64) / 60.0


def series(pid):
    d = wf.path("downloads", "openmeteo")
    waves = wf.read_json(os.path.join(d, f"waves_{pid}.json"))["hourly"]
    wind = wf.read_json(os.path.join(d, f"wind_{pid}.json"))["hourly"]

    def arr(h, k):
        return np.array([np.nan if v is None else v for v in h[k]], np.float64)

    tp, tm, hs = arr(waves, "wave_peak_period"), arr(waves, "wave_period"), arr(waves, "wave_height")
    return {"t": hours(waves["time"]), "hs": hs, "tp": fill_peak(tp, tm, hs), "tm": tm,
            "dir": arr(waves, "wave_direction"), "tw": hours(wind["time"]), "wind": arr(wind, "wind_speed_10m"),
            "wdir": arr(wind, "wind_direction_10m")}


def fill_peak(tp, tm, hs):
    """Open-Meteo's ERA5 waves have no peak period after 18 November 2024 (the mean period
    and the height go on): there, the peak period is the mean period times the point's own
    median ratio of the two over the hours with Hs >= 1.5 m before (about 1.25 off the west
    coast)."""
    ok = np.isfinite(tp) & np.isfinite(tm) & (tm > 0) & (hs >= 1.5)
    ratio = float(np.median(tp[ok] / tm[ok])) if ok.sum() > 100 else 1.25
    return np.where(np.isfinite(tp), tp, tm * ratio)


def at(s, ts):
    """[[hs, tp, dir, wind speed, wind from], ...] at the hours ts."""
    cols = [wf.at_time(s["t"], s["hs"], ts), wf.at_time(s["t"], s["tp"], ts), wf.at_time_angle(s["t"], s["dir"], ts),
            wf.at_time(s["tw"], s["wind"], ts), wf.at_time_angle(s["tw"], s["wdir"], ts)]
    return [[None if not np.isfinite(v) else round(float(v), 2) for v in row] for row in zip(*cols)]


def tiles(names):
    common = wf.satellite()
    pts = wf.read_json(wf.rpath("work", "seastate", "points.json"))["points"]
    ser = {p["id"]: series(p["id"]) for p in pts}
    # Each point's own sizes: what is big there (the Irish Sea's 90th percentile is the
    # Atlantic's median).
    for p in pts:
        hs = ser[p["id"]]["hs"]
        p["hsPercentiles"] = {str(q): round(float(np.nanpercentile(hs, q)), 2) for q in (25, 50, 75, 90)}
    wf.write_json(wf.rpath("work", "seastate", "points.json"), {"points": pts}, indent=1)
    plan = common.read_json(common.path("work", "plan.json"))
    for tile in names or sorted(plan["tiles"]):
        cat = common.read_json(common.path("downloads", "catalog", f"{tile}.json"))
        stamps = [it["stamp"] for it in cat["items"]]
        ts = np.array([common.time_of(st).timestamp() / 3600 for st in stamps])
        per = {pid: at(s, ts) for pid, s in ser.items()}
        out = {st: {pid: per[pid][k] for pid in per} for k, st in enumerate(stamps)}
        wf.write_json(wf.rpath("work", "seastate", f"{tile}.json"),
                      {"tile": tile, "fields": ["hs", "tp", "dir", "wind", "windFrom"], "looks": out})
        print(f"{tile}: {len(out)} acquisitions", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["fetch", "tiles"])
    p.add_argument("--region", default="ireland")
    p.add_argument("--tile", action="append")
    p.add_argument("--part", help="k/n: fetch every n-th point from the k-th (and write no points.json)")
    a = p.parse_args()
    wf.set_region(a.region)
    cfg = wf.config()
    if a.step == "fetch":
        fetch(cfg, tuple(int(v) for v in a.part.split("/")) if a.part else None)
    else:
        tiles(a.tile)


if __name__ == "__main__":
    sys.exit(main())
