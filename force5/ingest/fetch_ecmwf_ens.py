"""ECMWF ENS open data (stream enfo, type pf): per-spot member series + mean frames.

Every perturbed member is decoded and validated, but only the ensemble mean is
published as map frames. Per-spot member series are precomputed into the
manifest, so a browser drawing a probability blend never downloads member grids.

IFS Cycle 50r1 retired `scda` and merged the ENS control into `oper`: this
importer never requests `type=cf`. The unperturbed control remains the separate
`ecmwf` product. No API key is used; ranged HTTP reads select members and steps.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import threading

import eccodes as ec

from cadence import ladder_hours
from f5bin import ENCODING as FRAME_ENCODING, publish_frame
from fetch_ecmwf import SOURCE_URL, ForecastSession, client, gust_parameter
from fetch_forecast import PROJECT_ROOT, ROOT, PUBLISHED_IN_BUCKET, PUBLISHED_ON_DISK, already_published, decode_handle, sample, write_json
from registry import UNCHANGED_EXIT

# Measured 2026-09-16 on the 0.25° enfo index: one member-message is about
# 0.84 MB (10u), 0.83 MB (10v) and 1.39 MB (10fg), plus a 2.0 MB step index.
# 25 members, 6-hourly to +144h therefore downloads about 1.95 GB per run.
MEMBERS, STEP, HOURS = 25, 6, 144
MEMBER_LIMIT = 50
WIND_PARAMS = {165: "u", 166: "v"}
GUST_PARAMS = (49, 123, 228028, 237318)
GUST_ALIASES = ("10fg", "10fg3", "10fg6")


class MeteredSession(ForecastSession):
    """A run's byte meter: step indexes here, member GRIB counted in fetch().

    The client streams ranged member messages through its own module-level
    requests calls, so a session hook cannot see them; the cached file size is
    exactly the byte ranges asked for. HEAD advertises the whole multi-gigabyte
    source object and is never transferred.
    """
    index_bytes = 0
    grib_bytes = 0
    lock = threading.Lock()

    @classmethod
    def count(cls, index=0, grib=0):
        with cls.lock:
            cls.index_bytes += index
            cls.grib_bytes += grib

    def request(self, *args, **kwargs):
        response = super().request(*args, **kwargs)
        if response.status_code == 200 and str(response.url).endswith(".index"):
            MeteredSession.count(index=int(response.headers.get("Content-Length") or 0))
        return response


def ens_client(source):
    value = client(source)
    value.session.close()
    value.session = MeteredSession()
    # Thousands of ranged reads per run: the control product's two quick retries
    # abandon a run on a throttled mirror, and the library default waits 500 × 120s.
    value.maximum_retries, value.retry_after = 6, 10
    return value


def spots_file():
    """Prefer the richer riding-location catalogue when it has been added."""
    override = os.environ.get("FORCE5_SPOTS_FILE")
    if override:
        return Path(override)
    preferred = PROJECT_ROOT / "public" / "riding-locations.json"
    return preferred if preferred.exists() else PROJECT_ROOT / "public" / "spots.json"


def load_spots(path):
    """Accept either catalogue shape; ignore entries that cannot be sampled."""
    data = json.loads(path.read_text())
    if isinstance(data, dict):
        for key in ("spots", "locations", "riding"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    spots, seen = [], set()
    for entry in data if isinstance(data, list) else []:
        if not isinstance(entry, dict) or entry.get("kind") not in (None, "spot"):
            continue
        identifier, lat, lon = entry.get("id"), entry.get("lat"), entry.get("lon")
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            continue
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) for v in (lat, lon)):
            continue
        seen.add(identifier)
        spots.append({"id": identifier, "lat": float(lat), "lon": float(lon)})
    if not spots:
        raise ValueError(f"No usable riding locations in {path}")
    return spots


def run_datetime(run, hours):
    if len(run) != 10:
        raise ValueError("A run is YYYYMMDDHH")
    value = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if value.hour not in (0, 6, 12, 18):
        raise ValueError("ENS cycles are 00, 06, 12 and 18 UTC")
    if value.hour in (6, 18) and hours > 144:
        raise ValueError("The 06/18 UTC ensemble only reaches +144h")
    return value


def parameter_sets(hour):
    """Gust aliases differ across the horizon; initialization has no gust period."""
    if hour == 0:
        return [["10u", "10v"]]
    preferred = gust_parameter(hour)
    order = [preferred] + [name for name in GUST_ALIASES if name != preferred]
    return [["10u", "10v", name] for name in order]


def fetch(cache, source, run, hour, members, refresh=False):
    """Return the cached per-step GRIB holding every requested member message."""
    path = cache / f"{hour:03d}-{len(members)}m-v1.grib2"
    if path.exists() and not refresh:
        return path
    temporary = path.with_suffix(".download")
    candidates = parameter_sets(hour)
    for params in candidates:
        try:
            ens_client(source).retrieve(date=run[:8], time=int(run[-2:]), step=hour,
                                       stream="enfo", type="pf", number=members,
                                       param=params, target=str(temporary))
            break
        except ValueError as error:
            # Retry only an absent gust alias, never a network/validation error.
            if params is candidates[-1] or "Cannot find index entries matching" not in str(error):
                raise
    with temporary.open("rb") as stream:
        if stream.read(4) != b"GRIB":
            raise ValueError(f"Not a GRIB response for +{hour:03d}h")
    os.replace(temporary, path)
    MeteredSession.count(grib=path.stat().st_size)
    return path


def decode_step(path, run, hour, members, layout=None):
    """Validate every member message of one step with the control-product checks."""
    fields = {"u": {}, "v": {}, "gust": {}}
    interval = None
    expected = set(members)
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                param = ec.codes_get(handle, "paramId")
                field = WIND_PARAMS.get(param, "gust" if param in GUST_PARAMS else None)
                if field is None:
                    raise ValueError(f"Unexpected ECMWF ENS parameter {param}")
                if ec.codes_get(handle, "centre") != "ecmf" or ec.codes_get(handle, "dataType") != "pf":
                    raise ValueError("Expected ECMWF perturbed ensemble members, not control/analysis")
                member = ec.codes_get(handle, "number")
                if member not in expected:
                    raise ValueError(f"Unexpected ensemble member {member}")
                if member in fields[field]:
                    raise ValueError(f"Duplicate {field} message for member {member}")
                if field == "gust" and ec.codes_get(handle, "numberOfMissing") != 0:
                    raise ValueError("Incomplete ECMWF ENS gust field")
            except Exception:
                ec.codes_release(handle)
                raise
            values, layout, metadata = decode_handle(handle, field, run, hour, layout)
            fields[field][member] = values
            if field == "gust":
                window = [int(metadata["startStep"]), int(metadata["endStep"])]
                if not 0 <= window[0] < window[1] or window[1] != hour or window[1] - window[0] not in (1, 3, 6):
                    raise ValueError("Invalid ECMWF ENS gust maximum interval")
                if interval is not None and window != interval:
                    raise ValueError("Ensemble members disagree on the gust interval")
                interval = window
    wanted = {"u", "v"} if hour == 0 else {"u", "v", "gust"}
    for field, values in fields.items():
        if field in wanted and set(values) != expected:
            raise ValueError(f"Incomplete ensemble: {field} +{hour:03d}h has "
                             f"{len(values)} of {len(expected)} members")
        if field not in wanted and values:
            raise ValueError("Initialization has no preceding gust period")
    if layout[2]["dx"] != 0.25 or layout[2]["dy"] != 0.25:
        raise ValueError("Expected the 0.25-degree open-data grid")
    return fields, layout, interval


def average(series):
    return [round(sum(column) / len(series), 2) for column in zip(*series)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", help="Optional YYYYMMDDHH; 06/18 reach only +144h")
    parser.add_argument("--source", choices=["ecmwf", "aws", "google"], default="ecmwf")
    parser.add_argument("--members", type=int, default=MEMBERS,
                        help=f"Perturbed members 1..N of {MEMBER_LIMIT} (default {MEMBERS})")
    parser.add_argument("--step", type=int, choices=[3, 6, 12], default=STEP,
                        help=f"Uniform source step in hours (default {STEP})")
    parser.add_argument("--hours", type=int, default=HOURS, help=f"Horizon (default {HOURS})")
    parser.add_argument("--workers", type=int, default=2, help="Concurrent ranged downloads")
    args = parser.parse_args()
    if not 2 <= args.members <= MEMBER_LIMIT:
        parser.error(f"Use 2–{MEMBER_LIMIT} perturbed members")
    if not args.step <= args.hours <= 360 or args.hours % args.step:
        parser.error("Horizon must be a multiple of the step, at most 360 hours")
    if args.step == 3 and args.hours > 144:
        parser.error("The source is 6-hourly beyond +144h; use --step 6 or --hours 144")
    if not 1 <= args.workers <= 4:
        parser.error("Use 1–4 concurrent downloads; the mirrors throttle harder above that")
    members = list(range(1, args.members + 1))
    ranges = [{"throughHour": args.hours, "stepHours": args.step}]
    hours = ladder_hours(ranges)
    run = args.run or ens_client(args.source).latest(
        step=args.hours, stream="enfo", type="pf", number=1, param="10u").strftime("%Y%m%d%H")
    run_time = run_datetime(run, args.hours)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= 24:
        raise ValueError("Refusing a stale/future ECMWF ENS run (maximum age 24 hours)")
    output = ROOT / "public" / "weather"
    prefix = f"ecmwf-ens-{run}-{args.hours}h-{len(members)}m-v1"
    published = already_published(output / "ecmwf-ens.json", run, prefix) if not args.run else False
    if published == PUBLISHED_IN_BUCKET:
        print(f"ECMWF ENS {run} is already published; nothing to download.", flush=True)
        return UNCHANGED_EXIT
    if published == PUBLISHED_ON_DISK:
        # An earlier attempt wrote it but may never have published it. Skip the
        # download, and let the worker validate and publish what is on disk.
        print(f"ECMWF ENS {run} is already on disk; publishing it without downloading.", flush=True)
        return 0
    print(f"Fetching ECMWF ENS {run}: {len(members)} members × {len(hours)} steps "
          f"to +{args.hours}h (about {len(members) * (3 * len(hours) - 1)} member messages)", flush=True)
    cache = ROOT / ".cache" / "ecmwf-ens" / run
    cache.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        paths = list(pool.map(lambda hour: fetch(cache, args.source, run, hour, members), hours))
    print("Downloads complete. Validating every member and cropping to Ireland…", flush=True)
    spots = load_spots(spots_file())
    spot_forecasts = {spot["id"]: [] for spot in spots}
    spot_members = {spot["id"]: [] for spot in spots}
    layout, frames = None, []
    for hour, path in zip(hours, paths):
        try:
            fields, layout, interval = decode_step(path, run, hour, members, layout)
        except Exception as error:
            # A corrupt or stale cache entry must never publish; fetch it once more.
            print(f"Re-fetching +{hour:03d}h after {error}", flush=True)
            fields, layout, interval = decode_step(
                fetch(cache, args.source, run, hour, members, refresh=True), run, hour, members, layout)
        grid = layout[2]
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        mean = {field: average([fields[field][m] for m in members]) for field in ("u", "v")}
        gust = average([fields["gust"][m] for m in members]) if hour else None
        payload = {"model": "ecmwf-ens", "run": run, "hour": hour, "validTime": valid,
                   "grid": grid, "gust": gust, "gustIntervalHours": interval, **mean}
        name = publish_frame(output, prefix, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}",
                       "gustIntervalHours": interval})
        for spot in spots:
            lon, lat = spot["lon"], spot["lat"]
            spot_forecasts[spot["id"]].append({
                "hour": hour, "validTime": valid,
                "gust": sample(grid, gust, lon, lat) if gust is not None else None,
                **{field: sample(grid, values, lon, lat) for field, values in mean.items()}})
            if sample(grid, mean["u"], lon, lat) is None:
                # Outside the crop: the mean series carries nulls, but the
                # publisher rejects null member values, so publish no members.
                spot_members.pop(spot["id"], None)
                continue
            spot_members[spot["id"]].append({
                "hour": hour, "validTime": valid,
                "u": [sample(grid, fields["u"][m], lon, lat) for m in members],
                "v": [sample(grid, fields["v"][m], lon, lat) for m in members],
                "gust": [sample(grid, fields["gust"][m], lon, lat) for m in members]
                        if hour else [None] * len(members)})
        print(f"  Validated +{hour:03d}h — {len(members)} members, gust {interval}", flush=True)
    manifest = {
        "schemaVersion": 1, "model": "ecmwf-ens", "modelName": "ECMWF ENS", "provider": "ECMWF",
        "modelDetail": f"IFS ensemble, {len(members)} perturbed members", "resolutionKm": None,
        "resolutionLabel": "0.25° open-data grid", "run": run,
        "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": args.step,
        "stepRanges": ranges, "grid": layout[2], "encoding": FRAME_ENCODING, "frames": frames,
        "spotForecasts": spot_forecasts, "spotMembers": spot_members,
        "ensemble": {"members": len(members), "control": None,
                     "description": f"Perturbed members 1–{len(members)} of ECMWF's open-data "
                     f"{MEMBER_LIMIT}-member IFS ensemble (stream enfo, type pf). Members are "
                     "exchangeable, so a leading subset is a valid random subsample, not a "
                     "selection of better members. The unperturbed control is not in this "
                     "product: IFS Cycle 50r1 merged it into the oper stream, published here "
                     "as the separate ecmwf model."},
        "spotForecastsDescription": "spotForecasts holds the ensemble MEAN u/v/gust per spot, "
        "sampled from the published mean frames. Per-member values are in spotMembers, indexed "
        "identically for every hour. A mean is not the most likely outcome; use the members for "
        "spread and probabilities.",
        "gustAvailable": True, "gustMissingHours": [0],
        "gustDescription": "Ensemble-mean scalar maximum 10 m gust over the source GRIB interval ending at each forecast time. Intervals may be 1, 3 or 6 hours and need not equal the spacing between displayed columns; every member of a step shares one interval. Initialization (+0h) has no preceding forecast gust period and is shown as unavailable, not zero.",
        "processing": f"Ensemble mean of perturbed members 1–{len(members)}, cropped from the "
        f"public 0.25° regular grid without downscaling. Uniform {args.step}-hour source steps to "
        f"+{args.hours}h; no hourly forecasts are invented. Frames carry the mean only. Member "
        "spread is published solely as per-spot series, because publishing 50 member grids per "
        "step would be unusable in a browser. Ensemble spread describes model uncertainty, not "
        "local terrain effects, and is not a measured probability of rideable conditions.",
        "sourceUrl": SOURCE_URL,
        "attribution": f"© {run_time.year} European Centre for Medium-Range Weather Forecasts (ECMWF). This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF). Data cropped and processed by Force5 under CC BY 4.0. ECMWF provides no warranty and accepts no liability for errors, availability or consequences of use; it does not endorse Force5.",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "termsUrl": "https://apps.ecmwf.int/datasets/licences/general/",
    }
    write_json(output / "ecmwf-ens.json", manifest)
    cached = sum(path.stat().st_size for path in paths)
    print(f"Published {len(frames)} ECMWF ENS mean frames and {len(spots)} member series to "
          f"{output / 'ecmwf-ens.json'}", flush=True)
    transferred = MeteredSession.grib_bytes + MeteredSession.index_bytes
    print(f"Transferred {transferred / 1e9:.3f} GB this run "
          f"({MeteredSession.grib_bytes / 1e9:.3f} GB member GRIB + "
          f"{MeteredSession.index_bytes / 1e6:.0f} MB step indexes); "
          f"{cached / 1e9:.3f} GB of source GRIB is cached under {cache}", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"ECMWF ENS refresh failed: {error}. Last published manifest preserved.", file=sys.stderr)
        sys.exit(1)
