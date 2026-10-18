"""Northern Ireland's tide predictions, from committed harmonic constants.

The Marine Institute has no station in Northern Ireland. Its stations here are
our own: harmonic constants per station in tide_stations_ni.json (made once by
scripts/tides/build_ni.py: the Environment Agency's open gauges at Portrush
and Bangor, and the EOT20 ocean tide model elsewhere), and the curve and high
and low waters predicted from them at ingest in plain numpy (harmonics.py).
Heights are metres above each station's Lowest Astronomical Tide, the lowest
level its constants predict over a full 18.6-year nodal cycle.

    python tides_ni.py levels [--from 2026-01-01 --to 2029-01-01]

prints each station's mean sea level, mean high and low water, highest and
lowest predicted level over the window, in the layout of
scripts/foildepth/stations.json, for the foil-depth build.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys

import numpy as np

import harmonics

CONSTANTS = Path(__file__).with_name("tide_stations_ni.json")
EVENT_STEP_MINUTES = 1


def load(path=CONSTANTS):
    doc = json.loads(Path(path).read_text())
    stations = doc.get("stations")
    if not isinstance(stations, dict) or not stations:
        raise ValueError(f"{path}: no stations")
    for identifier, station in stations.items():
        if station.get("lagOf"):
            if station["lagOf"] not in stations or stations[station["lagOf"]].get("lagOf"):
                raise ValueError(f"{identifier}: lags an unknown station or another lag")
            continue
        constituents = station.get("constituents")
        if not isinstance(constituents, dict) or "M2" not in constituents:
            raise ValueError(f"{identifier}: no harmonic constants")
        unknown = set(constituents) - set(harmonics.CONSTITUENTS)
        if unknown:
            raise ValueError(f"{identifier}: unknown constituents {sorted(unknown)}")
    return doc


def _base(stations, identifier):
    """The station whose constants give this one's curve, and the lag in seconds."""
    station = stations[identifier]
    if station.get("lagOf"):
        return stations[station["lagOf"]], float(station["lagMinutes"]) * 60.0
    return station, 0.0


def heights(stations, identifier, epoch_seconds):
    """Metres above the station's LAT at each time."""
    base, lag = _base(stations, identifier)
    constituents = {name: tuple(value) for name, value in base["constituents"].items()}
    return harmonics.predict(constituents, base["z0"], np.asarray(epoch_seconds, float) - lag)


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def station_series(stations, identifier, start, end, step_minutes):
    """The published curve (every step from start to end) and high/low events.

    Events are found on a one-minute curve over the window and an hour beyond
    each end, so a turn at the window's edge is not mistaken for none."""
    t0 = start.timestamp()
    count = int((end - start).total_seconds() // (step_minutes * 60)) + 1
    curve = heights(stations, identifier, t0 + np.arange(count) * step_minutes * 60.0)
    fine_t = np.arange(t0 - 3600.0, end.timestamp() + 3600.0 + 1, EVENT_STEP_MINUTES * 60.0)
    fine = heights(stations, identifier, fine_t)
    events = []
    for index, kind in harmonics.extremes(fine_t, fine):
        at = datetime.fromtimestamp(fine_t[index], timezone.utc)
        if start <= at <= end:
            events.append({"time": stamp(at), "kind": kind, "height": round(float(fine[index]), 2)})
    return [round(float(h), 2) for h in curve], events


def levels(doc, start, end):
    """MSL, MHW, MLW, the highest and the lowest predicted level per station."""
    stations = doc["stations"]
    out = {}
    t = np.arange(start.timestamp(), end.timestamp(), 600.0)
    for identifier, station in sorted(stations.items()):
        z = heights(stations, identifier, t)
        fine_t = np.arange(start.timestamp(), end.timestamp(), 60.0)
        fine = heights(stations, identifier, fine_t)
        turns = harmonics.extremes(fine_t, fine)
        highs = [fine[i] for i, kind in turns if kind == "high"]
        lows = [fine[i] for i, kind in turns if kind == "low"]
        out[identifier] = {
            "name": station["name"], "lat": station["lat"], "lon": station["lon"],
            "modelled": bool(station["modelled"]),
            "mslMetres": round(float(z.mean()), 3),
            "mhwMetres": round(float(np.mean(highs)), 3),
            "mlwMetres": round(float(np.mean(lows)), 3),
            "hatMetres": round(float(fine.max()), 3),
            "lowestMetres": round(float(fine.min()), 3),
        }
        if station.get("lagOf"):
            out[identifier].update({"lagOf": station["lagOf"], "lagMinutes": station["lagMinutes"]})
    return {
        "source": "wingfoil.ie harmonic predictions (force5/ingest/tide_stations_ni.json): "
                  "Environment Agency gauges (OGL v3) and EOT20 (DGFI-TUM, CC BY 4.0)",
        "window": [stamp(start), stamp(end)],
        "method": "Predicted every minute from the stations' harmonic constants: msl = mean; "
                  "hat/lowest = max/min; mhw/mlw = mean of the predicted high/low waters. "
                  "Metres above each station's LAT (its lowest level over 18.6 years).",
        "stations": out,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    lv = sub.add_parser("levels", help="Tide levels per station, as scripts/foildepth/stations.json has them")
    lv.add_argument("--from", dest="start", default="2026-01-01")
    lv.add_argument("--to", dest="end", default="2029-01-01")
    args = parser.parse_args()
    start = datetime.fromisoformat(args.start).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(args.end).replace(tzinfo=timezone.utc)
    if end <= start or end - start > timedelta(days=366 * 20):
        parser.error("Use a window of up to 20 years, end after start")
    json.dump(levels(load(), start, end), sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
