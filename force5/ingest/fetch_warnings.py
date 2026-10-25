"""Met Éireann's weather warnings, as they stand, for the site and the MCP server.

Met Éireann publishes every warning in force or still to come, land and marine, in
one open JSON file (warning_ALL.json), updated within a minute of any change. This
job copies it to `marine/warnings.json` beside the forecasts once an hour, so the
map, the spot page and the MCP server read one file from one origin and can never
disagree (force5/src/warnings.ts is what they read it with, and where the rule for
the stars lives). A warning issued, upgraded or lifted can therefore take up to
about an hour to show here; Met Éireann's own page is linked beside them for the
latest.

Licence: CC BY 4.0, with Met Éireann's own conditions, which this job keeps:

  - each warning is published exactly as Met Éireann wrote it: its issue and
    update times, onset, expiry, regions, headline, description, severity,
    certainty, type, level and status are copied, never edited or reformatted;
  - warnings already expired are left out, the file is rewritten every hour, and
    the readers drop a warning at its expiry by the clock and stop trusting a file
    more than three hours old (force5/src/warnings.ts), so nothing lifted or
    expired is shown as current for long;
  - the file names Met Éireann as its source, and every display credits it.

`run` is the hour the feed was read in, so the registry's freshness limit measures
how long since the job last succeeded, and each hourly run publishes a new file.
A feed this job cannot read, or one whose shape has changed, fails the job rather
than publishing an empty list: an empty list says "no warnings", which a broken
feed must never say. The site then shows the warnings as not checked and points
riders to met.ie.
"""
import argparse
from datetime import datetime, timezone
import re
import sys

import requests

from fetch_forecast import ROOT, write_json
import timing

MANIFEST = "marine/warnings.json"
FEED = "https://www.met.ie/Open_Data/json/warning_ALL.json"
WARNINGS_PAGE = "https://www.met.ie/warnings"
USER_AGENT = "Force5/0.1 (wingfoil.ie prototype)"
SESSION = timing.count_responses(requests.Session())
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = ("Weather warnings from Met Éireann (met.ie), licensed under CC BY 4.0, "
               "published unaltered. Met Éireann does not accept any liability whatsoever "
               "for any error or omission in the data, their availability, or for any loss "
               "or damage arising from their use.")
CONDITIONS = ("Met Éireann's conditions: acknowledge Met Éireann as the source; do not "
              "materially change a warning's time of issue, onset or expiry, area, "
              "description, severity, certainty, event or headline; keep warnings up to "
              "date and remove expired ones.")

# The levels this site shows. Met Éireann's CAP scale also has "green" (Minor),
# which it does not issue as a warning; a level outside the scale means the feed
# has changed, and fails the job.
LEVELS = ("yellow", "orange", "red")
KNOWN_LEVELS = LEVELS + ("green",)
TEXT_FIELDS = ("capId", "type", "severity", "certainty", "level", "issued", "updated",
               "onset", "expiry", "headline", "description", "status")
TIME_FIELDS = ("issued", "updated", "onset", "expiry")
# County FIPS codes (EI01-EI31) and sea area EMMA_IDs (EI805-EI825).
REGION = re.compile(r"EI\d{2}|EI8\d{2}")


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def moment(value, label):
    """A feed time: ISO 8601 with its offset, as Met Éireann writes it."""
    try:
        at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} is not a time: {value!r}") from error
    if at.tzinfo is None:
        raise ValueError(f"{label} has no time zone: {value!r}")
    return at


def check_warning(warning, index):
    """Raise unless a feed entry has the shape the site reads; return its expiry."""
    label = f"Warning {index}"
    if not isinstance(warning, dict):
        raise ValueError(f"{label} is not an object")
    for field in TEXT_FIELDS:
        if not isinstance(warning.get(field), str):
            raise ValueError(f"{label} has no {field}")
    if not warning["capId"].strip() or not warning["headline"].strip():
        raise ValueError(f"{label} has an empty capId or headline")
    if warning["level"].strip().lower() not in KNOWN_LEVELS:
        raise ValueError(f"{label} has an unknown level {warning['level']!r}")
    times = {field: moment(warning[field], f"{label} {field}") for field in TIME_FIELDS}
    if times["expiry"] < times["onset"]:
        raise ValueError(f"{label} expires before its onset")
    regions = warning.get("regions")
    if not isinstance(regions, list) or not regions or not all(
            isinstance(code, str) and REGION.fullmatch(code) for code in regions):
        raise ValueError(f"{label} has no usable regions")
    return times["expiry"]


def current_warnings(feed, now):
    """The feed's warnings still to expire, at a level the site shows, untouched."""
    if not isinstance(feed, list):
        raise ValueError("The warnings feed is not a list")
    kept = []
    for index, warning in enumerate(feed):
        expiry = check_warning(warning, index)
        if expiry > now and warning["level"].strip().lower() in LEVELS:
            kept.append(warning)
    return kept


def build_manifest(feed, now):
    run = now.replace(minute=0, second=0, microsecond=0)
    return {
        "schemaVersion": 1, "kind": "warnings", "model": "warnings",
        "modelName": "Met Éireann weather warnings", "provider": "Met Éireann",
        "run": run.strftime("%Y%m%d%H"), "runTime": stamp(run), "generatedAt": stamp(now),
        # `sourceUrl`, never `url`: the pruner reads every "url" as an object.
        "sourceUrl": FEED, "warningsPage": WARNINGS_PAGE,
        "licence": "CC BY 4.0", "licenseUrl": LICENSE_URL,
        "attribution": ATTRIBUTION, "conditions": CONDITIONS,
        "warnings": current_warnings(feed, now),
    }


def fetch_feed():
    response = SESSION.get(FEED, headers={"User-Agent": USER_AGENT,
                                          "Accept": "application/json"}, timeout=30)
    response.raise_for_status()
    return response.json()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.parse_args(argv)
    timing.start("download")
    feed = fetch_feed()
    timing.start("decode")
    manifest = build_manifest(feed, datetime.now(timezone.utc).replace(microsecond=0))
    out = ROOT / "public" / MANIFEST
    write_json(out, manifest)
    levels = [w["level"].lower() for w in manifest["warnings"]]
    print(f"Met Éireann warnings: {len(levels)} current "
          f"({', '.join(f'{levels.count(level)} {level}' for level in LEVELS)}), "
          f"of {len(feed)} in the feed, written to {out}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Warnings refresh failed: {error}. Last published warnings preserved.",
              file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
