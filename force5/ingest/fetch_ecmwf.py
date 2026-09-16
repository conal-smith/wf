"""ECMWF IFS open-data control: real 0.25-degree, 15-day Ireland wind snapshot.

Uses public HTTP range downloads via ECMWF's client; no API key. The final
manifest is written only after all 85 frames have passed GRIB validation.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import sys

import eccodes as ec
import requests
from ecmwf.opendata import Client

from cadence import ECMWF_HOURS, ECMWF_RANGES
from fetch_forecast import ROOT, decode_handle, load_spots, sample, write_json

SOURCE_URL = "https://www.ecmwf.int/en/forecasts/datasets/open-data"


class ForecastSession(requests.Session):
    """Apply connect/read limits to discovery, index and ranged data requests."""
    def request(self, *args, **kwargs):
        if kwargs.get("timeout") is None:
            kwargs["timeout"] = (15, 90)
        return super().request(*args, **kwargs)


def client(source):
    value = Client(source=source, model="ifs", resol="0p25",
                   infer_stream_keyword=False, maximum_retries=2, retry_after=2)
    value.session.close()
    value.session = ForecastSession()
    return value


def run_datetime(run):
    value = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if len(run) != 10 or value.hour not in (0, 12):
        raise ValueError("The 15-day product requires a 00 or 12 UTC run")
    return value


def decode_wind(path, run, hour, layout=None):
    fields = {}
    with path.open("rb") as stream:
        while True:
            handle = ec.codes_grib_new_from_file(stream)
            if handle is None:
                break
            try:
                field = {165: "u", 166: "v"}.get(ec.codes_get(handle, "paramId"))
                if field is None or field in fields:
                    raise ValueError("Unexpected or duplicate ECMWF wind parameter")
                if ec.codes_get(handle, "centre") != "ecmf" or ec.codes_get(handle, "dataType") != "fc":
                    raise ValueError("Expected ECMWF IFS control forecast, not ensemble/analysis")
            except Exception:
                ec.codes_release(handle)
                raise
            fields[field], layout, _ = decode_handle(handle, field, run, hour, layout)
    if set(fields) != {"u", "v"}:
        raise ValueError("Missing ECMWF wind component")
    if layout[2]["dx"] != 0.25 or layout[2]["dy"] != 0.25:
        raise ValueError("Expected the 0.25-degree open-data grid")
    return fields, layout


def gust_parameter(hour):
    # Public inventory aliases differ across the dissemination horizon.
    return "10fg3" if 90 < hour <= 144 else "10fg"


def decode_gust(path, run, hour, layout):
    with path.open("rb") as stream:
        handle = ec.codes_grib_new_from_file(stream)
        if handle is None:
            raise ValueError("Missing ECMWF gust field")
        try:
            if (ec.codes_get(handle, "paramId") not in (49, 123, 228028, 237318)
                    or ec.codes_get(handle, "centre") != "ecmf"
                    or ec.codes_get(handle, "dataType") != "fc"
                    or ec.codes_get(handle, "numberOfMissing") != 0):
                raise ValueError("Expected a complete ECMWF scalar maximum gust field")
            extra = ec.codes_grib_new_from_file(stream)
            if extra is not None:
                ec.codes_release(extra)
                raise ValueError("Duplicate/unexpected ECMWF gust messages")
        except Exception:
            ec.codes_release(handle)
            raise
        values, _, metadata = decode_handle(handle, "gust", run, hour, layout)
    start, end = int(metadata["startStep"]), int(metadata["endStep"])
    if not 0 <= start < end or end != hour or end - start not in (1, 3, 6):
        raise ValueError("Invalid ECMWF gust maximum interval")
    return values, [start, end]


def download_gust(cache, source, run, hour, layout):
    if hour == 0:
        # No preceding forecast period at initialization. Do not invent a zero.
        return None, None
    path = cache / f"{hour:03d}-gust-v1.grib2"
    if path.exists():
        try:
            return decode_gust(path, run, hour, layout)
        except Exception:
            print(f"Re-fetching invalid cached gust +{hour:03d}h", flush=True)
    temporary = path.with_suffix(".download")
    preferred = gust_parameter(hour)
    for parameter in [preferred, "10fg" if preferred == "10fg3" else "10fg3"]:
        try:
            client(source).retrieve(date=run[:8], time=int(run[-2:]), step=hour,
                                    stream="oper", type="fc", param=parameter, target=str(temporary))
            break
        except ValueError as error:
            # Retry only an absent alias, never a network/validation error.
            if parameter != preferred or "Cannot find index entries matching" not in str(error):
                raise
    result = decode_gust(temporary, run, hour, layout)
    os.replace(temporary, path)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", help="Optional YYYYMMDDHH, cycle 00 or 12")
    parser.add_argument("--source", choices=["aws", "ecmwf", "google"], default="aws")
    args = parser.parse_args()
    # Probing +360 avoids selecting the shorter 06/18 UTC products. Individual
    # fields/steps are still validated below: existence of the last file alone
    # is not sufficient to publish a snapshot.
    run = args.run or client(args.source).latest(step=360, stream="oper", type="fc").strftime("%Y%m%d%H")
    run_time = run_datetime(run)
    age = (datetime.now(timezone.utc) - run_time).total_seconds() / 3600
    if not -1 <= age <= 24:
        raise ValueError("Refusing a stale/future ECMWF run (maximum age 24 hours)")
    print(f"Fetching ECMWF IFS {run}: 85 frames through +360h", flush=True)
    cache = ROOT / ".cache" / "ecmwf" / run
    cache.mkdir(parents=True, exist_ok=True)

    def download(hour):
        path = cache / f"{hour:03d}.grib2"
        # Validate cached data too; a corrupt cache entry must never publish.
        if path.exists():
            try:
                return hour, decode_wind(path, run, hour)
            except Exception:
                print(f"Re-fetching invalid cached frame +{hour:03d}h", flush=True)
        temporary = path.with_suffix(".download")
        client(args.source).retrieve(date=run[:8], time=int(run[-2:]), step=hour,
                                     stream="oper", type="fc", param=["10u", "10v"],
                                     target=str(temporary))
        decoded = decode_wind(temporary, run, hour)
        os.replace(temporary, path)
        print(f"  Validated +{hour:03d}h", flush=True)
        return hour, decoded

    with ThreadPoolExecutor(max_workers=3) as pool:
        decoded = dict(pool.map(download, ECMWF_HOURS))
    def fetch_gust(hour):
        result = download_gust(cache, args.source, run, hour, decoded[hour][1])
        print(f"  Validated gust +{hour:03d}h: {result[1]}", flush=True)
        return hour, result
    with ThreadPoolExecutor(max_workers=2) as pool:
        gusts = dict(pool.map(fetch_gust, ECMWF_HOURS))
    output = ROOT / "public" / "weather"
    prefix = f"ecmwf-{run}-360h-v2"
    spots = load_spots()
    spot_forecasts = {spot["id"]: [] for spot in spots}
    grid = decoded[0][1][2]
    signature = decoded[0][1][0]
    frames = []
    for hour in ECMWF_HOURS:
        fields, layout = decoded[hour]
        if layout[0] != signature or layout[2] != grid:
            raise ValueError("ECMWF grid changed within the run")
        valid = (run_time + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
        gust, interval = gusts[hour]
        payload = {"model": "ecmwf", "run": run, "hour": hour, "validTime": valid,
                   "grid": grid, "gust": gust, "gustIntervalHours": interval, **fields}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
        name = f"{prefix}/{hour:03d}-{digest}.json"
        write_json(output / name, payload)
        frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}", "gustIntervalHours": interval})
        for spot in spots:
            point = {field: sample(grid, values, spot["lon"], spot["lat"]) for field, values in fields.items()}
            spot_forecasts[spot["id"]].append({"hour": hour, "validTime": valid,
                "gust": sample(grid, gust, spot["lon"], spot["lat"]) if gust is not None else None, **point})
    manifest = {
        "schemaVersion": 1, "model": "ecmwf", "modelName": "ECMWF IFS", "provider": "ECMWF",
        "modelDetail": "IFS medium-range control forecast", "resolutionKm": None,
        "resolutionLabel": "0.25° open-data grid", "run": run,
        "runTime": run_time.isoformat().replace("+00:00", "Z"),
        "generatedAt": datetime.now(timezone.utc).isoformat(), "stepHours": 3,
        "stepRanges": ECMWF_RANGES, "grid": grid, "frames": frames, "spotForecasts": spot_forecasts,
        "gustAvailable": True, "gustMissingHours": [0],
        "gustDescription": "Scalar maximum 10 m gust over the source GRIB interval ending at each forecast time. Intervals may be 1, 3 or 6 hours and need not equal the spacing between displayed columns. Initialization (+0h) has no preceding forecast gust period and is shown as unavailable, not zero.",
        "processing": "Cropped from the public 0.25° regular grid, without downscaling. Source steps are 3-hourly to +144h, then 6-hourly to +360h; no hourly forecasts are invented. Week two is a planning outlook, not a precise local wind prediction.",
        "sourceUrl": SOURCE_URL,
        "attribution": f"© {run_time.year} European Centre for Medium-Range Weather Forecasts (ECMWF). This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF). Data cropped and processed by Force5 under CC BY 4.0. ECMWF provides no warranty and accepts no liability for errors, availability or consequences of use; it does not endorse Force5.",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "termsUrl": "https://apps.ecmwf.int/datasets/licences/general/",
    }
    write_json(output / "ecmwf.json", manifest)
    print(f"Published {len(frames)} ECMWF frames to {output / 'ecmwf.json'}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ECMWF refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
