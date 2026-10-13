"""The tide at every station at every Sentinel-2 acquisition, from open data only.

Every station gets EOT20 (DGFI-TUM's global ocean-tide model, CC BY 4.0, via
pyTMD) at its point, fitted to an open reference: its timing (a shift), scale
and datum (`level = a + b * model(t + shift)`).

- The Marine Institute's 33 stations: fitted to the Marine Institute's own
  predictions (ERDDAP imiTidePrediction, metres above LAT, CC BY 4.0) over
  2026, the year ERDDAP has. The rocks pilot found EOT20 within 0.07 m RMS of
  them at Howth once fitted.
- Northern Ireland's (stations_ni.json): fitted to the UK gauges at Bangor and
  Portrush (Copernicus Marine in-situ, on EMODnet Physics' ERDDAP, chart
  datum, hourly since mid-2022). The stations with no gauge keep the model's
  amplitude and timing, and their datum is the model's own LAT: the lowest
  level it predicts over 19 years.

At a scene's time the level is an observation where there is one (the
Irish National Tide Gauge Network's 5-minute gauges, CC BY 4.0, or the UK
gauge's hourly level, interpolated), since that carries the surge the
waterline sees; else the fitted model. An observation further than
`maxSurgeMetres` from the model, or from a gauge-year whose median departs
from it by more than `maxGaugeOffsetMetres` (a datum change), is not used.

Great Britain (SATELLITE_CONFIG=config-gb.json) has no Marine Institute
stations: its gauges (gauges_gb.json, the UK National Tide Gauge Network and
the Channel Coastal Observatory's, on the same ERDDAP, mid-2022 to late 2024)
and, where the coast is further than tides.fillKm from all of them, the model
alone at a point offshore (`place` writes stations_gb.json). Some gauges are
in chart datum and some in Ordnance Datum Newlyn, so with tides.datum
"modelLAT" every station's datum is its own fitted model's 19-year lowest,
the gauges' levels moved with it.

    python -I tides.py place        # Great Britain: stations_gb.json (needs coarse.py's coarse.tif)
    python -I tides.py fetch        # downloads: predictions, gauges
    python -I tides.py calibrate    # work/tides/calibration.json
    python -I tides.py scenes       # work/tides/scenes.json (needs catalog.py's lists)
"""
import argparse
import concurrent.futures as cf
import csv
import io
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

MI = "https://erddap.marine.ie/erddap/tabledap"
EMODNET = "https://erddap.emodnet-physics.eu/erddap/tabledap/ERD_EP_SLEV_NRT_60m"
UA = "wingfoil.ie satellite build (scripts/satellite)"
PRED_FROM, PRED_TO = "2026-01-01T00:00:00Z", "2026-10-01T00:00:00Z"
NI_FROM, NI_TO = "2022-06-01T00:00:00Z", "2026-10-01T00:00:00Z"
MAX_SURGE = 1.0
MAX_GAUGE_OFFSET = 0.3
# The Irish National Tide Gauge Network's id for each station that is a gauge.
MI_GAUGES = {
    "Aranmore": "Aranmore Island - Leabgarrow", "Ballycotton": "Ballycotton Harbour",
    "Ballyglass": "Ballyglass Harbour", "Buncranna": "Buncranna", "Castletownbere": "Castletownbere Port",
    "Dingle": "Dingle Harbour", "Dublin_Port": "Dublin Port", "Dunmore": "Dunmore East Harbour",
    "Galway": "Galway Port", "Howth": "Howth Water Level 1", "Killybegs": "Killybegs Port",
    "Kilrush": "Kilrush Lough", "Malin_Head": "Malin Head - Portmore Pier", "Rosslare": "Rosslare",
    "Skerries": "Skerries Harbour", "Sligo": "Sligo", "Union_Hall": "Union Hall Harbor",
    "Wexford": "Wexford Harbour",
}


def get(url, timeout=600):
    import requests
    for attempt in range(5):
        try:
            r = requests.get(url, timeout=(20, timeout), headers={"User-Agent": UA})
            if r.status_code == 404:  # ERDDAP: no rows
                return ""
            r.raise_for_status()
            return r.text
        except Exception as e:
            if attempt == 4:
                raise
            print(f"  retry {attempt + 1}: {e!r}"[:160], flush=True)
            time.sleep(5 * 2 ** attempt)


def rows(text):
    lines = list(csv.reader(io.StringIO(text)))
    return lines[2:] if len(lines) > 2 else []


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def save(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".part", "w") as fh:
        fh.write(text)
    os.replace(path + ".part", path)


# ---- fetch -------------------------------------------------------------------


def fetch(stations, workers=4):
    d = common.path("downloads", "tides")
    gauge_from = common.config().get("tides", {}).get("gaugeFrom", NI_FROM)
    jobs = []
    for s in stations:
        if not s["ni"]:
            out = os.path.join(d, "pred", f"{s['id']}.csv")
            url = (f"{MI}/imiTidePrediction.csv?time,Water_Level&stationID={quote(chr(34) + s['id'] + chr(34))}"
                   f"&time{quote('>=')}{PRED_FROM}&time{quote('<')}{PRED_TO}")
            jobs.append((out, url))
            gauge = MI_GAUGES.get(s["id"])
            if gauge:
                for year in range(2017, 2027):
                    out = os.path.join(d, "gauge", f"{s['id']}-{year}.csv")
                    url = (f"{MI}/IrishNationalTideGaugeNetwork.csv?time,Water_Level_LAT,QC_Flag"
                           f"&station_id={quote(chr(34) + gauge + chr(34))}"
                           f"&time{quote('>=')}{year}-01-01T00:00:00Z&time{quote('<')}{year + 1}-01-01T00:00:00Z")
                    jobs.append((out, url))
        elif s.get("gauge"):
            out = os.path.join(d, "ni", f"{s['id']}.csv")
            url = (f"{EMODNET}.csv?time,SLEV,SLEV_QC&PLATFORMCODE={quote(chr(34) + s['gauge']['platform'] + chr(34))}"
                   f"&time{quote('>=')}{gauge_from}&time{quote('<')}{NI_TO}")
            jobs.append((out, url))
    todo = [(o, u) for o, u in jobs if not os.path.exists(o)]
    print(f"tides: {len(todo)} of {len(jobs)} downloads to do", flush=True)

    def one(job):
        out, url = job
        save(out, get(url))
        return out

    with cf.ThreadPoolExecutor(workers) as pool:
        for n, out in enumerate(pool.map(one, todo), 1):
            print(f"  [{n}/{len(todo)}] {os.path.basename(out)}", flush=True)


def load_series(path, value_col=1, flag_col=2, good_flags=None):
    """(epoch seconds, level) arrays from an ERDDAP csv; bad flags, NaNs and
    levels outside tides.validRange dropped (the Severn's reach 14 m)."""
    if not os.path.exists(path):
        return np.empty(0), np.empty(0)
    lo, hi = common.config().get("tides", {}).get("validRange", [-3, 9])
    t, v = [], []
    with open(path) as fh:
        for row in rows(fh.read()):
            try:
                val = float(row[value_col])
            except (ValueError, IndexError):
                continue
            if not np.isfinite(val) or not lo < val < hi:
                continue
            if good_flags is not None and len(row) > flag_col and row[flag_col] not in good_flags:
                continue
            t.append(parse_time(row[0]).timestamp())
            v.append(val)
    order = np.argsort(t)
    return np.asarray(t, dtype=np.float64)[order], np.asarray(v, dtype=np.float64)[order]


def mi_gauge(sid):
    ts, vs = [], []
    for year in range(2017, 2027):
        t, v = load_series(common.path("downloads", "tides", "gauge", f"{sid}-{year}.csv"),
                           good_flags=("0", "1", ""))
        ts.append(t)
        vs.append(v)
    return np.concatenate(ts), np.concatenate(vs)


# ---- the model -----------------------------------------------------------------


def eot20_dir():
    return common.path("downloads", "eot20")


def model(lon, lat, epoch_seconds):
    """EOT20 at a point, metres about mean sea level."""
    import pyTMD.compute
    t = np.asarray(epoch_seconds, dtype=np.float64).astype("datetime64[s]")
    out = np.empty(len(t))
    step = 200000  # pyTMD holds every constituent at every time: about 3 kB a time
    for i in range(0, len(t), step):
        z = pyTMD.compute.tide_elevations(np.array([lon]), np.array([lat]), t[i:i + step], directory=eot20_dir(),
                                          model="EOT20", type="time series", standard="datetime",
                                          extrapolate=True, cutoff=40, crop=True,
                                          bounds=[lon % 360 - 1, lon % 360 + 1, lat - 1, lat + 1])
        out[i:i + step] = np.asarray(z, dtype=float).ravel()
    return out


def fit_reference(lon, lat, t_ref, v_ref):
    """Shift (minutes), a, b and RMS of `v_ref ≈ a + b * model(t + shift)`:
    the shift by a search over ±90 min, then a and b by least squares."""
    sel = np.linspace(0, len(t_ref) - 1, min(len(t_ref), 20000)).astype(int)
    t, v = t_ref[sel], v_ref[sel]
    shifts = np.arange(-90, 91, 3)
    grid = model(lon, lat, np.concatenate([t + s * 60 for s in shifts])).reshape(len(shifts), -1)
    best = None
    for s, m in zip(shifts, grid):
        b, a = np.polyfit(m, v, 1)
        rms = float(np.sqrt(np.mean((v - (a + b * m)) ** 2)))
        if best is None or rms < best[3]:
            best = (int(s), float(a), float(b), rms)
    return best


def calibrate_one(s, datum):
    """One station's fit (not a basin's)."""
    long_t = np.arange(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp(),
                       datetime(2039, 1, 1, tzinfo=timezone.utc).timestamp(), 1800.0)
    lon, lat = s["model"]
    entry = {"model": [lon, lat]}
    if not s["ni"]:
        t, v = load_series(common.path("downloads", "tides", "pred", f"{s['id']}.csv"), flag_col=99)
        ref = "Marine Institute prediction 2026 (imiTidePrediction)"
    elif s.get("gauge"):
        t, v = load_series(common.path("downloads", "tides", "ni", f"{s['id']}.csv"), good_flags=("1", "2", "0"))
        ref = (f"UK gauge {s['gauge']['platform']} (via EMODnet Physics), "
               + ("its datum moved to the fitted model's 19-year lowest" if datum == "modelLAT" else "chart datum"))
    else:
        t, v = np.empty(0), np.empty(0)
        ref = None
    if len(t) > 500:
        shift, a, b, rms = fit_reference(lon, lat, t, v)
        entry.update({"reference": ref, "samples": int(len(t)), "shiftMinutes": shift, "a": round(a, 4),
                      "b": round(b, 4), "rms": round(rms, 3)})
        z = entry["a"] + entry["b"] * model(lon, lat, long_t + entry["shiftMinutes"] * 60)
        if datum == "modelLAT":
            # The gauge's datum (chart datum or ODN) to the fitted model's own lowest.
            entry["obsOffset"] = round(float(-z.min()), 4)
            entry["a"] = round(entry["a"] + entry["obsOffset"], 4)
            z = z + entry["obsOffset"]
    else:
        # No reference: the model as it is, its datum its own 19-year lowest.
        z = model(lon, lat, long_t)
        entry.update({"reference": "none: EOT20 as is, datum its own 19-year lowest (model LAT)",
                      "shiftMinutes": 0, "a": round(float(-z.min()), 4), "b": 1.0, "rms": None})
        z = z + entry["a"]
    entry["modelLowest19y"] = round(float(z.min()), 3)
    entry["modelHighest19y"] = round(float(z.max()), 3)
    return entry


def calibrate(stations, force=False, workers=2):  # EOT20 takes about 4.5 GB a process
    path = common.path("work", "tides", "calibration.json")
    out = {} if force or not os.path.exists(path) else common.read_json(path)["stations"]
    datum = common.config().get("tides", {}).get("datum", "reference")
    todo = [s for s in stations if s["id"] not in out and not s.get("lagOf")]
    def save():
        common.write_json(path, {"generatedAt": datetime.now(timezone.utc).isoformat()[:19] + "Z", "stations": out})

    # A fresh process a station: pyTMD's memory grows from one call to the next.
    with cf.ProcessPoolExecutor(workers, max_tasks_per_child=1) as pool:
        for s, entry in zip(todo, pool.map(calibrate_one, todo, [datum] * len(todo))):
            out[s["id"]] = entry
            print(f"{s['id']}: {entry}", flush=True)
            save()
    for s in stations:
        if s.get("lagOf") and s["id"] not in out:
            # A basin: its parent's fit, lagMinutes later (lag.py read the lag off the imagery).
            entry = dict(out[s["lagOf"]])
            entry["shiftMinutes"] = entry["shiftMinutes"] - s["lagMinutes"]
            entry["reference"] = (f"{s['lagOf']}'s fit, {s['lagMinutes']} min later: the lag that best sorts the "
                                  "basin's wet and dry looks (lag.py); the parent's amplitude and datum")
            out[s["id"]] = entry
            print(f"{s['id']}: {entry}", flush=True)
    save()
    return out


def interp_obs(t_obs, v_obs, when, max_gap):
    """Linear interpolation at `when` between samples at most max_gap s apart; NaN where not."""
    if len(t_obs) < 2:
        return np.full(len(when), np.nan)
    i = np.clip(np.searchsorted(t_obs, when), 1, len(t_obs) - 1)
    t0, t1 = t_obs[i - 1], t_obs[i]
    f = np.where(t1 > t0, (when - t0) / np.maximum(t1 - t0, 1e-9), 0)
    v = v_obs[i - 1] + f * (v_obs[i] - v_obs[i - 1])
    ok = (t1 - t0 <= max_gap) & (when >= t0) & (when <= t1)
    return np.where(ok, v, np.nan)


def scenes(stations):
    """Each station's level at every acquisition in the catalog."""
    cal = common.read_json(common.path("work", "tides", "calibration.json"))["stations"]
    stamps = set()
    cat_dir = common.path("downloads", "catalog")
    for f in sorted(os.listdir(cat_dir)):
        if f.endswith(".json") and not f.startswith("."):
            for it in common.read_json(os.path.join(cat_dir, f))["items"]:
                stamps.add(it["stamp"])
    stamps = sorted(stamps)
    when = np.array([common.time_of(s).timestamp() for s in stamps])
    print(f"{len(stamps)} acquisition times", flush=True)
    levels, report = {}, {}
    for s in stations:
        c = cal[s["id"]]
        lon, lat = c["model"]
        m = c["a"] + c["b"] * model(lon, lat, when + c["shiftMinutes"] * 60)
        obs = np.full(len(when), np.nan)
        if not s["ni"] and s["id"] in MI_GAUGES:
            t, v = mi_gauge(s["id"])
            obs = interp_obs(t, v, when, max_gap=20 * 60)
        elif s.get("gauge"):
            t, v = load_series(common.path("downloads", "tides", "ni", f"{s['id']}.csv"), good_flags=("1", "2", "0"))
            obs = interp_obs(t, v, when, max_gap=2 * 3600 + 60) + c.get("obsOffset", 0.0)
        # A gauge-year off the model by a datum's worth is not used, nor a single wild reading.
        years = np.array([int(x[:4]) for x in stamps])
        dropped_years = []
        for y in np.unique(years):
            sel = (years == y) & np.isfinite(obs)
            if sel.sum() >= 10 and abs(np.median(obs[sel] - m[sel])) > MAX_GAUGE_OFFSET:
                obs[years == y] = np.nan
                dropped_years.append(int(y))
        obs[np.abs(obs - m) > MAX_SURGE] = np.nan
        use = np.isfinite(obs)
        lv = np.where(use, obs, m)
        levels[s["id"]] = {k: [round(float(x), 3), "g" if u else "m"] for k, x, u in zip(stamps, lv, use)}
        resid = obs[use] - m[use]
        report[s["id"]] = {"gaugeShare": round(float(use.mean()), 3), "gaugeYearsDropped": dropped_years,
                           "gaugeMinusModelRms": round(float(np.sqrt(np.mean(resid ** 2))), 3) if use.any() else None,
                           "range": [round(float(lv.min()), 2), round(float(lv.max()), 2)]}
        print(f"{s['id']}: {report[s['id']]}", flush=True)
    common.write_json(common.path("work", "tides", "scenes.json"),
                      {"datum": "LAT (chart datum for the UK gauges)", "report": report, "levels": levels}, indent=None)


# ---- Great Britain's stations ------------------------------------------------------


def place(fill_km, out_path):
    """stations_gb.json: every gauge in gauges_gb.json, then the model alone
    wherever the coast is further than fill_km from every station so far (the
    furthest first), at a point of sea 1-2 km off it."""
    import rasterio
    from pyproj import Transformer
    gauges = common.read_json(os.path.join(HERE, "gauges_gb.json"))["gauges"]
    with rasterio.open(common.path("work", "coarse.tif")) as src:
        sea, s2l = src.read(3) > 0, src.read(5)
        tf, crs = src.transform, src.crs
    # Coast points: sea 1-2 km from the land, on a 500 m lattice.
    band = sea & (s2l >= 1.0) & (s2l <= 2.0)
    keep = np.zeros_like(band)
    keep[::5, ::5] = band[::5, ::5]
    rows, cols = np.nonzero(keep)
    x, y = tf * (cols + 0.5, rows + 0.5)
    lon, lat = Transformer.from_crs(crs, 4326, always_xy=True).transform(x, y)
    out = {}
    for g in gauges:
        out[g["id"]] = {"name": g["name"], "lon": g["lon"], "lat": g["lat"], "model": [g["lon"], g["lat"]],
                        "gauge": {"source": "emodnet", "platform": g["platform"]}}
    pts = [{"lon": v["lon"], "lat": v["lat"]} for v in out.values()]
    d = common.station_distances(lon, lat, pts).min(axis=0)
    while d.max() > fill_km:
        k = int(np.argmax(d))
        sid = f"GB_{lat[k]:.2f}N_{abs(lon[k]):.2f}{'W' if lon[k] < 0 else 'E'}_MODELLED".replace(".", "")
        out[sid] = {"name": f"{lat[k]:.2f}N {abs(lon[k]):.2f}{'W' if lon[k] < 0 else 'E'} (modelled)",
                    "lon": round(float(lon[k]), 4), "lat": round(float(lat[k]), 4),
                    "model": [round(float(lon[k]), 4), round(float(lat[k]), 4)]}
        d = np.minimum(d, common.station_distances(lon, lat, [out[sid]])[0])
    n_model = sum(1 for v in out.values() if "gauge" not in v)
    print(f"{len(gauges)} gauges and {n_model} modelled stations, every coast point within {fill_km} km", flush=True)
    common.write_json(out_path, {
        "about": "Tide stations for Great Britain's coast (tides.py place): the UK gauges on EMODnet Physics' "
                 "ERDDAP (gauges_gb.json), EOT20 fitted to each; where the coast is further than "
                 f"{fill_km} km from all of them, EOT20 as it is at a point 1-2 km offshore. Every datum is "
                 "the station's fitted model's 19-year lowest (tides.datum modelLAT).",
        "stations": out})


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["place", "fetch", "calibrate", "scenes"])
    a = p.parse_args()
    if a.step == "place":
        cfg = common.config()
        return place(cfg["tides"]["fillKm"], os.path.join(HERE, cfg["stations"]["others"]))
    st = common.stations()
    if a.step == "fetch":
        fetch(st)
    elif a.step == "calibrate":
        calibrate(st)
    else:
        scenes(st)


if __name__ == "__main__":
    sys.exit(main())
