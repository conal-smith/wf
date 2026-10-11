"""ECMWF AIFS Single open data: the AI model's Ireland wind snapshot to +360h.

AIFS Single is ECMWF's operational data-driven deterministic forecast. It is
published on the same public 0.25-degree open-data grid as the IFS control, with
no API key, at all four cycles, in uniform 6-hour steps to +360h. The crop, the
frame contract and the GRIB validation are the IFS control's, reused unchanged;
only the identity check differs, because AIFS and IFS share `centre=ecmf` and
`dataType=fc` and are separated by their MARS class.

**There is no gust.** The open-data inventory for `aifs-single` lists 10 m and
100 m wind, temperature, pressure, cloud, precipitation and soil fields, and no
`10fg`/`10fg3` maximum gust at any step. This product therefore publishes
`gustAvailable: false` with null gust arrays rather than multiplying the mean
wind by a gust factor, which would be a guess dressed as a forecast.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
import sys

import eccodes as ec

from f5bin import publish_frame
from fetch_ecmwf import SOURCE_URL, client
from fetch_forecast import (ROOT, decode_handle, load_spots, published_in_bucket, sample,
                            spots_file)
from registry import UNCHANGED_EXIT
from rundir import write_run
import timing

MODEL = "aifs"
OPENDATA_MODEL = "aifs-single"
STEP = 6            # The only cadence the product publishes; there is no 3-hour file.
MAX_HOURS = 360
# Four cycles six hours apart, each published about six hours after run time, so a
# run is never more than twelve hours old when its successor is due.
MAX_AGE_HOURS = 12
WIND_PARAMS = {165: "u", 166: "v"}
# What the live 0.25° headers actually say, read on 17 September 2026. AIFS shares
# `centre` and `dataType` with the IFS control and is separated from it by the MARS
# class: `ai` against `od`. `generatingProcessIdentifier` also differs (5 against
# 161) but is a process number ECMWF may renumber, so identity is taken from the
# class, the stream and the type, which are what the request itself asked for.
IDENTITY = {"centre": "ecmf", "marsClass": "ai", "marsStream": "oper", "dataType": "fc"}
GUST_DESCRIPTION = (
    "AIFS Single publishes no gust field. ECMWF's open-data inventory for this model "
    "carries 10 m and 100 m wind but no 10fg/10fg3 maximum gust at any step, so gusts "
    "here are null everywhere rather than estimated from the mean wind: a gust factor "
    "applied to a forecast wind speed is an assumption, not model output. Read gusts "
    "from ECMWF IFS, HARMONIE or ICON-EU instead.")


def run_datetime(run):
    if len(run) != 10:
        raise ValueError("A run is YYYYMMDDHH")
    value = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if value.hour not in (0, 6, 12, 18):
        raise ValueError("AIFS Single cycles are 00, 06, 12 and 18 UTC")
    return value


def decode_wind(path, run, hour, layout=None):
    """Validate and crop one AIFS step's two wind messages; takes no gust."""
    fields = {}
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                field = WIND_PARAMS.get(ec.codes_get(handle, "paramId"))
                if field is None or field in fields:
                    raise ValueError("Unexpected or duplicate AIFS wind parameter")
                for key, expected in IDENTITY.items():
                    found = ec.codes_get(handle, key)
                    if found != expected:
                        raise ValueError(f"Expected ECMWF AIFS Single ({key}={expected}), "
                                         f"not {key}={found!r}")
            except Exception:
                ec.codes_release(handle)
                raise
            fields[field], layout, _ = decode_handle(handle, field, run, hour, layout)
    if set(fields) != set(WIND_PARAMS.values()):
        raise ValueError("Missing AIFS wind component")
    if layout[2]["dx"] != 0.25 or layout[2]["dy"] != 0.25:
        raise ValueError("Expected the 0.25-degree open-data grid")
    return fields, layout


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", help="Optional YYYYMMDDHH; all four cycles reach +360h")
    # The AWS mirror has been answering 503 SlowDown; data.ecmwf.int is the default.
    parser.add_argument("--source", choices=["ecmwf", "aws", "google"], default="ecmwf",
                        help="Official ECMWF public mirror (default: ECMWF's own)")
    parser.add_argument("--hours", type=int, default=MAX_HOURS,
                        help=f"Horizon, {STEP}–{MAX_HOURS} and a multiple of {STEP}")
    parser.add_argument("--workers", type=int, default=3, help="Concurrent ranged downloads")
    args = parser.parse_args(argv)
    if not STEP <= args.hours <= MAX_HOURS or args.hours % STEP:
        parser.error(f"Use {STEP}–{MAX_HOURS} hours in multiples of {STEP}: "
                     "AIFS Single has no finer step")
    if not 1 <= args.workers <= 4:
        parser.error("Use 1–4 concurrent downloads; the mirrors throttle harder above that")
    return args


def manifest_for(run, run_time, hours, grid, frames, spot_forecasts):
    # A uniform step declared on its own lets the frame count imply the horizon, so a
    # run that stopped early would publish a shorter timeline without complaint. The
    # explicit one-entry ladder states the horizon instead, and both the publisher and
    # the browser then reject a missing tail frame rather than quietly shrinking it.
    ranges = [{"throughHour": hours[-1], "stepHours": STEP}]
    return {
        "schemaVersion": 1, "model": MODEL, "modelName": "ECMWF AIFS", "provider": "ECMWF",
        "modelDetail": "AIFS Single deterministic AI forecast", "resolutionKm": None,
        "resolutionLabel": "0.25° open-data grid", "run": run,
        "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": STEP,
        "stepRanges": ranges, "grid": grid, "frames": frames,
        "spotForecasts": spot_forecasts,
        "gustAvailable": False, "gustDescription": GUST_DESCRIPTION,
        "processing": (
            "ECMWF AIFS Single, a machine-learned forecast model trained on ERA5 and "
            "operational analyses, initialized from the same analysis as the IFS control. "
            f"Cropped from the public 0.25° regular grid without downscaling. Uniform "
            f"{STEP}-hour source steps to +{hours[-1]}h at every cycle; no hourly or "
            "3-hourly forecasts are invented, because the source publishes none. This is "
            "a different kind of model from IFS, not a correction of it: where AIFS and "
            "IFS disagree, neither is the error term of the other, and week two is a "
            "planning outlook rather than a local wind prediction."),
        "sourceUrl": SOURCE_URL,
        "attribution": f"© {run_time.year} European Centre for Medium-Range Weather "
        "Forecasts (ECMWF). This service is based on data and products of the European "
        "Centre for Medium-Range Weather Forecasts (ECMWF). Data cropped and processed by "
        "Force5 under CC BY 4.0. ECMWF provides no warranty and accepts no liability for "
        "errors, availability or consequences of use; it does not endorse Force5.",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "termsUrl": "https://apps.ecmwf.int/datasets/licences/general/",
    }


def main(argv=None):
    args = parse_args(argv)
    hours = list(range(0, args.hours + 1, STEP))

    def aifs():
        """A fresh client per call: its session is not shared between threads."""
        return client(args.source, OPENDATA_MODEL)

    timing.start("discover")
    # Probing the requested last step refuses a cycle that is still publishing.
    # Individual steps are still validated below: the last file existing is not
    # on its own a reason to replace a published snapshot.
    run = args.run or aifs().latest(step=args.hours, stream="oper", type="fc").strftime("%Y%m%d%H")
    run_time = run_datetime(run)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= MAX_AGE_HOURS:
        raise ValueError(f"Refusing a stale/future AIFS run (maximum age {MAX_AGE_HOURS} hours)")
    if published_in_bucket(run, args.run):
        print(f"ECMWF AIFS Single {run} is already published; nothing to download.", flush=True)
        return UNCHANGED_EXIT
    print(f"Fetching ECMWF AIFS Single {run} from {args.source}: "
          f"{len(hours)} frames through +{args.hours}h, no gust field", flush=True)
    cache = ROOT / ".cache" / MODEL / run
    cache.mkdir(parents=True, exist_ok=True)
    spots = load_spots()
    print(f"Sampling {len(spots)} spots from {spots_file()}", flush=True)

    def download(hour):
        path = cache / f"{hour:03d}.grib2"
        # Validate cached data too: a truncated cache entry must never publish.
        if path.exists():
            try:
                return hour, decode_wind(path, run, hour)
            except Exception:
                print(f"Re-fetching invalid cached frame +{hour:03d}h", flush=True)
        temporary = path.with_suffix(".download")
        aifs().retrieve(date=run[:8], time=int(run[-2:]), step=hour, stream="oper",
                        type="fc", param=["10u", "10v"], target=str(temporary))
        decoded = decode_wind(temporary, run, hour)
        os.replace(temporary, path)
        print(f"  Validated +{hour:03d}h ({path.stat().st_size} bytes)", flush=True)
        return hour, decoded

    timing.start("download", workers=args.workers)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        decoded = dict(pool.map(download, hours))
    timing.start("decode")
    output = ROOT / "public" / "weather"
    prefix = f"{MODEL}-{run}-{args.hours}h-v1"
    spot_forecasts = {spot["id"]: [] for spot in spots}
    signature, grid = decoded[0][1][0], decoded[0][1][2]
    frames = []
    for hour in hours:
        fields, layout = decoded[hour]
        if layout[0] != signature or layout[2] != grid:
            raise ValueError("AIFS grid changed within the run")
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        payload = {"model": MODEL, "run": run, "hour": hour, "validTime": valid,
                   "grid": grid, "gust": None, "gustIntervalHours": None, **fields}
        publish_frame(output, prefix, payload)
        # The browser reads a null interval as a declared absence; leaving the key
        # out would read as an undeclared one and fail its contract check.
        frames.append({"hour": hour, "validTime": valid, "gustIntervalHours": None})
        for spot in spots:
            spot_forecasts[spot["id"]].append({
                "hour": hour, "validTime": valid, "gust": None,
                **{field: sample(grid, values, spot["lon"], spot["lat"])
                   for field, values in fields.items()}})
    manifest = manifest_for(run, run_time, hours, grid, frames, spot_forecasts)
    # Only this final write advances the published snapshot.
    write_run(output, f"{MODEL}.json", manifest, prefix, spots)
    transferred = sum(path.stat().st_size for path in cache.glob("*.grib2"))
    print(f"Published {len(frames)} AIFS frames to {output / (MODEL + '.json')}; "
          f"{transferred / 1e6:.1f} MB of source GRIB cached under {cache}", flush=True)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"AIFS refresh failed: {error}. Last published snapshot preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
