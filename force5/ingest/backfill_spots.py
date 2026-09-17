"""Recompute a published manifest's per-spot series from its own bundled frames.

A snapshot published before `public/riding-locations.json` existed carries
`spotForecasts` for only the original eight spots, and the browser's blend and
candle views are unavailable wherever a series is missing. The provider runs have
long since rotated, so they cannot be downloaded again — but every frame of those
runs is bundled, and the adapters derive each spot series from nothing except the
frame grids and `sample()`. So the missing series are recoverable exactly, with no
new source data and no change to any immutable frame.

This tool reads a manifest, re-derives every spot's series from the frames it
already references, and rewrites only `spotForecasts` (wind) or `spotSeries`
(wave). Spots that are already published are checked against the recomputation
and then kept byte-for-byte: a disagreement means the frames and the manifest
describe different data, which is a corrupt bundle rather than something to
paper over, so the run aborts without writing.

    .venv/bin/python force5/ingest/backfill_spots.py --all --check
    .venv/bin/python force5/ingest/backfill_spots.py harmonie icon-eu ecmwf gfs

Ensemble manifests are refused: `spotMembers` holds per-member values and the
bundled frames are the ensemble mean, so the members are not recoverable.

Binary frames (`encoding: "f5-int16-v1"`) are decoded and resampled the same way,
but they store tenths of a metre per second while an adapter's own series was
sampled from the full-precision field, so recomputation over them agrees only to
`BINARY_TOLERANCE` rather than to rounding noise. That looser limit applies to a
binary manifest and to nothing else.

**A series this tool adds to a binary bundle is therefore coarser than one the
adapter published.** The adapter sampled the source field; this samples the
quantised frame, because the source is long gone — that is the whole point of
the tool. The difference is at most 0.06 m/s, well under a tenth of a knot, and
it is invisible in the table and the chart. It is worth knowing about anyway:
a backfilled spot's series and a freshly ingested one are not byte-identical,
and only the fresh one is exact. The next run publishes the exact series.
"""
import argparse
import json
from pathlib import Path, PurePosixPath
import sys

import f5bin
from fetch_forecast import ROOT, load_spots, sample, spots_file, write_json
from publish_s3 import frame_encoding, referenced
from registry import MANIFESTS, MODELS

WIND_FIELDS = ("u", "v", "gust")
# The manifest's own agreement limit: recomputation is deterministic, so anything
# above rounding noise means the frames and the published series disagree.
TOLERANCE = 0.005
# A binary frame stores tenths of a metre per second while the series it is
# checked against was sampled from the full-precision field and rounded to
# hundredths. Each of the four cells a bilinear sample reads is at most 0.05 out,
# and a convex combination of them is too, so the sample is at most 0.05 out;
# the two roundings to 0.01 add 0.005 each. Anything past 0.06 is a real
# disagreement, not the quantisation.
BINARY_TOLERANCE = 0.06


def tolerance(manifest):
    """How far a recomputed value may sit from its published one, per encoding."""
    return BINARY_TOLERANCE if frame_encoding(manifest) else TOLERANCE


def read_frame(public, model, manifest, info):
    """One referenced frame, through the publisher's own unsafe-path guard.

    `referenced` requires the run directory to be named for this model, which is
    what establishes a binary frame's model — the file itself does not carry one.
    Its header carries the run, the hour and the grid size, and its name is the
    hash of its own bytes, so a file from the wrong step or with the wrong
    contents is refused. The valid time is the manifest's, as it is for JSON.
    """
    _, data = referenced(public, info["url"], model, 3)
    if frame_encoding(manifest):
        decoded = f5bin.decode_frame(data)
        if (decoded["run"], decoded["hour"]) != (manifest["run"], info["hour"]):
            raise ValueError(f"{info['url']} is not the frame the manifest lists at "
                             f"+{info['hour']}h of run {manifest['run']}")
        if not f5bin.names_these_bytes(PurePosixPath(info["url"]).name, info["hour"], data):
            raise ValueError(f"{info['url']} does not hold the frame its name claims")
        grid = manifest["grid"]
        if (decoded["width"], decoded["height"]) != (grid["width"], grid["height"]):
            raise ValueError(f"{info['url']} does not match the published grid")
        return {"model": model, "hour": decoded["hour"], "validTime": info["validTime"],
                "grid": grid, "u": decoded["u"], "v": decoded["v"], "gust": decoded["gust"]}
    frame = json.loads(data)
    if (frame.get("hour"), frame.get("validTime")) != (info["hour"], info["validTime"]):
        raise ValueError(f"{info['url']} is not the frame the manifest lists at "
                         f"+{info['hour']}h")
    if frame.get("model") != model:
        raise ValueError(f"{info['url']} belongs to model {frame.get('model')!r}")
    return frame


def field_order(published, fields):
    """Keep each adapter's own key order, so untouched entries stay byte-identical."""
    order = [key for key in published if key in fields] if published else []
    return order + [field for field in fields if field not in order]


def wind_series(manifest, model, public, spots, order):
    """Every spot's u/v/gust series, sampled from the frames as the adapters do."""
    gust_available = manifest.get("gustAvailable") is not False
    missing_gust_hours = manifest.get("gustMissingHours", [])
    series = {spot["id"]: [] for spot in spots}
    for info in manifest["frames"]:
        frame = read_frame(public, model, manifest, info)
        grid, hour = frame["grid"], frame["hour"]
        # A gust the manifest declares absent is null everywhere, never zero; a
        # gust it declares present must actually be in the frame.
        gust_missing = not gust_available or hour in missing_gust_hours
        fields = {}
        for field in WIND_FIELDS:
            values = frame.get(field)
            if field == "gust" and gust_missing:
                if values is not None:
                    raise ValueError(f"+{hour}h carries a gust the manifest calls unavailable")
                values = None
            elif values is None:
                raise ValueError(f"+{hour}h is missing its {field} field")
            fields[field] = values
        for spot in spots:
            # A spot outside the grid samples to None, exactly as ECMWF and GFS
            # publish it: no clamping to the edge and no invented value.
            point = {field: None if fields[field] is None
                     else sample(grid, fields[field], spot["lon"], spot["lat"])
                     for field in order}
            series[spot["id"]].append({"hour": hour, "validTime": frame["validTime"], **point})
    return series


def wave_series(manifest, model, public, spots, variables):
    """Every spot's wave series, null-propagating over land as GFS-Wave does."""
    # pyproj is only needed to decode a wave GRIB, never to resample a published
    # frame, so the import stays inside the wave path.
    from fetch_gfswave import sample_wave

    series = {spot["id"]: [] for spot in spots}
    for info in manifest["frames"]:
        frame = read_frame(public, model, manifest, info)
        grid = frame["grid"]
        for name in variables:
            if not isinstance(frame.get(name), list):
                raise ValueError(f"+{frame['hour']}h is missing its {name} field")
        for spot in spots:
            series[spot["id"]].append({
                "hour": frame["hour"], "validTime": frame["validTime"],
                "values": {name: sample_wave(grid, frame[name], spot["lon"], spot["lat"])
                           for name in variables}})
    return series


def disagreements(published, rebuilt, describe):
    """Where a published series and its recomputation differ by more than rounding."""
    faults = []
    for spot, steps in published.items():
        recomputed = rebuilt.get(spot)
        if recomputed is None or len(recomputed) != len(steps):
            faults.append(f"{spot}: {len(steps)} published steps, "
                          f"{0 if recomputed is None else len(recomputed)} recomputed")
            continue
        for step, other in zip(steps, recomputed):
            if (step.get("hour"), step.get("validTime")) != (other["hour"], other["validTime"]):
                faults.append(f"{spot} +{step.get('hour')}h: published valid time "
                              f"{step.get('validTime')} is not {other['validTime']}")
                continue
            faults.extend(describe(spot, step, other))
    return faults


def wind_faults(spot, step, other, limit=TOLERANCE):
    for field in WIND_FIELDS:
        was, now = step.get(field), other[field]
        if (was is None) != (now is None):
            yield f"{spot} +{step['hour']}h {field}: published {was}, frames give {now}"
        elif was is not None and abs(was - now) > limit:
            yield f"{spot} +{step['hour']}h {field}: published {was}, frames give {now}"


def wave_faults(spot, step, other, limit=TOLERANCE):
    was, now = step.get("values") or {}, other["values"]
    if set(was) != set(now):
        yield f"{spot} +{step['hour']}h: published variables {sorted(was)} are not {sorted(now)}"
        return
    for name in now:
        if (was[name] is None) != (now[name] is None):
            yield f"{spot} +{step['hour']}h {name}: published {was[name]}, frames give {now[name]}"
        elif was[name] is not None and abs(was[name] - now[name]) > limit:
            yield f"{spot} +{step['hour']}h {name}: published {was[name]}, frames give {now[name]}"


def backfill(public, model, spots=None, check=False, log=print):
    """Rewrite one manifest's spot series from its frames. Returns the ids added.

    Nothing is written when `check` is set, and nothing is written when the
    published series and the recomputation disagree: the caller sees the fault
    instead of a manifest that silently contradicts its own frames.
    """
    public = Path(public).resolve()
    path = public / MANIFESTS[model]
    manifest = json.loads(path.read_text())
    kind = manifest.get("kind", "wind")
    if kind != MODELS[model]["kind"]:
        raise ValueError(f"{model} manifest declares kind {kind!r}, "
                         f"not the registry's {MODELS[model]['kind']!r}")
    if manifest.get("spotMembers") is not None or manifest.get("ensemble") is not None:
        raise ValueError(f"{model} is an ensemble: spotMembers holds per-member values and "
                         "the bundled frames are the ensemble mean, so members cannot be "
                         "recomputed. Re-run the adapter against a live cycle instead.")
    if kind not in ("wind", "wave"):
        raise ValueError(f"{model} bundles are {kind!r}; only wind and wave carry spot series")
    if not manifest.get("frames"):
        log(f"{model}: no frames are bundled, so no series can be recomputed. Skipped.")
        return []

    spots = load_spots() if spots is None else spots
    key = "spotForecasts" if kind == "wind" else "spotSeries"
    published = manifest.get(key) or {}
    # Checked before anything is recomputed, so a shrunken catalogue is reported as
    # itself rather than as a series the frames "cannot reproduce".
    dropped = [spot for spot in published if spot not in {entry["id"] for entry in spots}]
    if dropped:
        raise ValueError(f"{model}: {', '.join(dropped)} are published but absent from "
                         f"{spots_file()}; refusing to drop a published series")
    if kind == "wind":
        order = field_order((next(iter(published.values()), None) or [{}])[0], WIND_FIELDS)
        rebuilt = wind_series(manifest, model, public, spots, order)
        limit = tolerance(manifest)
        faults = disagreements(published, rebuilt,
                               lambda *args: wind_faults(*args, limit=limit))
    else:
        variables = list(manifest.get("variables") or {})
        gridded = manifest.get("frameVariables", variables)
        if set(gridded) != set(variables):
            log(f"{model}: frames carry only {sorted(gridded)} of {sorted(variables)}, "
                "so a full series cannot be recomputed. Skipped.")
            return []
        uncovered = [spot["id"] for spot in spots if spot["id"] not in (manifest.get("spotCoverage") or {})]
        if uncovered:
            log(f"{model}: spotCoverage is derived from the native land mask, not from the "
                f"published frames, so {len(uncovered)} location(s) cannot be added: "
                f"{', '.join(uncovered)}. Skipped.")
            return []
        rebuilt = wave_series(manifest, model, public, spots, variables)
        faults = disagreements(published, rebuilt, wave_faults)

    if faults:
        shown = "\n  ".join(faults[:10])
        raise ValueError(f"{model}: the bundled frames disagree with the published {key} in "
                         f"{len(faults)} place(s); refusing to rewrite it.\n  {shown}")
    # Published spots keep their exact published entries: recomputation has just
    # proved they agree, and an untouched byte cannot drift.
    series = {spot["id"]: published.get(spot["id"], rebuilt[spot["id"]]) for spot in spots}
    added = [spot["id"] for spot in spots if spot["id"] not in published]
    verb = "would gain" if check else "gains"
    log(f"{model}: {len(published)} published series verified against {len(manifest['frames'])} "
        f"frames; {verb} {len(added)} of {len(spots)} ({', '.join(added) or 'none'})")
    if check or not added:
        return added
    # Assigning an existing key keeps its position, so the manifest's shape is
    # unchanged apart from the series themselves.
    manifest[key] = series
    write_json(path, manifest)
    return added


def backfillable_models(public, log=print):
    """Local wind/wave manifests, minus the ensembles that cannot be recomputed.

    `--all` is a sweep of what this tool can do, so an ensemble bundle is
    reported and stepped over rather than failing the sweep. Naming one
    explicitly still refuses, which is what a request to backfill it deserves.
    """
    models = []
    for model, entry in MODELS.items():
        path = Path(public) / entry["manifest"]
        if entry["kind"] not in ("wind", "wave") or not path.exists():
            continue
        manifest = json.loads(path.read_text())
        if manifest.get("spotMembers") is not None or manifest.get("ensemble") is not None:
            log(f"{model}: an ensemble's members cannot be recomputed from mean frames. Skipped.")
            continue
        models.append(model)
    return models


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("models", nargs="*", metavar="MODEL",
                        help=f"Registry model ids to backfill: {', '.join(MODELS)}")
    parser.add_argument("--all", action="store_true",
                        help="Every wind and wave model whose manifest exists locally")
    parser.add_argument("--public", default=str(ROOT / "public"),
                        help="Published output directory (default: the working tree's public/)")
    parser.add_argument("--check", action="store_true",
                        help="Report what would change and write nothing")
    args = parser.parse_args(argv)
    unknown = [model for model in args.models if model not in MODELS]
    if unknown:
        parser.error(f"Unknown model(s): {', '.join(unknown)}")
    models = backfillable_models(args.public) if args.all else list(dict.fromkeys(args.models))
    if not models:
        parser.error("Name at least one model, or pass --all")
    spots = load_spots()
    print(f"Backfilling {len(spots)} spots from {spots_file()}"
          f"{' (dry run)' if args.check else ''}", flush=True)
    failures = 0
    for model in models:
        try:
            backfill(args.public, model, spots, args.check)
        except Exception as error:
            failures += 1
            print(f"{model}: {error}", file=sys.stderr, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
