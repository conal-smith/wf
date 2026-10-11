#!/usr/bin/env python3
"""Keep what every wind model forecast, and what the wind then did, before it is gone.

The publisher deletes a run's frames the moment the next run replaces it, so the
only moment to record a forecast is while it is still being served. Every hour,
after the blend, this reads every wind manifest that is published right now and,
for each run the archive does not hold yet, writes `archive/forecasts/<model>/<run>.json`
(archive.py), once, never to be changed:

- **at every observing station**: u, v and gust sampled from the run's own frames
  at the station's position, bilinearly, exactly as the adapters sample a riding
  spot (`fetch_forecast.sample`). The stations come from the published wind
  observations; with none published, from the committed wind_stations.json. A
  station outside the model's grid is left out, never clamped to the edge.
- **at every riding spot**: the run's own `spotForecasts`, copied from its spot
  squares (squares.load_spot_data).
- **for an ensemble**: each spot's members, summarised per step as the 10th, 50th
  and 90th percentile and mean of the member speeds, and the mean member gust.
  An ensemble publishes only mean frames, so at a station it is the mean wind.

Values are m/s rounded to 0.1, which is the precision the binary frames store.
Each record also keeps the manifest's `generatedAt`, when the run became
available, so that verify.py can rebuild the blend a rider was shown at any hour.

It also merges the published wind observations into one file per UTC day,
`archive/observations/YYYY-MM-DD.json`, keyed by station and time, so the same
reading merged twice is stored once. The observation manifest carries 72 hours,
so this job can miss two days of runs and lose no observation.

With `--bucket` everything is read from what the bucket serves and written to
its archive; the frames of each new run are fetched into a scratch directory,
checked by the same code that validates them for publication, and deleted again.
Without it, the work directory's own public/ is read and its public/archive/
written. The pointer it publishes, verify/forecast-archive.json, only says what
it copied this hour; the archive itself is written directly, because nothing in
it is ever replaced or pruned.
"""
import argparse
from datetime import datetime, timezone
import gzip
import json
import math
from pathlib import Path
import sys
import tempfile

from archive import forecast_key, observation_key, open_archive
from fetch_forecast import ROOT, write_json
from prune import read_object
from publish_s3 import log_event, make_client, object_prefix, read_current
from registry import MANIFESTS, MODELS
from squares import run_path, with_spot_data
import timing

SUMMARY = MANIFESTS["forecast-archive"]
STATIONS_FILE = Path(__file__).with_name("wind_stations.json")
OBSERVATIONS = "wind-obs"
SCHEMA = 1


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def tenth(value):
    return None if value is None else round(value, 1)


def wind_models():
    return [model for model, entry in MODELS.items() if entry["kind"] == "wind"]


# --- what we sample at -------------------------------------------------------

def station_points(observations, fallback=STATIONS_FILE):
    """{id: (lat, lon)} for every station, from the observations or the committed list."""
    stations = (observations or {}).get("stations")
    if isinstance(stations, dict) and stations:
        return {identifier: (station["lat"], station["lon"])
                for identifier, station in sorted(stations.items())}, "wind-obs"
    listed = json.loads(Path(fallback).read_text())["stations"]
    return {station["id"]: (station["lat"], station["lon"]) for station in listed}, "committed"


def sample_point(grid, values, lon, lat):
    """`fetch_forecast.sample`, but None when the point or any cell it reads is missing.

    A binary frame marks land, or the edge of a cropped domain, as missing. A
    bilinear sample that touches such a cell is not a forecast for the point.
    """
    x = (lon - grid["west"]) / grid["dx"]
    y = (grid["north"] - lat) / grid["dy"]
    if not (0 <= x <= grid["width"] - 1 and 0 <= y <= grid["height"] - 1):
        return None
    x0, y0 = min(math.floor(x), grid["width"] - 2), min(math.floor(y), grid["height"] - 2)
    tx, ty = x - x0, y - y0
    i = y0 * grid["width"] + x0
    cells = (values[i], values[i + 1], values[i + grid["width"]], values[i + grid["width"] + 1])
    if any(cell is None for cell in cells):
        return None
    return ((cells[0] * (1 - tx) + cells[1] * tx) * (1 - ty)
            + (cells[2] * (1 - tx) + cells[3] * tx) * ty)


def percentile(ordered, fraction):
    """Linear-interpolated percentile of an already sorted, non-empty list."""
    position = (len(ordered) - 1) * fraction
    low = math.floor(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def member_summary(step):
    """One ensemble step: p10/p50/p90/mean of the member speeds, mean member gust."""
    speeds = sorted(math.hypot(u, v) for u, v in zip(step.get("u") or [], step.get("v") or [])
                    if u is not None and v is not None)
    gusts = [gust for gust in step.get("gust") or [] if gust is not None]
    if not speeds:
        return None, None, None, None, None
    return (percentile(speeds, 0.1), percentile(speeds, 0.5), percentile(speeds, 0.9),
            sum(speeds) / len(speeds), sum(gusts) / len(gusts) if gusts else None)


# --- one run's record ---------------------------------------------------------

def station_series(frames, points):
    """{station: {u, v, gust}} over the frames; a station off the grid is left out."""
    series = {identifier: {"u": [], "v": [], "gust": []} for identifier in points}
    for frame in frames:
        grid = frame["grid"]
        for identifier, (lat, lon) in points.items():
            for field in ("u", "v", "gust"):
                values = frame.get(field)
                value = None if values is None else sample_point(grid, values, lon, lat)
                series[identifier][field].append(tenth(value))
    return {identifier: values for identifier, values in series.items()
            if any(value is not None for value in values["u"])}


def spot_copies(manifest):
    """The run's spotForecasts, compacted: shared hours, then u/v/gust columns."""
    forecasts = manifest.get("spotForecasts") or {}
    first = next(iter(forecasts.values()), [])
    hours = [step["hour"] for step in first]
    spots = {}
    for spot, steps in sorted(forecasts.items()):
        entry = {field: [tenth(step.get(field)) for step in steps] for field in ("u", "v", "gust")}
        own = [step["hour"] for step in steps]
        if own != hours:
            entry["hours"] = own
        spots[spot] = entry
    return hours, spots


def member_stats(manifest):
    """Per spot and member step: p10/p50/p90/mean speed and mean gust, or None."""
    members = manifest.get("spotMembers")
    if not manifest.get("ensemble") or not isinstance(members, dict):
        return None, None
    first = next(iter(members.values()), [])
    hours = [step["hour"] for step in first]
    stats = {}
    for spot, steps in sorted(members.items()):
        columns = {key: [] for key in ("p10", "p50", "p90", "mean", "gustMean")}
        for step in steps:
            for key, value in zip(columns, member_summary(step)):
                columns[key].append(tenth(value))
        if [step["hour"] for step in steps] != hours:
            columns["hours"] = [step["hour"] for step in steps]
        stats[spot] = columns
    return hours, stats


def forecast_record(manifest, frames, points, station_source, archived_at):
    """Everything kept of one run. `frames` are decoded wind frames, in order."""
    frames = list(frames)
    spot_hours, spots = spot_copies(manifest)
    member_hours, members = member_stats(manifest)
    windows = []
    for info in manifest.get("frames") or []:
        interval = info.get("gustIntervalHours")
        windows.append(interval[1] - interval[0] if isinstance(interval, list) else None)
    return {
        "schemaVersion": SCHEMA, "model": manifest["model"], "run": manifest["run"],
        "runTime": manifest["runTime"],
        # When the run became available, which is what rebuilding the blend a
        # rider saw at a given hour needs; `archivedAt` is only when we copied it.
        "generatedAt": manifest.get("generatedAt"), "archivedAt": stamp(archived_at),
        "resolutionKm": manifest.get("resolutionKm"),
        "ensemble": ({"members": manifest["ensemble"].get("members")}
                     if manifest.get("ensemble") else None),
        "gustKind": manifest.get("gustKind", "interval"),
        "gustAvailable": manifest.get("gustAvailable") is not False,
        "units": "m/s, rounded to 0.1",
        "stationSource": station_source,
        "hours": [frame["hour"] for frame in frames],
        "gustWindowHours": windows,
        "stations": station_series(frames, points),
        "spotHours": spot_hours, "spots": spots,
        "memberHours": member_hours, "members": members,
        "sampling": ("Stations: bilinear from the run's published frames (an ensemble's are "
                     "its mean), omitted off the grid. Spots: the run's own spotForecasts. "
                     "Members: percentiles and mean of member speeds per spot and step."),
    }


# --- observations ----------------------------------------------------------------

def observation_days(manifest):
    """{YYYY-MM-DD: {station: [rows]}} from a published wind observation manifest."""
    days = {}
    for identifier, station in (manifest.get("stations") or {}).items():
        for row in station.get("readings") or []:
            days.setdefault(row[0][:10], {}).setdefault(identifier, []).append(row)
    return days


def station_meta(station):
    return {key: station.get(key) for key in ("name", "lat", "lon", "source", "class", "heightM")}


def merge_day(existing, day, rows_by_station, manifest, now):
    """One day's archive with these rows merged in, and how many readings are new.

    Keyed by station and time: a reading already archived is replaced only if the
    source has since revised it, and merging the same manifest twice changes
    nothing, in which case the document returned is None and nothing is written.
    """
    document = existing or {
        "schemaVersion": SCHEMA, "date": day, "readingFields": manifest["readingFields"],
        "units": manifest["units"], "stations": {}, "readings": {}}
    changed, added = existing is None, 0
    for identifier, rows in rows_by_station.items():
        meta = station_meta(manifest["stations"][identifier])
        if document["stations"].get(identifier) != meta:
            document["stations"][identifier] = meta
            changed = True
        stored = {row[0]: row for row in document["readings"].get(identifier, [])}
        for row in rows:
            if row[0] not in stored:
                added += 1
            if stored.get(row[0]) != row:
                stored[row[0]] = row
                changed = True
        document["readings"][identifier] = [stored[time] for time in sorted(stored)]
    if not changed:
        return None, 0
    document.update({"sources": manifest.get("sources"), "attribution": manifest.get("attribution"),
                     "licenseUrl": manifest.get("licenseUrl"), "updatedAt": stamp(now)})
    return document, added


def archive_observations(store, manifest, now):
    """Merge a published observation manifest into the daily archive files."""
    if not manifest:
        return None
    touched, added = [], {}
    for day, rows in sorted(observation_days(manifest).items()):
        def combine(existing, day=day, rows=rows):
            document, added[day] = merge_day(existing, day, rows, manifest, now)
            return document
        store.merge(observation_key(day), combine)
        touched.append(observation_key(day))
    return {"days": touched, "added": sum(added.values()), "run": manifest.get("run")}


# --- where manifests and frames come from ------------------------------------------

def run_file(model, manifest, relative):
    """A file of a published run, as its published path (`weather/<base><relative>`)."""
    return f"{Path(MANIFESTS[model]).parent.as_posix()}/{run_path(manifest['base'], relative)}"


class LocalSource:
    """The work directory's own published manifests, spot squares and frames."""

    def __init__(self, public):
        self.public = Path(public).resolve()

    def manifest(self, model):
        path = self.public / MANIFESTS[model]
        return json.loads(path.read_text()) if path.is_file() else None

    def with_spots(self, model, manifest):
        """The pointer with every spot square of its run merged back in."""
        directory = (self.public / MANIFESTS[model]).parent
        return with_spot_data(manifest, lambda path: json.loads((directory / path).read_text()))

    def frames(self, model, manifest):
        from backfill_spots import read_frame
        for info in manifest.get("frames") or []:
            yield read_frame(self.public, model, manifest, info)


class BucketSource:
    """What the bucket serves: pointers read directly, frames via a scratch directory.

    Each frame is downloaded into a scratch copy of public/ and read through
    backfill_spots.read_frame, so a frame the bucket serves is checked exactly as
    one on disk would be (its path, its run and hour, and its content hash).
    """

    def __init__(self, s3, bucket, prefix, scratch):
        self.s3, self.bucket, self.prefix = s3, bucket, object_prefix(prefix)
        self.scratch = Path(scratch).resolve()

    def manifest(self, model):
        manifest, _ = read_current(self.s3, self.bucket, self.prefix + MANIFESTS[model])
        return manifest

    def with_spots(self, model, manifest):
        directory = Path(MANIFESTS[model]).parent.as_posix()
        return with_spot_data(manifest, lambda path: json.loads(read_object(
            self.s3, self.bucket, f"{self.prefix}{directory}/{path}")))

    def body(self, url):
        response = self.s3.get_object(Bucket=self.bucket, Key=self.prefix + url)
        data = response["Body"].read()
        encoding = response.get("ContentEncoding")
        if encoding == "gzip":
            return gzip.decompress(data)
        if encoding == "br":
            import brotli
            return brotli.decompress(data)
        return data

    def frames(self, model, manifest):
        from backfill_spots import read_frame
        for info in manifest.get("frames") or []:
            published = run_file(model, manifest, info["url"])
            target = self.scratch / published
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(self.body(published))
            try:
                yield read_frame(self.scratch, model, manifest, info)
            finally:
                target.unlink(missing_ok=True)


def archive_runs(source, store, points, station_source, now, models=None):
    """Archive every published run the archive lacks. One model's failure is not fatal."""
    archived, current, failed = [], {}, []
    for model in models or wind_models():
        try:
            manifest = source.manifest(model)
        except Exception as error:
            failed.append({"model": model, "error": str(error)[:300]})
            log_event("archive_failed", model=model, error=error)
            continue
        if not manifest or not manifest.get("run"):
            continue
        current[model] = {"run": manifest["run"]}
        key = forecast_key(model, manifest["run"])
        try:
            if store.exists(key):
                continue
            # The spot squares only once the run is known to be new: an hour in which
            # nothing has changed reads the pointers and nothing else.
            manifest = source.with_spots(model, manifest)
            record = forecast_record(manifest, source.frames(model, manifest), points,
                                     station_source, now)
            if store.create(key, record):
                archived.append({"model": model, "run": manifest["run"], "key": key,
                                 "stations": len(record["stations"]),
                                 "spots": len(record["spots"]),
                                 "members": record["members"] is not None})
                log_event("forecast_archived", model=model, run=manifest["run"], key=key,
                          stations=len(record["stations"]), spots=len(record["spots"]))
        except Exception as error:
            failed.append({"model": model, "run": manifest["run"], "error": str(error)[:300]})
            log_event("archive_failed", model=model, run=manifest["run"], error=error)
    return archived, current, failed


def summary(now, archived, current, failed, observations, station_source, stations):
    hour = now.replace(minute=0, second=0, microsecond=0)
    return {"schemaVersion": SCHEMA, "kind": "archive", "model": "forecast-archive",
            "run": hour.strftime("%Y%m%d%H"), "runTime": stamp(hour), "generatedAt": stamp(now),
            "archived": archived, "current": current, "failed": failed,
            "observations": observations, "stationSource": station_source,
            "stations": stations,
            "description": "What the hourly archive job copied into archive/ this hour. "
                           "The archive is never pruned; see docs/VERIFICATION.md."}


def run(source, store, now, out):
    # Reading a run and writing its archive copy are interleaved, model by model.
    timing.start("archive")
    observations = source.manifest(OBSERVATIONS)
    points, station_source = station_points(observations)
    merged = archive_observations(store, observations, now)
    archived, current, failed = archive_runs(source, store, points, station_source, now)
    if failed and not archived and not current:
        raise RuntimeError(f"Nothing could be archived: {failed[0]['error']}")
    document = summary(now, archived, current, failed, merged, station_source, len(points))
    write_json(out, document)
    readings = "none published" if merged is None else f"{merged['added']} new readings"
    print(f"Archived {len(archived)} new run(s) of {len(current)} published; "
          f"{len(failed)} failed; observations: {readings}", flush=True)
    return document


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bucket", help="Read what the bucket serves and write its archive")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--endpoint-url")
    parser.add_argument("--region")
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)
    out = ROOT / "public" / SUMMARY
    if not args.bucket:
        public = ROOT / "public"
        return run(LocalSource(public), open_archive(public=public), now, out)
    s3 = make_client(args.endpoint_url, args.region)
    with tempfile.TemporaryDirectory(prefix="archive-") as scratch:
        return run(BucketSource(s3, args.bucket, args.prefix, scratch),
                   open_archive(s3=s3, bucket=args.bucket, prefix=args.prefix), now, out)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Forecast archive failed: {error}", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
