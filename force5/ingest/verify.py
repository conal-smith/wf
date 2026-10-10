#!/usr/bin/env python3
"""Score every wind model, and the blend riders see, against what the wind then did.

Reads only the archive (archive.py): the runs archive_forecasts.py sampled at each
observing station, and the observations it merged into daily files. A forecast
and an observation are paired when the forecast's valid time is the reading's
hour exactly; nothing is interpolated in time for a model, and a model that does
not publish that hour simply has no pair there.

For each model, each lead-time bucket (0-12, 12-24, 24-48, 48-72, 72-120 and 120+
hours after the run) and each station class (buoy, coastal, inland), and for each
station over all leads, over the last 30 and 90 complete UTC days:

- speed: count, bias (forecast minus observed), mean absolute error, RMSE;
- gust: count, bias and mean absolute error, where both sides have a gust;
- direction: mean absolute angular error, only where the observed wind is at
  least 3 m/s, because a light wind's bearing is noise;
- rideable (6 m/s, about 12 kn, on both sides): hits, misses, false alarms, the
  probability of detection (hits / observed rideable hours) and the false alarm
  ratio (false alarms / forecast rideable hours).

**The blend** is scored as model "blend": rebuilt at 00, 06, 12 and 18 UTC each day
from the newest run of each model that had been published by then (its
`generatedAt`), exactly as the site works it out (consensus.py replicates
src/ratings.ts `placeConsensus`), and its lead is hours after that issue time.
At a station an ensemble contributes its mean wind, because only its mean frames
are gridded; at a spot the site uses the mean of its members' speeds.

The scores are sums, so a day's are kept as `archive/verify/sums/YYYY-MM-DD.json`
once the day is beyond the observations' 72-hour window and can no longer change,
and only the newest days are recomputed each run. A stored day is recomputed if
the scoring or the blend replica has changed since (`sumsVersion`, `blendSignature`).
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import sys

from archive import ARCHIVE_ROOT, observation_key, open_archive, sums_key
import consensus
from consensus import BLEND_MODELS, direction, place_consensus
from fetch_forecast import ROOT, write_json
from publish_s3 import log_event, make_client
from registry import MANIFESTS

SCORES = MANIFESTS["verify"]
SCHEMA = 1
SUMS_VERSION = 1
WINDOWS = (30, 90)
LEAD_BUCKETS = ((0, 12, "0-12"), (12, 24, "12-24"), (24, 48, "24-48"),
                (48, 72, "48-72"), (72, 120, "72-120"), (120, None, "120+"))
RIDEABLE_MPS = 6.0          # About 12 knots: the wind a foil starts to ride in.
DIRECTION_MIN_MPS = 3.0     # Below this an observed bearing is mostly noise.
BLEND = "blend"
BLEND_ISSUE_HOURS = (0, 6, 12, 18)
# A day can still change while any of it is inside the observation manifest's
# 72-hour window, because the archive job is still merging those hours.
FINAL_AFTER_HOURS = 72
# How far back a run can still forecast a day: ECMWF's 15 days, plus a day.
MAX_LEAD_DAYS = 16
CLASSES = ("buoy", "coastal", "inland")
# Table order: leads shortest first, then the per-station "all".
LEAD_ORDER = {label: index for index, (_, _, label) in enumerate(LEAD_BUCKETS)}
LEAD_ORDER["all"] = len(LEAD_BUCKETS)
SUM_FIELDS = ("n", "speedErr", "speedAbs", "speedSq", "gustN", "gustErr", "gustAbs",
              "dirN", "dirAbs", "hits", "misses", "falseAlarms", "correctNegatives")
SCORE_FIELDS = ("model", "lead", "group", "n", "speedBias", "speedMae", "speedRmse",
                "gustN", "gustBias", "gustMae", "dirN", "dirMae", "hits", "misses",
                "falseAlarms", "pod", "far")
ATTRIBUTION = ("Observations: contains Met Éireann data, CC BY 4.0, and Marine Institute "
               "weather buoy data, CC BY 4.0. Forecasts: the models named, as published by "
               "their providers (see each model's attribution).")
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# --- pure scoring -------------------------------------------------------------------

def lead_bucket(hours):
    for low, high, label in LEAD_BUCKETS:
        if hours >= low and (high is None or hours < high):
            return label
    return None  # A negative lead is a hindcast, not a forecast.


def angle_difference(a, b):
    """The smaller angle between two bearings, 0..180 degrees."""
    difference = abs(a - b) % 360
    return min(difference, 360 - difference)


def empty_sums():
    return dict.fromkeys(SUM_FIELDS, 0)


def accumulate(sums, forecast, observed):
    """Add one pair. Each side is (speed, gust, direction); gust and direction may be None."""
    fc_speed, fc_gust, fc_direction = forecast
    ob_speed, ob_gust, ob_direction = observed
    error = fc_speed - ob_speed
    sums["n"] += 1
    sums["speedErr"] += error
    sums["speedAbs"] += abs(error)
    sums["speedSq"] += error * error
    if fc_gust is not None and ob_gust is not None:
        sums["gustN"] += 1
        sums["gustErr"] += fc_gust - ob_gust
        sums["gustAbs"] += abs(fc_gust - ob_gust)
    if ob_speed >= DIRECTION_MIN_MPS and ob_direction is not None and fc_direction is not None:
        sums["dirN"] += 1
        sums["dirAbs"] += angle_difference(fc_direction, ob_direction)
    rides, forecast_rides = ob_speed >= RIDEABLE_MPS, fc_speed >= RIDEABLE_MPS
    key = {(True, True): "hits", (True, False): "misses", (False, True): "falseAlarms",
           (False, False): "correctNegatives"}[(rides, forecast_rides)]
    sums[key] += 1
    return sums


def add_sums(target, source):
    for field in SUM_FIELDS:
        target[field] += source[field]
    return target


def ratio(top, bottom, digits=2):
    return round(top / bottom, digits) if bottom else None


def metrics(sums):
    """The published scores from additive sums. None wherever there is nothing to score."""
    n = sums["n"]
    return {"n": n, "speedBias": ratio(sums["speedErr"], n), "speedMae": ratio(sums["speedAbs"], n),
            "speedRmse": round(math.sqrt(sums["speedSq"] / n), 2) if n else None,
            "gustN": sums["gustN"], "gustBias": ratio(sums["gustErr"], sums["gustN"]),
            "gustMae": ratio(sums["gustAbs"], sums["gustN"]),
            "dirN": sums["dirN"], "dirMae": ratio(sums["dirAbs"], sums["dirN"], 1),
            "hits": sums["hits"], "misses": sums["misses"], "falseAlarms": sums["falseAlarms"],
            "pod": ratio(sums["hits"], sums["hits"] + sums["misses"], 3),
            "far": ratio(sums["falseAlarms"], sums["hits"] + sums["falseAlarms"], 3)}


def wind_triple(u, v, gust):
    """(speed, gust, direction) from a forecast's u/v/gust; no bearing for a dead calm."""
    speed = math.hypot(u, v)
    return speed, gust, direction(u, v) if speed > 0 else None


# --- the archive, read --------------------------------------------------------------

def observed_hours(document):
    """{station: {hour ISO: (speed, gust, direction)}} from one archived day.

    Only readings at the top of the hour are kept: they are the ones a forecast's
    valid time can match exactly.
    """
    hours = {}
    for station, rows in (document or {}).get("readings", {}).items():
        for time, speed, gust, heading in rows:
            if speed is None or not time.endswith(":00:00Z"):
                continue
            hours.setdefault(station, {})[time] = (speed, gust, heading)
    return hours


def run_time_of(key):
    """The run's own time from its archive key, archive/forecasts/<model>/<YYYYMMDDHH>.json."""
    return datetime.strptime(key.rsplit("/", 1)[1][:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)


def station_record(record):
    """Only what verification reads of an archived run: the stations, and when it was out."""
    available = record.get("generatedAt") or record.get("archivedAt")
    return {"model": record["model"], "run": record["run"], "runTime": moment(record["runTime"]),
            "available": moment(available) if available else moment(record["runTime"]),
            "resolutionKm": record.get("resolutionKm"), "hours": record.get("hours") or [],
            "stations": record.get("stations") or {}}


def model_pairs(record, observed, day):
    """(lead hours, station, forecast triple, observed triple) for every match on `day`."""
    for index, hour in enumerate(record["hours"]):
        valid = record["runTime"] + timedelta(hours=hour)
        key = stamp(valid)
        if key[:10] != day:
            continue
        for station, series in record["stations"].items():
            observation = observed.get(station, {}).get(key)
            u, v = series["u"][index], series["v"][index]
            if observation is None or u is None or v is None:
                continue
            yield hour, station, wind_triple(u, v, series["gust"][index]), observation


def blend_members(records, issue):
    """The run of each blended model a rider would have been shown at `issue`."""
    chosen = {}
    for record in records:
        if record["model"] not in BLEND_MODELS:
            continue
        if record["available"] > issue or record["runTime"] > issue:
            continue
        best = chosen.get(record["model"])
        if best is None or record["runTime"] > best["runTime"]:
            chosen[record["model"]] = record
    return list(chosen.values())


def station_manifest(record, station):
    """An archived run at one station, shaped as the blend reads a manifest's spot."""
    series = record["stations"].get(station)
    points = [] if series is None else [
        {"validTime": stamp(record["runTime"] + timedelta(hours=hour)),
         "u": series["u"][i], "v": series["v"][i], "gust": series["gust"][i]}
        for i, hour in enumerate(record["hours"])]
    return {"model": record["model"], "resolutionKm": record["resolutionKm"],
            "spotForecasts": {station: points} if points else {}}


def blend_pairs(records, observed, day):
    """(lead hours, station, blend triple, observed triple) for the blend issued 4x daily."""
    shaped = {}  # One run at one station is the same input at every issue time.
    start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    hours = [start + timedelta(hours=h) for h in range(24)]
    issue = (start - timedelta(days=MAX_LEAD_DAYS)).replace(hour=0)
    while issue < end:
        if issue.hour in BLEND_ISSUE_HOURS:
            members = blend_members(records, issue)
            axis = [time for time in hours if time >= issue]
            if members and axis:
                labels = [stamp(time) for time in axis]
                for station, readings in observed.items():
                    if not any(label in readings for label in labels):
                        continue
                    manifests = [shaped.setdefault((id(record), station),
                                                   station_manifest(record, station))
                                 for record in members]
                    blended = place_consensus(manifests, BLEND_MODELS, station, labels)
                    for column, label in enumerate(labels):
                        observation = readings.get(label)
                        speed = blended["median"][column]
                        if observation is None or speed is None:
                            continue
                        lead = (axis[column] - issue).total_seconds() / 3600
                        yield lead, station, (speed, blended["gust"][column],
                                              blended["from"][column]), observation
        issue += timedelta(hours=6)


def day_sums(day, records, observed):
    """{(model, lead bucket, station): sums} for one UTC day."""
    cells = {}

    def add(model, lead, station, forecast, observation):
        bucket = lead_bucket(lead)
        if bucket is None:
            return
        accumulate(cells.setdefault((model, bucket, station), empty_sums()), forecast, observation)

    for record in records:
        for lead, station, forecast, observation in model_pairs(record, observed, day):
            add(record["model"], lead, station, forecast, observation)
    for lead, station, forecast, observation in blend_pairs(records, observed, day):
        add(BLEND, lead, station, forecast, observation)
    return cells


def blend_signature():
    """Changes whenever the scoring or the replicated blend would score differently."""
    probe = [consensus.blend_weight(km) for km in (1, 2.5, 3, 5, 8, 9, 25, None)]
    material = json.dumps([SUMS_VERSION, list(BLEND_MODELS), probe, list(BLEND_ISSUE_HOURS),
                           RIDEABLE_MPS, DIRECTION_MIN_MPS, [b[2] for b in LEAD_BUCKETS]])
    return hashlib.sha256(material.encode()).hexdigest()[:16]


def sums_document(day, cells, stations, now, runs, observations):
    rows = [[model, bucket, station, *[round(sums[f], 4) if isinstance(sums[f], float) else sums[f]
                                       for f in SUM_FIELDS]]
            for (model, bucket, station), sums in sorted(cells.items())]
    return {"schemaVersion": SCHEMA, "date": day, "sumsVersion": SUMS_VERSION,
            "blendSignature": blend_signature(), "computedAt": stamp(now),
            "fields": ["model", "lead", "station", *SUM_FIELDS], "cells": rows,
            "stations": stations, "runs": runs, "observations": observations}


def cells_of(document):
    cells = {}
    for row in document.get("cells", []):
        cells[tuple(row[:3])] = dict(zip(SUM_FIELDS, row[3:]))
    return cells


def up_to_date(document):
    return bool(document) and document.get("sumsVersion") == SUMS_VERSION \
        and document.get("blendSignature") == blend_signature()


# --- the job --------------------------------------------------------------------------

class Runs:
    """The archived runs, loaded on demand and dropped once too old for the day at hand."""

    def __init__(self, store):
        self.store = store
        self.keys = [key for key in store.keys(f"{ARCHIVE_ROOT}/forecasts")
                     if key.count("/") == 3]
        self.loaded = {}

    def for_day(self, day):
        start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
        earliest, end = start - timedelta(days=MAX_LEAD_DAYS), start + timedelta(days=1)
        for key in list(self.loaded):
            if run_time_of(key) < earliest:
                del self.loaded[key]
        wanted = [key for key in self.keys if earliest <= run_time_of(key) < end]
        for key in wanted:
            if key not in self.loaded:
                try:
                    self.loaded[key] = station_record(self.store.read(key))
                except Exception as error:
                    log_event("verify_run_unreadable", key=key, error=error)
                    self.loaded[key] = None
        return [self.loaded[key] for key in wanted if self.loaded[key] is not None]


def score_days(store, now, days=max(WINDOWS)):
    """{day: (cells, stations)} for each complete day in the window that has observations."""
    yesterday = (now - timedelta(days=1)).date()
    first = yesterday - timedelta(days=days - 1)
    runs, results, stored, computed = Runs(store), {}, 0, 0
    for offset in range(days):
        day = (first + timedelta(days=offset)).isoformat()
        final = now - (datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
                       + timedelta(days=1)) >= timedelta(hours=FINAL_AFTER_HOURS)
        if final:
            cached = store.read(sums_key(day))
            if up_to_date(cached):
                results[day] = (cells_of(cached), cached.get("stations") or {})
                stored += 1
                continue
        observations = store.read(observation_key(day))
        if not observations:
            continue  # Before the archive began, or a day nothing was observed.
        observed = observed_hours(observations)
        records = runs.for_day(day)
        cells = day_sums(day, records, observed)
        stations = observations.get("stations") or {}
        results[day] = (cells, stations)
        computed += 1
        if final:
            document = sums_document(day, cells, stations, now, len(records),
                                     sum(len(hours) for hours in observed.values()))
            store.merge(sums_key(day), lambda existing, d=document: d)
    log_event("verify_days", days=len(results), fromStore=stored, computed=computed)
    return results


def tables(results, now, window):
    """byClass and byStation rows over the last `window` days of `results`."""
    cutoff = ((now - timedelta(days=1)).date() - timedelta(days=window - 1)).isoformat()
    stations, by_class, by_station = {}, {}, {}
    for day, (cells, day_stations) in results.items():
        if day < cutoff:
            continue
        stations.update(day_stations)
    for day, (cells, _) in results.items():
        if day < cutoff:
            continue
        for (model, bucket, station), sums in cells.items():
            group = (stations.get(station) or {}).get("class")
            for target in ((model, bucket, group), (model, bucket, "all")):
                if target[2] is not None:
                    add_sums(by_class.setdefault(target, empty_sums()), sums)
            add_sums(by_station.setdefault((model, "all", station), empty_sums()), sums)

    def rows(table):
        out = []
        for (model, bucket, group), sums in sorted(
                table.items(), key=lambda item: (item[0][0], LEAD_ORDER[item[0][1]], item[0][2])):
            scored = metrics(sums)
            out.append([model, bucket, group, *[scored[f] for f in SCORE_FIELDS[3:]]])
        return out

    return rows(by_class), rows(by_station), stations


def scores(results, now):
    hour = now.replace(minute=0, second=0, microsecond=0)
    yesterday = (now - timedelta(days=1)).date()
    by_class, by_station, stations, windows = {}, {}, {}, []
    for window in WINDOWS:
        first = yesterday - timedelta(days=window - 1)
        days = sorted(day for day in results if day >= first.isoformat())
        windows.append({"days": window, "from": first.isoformat(), "to": yesterday.isoformat(),
                        "daysWithData": len(days)})
        by_class[str(window)], by_station[str(window)], seen = tables(results, now, window)
        stations.update(seen)
    models = sorted({row[0] for rows in by_class.values() for row in rows})
    return {
        "schemaVersion": SCHEMA, "kind": "verification", "model": "verify",
        "run": hour.strftime("%Y%m%d%H"), "runTime": stamp(hour), "generatedAt": stamp(now),
        "windows": windows,
        "leadBuckets": [{"id": label, "fromHours": low, "toHours": high}
                        for low, high, label in LEAD_BUCKETS],
        "thresholds": {"rideableMps": RIDEABLE_MPS, "directionMinSpeedMps": DIRECTION_MIN_MPS},
        "units": {"speed": "m/s", "gust": "m/s", "direction": "degrees"},
        "models": models,
        "blend": {"models": list(BLEND_MODELS), "issueHours": list(BLEND_ISSUE_HOURS),
                  "signature": blend_signature(),
                  "method": "src/ratings.ts placeConsensus, replicated in force5/ingest/consensus.py: "
                            "grid-size weights 3/2/1, weighted median speed and gust, weighted "
                            "mean vector for the bearing. At a station an ensemble contributes "
                            "its mean wind, sampled from its mean frames."},
        "fields": list(SCORE_FIELDS),
        "byClass": by_class, "byStation": by_station,
        "stations": {identifier: {key: meta.get(key) for key in ("name", "class", "source", "lat", "lon")}
                     for identifier, meta in sorted(stations.items())},
        "notes": ("Bias is forecast minus observed. Leads are hours after the run (the blend: after "
                  "its issue time). Direction only where the observed wind is at least "
                  f"{DIRECTION_MIN_MPS:g} m/s; rideable means at least {RIDEABLE_MPS:g} m/s on "
                  "both sides. See docs/VERIFICATION.md for what this can and cannot say."),
        "attribution": ATTRIBUTION, "licenseUrl": LICENSE_URL,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bucket", help="Read and keep the bucket's archive")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--endpoint-url")
    parser.add_argument("--region")
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)
    store = (open_archive(s3=make_client(args.endpoint_url, args.region), bucket=args.bucket,
                          prefix=args.prefix) if args.bucket
             else open_archive(public=ROOT / "public"))
    document = scores(score_days(store, now), now)
    out = ROOT / "public" / SCORES
    write_json(out, document)
    print(f"Verification over {document['windows'][-1]['daysWithData']} day(s) with data: "
          f"{len(document['models'])} model(s), {len(document['stations'])} station(s), "
          f"written to {out}", flush=True)
    return document


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Verification failed: {error}", file=sys.stderr)
        sys.exit(1)
