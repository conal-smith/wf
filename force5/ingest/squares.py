"""Spot squares: the 2° × 2° key every spot-shaped file is cut by.

A run's per-spot data (`spotForecasts`, `spotSeries`, `spotCoverage`,
`spotMembers`, `spotCells`, and the blend's `spotBlend`) used to sit inside its
pointer manifest, which made every manifest grow with every spot and made every
page load download all of it.
It now lives in one file per square of the run directory,
`spots/<square>.json`, and the manifest only lists the squares
(docs/TILING_DESIGN.md, decision 6).

A square is named by its south-west corner on even degrees, the way SRTM names
elevation tiles: `n52w010` covers 52–54° N and 10–8° W. The same rule is
`spotSquare` in force5/src/squares.ts, and both are held to
tests/fixtures/squares.json.

Two halves, one per direction:

- `split_spot_data` is the only writer. rundir.write_run calls it as a run is
  published, so every adapter keeps building the whole manifest in memory and
  none of them knows squares exist.
- `load_spot_data` is the only reader. It takes the pointer and a function that
  reads a JSON file relative to the pointer's own directory, so the same code
  reads a work directory, a bucket or a scratch copy.
"""
from datetime import datetime, timedelta, timezone
import math
from pathlib import PurePosixPath
import re

SQUARE_DEGREES = 2
SCHEMA_VERSION = 2
# Every per-spot key a run manifest may carry. `spotCells` is Irish Shelf SWAN's
# record of the wet cell each spot was read from; it used to be called `spots`,
# which is now the name of the square index. `spotBlend` is the blend's own
# consensus per riding place (src/spotBlend.ts), which the blend publishes as a
# run of its own, and which no model carries.
SPOT_KEYS = ("spotForecasts", "spotSeries", "spotCoverage", "spotMembers", "spotCells",
             "spotBlend")
SQUARE_URL = "spots/{square}.json"
SQUARE_NAME = re.compile(r"[ns]\d{2}[ew]\d{3}")
# `<model>-<run>-<hours>h-v<N>-<hash8>/`, one path segment. rundir.py names it.
RUN_DIRECTORY = re.compile(r"[a-z0-9][a-z0-9.-]*-[0-9a-f]{8}")
# How long a pointer remembers the run directories it replaced (`superseded`),
# and how many it names at most: longer than any grace the pruners are given, and
# few enough that an hourly model's pointer grows by a few hundred bytes.
SUPERSEDED_KEEP_HOURS = 6
SUPERSEDED_LIMIT = 24


def spot_square(lat, lon):
    """The square holding a point: 'n' or 's', two digits, 'e' or 'w', three digits.

    Floor, not truncation, so 0.5° S is in s02 (2° S to the equator), and the
    square is always named by its south-west corner. Longitude wraps, so 180° E
    is the square at 180° W; a latitude of exactly 90° belongs to the top row.
    """
    if not (math.isfinite(lat) and math.isfinite(lon)) or abs(lat) > 90:
        raise ValueError(f"No square for {lat}, {lon}")
    lat0 = min(math.floor(lat / SQUARE_DEGREES) * SQUARE_DEGREES, 90 - SQUARE_DEGREES)
    lon0 = (math.floor(lon / SQUARE_DEGREES) * SQUARE_DEGREES + 180) % 360 - 180
    return (f"{'n' if lat0 >= 0 else 's'}{abs(lat0):02d}"
            f"{'e' if lon0 >= 0 else 'w'}{abs(lon0):03d}")


def squares_for(spots):
    """The sorted squares a list of spots (dicts with lat and lon) fall in."""
    return sorted({spot_square(spot["lat"], spot["lon"]) for spot in spots})


def check_base(base):
    """A manifest's `base`: one run directory beside the pointer, ending in '/'."""
    if not isinstance(base, str) or not base.endswith("/") \
            or not RUN_DIRECTORY.fullmatch(base[:-1]):
        raise ValueError(f"Unusable run directory {base!r}")
    return base


def run_path(base, relative):
    """A file of the run, relative to the pointer's directory. Never leaves `base`."""
    path = PurePosixPath(str(relative))
    if not relative or path.is_absolute() or ".." in path.parts or "." in path.parts \
            or str(relative) != str(path) or "\\" in str(relative):
        raise ValueError(f"Unusable path {relative!r} inside a run directory")
    return check_base(base) + str(path)


def iso_time(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def superseded_entries(manifest):
    """The run directories a pointer says it replaced, as `(base, when)` pairs.

    A pointer that swapped its run directory for another names the old one under
    `superseded`, `[{"base": "harmonie-…-1a2b3c4d/", "at": "2026-10-11T12:00:00Z"}]`,
    so the pruners can leave it for readers still holding the old pointer. An
    entry whose base is unusable names nothing and is skipped; one whose time
    cannot be read gives `when` None, which the pruners read as "just now".
    """
    entries = manifest.get("superseded") if isinstance(manifest, dict) else None
    out = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        try:
            base = check_base(entry.get("base"))
        except ValueError:
            continue
        try:
            when = datetime.fromisoformat(str(entry.get("at")).replace("Z", "+00:00"))
            when = when if when.tzinfo else None
        except ValueError:
            when = None
        out.append((base, when))
    return out


def retire(previous, manifest, now):
    """The `superseded` list for `manifest`, the pointer about to replace `previous`.

    What `previous` already remembered, younger than `SUPERSEDED_KEEP_HOURS`, and
    `previous`'s own run directory at `now` when it is not the one `manifest`
    names. A directory the new pointer names again is dropped from the list: it
    is live, not superseded. Oldest first, at most `SUPERSEDED_LIMIT`.
    """
    live = manifest.get("base")
    cutoff = now - timedelta(hours=SUPERSEDED_KEEP_HOURS)
    retired = {}
    for base, when in superseded_entries(previous):
        when = when or now
        if base != live and when > cutoff:
            retired[base] = max(when, retired.get(base, when))
    if isinstance(previous, dict) and previous.get("base") not in (None, live):
        try:
            retired[check_base(previous["base"])] = now
        except ValueError:
            pass  # An unusable base names nothing worth keeping.
    ordered = sorted(retired.items(), key=lambda item: (item[1], item[0]))[-SUPERSEDED_LIMIT:]
    return [{"base": base, "at": iso_time(when)} for base, when in ordered]


def square_index(manifest):
    """The manifest's `spots` block, checked: the squares it lists, in order."""
    index = manifest.get("spots")
    if not isinstance(index, dict) or index.get("squareDegrees") != SQUARE_DEGREES \
            or index.get("url") != SQUARE_URL:
        raise ValueError("Manifest has no usable spot square index")
    squares, keys = index.get("squares"), index.get("keys")
    if not isinstance(squares, list) or squares != sorted(set(squares)) \
            or not all(isinstance(s, str) and SQUARE_NAME.fullmatch(s) for s in squares):
        raise ValueError("Spot squares must be distinct square names, sorted")
    if not isinstance(keys, list) or len(set(keys)) != len(keys) \
            or not set(keys) <= set(SPOT_KEYS):
        raise ValueError("Spot square keys must be distinct per-spot keys")
    return index


def square_path(manifest, square):
    """Where one square file is, relative to the pointer's directory."""
    return run_path(manifest.get("base"), square_index(manifest)["url"].replace("{square}", square))


def split_spot_data(manifest, spots):
    """The pointer and one document per square, from a whole manifest held in memory.

    `spots` are the places the adapter sampled, with their coordinates: the same
    catalogue entries (fetch_forecast.load_spots) that put the spot in the
    manifest in the first place. A spot the manifest names and the catalogue does
    not is refused rather than guessed at.
    """
    where = {}
    for spot in spots:
        where[spot["id"]] = spot_square(spot["lat"], spot["lon"])
    if isinstance(manifest.get("spots"), dict) and "squares" in manifest["spots"]:
        raise ValueError("This manifest is already split into spot squares")
    if "spots" in manifest:
        raise ValueError("A run manifest's `spots` is the square index; per-spot records "
                         "belong in a spot key such as `spotCells`")
    # `superseded` belongs to the pointer a run replaces, never to the run itself:
    # whoever writes the pointer works it out afresh (rundir.write_run, publish_s3).
    pointer = {key: value for key, value in manifest.items()
               if key not in SPOT_KEYS and key != "superseded"}
    pointer["schemaVersion"] = SCHEMA_VERSION
    keys = [key for key in SPOT_KEYS if key in manifest]
    squares = {}
    for key in keys:
        values = manifest[key]
        if not isinstance(values, dict):
            raise ValueError(f"{key} must map spot ids to values")
        for spot, value in values.items():
            if spot not in where:
                raise ValueError(f"{key} names {spot!r}, which has no coordinates in the "
                                 "spot catalogue; cannot place it in a square")
            squares.setdefault(where[spot], {}).setdefault(key, {})[spot] = value
    documents = {square: {"schemaVersion": SCHEMA_VERSION, "model": manifest["model"],
                          "run": manifest["run"], "square": square, **squares[square]}
                 for square in sorted(squares)}
    if not manifest.get("frames") and "horizonHours" not in manifest:
        # A frameless run used to be timed by its series; the pointer alone must
        # still say how far it reaches, so a reader need not load a square for it.
        last = [steps[-1]["hour"] for key in ("spotForecasts", "spotMembers")
                for steps in (manifest.get(key) or {}).values() if steps]
        if last:
            pointer["horizonHours"] = max(last)
    pointer["spots"] = {"squareDegrees": SQUARE_DEGREES, "url": SQUARE_URL,
                        "squares": sorted(documents), "keys": keys}
    return pointer, documents


def check_square(manifest, square, document, keys):
    """One square file read back: its envelope, and only per-spot keys inside."""
    if not isinstance(document, dict) or document.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"Spot square {square} has an unknown schema")
    if (document.get("model"), document.get("run"), document.get("square")) \
            != (manifest.get("model"), manifest.get("run"), square):
        raise ValueError(f"Spot square {square} belongs to another model, run or square")
    extra = set(document) - {"schemaVersion", "model", "run", "square"} - set(keys)
    if extra:
        raise ValueError(f"Spot square {square} carries undeclared keys {sorted(extra)}")
    present = [key for key in keys if key in document]
    if not present:
        raise ValueError(f"Spot square {square} carries no spot data")
    for key in present:
        if not isinstance(document[key], dict) or not document[key]:
            raise ValueError(f"Spot square {square} has an empty or malformed {key}")
    return document


def load_spot_data(manifest, read_json, squares=None):
    """The per-spot data of a run, merged from its square files.

    `read_json(path)` returns the parsed file at `path`, relative to the
    pointer's directory (so `harmonie-…-1a2b3c4d/spots/n52w010.json` for
    `weather/harmonie.json`). `squares` limits the read to those squares; a square
    the manifest does not list holds none of its spots and is skipped. Omitted,
    every listed square is read. A spot found in two squares is a corrupt run.
    """
    index = square_index(manifest)
    listed = set(index["squares"])
    wanted = index["squares"] if squares is None else [
        square for square in dict.fromkeys(squares) if square in listed]
    merged = {key: {} for key in index["keys"]}
    for square in wanted:
        document = check_square(manifest, square, read_json(square_path(manifest, square)),
                                index["keys"])
        for key in index["keys"]:
            for spot, value in (document.get(key) or {}).items():
                if spot in merged[key]:
                    raise ValueError(f"{spot} appears in more than one spot square of {key}")
                merged[key][spot] = value
    return merged


def with_spot_data(manifest, read_json, squares=None):
    """The manifest with its spot data merged back in: the shape adapters build."""
    return {**manifest, **load_spot_data(manifest, read_json, squares)}
