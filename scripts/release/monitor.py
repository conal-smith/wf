"""Watch what production serves: every live model's pointer and the files it names.

.github/workflows/monitor.yml runs this every two hours against
PRODUCTION_FORECAST_BASE_URL, on a stock runner with nothing installed: Python's
standard library only. It is read-only towards the data domain.

    python3 scripts/release/monitor.py check --base https://data.wingfoil.ie/ \\
        [--site https://wingfoil.ie] [--json monitor.json] [--summary FILE]
    python3 scripts/release/monitor.py issue monitor.json    # in Actions

**Which models.** The ones production publishes and the site reads, worked out
from the checkout so retiring or reviving a model changes the monitor with it:
every model of an enabled worker job in deploy/local/jobs.toml (the timetable
Home Compute and Cloudflare are generated from), plus any model the site lists
(force5/src/catalog.ts, neither `planned` nor `retired`), minus every model the
site calls retired or planned. A model the site lists but no job publishes is
therefore checked, and goes stale: that is a real fault, not noise.

**What is checked, per model.** The pointer parses; a run (`wind`, `wave`,
`weather`, `blend`) is schemaVersion 2 with a usable `base` and spot square index;
tides, observations, the archive and the scores are the schemaVersion 1 bundles
they are. Its `run` is no older than force5/ingest/registry.py's `maxAgeHours` --
the limit status.py calls stale, the one that means something is wrong -- plus
`MARGIN_HOURS`, and a run's coverage has not ended. Then, with HEAD requests
only: every spot square it lists; for a tiled run, every tile of the coarsest
level and the first level-0 tile at the first frame, skipping tiles the pointer
calls `absent`; for a schemaVersion 1 bundle, every file it names by `url`. Every
one of those must be cached as immutable and every tile served brotli or gzip
encoded; the pointer must not be cached for long.

**The site**, when --site is given: it answers 200 with the
`wingfoil:forecast-base` meta naming this data domain, and the data domain allows
that origin (CORS) on a pointer. No browser.

The result is a Markdown table (stdout, and --summary for $GITHUB_STEP_SUMMARY)
and --json for the `issue` command, which opens, updates or closes the single
"Production monitor: forecast data problem" issue (label `monitor`). It comments
only when the set of problems changes, so a fault that lasts a day is one
notification, not twelve. Exit status: 0 all good, 1 a problem found.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import sys
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
import zlib

ROOT = Path(__file__).resolve().parents[2]
JOBS_FILE = ROOT / "deploy" / "local" / "jobs.toml"
CATALOG_FILE = ROOT / "force5" / "src" / "catalog.ts"
# registry.py and squares.py import nothing outside the standard library.
sys.path.insert(0, str(ROOT / "force5" / "ingest"))

from registry import MANIFESTS, MODELS  # noqa: E402
from squares import check_base, square_index, square_path  # noqa: E402

# On top of the registry's limit: the monitor runs every two hours and a job may
# sit in Home Compute's queue for a while, so a run an hour past its limit is late,
# not merely about to be replaced.
MARGIN_HOURS = 1.0
# A run kind publishes a run directory behind a schemaVersion 2 pointer.
RUN_KINDS = ("wind", "wave", "weather", "blend")
# Pointers are revalidated by every reader; anything cached longer than this is wrong.
POINTER_MAX_AGE_SECONDS = 300
IMMUTABLE_MIN_AGE_SECONDS = 86400
TILE_URL = "t/{level}/{x}/{y}/{hour}.bin"
TILE_ENCODINGS = ("br", "gzip")
FORECAST_BASE_META = "wingfoil:forecast-base"
USER_AGENT = "wingfoil-production-monitor (+https://github.com/sprintengine/wingfoil)"

ISSUE_TITLE = "Production monitor: forecast data problem"
ISSUE_LABEL = "monitor"
SIGNATURE = re.compile(r"<!-- production-monitor signature: ([^>]*?) -->")


# --- which models -----------------------------------------------------------------

def catalog_flags(text):
    """{id: {"retired": bool, "planned": bool}} for every entry of catalog.ts's MODEL_CATALOG."""
    start = text.index("MODEL_CATALOG")
    body = text[start:text.index("\n];", start)]
    found = list(re.finditer(r'\bid:\s*"([^"]+)"', body))
    flags = {}
    for index, match in enumerate(found):
        end = found[index + 1].start() if index + 1 < len(found) else len(body)
        entry = body[match.end():end]
        flags[match.group(1)] = {"retired": bool(re.search(r"\bretired:\s*true\b", entry)),
                                 "planned": bool(re.search(r"\bplanned:\s*true\b", entry))}
    return flags


def enabled_models(jobs):
    """Models of every enabled worker job, as the scheduler reads jobs.toml."""
    models = set()
    for job in jobs.get("jobs", []):
        if not isinstance(job, dict) or job.get("command", "worker") != "worker":
            continue
        if job.get("enabled", True) is False:
            continue
        models.update(model for model in job.get("models", []) if isinstance(model, str))
    return models


def live_models(jobs, flags, registry=MODELS):
    """[(model, note)] in registry order: what production publishes and the site reads."""
    off = {model for model, flag in flags.items() if flag["retired"] or flag["planned"]}
    listed = {model for model, flag in flags.items() if not (flag["retired"] or flag["planned"])}
    enabled = enabled_models(jobs)
    out = []
    for model in registry:
        if model in off or (model not in enabled and model not in listed):
            continue
        note = "" if model in enabled else "the site lists it but no enabled job publishes it"
        out.append((model, note))
    return out


def load_live_models(jobs_file=JOBS_FILE, catalog_file=CATALOG_FILE):
    with open(jobs_file, "rb") as handle:
        jobs = tomllib.load(handle)
    return live_models(jobs, catalog_flags(Path(catalog_file).read_text()))


# --- HTTP ---------------------------------------------------------------------------

class Response:
    def __init__(self, url, status=None, headers=None, body=b"", error=None):
        self.url, self.status, self.body, self.error = url, status, body, error
        self.headers = {key.lower(): value for key, value in (headers or {}).items()}

    def describe(self):
        return f"answered {self.status}" if self.status is not None else f"failed ({self.error})"


def urllib_fetch(method, url, headers, timeout):
    """One request: (status, headers, body). An HTTP error status is an answer, not an error."""
    request = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), b""


TRANSIENT = (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError,
             http.client.HTTPException, OSError)


class Http:
    """GET and HEAD with timeouts, retrying what a flaky network or a busy edge returns.

    A dropped connection, a timeout, a 429 or a 5xx is retried `retries` times
    with a growing pause; a 404 is an answer and is not.
    """

    def __init__(self, fetch=urllib_fetch, timeout=10.0, retries=2, pause=2.0, sleep=time.sleep):
        self.fetch, self.timeout, self.retries, self.pause, self.sleep = fetch, timeout, retries, pause, sleep

    def request(self, method, url, headers=None):
        headers = {"User-Agent": USER_AGENT, **(headers or {})}
        last = None
        for attempt in range(self.retries + 1):
            if attempt:
                self.sleep(self.pause * attempt)
            try:
                status, answer, body = self.fetch(method, url, headers, self.timeout)
            except TRANSIENT as error:
                last = Response(url, error=f"{type(error).__name__}: {error}")
                continue
            last = Response(url, status, answer, body)
            if status != 429 and status < 500:
                return last
        return last

    def head(self, url, headers=None):
        return self.request("HEAD", url, headers)

    def get_text(self, url, headers=None):
        """A body as text, asking for gzip or nothing: the standard library has no brotli."""
        response = self.request("GET", url, {"Accept-Encoding": "gzip", **(headers or {})})
        if response.status == 200:
            encoding = response.headers.get("content-encoding", "identity").strip().lower()
            try:
                if encoding == "gzip":
                    response.body = gzip.decompress(response.body)
                elif encoding == "deflate":
                    response.body = zlib.decompress(response.body)
                elif encoding not in ("", "identity"):
                    raise ValueError(f"served {encoding!r} although only gzip was accepted")
                response.text = response.body.decode("utf-8")
            except (OSError, ValueError, zlib.error, UnicodeDecodeError) as error:
                response.status, response.error = None, f"undecodable body: {error}"
        return response


# --- checks -------------------------------------------------------------------------

def cache_seconds(cache_control, directive):
    match = re.search(rf"(?:^|[\s,]){directive}=(\d+)", cache_control or "")
    return int(match.group(1)) if match else None


def pointer_header_problem(headers):
    """Why a pointer's caching is wrong, or None: it must be revalidated, never immutable."""
    cache = headers.get("cache-control", "")
    if not cache:
        return "is served without Cache-Control"
    if "immutable" in cache:
        return f"is cached as immutable ({cache})"
    for directive in ("max-age", "s-maxage"):
        seconds = cache_seconds(cache, directive)
        if seconds is not None and seconds > POINTER_MAX_AGE_SECONDS:
            return f"is cached for {seconds} s ({cache})"
    return None


def immutable_header_problem(headers, tile=False):
    """Why a run's file is cached or encoded wrongly, or None."""
    cache = headers.get("cache-control", "")
    seconds = cache_seconds(cache, "max-age")
    if "immutable" not in cache or seconds is None or seconds < IMMUTABLE_MIN_AGE_SECONDS:
        return f"is not cached as immutable ({cache or 'no Cache-Control'})"
    if tile:
        encoding = headers.get("content-encoding", "").strip().lower()
        if encoding not in TILE_ENCODINGS:
            return f"is served with Content-Encoding {encoding or 'none'}, not br or gzip"
    return None


def run_hour(value):
    return datetime.strptime(value, "%Y%m%d%H").replace(tzinfo=timezone.utc)


def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def coverage_end(pointer):
    """The last time a bundle covers, from the pointer alone, or None when it does not say."""
    coverage = pointer.get("coverage")
    if isinstance(coverage, dict) and coverage.get("to"):
        return moment(coverage["to"])
    frames = pointer.get("frames")
    if isinstance(frames, list) and frames and isinstance(frames[-1], dict) and frames[-1].get("validTime"):
        return moment(frames[-1]["validTime"])
    if isinstance(pointer.get("horizonHours"), int) and pointer.get("runTime"):
        return moment(pointer["runTime"]) + timedelta(hours=pointer["horizonHours"])
    return None


def named_urls(value):
    """Every `url` a schemaVersion 1 bundle names, as status.py's manifest_urls finds them."""
    urls = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "url" and isinstance(item, str):
                urls.add(item)
            else:
                urls |= named_urls(item)
    elif isinstance(value, list):
        for item in value:
            urls |= named_urls(item)
    return urls


def tile_samples(pointer):
    """The tiles to look for, relative to the run directory: [(path, is_first_level0)].

    Every tile of the coarsest level, and the first level-0 tile, at the first
    frame; never a tile the pointer calls absent.
    """
    tiles, frames = pointer.get("tiles"), pointer.get("frames")
    if tiles is None:
        return []
    if not isinstance(tiles, dict) or tiles.get("url") != TILE_URL or not isinstance(tiles.get("levels"), list) \
            or not tiles["levels"] or not isinstance(frames, list) or not frames:
        raise ValueError("its tiles block is not one the monitor can read")
    hour = frames[0]["hour"]

    def present(entry):
        absent = {tuple(pair) for pair in entry.get("absent", [])}
        for y in range(entry["y"][0], entry["y"][1] + 1):
            for x in range(entry["x"][0], entry["x"][1] + 1):
                if (x, y) not in absent:
                    yield f"t/{entry['level']}/{x}/{y}/{hour:03d}.bin"

    levels = sorted(tiles["levels"], key=lambda entry: entry["level"])
    picked = list(present(levels[-1]))
    finest = next(present(levels[0]), None) if levels[0]["level"] == 0 else None
    if finest and finest not in picked:
        picked.append(finest)
    return picked


class Row:
    def __init__(self, model, pointer, limit, note=""):
        self.model, self.pointer, self.limit, self.note = model, pointer, limit, note
        self.run = self.age = None
        self.checked = 0
        self.problems = []  # [(code, message)]

    def problem(self, code, message):
        self.problems.append((code, message))

    def as_dict(self):
        return {"model": self.model, "pointer": self.pointer, "run": self.run,
                "ageHours": None if self.age is None else round(self.age, 2),
                "limitHours": self.limit, "filesChecked": self.checked, "note": self.note,
                "ok": not self.problems,
                "problems": [{"code": code, "message": message} for code, message in self.problems]}


def check_model(http, base, model, now, pool, note=""):
    """One model's pointer and a sample of what it names, as a Row."""
    entry = MODELS[model]
    published = MANIFESTS[model]
    row = Row(model, published, float(entry["maxAgeHours"]) + MARGIN_HOURS, note)
    response = http.get_text(base + published)
    if response.status != 200:
        row.problem("pointer", f"{published} {response.describe()}")
        return row
    header = pointer_header_problem(response.headers)
    if header:
        row.problem("headers", f"{published} {header}")
    try:
        pointer = json.loads(response.text)
        if not isinstance(pointer, dict):
            raise ValueError("not a JSON object")
        row.run = pointer["run"]
        run = run_hour(pointer["run"])
    except (ValueError, KeyError, TypeError) as error:
        row.problem("unreadable", f"{published} does not parse: {error}")
        return row
    if pointer.get("model") not in (None, model):
        row.problem("unreadable", f"{published} names model {pointer.get('model')!r}")
    row.age = (now - run).total_seconds() / 3600
    if row.age > row.limit:
        row.problem("stale", f"run {row.run} is {row.age:.1f} h old; the limit is {row.limit:g} h")
    elif row.age < -1:
        row.problem("future", f"run {row.run} is {-row.age:.1f} h in the future")
    kind = entry["kind"]
    try:
        if kind in RUN_KINDS:
            if pointer.get("schemaVersion") != 2:
                raise ValueError(f"schemaVersion {pointer.get('schemaVersion')!r}, not 2")
            directory = PurePosixPath(published).parent.as_posix()
            run_directory = f"{directory}/{check_base(pointer.get('base'))}"
            squares = [f"{directory}/{square_path(pointer, square)}"
                       for square in square_index(pointer)["squares"]]
            tiles = [run_directory + path for path in tile_samples(pointer)]
        else:
            if pointer.get("schemaVersion") not in (1, 2):
                raise ValueError(f"schemaVersion {pointer.get('schemaVersion')!r}")
            squares, tiles = sorted(named_urls(pointer)), []
        end = None if kind == "observation" else coverage_end(pointer)
    except (ValueError, KeyError, TypeError, IndexError, AttributeError) as error:
        row.problem("unreadable", f"{published}: {error}")
        return row
    if kind in RUN_KINDS and not squares:
        row.problem("unreadable", f"{published} lists no spot squares")
    if end is not None and end <= now:
        row.problem("expired", f"its coverage ended at {end.isoformat().replace('+00:00', 'Z')}")

    files = [(path, False) for path in squares] + [(path, True) for path in tiles]
    answers = list(pool.map(lambda item: (item, http.head(base + item[0], {"Accept-Encoding": "br, gzip"})),
                            files))
    row.checked = len(answers)
    # A 4xx is a file that is not there; no answer, or a 5xx after the retries, is
    # the domain failing to serve it.
    missing = [path for (path, _), answer in answers
               if answer.status is not None and answer.status != 200 and answer.status < 500]
    unreachable = [path for (path, _), answer in answers if answer.status is None or answer.status >= 500]
    if missing:
        row.problem("missing-files", f"{len(missing)} of {len(answers)} files missing, e.g. "
                                     + ", ".join(missing[:3]))
    if unreachable:
        row.problem("unreachable", f"{len(unreachable)} of {len(answers)} files did not answer, e.g. "
                                   + ", ".join(unreachable[:3]))
    wrong = [f"{path} {problem}" for (path, tile), answer in answers if answer.status == 200
             for problem in [immutable_header_problem(answer.headers, tile)] if problem]
    if wrong:
        row.problem("headers", "; ".join(wrong[:2]) + (f" (and {len(wrong) - 2} more)" if len(wrong) > 2 else ""))
    return row


def check_site(http, site, base, live):
    """The site's page names this data domain, and the data domain lets the site read it."""
    row = Row("site", site, None)
    response = http.get_text(site)
    row.checked = 1
    if response.status != 200:
        row.problem("site", f"{site} {response.describe()}")
        return row
    match = re.search(rf'<meta\s+name="{re.escape(FORECAST_BASE_META)}"\s+content="([^"]*)"', response.text)
    if not match:
        row.problem("site", f"{site} has no {FORECAST_BASE_META} meta")
    elif match.group(1).rstrip("/") + "/" != base:
        row.problem("site", f"{site} reads its forecast from {match.group(1)}, not {base}")
    if live:
        parts = urllib.parse.urlsplit(site)
        origin = f"{parts.scheme}://{parts.netloc}"
        pointer = MANIFESTS[live[0][0]]
        answer = http.head(base + pointer, {"Origin": origin})
        row.checked += 1
        allowed = answer.headers.get("access-control-allow-origin")
        if answer.status != 200 or allowed not in (origin, "*"):
            row.problem("cors", f"{base}{pointer} does not allow {origin} "
                                f"({answer.describe()}, Access-Control-Allow-Origin {allowed or 'absent'})")
    return row


def normalise_base(base):
    parts = urllib.parse.urlsplit(base or "")
    if parts.scheme not in ("https", "http") or not parts.netloc:
        raise ValueError(f"Not a forecast data address: {base!r}")
    return base.rstrip("/") + "/"


def run_checks(base, site=None, http=None, now=None, live=None):
    http = http or Http()
    now = now or datetime.now(timezone.utc)
    rows = []
    try:
        base = normalise_base(base)
    except ValueError as error:
        row = Row("config", "", None)
        row.problem("config", f"{error}: set the PRODUCTION_FORECAST_BASE_URL variable")
        return {"checkedAt": now.isoformat(timespec="seconds"), "base": base, "rows": [row.as_dict()]}
    live = load_live_models() if live is None else live
    with ThreadPoolExecutor(8) as files, ThreadPoolExecutor(4) as models:
        rows = list(models.map(lambda item: check_model(http, base, item[0], now, files, item[1]), live))
    if site:
        rows.append(check_site(http, site, base, live))
    return {"checkedAt": now.isoformat(timespec="seconds"), "base": base,
            "rows": [row.as_dict() for row in rows]}


# --- reporting ----------------------------------------------------------------------

def problems(result):
    return [{"model": row["model"], **problem} for row in result["rows"] for problem in row["problems"]]


def signature(result):
    """What the set of problems is, without what changes from run to run (ages, counts)."""
    return ",".join(sorted({f"{p['model']}:{p['code']}" for p in problems(result)})) or "ok"


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def table(rows):
    lines = ["| Model | Run | Age | Limit | Files checked | Status |", "| --- | --- | --- | --- | --- | --- |"]
    for row in rows:
        age = "-" if row["ageHours"] is None else f"{row['ageHours']:.1f} h"
        limit = "-" if row["limitHours"] is None else f"{row['limitHours']:g} h"
        status = "ok" if row["ok"] else "**" + "; ".join(p["message"] for p in row["problems"]) + "**"
        if row.get("note"):
            status += f" ({row['note']})"
        lines.append(f"| {cell(row['model'])} | {cell(row['run'] or '-')} | {age} | {limit} | "
                     f"{row['filesChecked'] or '-'} | {cell(status)} |")
    return "\n".join(lines)


def report(result):
    failing = [row for row in result["rows"] if not row["ok"]]
    head = (f"### Production monitor: {'all good' if not failing else f'{len(failing)} with problems'}\n\n"
            f"{result['base']} at {result['checkedAt']}; a run may be its registry limit "
            f"plus {MARGIN_HOURS:g} h old.\n")
    return f"{head}\n{table(result['rows'])}\n"


# --- the issue ----------------------------------------------------------------------

def issue_action(open_issue, last_signature, current):
    """What to do with the monitor issue: open, comment, close or nothing."""
    if current == "ok":
        return "close" if open_issue else "none"
    if not open_issue:
        return "open"
    return "comment" if current != last_signature else "none"


def last_signature(texts):
    found = None
    for text in texts:
        for match in SIGNATURE.finditer(text or ""):
            found = match.group(1)
    return found


def issue_text(result, run_url, opening):
    failing = [row for row in result["rows"] if not row["ok"]]
    intro = ("The production monitor found a problem with the forecast data at "
             if opening else "The problems with the forecast data have changed at ")
    return (f"{intro}{result['base']} ({result['checkedAt']}).\n\n{table(failing)}\n\n"
            f"Run: {run_url}\n\n"
            "This issue gets a comment when the set of problems changes and is closed when "
            "every check passes again. scripts/release/monitor.py says what is checked.\n\n"
            f"<!-- production-monitor signature: {signature(result)} -->\n")


class GitHub:
    """The few REST calls the issue needs, with the run's GITHUB_TOKEN (issues: write)."""

    def __init__(self, repository, token, api="https://api.github.com"):
        self.base = f"{api}/repos/{repository}"
        self.token = token

    def call(self, method, path, payload=None):
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                   "X-GitHub-Api-Version": "2022-11-28", "User-Agent": USER_AGENT}
        data = None if payload is None else json.dumps(payload).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    body = response.read()
                    return response.status, json.loads(body) if body else None
            except urllib.error.HTTPError as error:
                if error.code < 500 or attempt == 2:
                    return error.code, None
            except TRANSIENT:
                if attempt == 2:
                    raise
            time.sleep(2 * (attempt + 1))
        return None, None

    def ok(self, method, path, payload=None):
        status, body = self.call(method, path, payload)
        if status is None or status >= 300:
            raise RuntimeError(f"GitHub answered {status} to {method} {path}")
        return body

    def find_issue(self):
        """The open monitor issue: by label, else by title (a label GitHub dropped)."""
        for query in (f"?state=open&labels={ISSUE_LABEL}&per_page=100", "?state=open&per_page=100"):
            for issue in self.ok("GET", f"/issues{query}") or []:
                if issue.get("title") == ISSUE_TITLE and "pull_request" not in issue:
                    return issue
        return None

    def texts(self, issue):
        texts, page = [issue.get("body") or ""], 1
        while True:
            comments = self.ok("GET", f"/issues/{issue['number']}/comments?per_page=100&page={page}") or []
            texts += [comment.get("body") or "" for comment in comments]
            if len(comments) < 100:
                return texts
            page += 1


def update_issue(result, github, run_url):
    """Open, comment on or close the monitor issue; returns what it did."""
    issue = github.find_issue()
    current = signature(result)
    action = issue_action(issue, last_signature(github.texts(issue)) if issue else None, current)
    if action == "open":
        # The label must exist for an issue to carry it; 422 means it already does.
        github.call("POST", "/labels", {"name": ISSUE_LABEL, "color": "d93f0b",
                                        "description": "Opened by the production monitor"})
        created = github.ok("POST", "/issues", {"title": ISSUE_TITLE, "labels": [ISSUE_LABEL],
                                                "body": issue_text(result, run_url, True)})
        return f"opened #{created['number']}"
    if action == "comment":
        github.ok("POST", f"/issues/{issue['number']}/comments", {"body": issue_text(result, run_url, False)})
        return f"commented on #{issue['number']}"
    if action == "close":
        github.ok("POST", f"/issues/{issue['number']}/comments", {
            "body": f"Every check passes again ({result['checkedAt']}): {run_url}\n\n"
                    "<!-- production-monitor signature: ok -->\n"})
        github.ok("PATCH", f"/issues/{issue['number']}", {"state": "closed", "state_reason": "completed"})
        return f"closed #{issue['number']}"
    return f"left #{issue['number']} as it is (same problems)" if issue else "nothing to do"


def crashed_result():
    row = Row("monitor", "", None)
    row.problem("crashed", "the check did not finish; see the run's log")
    return {"checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "base": "",
            "rows": [row.as_dict()]}


# --- commands -----------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="check production and report")
    check.add_argument("--base", default=os.environ.get("PRODUCTION_FORECAST_BASE_URL", ""))
    check.add_argument("--site", default="", help="the site to check too (MONITOR_SITE_URL)")
    check.add_argument("--json", help="write the result here, for `issue`")
    check.add_argument("--summary", help="append the Markdown report here ($GITHUB_STEP_SUMMARY)")
    issue = commands.add_parser("issue", help="open, update or close the monitor issue from a result")
    issue.add_argument("result")
    args = parser.parse_args(argv)

    if args.command == "check":
        result = run_checks(args.base, args.site or None)
        text = report(result)
        print(text)
        if args.summary:
            with open(args.summary, "a", encoding="utf-8") as handle:
                handle.write(text)
        if args.json:
            Path(args.json).write_text(json.dumps(result, indent=2))
        return 1 if problems(result) else 0

    try:
        result = json.loads(Path(args.result).read_text())
    except (OSError, ValueError):
        result = crashed_result()
    env = os.environ
    run_url = f"{env.get('GITHUB_SERVER_URL', 'https://github.com')}/{env['GITHUB_REPOSITORY']}" \
              f"/actions/runs/{env.get('GITHUB_RUN_ID', '')}"
    print(update_issue(result, GitHub(env["GITHUB_REPOSITORY"], env["GITHUB_TOKEN"]), run_url))
    return 0


if __name__ == "__main__":
    sys.exit(main())
