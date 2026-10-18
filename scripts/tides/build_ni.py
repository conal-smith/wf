"""Harmonic constants for Northern Ireland's tide stations, and their validation.

The Marine Institute predicts no tide in Northern Ireland and the UK Hydrographic
Office's predictions are not open, so these stations are our own, from open
data only:

- **Portrush and Bangor**, the UK National Tide Gauge Network's gauges, from the
  Environment Agency's real-time flood-monitoring API (15-minute levels above
  chart datum and above Ordnance Datum, Open Government Licence v3.0): a
  harmonic analysis of the latest month the API holds, its unresolvable
  constituents (K2 from S2, P1 from K1, ...) inferred from EOT20's ratios at
  the gauge and its long-period ones taken from EOT20.
- **Everywhere else on the coast**, EOT20 (DGFI-TUM's global ocean tide model,
  CC BY 4.0) at a point of open water off it: its own constants, read off a
  two-year pyTMD prediction there by harmonic analysis, minor constituents
  included.
- **Strangford Lough inside the Narrows**: Killard Point's tide 100 minutes
  later, the lag the satellite run read off the lough's flats (scripts/
  satellite, lag.py). Its range is Killard's: no open data say the lough's.

Each station's datum is its own LAT: the lowest level its constants predict
every 10 minutes over the 18.61 years from 2026-01-01.

    PY=/Volumes/workdrive/satellite/venv/bin/python   # numpy, requests; pyTMD for eot20
    $PY -I build_ni.py --data /tmp/wf-ni-tides fetch       # EA month; validation downloads
    $PY -I build_ni.py --data /tmp/wf-ni-tides eot20 --eot20 /Volumes/workdrive/satellite/downloads/eot20
    $PY -I build_ni.py --data /tmp/wf-ni-tides constants   # force5/ingest/tide_stations_ni.json
    $PY -I build_ni.py --data /tmp/wf-ni-tides validate    # scripts/tides/validation.json

Validation downloads (never used for the constants): the same gauges' hourly
levels 2012-2024 (Copernicus Marine in-situ via EMODnet Physics), the Marine
Institute's predictions and gauge levels at Malin Head and Port Oriel (CC BY
4.0). The EA API keeps about 29 days; `fetch` keeps every month it has fetched
under the data directory, and `constants --since` can analyse more of them.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import sys
import time
from urllib.parse import quote

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "force5", "ingest"))
import harmonics  # noqa: E402

OUT = os.path.join(REPO, "force5", "ingest", "tide_stations_ni.json")
VALIDATION = os.path.join(HERE, "validation.json")
UA = "wingfoil.ie tide constants (scripts/tides/build_ni.py)"
EA = "https://environment.data.gov.uk/flood-monitoring/id/measures"
MI = "https://erddap.marine.ie/erddap/tabledap"
EMODNET = "https://erddap.emodnet-physics.eu/erddap/tabledap/ERD_EP_SLEV_NRT_60m"
DATUM_FROM = datetime(2026, 1, 1, tzinfo=timezone.utc)
NODAL_YEARS = 18.61
EOT20_FROM, EOT20_TO = "2026-01-01", "2028-01-01"
MAX_RESIDUAL = 1.0  # metres: a reading this far off the fit is a spike, not weather
OGL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
CCBY = "https://creativecommons.org/licenses/by/4.0/"
EOT20_DOI = "https://doi.org/10.17882/79489"
EOT20_CREDIT = "EOT20 ocean tide model, Hart-Davis et al. 2021, DGFI-TUM (CC BY 4.0)"
EA_CREDIT = ("Environment Agency tide gauge data from the real-time flood-monitoring API "
             "(Open Government Licence v3.0)")

# The Environment Agency's measures for each gauge: above chart datum, above Ordnance Datum.
GAUGES = {
    "Portrush": {"local": "E73924-level-tidal_level-Mean-15_min-m",
                 "aod": "E73939-level-tidal_level-Mean-15_min-mAOD", "emodnet": ["prus", "Portrush"]},
    "Bangor": {"local": "E73824-level-tidal_level-Mean-15_min-m",
               "aod": "E73839-level-tidal_level-Mean-15_min-mAOD", "emodnet": ["bang", "Bangor"]},
}

# Model points: open water 1-3 km off the coast (EOT20's cells are 1/8 degree);
# the satellite run's where it had one (scripts/satellite/stations_ni.json).
STATIONS = {
    "Portrush": {"name": "Portrush", "lat": 55.2011, "lon": -6.6512, "model": [-6.665, 55.215],
                 "gauge": "Portrush"},
    "Ballycastle_MODELLED": {"name": "Ballycastle", "lat": 55.206, "lon": -6.242, "model": [-6.235, 55.215]},
    "Larne_MODELLED": {"name": "Larne", "lat": 54.853, "lon": -5.79, "model": [-5.775, 54.86]},
    "Bangor": {"name": "Bangor", "lat": 54.6652, "lon": -5.6705, "model": [-5.66, 54.672], "gauge": "Bangor"},
    "Portavogie_MODELLED": {"name": "Portavogie", "lat": 54.458, "lon": -5.438, "model": [-5.415, 54.46]},
    "Killard_MODELLED": {"name": "Killard Point", "lat": 54.315, "lon": -5.525, "model": [-5.495, 54.312]},
    "Strangford_MODELLED": {"name": "Strangford Lough", "lat": 54.48, "lon": -5.62,
                            "lagOf": "Killard_MODELLED", "lagMinutes": 100},
    "Ardglass_MODELLED": {"name": "Ardglass", "lat": 54.262, "lon": -5.607, "model": [-5.58, 54.25]},
    "Dundrum_Bay_MODELLED": {"name": "Dundrum Bay", "lat": 54.225, "lon": -5.83, "model": [-5.80, 54.215]},
}
# Validation only: the Marine Institute's stations beside Northern Ireland, at
# the points the satellite run modelled them (its calibration's `model`).
TESTS = {
    "Malin_Head": {"model": [-7.33432, 55.37168], "miGauge": "Malin Head - Portmore Pier"},
    "Port_Oriel": {"model": [-6.221713, 53.79899]},
    "Howth": {"model": [-6.068, 53.391], "miGauge": "Howth Water Level 1"},
    "Skerries": {"model": [-6.108117, 53.585]},
}
# A 29-day record separates these (Rayleigh: a cycle apart over its length; MU2
# and L2 at 0.92 of one, kept because in these shallow seas MU2 carries 2MS2's
# shallow-water tide, which no inference from N2 gives: validation.json).
# MSF is left out: over one month it takes up the weather's fortnightly swings.
SOLVED = ["M2", "S2", "N2", "MU2", "L2", "K1", "O1", "Q1", "MO3", "M3", "MK3", "MN4", "M4", "MS4",
          "2MN6", "M6", "2MS6", "M8"]
# ... and ties these to a solved parent with EOT20's ratio and phase difference there.
INFERRED = {"K2": "S2", "T2": "S2", "R2": "S2", "ETA2": "S2",
            "P1": "K1", "S1": "K1", "PI1": "K1", "PSI1": "K1", "PHI1": "K1", "J1": "K1",
            "OO1": "K1", "THETA1": "K1", "CHI1": "K1", "M1": "O1",
            "2Q1": "Q1", "SIGMA1": "Q1", "RHO1": "Q1",
            "NU2": "N2", "2N2": "N2", "EPS2": "N2",
            "L2B": "M2", "LAMBDA2": "M2"}
FIXED = ["SA", "SSA", "MM", "MF"]
MIN_AMPLITUDE = 0.0005


def epoch(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")


def get(url, timeout=300):
    import requests
    for attempt in range(5):
        try:
            r = requests.get(url, timeout=(20, timeout), headers={"User-Agent": UA})
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.text
        except Exception as error:
            if attempt == 4:
                raise
            print(f"  retry {attempt + 1}: {error!r}"[:160], flush=True)
            time.sleep(3 * 2 ** attempt)


def save(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".part", "w") as fh:
        fh.write(text)
    os.replace(path + ".part", path)


def csv_series(path, value_col=1, flag_col=None, good=None, valid=(-3.0, 9.0)):
    """(epoch seconds, level) from an ERDDAP csv (two header lines)."""
    t, v = [], []
    if not os.path.exists(path):
        return np.empty(0), np.empty(0)
    with open(path) as fh:
        lines = fh.read().splitlines()[2:]
    for line in lines:
        row = line.split(",")
        try:
            value = float(row[value_col])
        except (ValueError, IndexError):
            continue
        if not np.isfinite(value) or not valid[0] < value < valid[1]:
            continue
        if good is not None and flag_col is not None and row[flag_col] not in good:
            continue
        t.append(epoch(row[0]))
        v.append(value)
    if not t:
        return np.empty(0), np.empty(0)
    order = np.argsort(t)
    t, v = np.asarray(t)[order], np.asarray(v)[order]
    keep = np.concatenate([[True], np.diff(t) > 0])
    return t[keep], v[keep]


# ---- fetch ---------------------------------------------------------------------


def fetch(data):
    d = os.path.join(data, "downloads")
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=31)).strftime("%Y-%m-%dT00:00:00Z")
    for gauge, ids in GAUGES.items():
        for which in ("local", "aod"):
            text = get(f"{EA}/{ids[which]}/readings?since={since}&_sorted&_limit=10000")
            doc = json.loads(text)
            if doc.get("meta", {}).get("licence", "").rstrip("/") != OGL.rstrip("/").replace("https://", "http://"):
                print(f"  {gauge} {which}: licence is {doc.get('meta', {}).get('licence')}", file=sys.stderr)
            items = [i for i in doc["items"] if isinstance(i.get("value"), (int, float))]
            stamp = now.strftime("%Y%m%d")
            save(os.path.join(d, "ea", f"{ids[which]}-{stamp}.json"), json.dumps(
                {"licence": doc["meta"].get("licence"), "fetched": now.isoformat(), "items": items}))
            print(f"  EA {gauge} {which}: {len(items)} readings {items[-1]['dateTime']} .. {items[0]['dateTime']}")
    # Validation: the same gauges' hourly record, and the Marine Institute's series.
    for gauge, ids in GAUGES.items():
        for platform in ids["emodnet"]:
            path = os.path.join(d, "emodnet", f"{platform}.csv")
            if not os.path.exists(path):
                text = get(f"{EMODNET}.csv?time,SLEV,SLEV_QC&PLATFORMCODE={quote(chr(34) + platform + chr(34))}"
                           f"&time{quote('>=')}2012-01-01T00:00:00Z", timeout=900)
                save(path, text or "")
                print(f"  EMODnet {platform}: {len((text or '').splitlines())} lines")
    for sid, test in TESTS.items():
        path = os.path.join(d, "mi", f"pred-{sid}.csv")
        if not os.path.exists(path):
            text = get(f"{MI}/imiTidePrediction.csv?time,Water_Level&stationID={quote(chr(34) + sid + chr(34))}"
                       f"&time{quote('>=')}2026-01-01T00:00:00Z&time{quote('<')}2026-10-01T00:00:00Z")
            if text:
                save(path, text)
            print(f"  MI prediction {sid}: {'ok' if text else 'unavailable'}")
        if test.get("miGauge"):
            for year in (2025, 2026):
                path = os.path.join(d, "mi", f"gauge-{sid}-{year}.csv")
                if os.path.exists(path):
                    continue
                text = get(f"{MI}/IrishNationalTideGaugeNetwork.csv?time,Water_Level_LAT,QC_Flag"
                           f"&station_id={quote(chr(34) + test['miGauge'] + chr(34))}"
                           f"&time{quote('>=')}{year}-01-01T00:00:00Z&time{quote('<')}{year + 1}-01-01T00:00:00Z")
                if text:
                    save(path, text)
                print(f"  MI gauge {sid} {year}: {'ok' if text else 'unavailable'}")


def ea_series(data, gauge, which, since=None):
    """Every EA reading fetched so far for one measure, merged by time."""
    d = os.path.join(data, "downloads", "ea")
    readings = {}
    for f in sorted(os.listdir(d)):
        if f.startswith(GAUGES[gauge][which]) and f.endswith(".json"):
            for item in json.load(open(os.path.join(d, f)))["items"]:
                readings[epoch(item["dateTime"])] = float(item["value"])
    t = np.array(sorted(readings))
    v = np.array([readings[k] for k in t])
    # The gauge's dropouts read exactly 0 above chart datum (Portrush: 360 of a month's
    # readings) and its stuck spells repeat one value; neither is the sea.
    stuck = np.zeros(len(v), bool)
    for i in range(len(v) - 3):
        if v[i] == v[i + 1] == v[i + 2] == v[i + 3]:
            stuck[i:i + 4] = True
    zero = v == 0.0 if which == "local" else np.zeros(len(v), bool)
    keep = ~stuck & ~zero
    t, v = t[keep], v[keep]
    if since is not None:
        keep = t >= since
        t, v = t[keep], v[keep]
    return t, v


# ---- EOT20 ---------------------------------------------------------------------


def eot20(data, directory):
    """EOT20's constants at every model point: a two-year hourly pyTMD
    prediction there (minor constituents inferred), analysed."""
    import pyTMD.compute
    points = {sid: s["model"] for sid, s in STATIONS.items() if "model" in s}
    points.update({sid: s["model"] for sid, s in TESTS.items()})
    out_path = os.path.join(data, "work", "eot20.json")
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    t = np.arange(np.datetime64(EOT20_FROM), np.datetime64(EOT20_TO), np.timedelta64(1, "h"))
    secs = (t - np.datetime64("1970-01-01T00:00:00")).astype("timedelta64[s]").astype(float)
    for sid, (lon, lat) in points.items():
        if sid in out and out[sid]["model"] == [lon, lat]:
            continue
        z = pyTMD.compute.tide_elevations(np.array([lon]), np.array([lat]), t, directory=directory,
                                          model="EOT20", type="time series", standard="datetime",
                                          extrapolate=True, cutoff=40, crop=True,
                                          bounds=[lon % 360 - 1, lon % 360 + 1, lat - 1, lat + 1])
        z = np.asarray(z, dtype=float).ravel()
        if not np.isfinite(z).all():
            raise SystemExit(f"{sid}: EOT20 has no value at {lon}, {lat}")
        constants, z0, residual = harmonics.analyse(secs, z, list(harmonics.CONSTITUENTS))
        out[sid] = {"model": [lon, lat], "z0": z0, "fitRms": float(np.sqrt(np.mean(residual ** 2))),
                    "constituents": {k: [round(a, 5), round(g, 2)] for k, (a, g) in constants.items()}}
        print(f"  {sid}: M2 {constants['M2'][0]:.3f} m {constants['M2'][1]:.1f} deg, "
              f"fit {out[sid]['fitRms'] * 1000:.1f} mm", flush=True)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w") as fh:
            json.dump(out, fh, indent=1)
    return out


# ---- constants -----------------------------------------------------------------


def tidy(constants):
    return {k: [round(float(a), 4), round(float(g) % 360.0, 2)]
            for k, (a, g) in sorted(constants.items(), key=lambda kv: -kv[1][0]) if a >= MIN_AMPLITUDE}


def datum(constants):
    """z0 (mean level above LAT) and HAT above LAT, over a nodal cycle."""
    lo, hi = harmonics.lowest_and_highest({k: tuple(v) for k, v in constants.items()}, 0.0,
                                          DATUM_FROM.timestamp(), NODAL_YEARS)
    return -lo, hi - lo


def month_analysis(t, v, reference):
    """29-day analysis with inference and fixed long periods from `reference`
    (EOT20 constants at the place). Two passes: spikes off the first fit by more
    than MAX_RESIDUAL are dropped."""
    ref = {k: tuple(x) for k, x in reference["constituents"].items()}
    inferred = {}
    for child, parent in INFERRED.items():
        if child in ref and parent in ref and ref[parent][0] > 0:
            inferred[child] = (parent, ref[child][0] / ref[parent][0], (ref[child][1] - ref[parent][1]) % 360)
    fixed = {k: ref[k] for k in FIXED if k in ref}
    keep = np.ones(len(t), bool)
    for _ in range(2):
        constants, z0, residual = harmonics.analyse(t[keep], v[keep], SOLVED, inferred, fixed)
        full = v - harmonics.predict(constants, z0, t)
        keep = np.abs(full) < MAX_RESIDUAL
    constants, z0, residual = harmonics.analyse(t[keep], v[keep], SOLVED, inferred, fixed)
    return constants, z0, residual, keep


def build_constants(data, since=None):
    ref = json.load(open(os.path.join(data, "work", "eot20.json")))
    stations = {}
    for sid, s in STATIONS.items():
        entry = {"name": s["name"], "lat": s["lat"], "lon": s["lon"]}
        if s.get("lagOf"):
            parent = STATIONS[s["lagOf"]]
            entry.update({
                "modelled": True, "kind": "lag", "lagOf": s["lagOf"], "lagMinutes": s["lagMinutes"],
                "method": (f"{parent['name']}'s predicted tide {s['lagMinutes']} minutes later: the lag the "
                           "satellite run read off the lough's flats (Sentinel-2 looks, scripts/satellite/lag.py: "
                           "the median misfit of the flats' wet and dry looks falls from 0.26 at no lag to 0.065 "
                           "at 100 minutes). Heights and datum are Killard Point's: no open gauge inside the "
                           "Narrows says how much smaller the lough's range is."),
                "attribution": f"Tidal predictions by wingfoil.ie from the {EOT20_CREDIT}, lagged for the lough "
                               "from Copernicus Sentinel-2 imagery",
                "licenseUrl": CCBY, "sourceUrl": EOT20_DOI,
            })
            stations[sid] = entry
            continue
        model = ref[sid]
        if s.get("gauge"):
            gauge = s["gauge"]
            t, v = ea_series(data, gauge, "local", since)
            ta, va = ea_series(data, gauge, "aod", since)
            both = np.intersect1d(t, ta)
            offset = np.median(v[np.isin(t, both)] - va[np.isin(ta, both)])
            constants, z0_cd, residual, keep = month_analysis(t, v, model)
            spikes, used = int((~keep).sum()), t[keep]
            z0, hat = datum(tidy(constants))
            entry.update({
                "modelled": False, "kind": "gauge",
                "method": (f"Harmonic analysis of the Environment Agency's 15-minute levels at the "
                           f"{s['name']} gauge, {iso(used[0])[:16]}Z to {iso(used[-1])[:16]}Z "
                           f"({(used[-1] - used[0]) / 86400:.1f} days, {len(used)} readings; {spikes} spikes and "
                           "the gauge's dropouts left out), solving {', '.join(SOLVED)}; the rest inferred from "
                           "EOT20's ratios to them at the gauge, and SA, SSA, MM and MF taken from EOT20."),
                "gauge": {"provider": "Environment Agency (UK National Tide Gauge Network)",
                          "measure": f"{EA}/{GAUGES[gauge]['local']}", "from": iso(used[0]), "to": iso(used[-1]),
                          "readings": int(len(used)), "residualRmsMetres": round(float(np.sqrt(np.mean(residual ** 2))), 3),
                          "chartDatumAboveOrdnanceDatumMetres": round(float(-offset), 3),
                          "meanLevelAboveChartDatumMetres": round(z0_cd, 3)},
                "attribution": f"Tidal predictions by wingfoil.ie from {EA_CREDIT} and the {EOT20_CREDIT}",
                "licenseUrl": OGL, "sourceUrl": f"{EA}/{GAUGES[gauge]['local']}",
            })
        else:
            constants = {k: tuple(x) for k, x in model["constituents"].items()}
            z0, hat = datum(tidy(constants))
            entry.update({
                "modelled": True, "kind": "model", "model": model["model"],
                "method": (f"EOT20 at {model['model'][1]:.3f} N {abs(model['model'][0]):.3f} W: its constants "
                           "read off a two-year pyTMD prediction there (minor constituents inferred) by "
                           f"harmonic analysis (fit {model['fitRms'] * 1000:.1f} mm RMS)."),
                "attribution": f"Tidal predictions by wingfoil.ie from the {EOT20_CREDIT}",
                "licenseUrl": CCBY, "sourceUrl": EOT20_DOI,
            })
        entry.update({"z0": round(z0, 4), "hatMetres": round(hat, 3), "constituents": tidy(constants)})
        if s.get("gauge"):
            # Chart datum against this LAT, from the month's mean level: weather moves it by a decimetre or so.
            entry["gauge"]["chartDatumAboveLatMetres"] = round(z0 - z0_cd, 3)
        stations[sid] = entry
        print(f"  {sid}: z0 {z0:.3f} HAT {hat:.3f} M2 {entry['constituents']['M2']}", flush=True)
    doc = {
        "about": ("Tide stations for Northern Ireland, which the Marine Institute does not predict "
                  "(scripts/tides/build_ni.py). Harmonic constants (amplitude metres, Greenwich phase lag "
                  "degrees) predicted by force5/ingest/harmonics.py; the gauges' from a month of the "
                  "Environment Agency's open levels, the rest from EOT20. Validation: scripts/tides/validation.json."),
        "datum": (f"LAT: each station's z0 is its mean level above the lowest level its constants predict "
                  f"every 10 minutes over the {NODAL_YEARS} years from {DATUM_FROM.date()} (a full nodal cycle)."),
        "generatedAt": datetime.now(timezone.utc).isoformat()[:19] + "Z",
        "sources": {
            "Environment Agency": {"what": "Portrush and Bangor gauge levels, 15-minute, chart datum and mAOD",
                                   "url": "https://environment.data.gov.uk/flood-monitoring/doc/tidegauge",
                                   "licence": OGL,
                                   "attribution": "This uses Environment Agency flood and river level data from "
                                                  "the real-time data API (Beta). Contains public sector "
                                                  "information licensed under the Open Government Licence v3.0."},
            "EOT20": {"what": "Global ocean tide model, 1/8 degree, 17 constituents (pyTMD infers the minor ones)",
                      "url": EOT20_DOI, "licence": CCBY,
                      "attribution": "Hart-Davis, M. G., Piccioni, G., Dettmering, D., Schwatke, C., Passaro, M., "
                                     "Seitz, F. (2021): EOT20: a global ocean tide model from multi-mission "
                                     "satellite altimetry. Earth System Science Data 13, 3869-3884."},
            "Sentinel-2": {"what": "Strangford Lough's lag behind Killard Point, read off the imagery",
                           "url": "https://sentinels.copernicus.eu/",
                           "attribution": "Contains modified Copernicus Sentinel data"},
        },
        "stations": stations,
    }
    with open(OUT, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    print(f"wrote {OUT}")
    return doc


# ---- validation ----------------------------------------------------------------


def predictor(entry):
    constants = {k: tuple(v) for k, v in entry["constituents"].items()}
    return lambda t: harmonics.predict(constants, entry["z0"], np.asarray(t, float))


def events_of(fn, t0, t1):
    t = np.arange(t0, t1, 60.0)
    z = fn(t)
    return [(t[i], kind, z[i]) for i, kind in harmonics.extremes(t, z)]


def observed_extreme(t, v, at, kind, half_window):
    """The time and height of a turn in a sampled series near `at`: the sample
    extreme within 3 h, then a parabola through the samples within half_window."""
    near = (t > at - 3 * 3600) & (t < at + 3 * 3600)
    if near.sum() < 5:
        return None
    tn, vn = t[near], v[near]
    k = int(np.argmax(vn) if kind == "high" else np.argmin(vn))
    if k == 0 or k == len(tn) - 1:
        return None
    sel = np.abs(tn - tn[k]) <= half_window
    if sel.sum() < 3:
        return None
    x = (tn[sel] - tn[k]) / 3600.0
    a, b, c = np.polyfit(x, vn[sel], 2)
    if (kind == "high" and a >= 0) or (kind == "low" and a <= 0):
        return None
    peak = -b / (2 * a)
    if abs(peak) > half_window / 3600.0:
        return None
    return tn[k] + peak * 3600.0, c - b * b / (4 * a)


def stats(errors):
    e = np.asarray(errors, float)
    if not len(e):
        return None
    return {"n": int(len(e)), "mean": round(float(e.mean()), 3), "rms": round(float(np.sqrt(np.mean(e ** 2))), 3),
            "meanAbs": round(float(np.mean(np.abs(e))), 3), "p95Abs": round(float(np.percentile(np.abs(e), 95)), 3)}


def against_series(fn, t, v, step_seconds, label):
    """Levels and turns of a prediction against a sampled series (observed or
    another prediction). Heights: the series' mean offset is removed first and
    reported as the datum difference."""
    p = fn(t)
    d = v - p
    ok = np.abs(d - np.median(d)) < MAX_RESIDUAL  # gauge spikes and datum steps
    t, v, p, d = t[ok], v[ok], p[ok], d[ok]
    offset = float(np.mean(d))
    out = {"label": label, "from": iso(t[0]), "to": iso(t[-1]), "samples": int(len(t)),
           "datumOffsetMetres": round(offset, 3),
           "heightRmsMetres": round(float(np.sqrt(np.mean((d - offset) ** 2))), 3)}
    half = max(2700.0, 1.5 * step_seconds)
    times = {"high": [], "low": []}
    heights = {"high": [], "low": []}
    for at, kind, h in events_of(fn, t[0] + 3 * 3600, t[-1] - 3 * 3600):
        found = observed_extreme(t, v, at, kind, half)
        if found:
            times[kind].append((found[0] - at) / 60.0)
            heights[kind].append(found[1] - offset - h)
    for kind in ("high", "low"):
        out[f"{kind}TimeMinutes"] = stats(times[kind])
        out[f"{kind}HeightMetres"] = stats(heights[kind])
    return out


def mi_month(data, sid):
    """The latest 29.3 days of the Marine Institute's gauge (LAT), QC flags 0/1."""
    ts, vs = [], []
    for year in (2025, 2026):
        t, v = csv_series(os.path.join(data, "downloads", "mi", f"gauge-{sid}-{year}.csv"),
                          flag_col=2, good=("0", "1", ""))
        ts.append(t)
        vs.append(v)
    t, v = np.concatenate(ts), np.concatenate(vs)
    return t, v


def validate(data):
    ref = json.load(open(os.path.join(data, "work", "eot20.json")))
    built = json.load(open(OUT))["stations"]
    eot20_entry = {}
    for sid in ref:
        constants = {k: tuple(x) for k, x in ref[sid]["constituents"].items()}
        z0, _ = datum(constants)
        eot20_entry[sid] = {"constituents": ref[sid]["constituents"], "z0": z0}
    results = {}
    # 1. The NI gauges: the published constants (one EA month) and EOT20 alone,
    #    against the gauges' own hourly record 2012-2024, years before that month.
    for sid in GAUGES:
        series = []
        for platform in GAUGES[sid]["emodnet"]:
            series.append(csv_series(os.path.join(data, "downloads", "emodnet", f"{platform}.csv"),
                                     flag_col=2, good=("0", "1", "2"), valid=(-1.0, 7.0)))
        # The longer-running platform code first; the other only where it adds hours.
        t, v = series[0]
        for t2, v2 in series[1:]:
            extra = ~np.isin(np.round(t2 / 3600), np.round(t / 3600))
            t, v = np.concatenate([t, t2[extra]]), np.concatenate([v, v2[extra]])
            order = np.argsort(t)
            t, v = t[order], v[order]
        hourly = np.mod(t, 3600) == 0
        t, v = t[hourly], v[hourly]
        res = {"published": against_series(predictor(built[sid]), t, v, 3600, "observed, hourly (EMODnet)"),
               "eot20Only": against_series(predictor(eot20_entry[sid]), t, v, 3600, "observed, hourly (EMODnet)")}
        # What the weather leaves: a full analysis of the record against itself.
        last = t >= t[-1] - 4 * 365.25 * 86400
        own, z0, _ = harmonics.analyse(t[last], v[last], list(harmonics.CONSTITUENTS))
        res["ownFourYearAnalysis"] = against_series(lambda x: harmonics.predict(own, z0, x), t[last], v[last], 3600,
                                                    "observed, hourly, in sample (the weather's floor)")
        # The published constants against that long analysis, 2026-2028: method error alone.
        tt = np.arange(DATUM_FROM.timestamp(), DATUM_FROM.timestamp() + 2 * 365.25 * 86400, 600.0)
        res["publishedVsFourYearAnalysis"] = against_series(
            predictor(built[sid]), tt, harmonics.predict(own, z0, tt), 600,
            "four-year analysis of the hourly record, predicted 2026-2027")
        # The gauge's chart datum against the published LAT: the record's mean offset.
        res["chartDatumAboveLatMetres"] = round(-res["published"]["datumOffsetMetres"], 3)
        results[sid] = res
        print(sid, json.dumps(res, indent=1), flush=True)
    # 2. The Marine Institute's stations: the same methods against its predictions.
    for sid, test in TESTS.items():
        t, v = csv_series(os.path.join(data, "downloads", "mi", f"pred-{sid}.csv"))
        if not len(t):
            continue
        res = {"eot20Only": against_series(predictor(eot20_entry[sid]), t, v, 300,
                                           "Marine Institute prediction, 5-minute (imiTidePrediction)")}
        if test.get("miGauge"):
            gt, gv = mi_month(data, sid)
            month = gt >= gt[-1] - 29.3 * 86400
            constants, z0_cd, residual, _ = month_analysis(gt[month], gv[month], ref[sid])
            z0, _ = datum(tidy(constants))
            entry = {"constituents": tidy(constants), "z0": z0}
            label = f"Marine Institute prediction; constants from its gauge {iso(gt[month][0])[:10]} to {iso(gt[month][-1])[:10]}"
            before = t < gt[month][0]
            res["gaugeMonth"] = against_series(predictor(entry), t[before], v[before], 300, label)
            year = (gt >= epoch("2025-01-01T00:00:00Z")) & (gt < epoch("2026-01-01T00:00:00Z"))
            if year.sum() > 1000:
                res["gaugeMonthVsObserved2025"] = against_series(predictor(entry), gt[year], gv[year], 300,
                                                                 "Marine Institute gauge 2025, 5-minute")
        results[sid] = res
        print(sid, json.dumps(res, indent=1), flush=True)
    doc = {"generatedAt": datetime.now(timezone.utc).isoformat()[:19] + "Z",
           "method": ("heightRmsMetres: RMS of series minus prediction after removing their mean difference "
                      "(datumOffsetMetres, series minus prediction). Turn times: each predicted high or low water "
                      "against the series' own turn (a parabola through its samples within 45 minutes, or 1.5 "
                      "steps), minutes, series minus prediction. Observed series carry the weather; the "
                      "ownFourYearAnalysis line is what a full analysis of the record leaves against itself."),
           "results": results}
    with open(VALIDATION, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    print(f"wrote {VALIDATION}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True, help="Working directory for downloads and work files")
    sub = parser.add_subparsers(dest="step", required=True)
    sub.add_parser("fetch")
    e = sub.add_parser("eot20")
    e.add_argument("--eot20", required=True, help="pyTMD directory holding EOT20/ocean_tides/*.nc")
    c = sub.add_parser("constants")
    c.add_argument("--since", help="Analyse EA readings from this date (default: every month fetched)")
    sub.add_parser("validate")
    args = parser.parse_args()
    if args.step == "fetch":
        fetch(args.data)
    elif args.step == "eot20":
        eot20(args.data, args.eot20)
    elif args.step == "constants":
        build_constants(args.data, epoch(args.since + "T00:00:00Z") if args.since else None)
    else:
        validate(args.data)


if __name__ == "__main__":
    main()
