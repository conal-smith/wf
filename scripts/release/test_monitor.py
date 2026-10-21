"""scripts/release/monitor.py: which models it watches, what it calls a problem, the issue.

    python3 -m unittest discover -s scripts/release -p 'test_*.py'

No network: a fake data domain answers from a dict.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import sys
import tomllib
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent))
import monitor  # noqa: E402

BASE = "https://data.example.com/"
NOW = datetime(2026, 10, 11, 16, 0, tzinfo=timezone.utc)
POINTER_CACHE = {"Cache-Control": "public, max-age=0, s-maxage=60, must-revalidate"}
IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}
RUN = "harmonie-2026101112-60h-v2-aa1e61c9/"
RUN_TIME = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)
# HARMONIE's limit, read as the monitor reads it, so a new maxAgeHours in
# registry.py moves the tests with it.
LIMIT_HOURS = float(monitor.MODELS["harmonie"]["maxAgeHours"]) + monitor.MARGIN_HOURS


def harmonie(**changes):
    pointer = {
        "schemaVersion": 2, "model": "harmonie", "run": "2026101112", "runTime": "2026-10-11T12:00:00Z",
        "frames": [{"hour": 0, "validTime": "2026-10-11T12:00:00Z"},
                   {"hour": 60, "validTime": "2026-10-14T00:00:00Z"}],
        "spots": {"squareDegrees": 2, "url": "spots/{square}.json", "squares": ["n52w010", "n54w010"],
                  "keys": ["spotForecasts"]},
        "tiles": {"size": 128, "border": 1, "encoding": "f5-tile-v1", "blocks": ["u", "v", "gust"],
                  "url": "t/{level}/{x}/{y}/{hour}.bin",
                  "levels": [{"level": 0, "dx": 0.025, "dy": 0.02, "x": [52, 53], "y": [13, 13],
                              "absent": [[52, 13]]},
                             {"level": 1, "dx": 0.05, "dy": 0.04, "x": [26, 26], "y": [6, 6], "absent": []}]},
        "base": RUN,
    }
    pointer.update(changes)
    return pointer


def harmonie_files():
    return {f"weather/{RUN}spots/n52w010.json": (200, IMMUTABLE, b""),
            f"weather/{RUN}spots/n54w010.json": (200, IMMUTABLE, b""),
            f"weather/{RUN}t/1/26/6/000.bin": (200, {**IMMUTABLE, "Content-Encoding": "br"}, b""),
            f"weather/{RUN}t/0/53/13/000.bin": (200, {**IMMUTABLE, "Content-Encoding": "br"}, b"")}


class Domain:
    """A fake data domain: {path: (status, headers, body)}; anything else is a 404."""

    def __init__(self, objects):
        self.objects, self.calls = dict(objects), []

    def put_json(self, path, value, headers=POINTER_CACHE):
        self.objects[path] = (200, headers, json.dumps(value).encode())

    def __call__(self, method, url, headers, timeout):
        self.calls.append((method, url, dict(headers)))
        status, answer, body = self.objects.get(url.removeprefix(BASE), (404, {}, b""))
        return status, answer, b"" if method == "HEAD" else body


def check(domain, model="harmonie", now=NOW):
    http = monitor.Http(fetch=domain, sleep=lambda seconds: None)
    with ThreadPoolExecutor(4) as pool:
        return monitor.check_model(http, BASE, model, now, pool).as_dict()


def codes(row):
    return [problem["code"] for problem in row["problems"]]


class WhichModels(unittest.TestCase):
    def test_the_catalog_names_what_the_site_retired(self):
        flags = monitor.catalog_flags(monitor.CATALOG_FILE.read_text())
        self.assertIn("harmonie", flags)
        self.assertFalse(flags["harmonie"]["retired"] or flags["harmonie"]["planned"])
        self.assertTrue(flags["harmonie-eps"]["planned"])
        retired = {model for model, flag in flags.items() if flag["retired"]}
        self.assertTrue({"ecmwf-ens", "gefs", "arpege", "arome", "aifs", "ecmwf-wave"} <= retired)

    def test_the_checkout_gives_enabled_jobs_less_what_the_site_retired(self):
        live = dict(monitor.load_live_models())
        flags = monitor.catalog_flags(monitor.CATALOG_FILE.read_text())
        jobs = tomllib.loads(monitor.JOBS_FILE.read_text())
        enabled = monitor.enabled_models(jobs)
        for model in live:
            self.assertIn(model, monitor.MODELS)
            self.assertFalse(flags.get(model, {}).get("retired") or flags.get(model, {}).get("planned"))
        for model in enabled - {m for m, f in flags.items() if f["retired"] or f["planned"]}:
            self.assertIn(model, live)
        self.assertIn("harmonie", live)
        self.assertIn("blend", live)

    def test_rules(self):
        jobs = {"jobs": [
            {"id": "a", "models": ["harmonie"]},
            {"id": "b", "models": ["gefs"], "enabled": False},
            {"id": "c", "models": ["aifs"]},                       # enabled, but the site retired it
            {"id": "d", "command": "prune"},
            {"id": "e", "models": ["tides", "not-registered"]},
        ]}
        flags = {"harmonie": {"retired": False, "planned": False},
                 "gefs": {"retired": False, "planned": False},     # listed, no job publishes it
                 "aifs": {"retired": True, "planned": False},
                 "harmonie-eps": {"retired": False, "planned": True}}
        live = monitor.live_models(jobs, flags)
        self.assertEqual([model for model, _ in live], ["harmonie", "gefs", "tides"])
        self.assertIn("no enabled job", dict(live)["gefs"])

    def test_catalog_parsing_reads_flags_per_entry(self):
        text = """export const MODEL_CATALOG: readonly ModelEntry[] = [
  { id: "x", hue: { wind: "#1", gust: "#2" }, retired: true },
  {
    id: "y",
    planned: true,
  },
  { id: "z" },
];
const other = { id: "w", retired: true };"""
        self.assertEqual(monitor.catalog_flags(text), {
            "x": {"retired": True, "planned": False}, "y": {"retired": False, "planned": True},
            "z": {"retired": False, "planned": False}})


class StaleLimits(unittest.TestCase):
    """The map, the MCP and the monitor call the same run stale (issue #120)."""

    def test_the_site_reads_the_registrys_limit_for_every_model_it_lists(self):
        hours = monitor.catalog_stale_hours(monitor.CATALOG_FILE.read_text())
        flags = monitor.catalog_flags(monitor.CATALOG_FILE.read_text())
        for model, limit in hours.items():
            if model in monitor.MODELS:
                self.assertEqual(limit, float(monitor.MODELS[model]["maxAgeHours"]),
                                 f"{model}: staleAfterHours in force5/src/catalog.ts must be "
                                 "maxAgeHours in force5/ingest/registry.py")
            else:
                self.assertTrue(flags[model]["planned"], f"{model} has no registry entry")
                self.assertIsNone(limit, f"{model} is planned: it has no schedule to be late on")
        for model, _ in monitor.load_live_models():
            if model in hours:
                self.assertIsNotNone(hours[model], model)

    def test_a_once_a_day_run_is_not_stale_before_the_next_days_slot(self):
        # The cutoff that used to be one 18 h for every model, against the ages the
        # issue measured on 21 October: ICON-EU and SWAN once a day, ECMWF twice.
        hours = monitor.catalog_stale_hours(monitor.CATALOG_FILE.read_text())
        self.assertGreater(hours["icon-eu"], 24 + 3.5)
        self.assertGreater(hours["icon-eu-weather"], 24 + 3.5)
        self.assertGreater(hours["mi-swan"], 24 + 10)
        self.assertGreater(hours["ecmwf"], 12 + 8.5)
        self.assertLess(hours["harmonie"], 18, "HARMONIE runs six times a day")

    def test_parsing_reads_each_entrys_own_limit(self):
        text = """export const MODEL_CATALOG: readonly ModelEntry[] = [
  { id: "x", kind: "wind", staleAfterHours: 30, retired: true },
  {
    id: "y",
    planned: true,
  },
  { id: "z", staleAfterHours: 12.5 },
];
const other = { id: "w", staleAfterHours: 1 };"""
        self.assertEqual(monitor.catalog_stale_hours(text), {"x": 30.0, "y": None, "z": 12.5})


class Http(unittest.TestCase):
    def test_retries_a_dropped_request_and_a_5xx_but_not_a_404(self):
        answers = [urllib.error.URLError("reset"), (503, {}, b""), (200, {}, b"ok")]

        def fetch(method, url, headers, timeout):
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer

        pauses = []
        http = monitor.Http(fetch=fetch, sleep=pauses.append)
        self.assertEqual(http.head(BASE).status, 200)
        self.assertEqual(pauses, [2.0, 4.0])
        domain = Domain({})
        self.assertEqual(monitor.Http(fetch=domain, sleep=lambda s: None).head(BASE + "x").status, 404)
        self.assertEqual(len(domain.calls), 1)

    def test_gives_up_after_its_retries(self):
        def fetch(method, url, headers, timeout):
            raise TimeoutError("timed out")

        response = monitor.Http(fetch=fetch, sleep=lambda s: None).head(BASE)
        self.assertIsNone(response.status)
        self.assertIn("timed out", response.describe())

    def test_reads_gzip_and_refuses_brotli(self):
        domain = Domain({"a.json": (200, {"Content-Encoding": "gzip"}, gzip.compress(b'{"a": 1}')),
                         "b.json": (200, {"Content-Encoding": "br"}, b"\x8b")})
        http = monitor.Http(fetch=domain, sleep=lambda s: None)
        self.assertEqual(json.loads(http.get_text(BASE + "a.json").text), {"a": 1})
        self.assertEqual(domain.calls[0][2]["Accept-Encoding"], "gzip")
        self.assertIsNone(http.get_text(BASE + "b.json").status)


class ARun(unittest.TestCase):
    def domain(self, pointer=None, files=None):
        domain = Domain(harmonie_files() if files is None else files)
        domain.put_json("weather/harmonie.json", pointer or harmonie())
        return domain

    def test_a_good_run_checks_its_squares_and_a_tile_sample(self):
        domain = self.domain()
        row = check(domain)
        self.assertEqual(row["problems"], [])
        self.assertEqual((row["run"], row["ageHours"], row["limitHours"], row["filesChecked"]),
                         ("2026101112", 4.0, LIMIT_HOURS, 4))
        heads = sorted(url.removeprefix(BASE + "weather/" + RUN) for method, url, _ in domain.calls
                       if method == "HEAD")
        # The coarsest level whole, the first level-0 tile not called absent.
        self.assertEqual(heads, ["spots/n52w010.json", "spots/n54w010.json",
                                 "t/0/53/13/000.bin", "t/1/26/6/000.bin"])

    def test_stale_by_the_registry_limit_and_the_margin(self):
        limit = RUN_TIME + timedelta(hours=LIMIT_HOURS)
        self.assertEqual(codes(check(self.domain(), now=limit - timedelta(minutes=1))), [])
        self.assertEqual(codes(check(self.domain(), now=limit + timedelta(minutes=1))), ["stale"])

    def test_expired_coverage(self):
        row = check(self.domain(), now=datetime(2026, 10, 14, 1, 0, tzinfo=timezone.utc))
        self.assertIn("expired", codes(row))

    def test_missing_and_unreachable_files(self):
        files = harmonie_files()
        del files[f"weather/{RUN}spots/n54w010.json"]
        files[f"weather/{RUN}t/1/26/6/000.bin"] = (502, {}, b"")
        row = check(self.domain(files=files))
        self.assertEqual(sorted(codes(row)), ["missing-files", "unreachable"])
        self.assertIn("n54w010", row["problems"][0]["message"])

    def test_headers(self):
        files = harmonie_files()
        files[f"weather/{RUN}t/0/53/13/000.bin"] = (200, IMMUTABLE, b"")       # not encoded
        files[f"weather/{RUN}spots/n52w010.json"] = (200, POINTER_CACHE, b"")  # not immutable
        domain = self.domain(files=files)
        domain.put_json("weather/harmonie.json", harmonie(),
                        {"Cache-Control": "public, max-age=14400, s-maxage=60, must-revalidate"})
        row = check(domain)
        self.assertEqual(codes(row), ["headers", "headers"])
        self.assertIn("cached for 14400 s", row["problems"][0]["message"])
        self.assertNotIn("CDN", row["problems"][0]["message"])
        self.assertIn("not cached as immutable", row["problems"][1]["message"])
        self.assertIn("Content-Encoding none", row["problems"][1]["message"])

    def test_a_pointer_the_cdn_rewrites_is_still_a_problem_and_says_so(self):
        # What data.wingfoil.ie did in October 2026: the bucket holds max-age=0, an
        # uncached HEAD gets it, and Cloudflare's Browser Cache TTL raises the cached
        # GET to four hours.
        domain = self.domain()

        def fetch(method, url, headers, timeout):
            status, answer, body = domain(method, url, headers, timeout)
            if method == "GET" and url == BASE + "weather/harmonie.json":
                answer = {"Cache-Control": "public, max-age=14400, s-maxage=60, must-revalidate"}
            return status, answer, body

        row = check(fetch)
        self.assertEqual(codes(row), ["headers"])
        self.assertIn("cached for 14400 s", row["problems"][0]["message"])
        self.assertIn("uncached HEAD gets public, max-age=0", row["problems"][0]["message"])
        self.assertIn("Browser Cache TTL", row["problems"][0]["message"])

    def test_a_pointer_that_is_missing_or_does_not_parse(self):
        self.assertEqual(codes(check(Domain({}))), ["pointer"])
        domain = Domain({"weather/harmonie.json": (200, POINTER_CACHE, b"{not json")})
        self.assertEqual(codes(check(domain)), ["unreadable"])
        self.assertEqual(codes(check(self.domain(harmonie(schemaVersion=1)))), ["unreadable"])
        self.assertEqual(codes(check(self.domain(harmonie(base="../escape/")))), ["unreadable"])
        self.assertEqual(codes(check(self.domain(harmonie(model="gfs")))), ["unreadable"])

    def test_tile_samples_respect_absent_tiles(self):
        pointer = harmonie()
        pointer["tiles"]["levels"][0]["absent"] = [[52, 13], [53, 13]]
        self.assertEqual(monitor.tile_samples(pointer), ["t/1/26/6/000.bin"])
        self.assertEqual(monitor.tile_samples({"frames": []}), [])
        with self.assertRaises(ValueError):
            monitor.tile_samples(harmonie(tiles={"url": "elsewhere/{x}.bin", "levels": []}))


class OtherBundles(unittest.TestCase):
    def test_tides_check_every_station_file(self):
        domain = Domain({"marine/tides-a.json": (200, IMMUTABLE, b"")})
        domain.put_json("marine/tides.json", {
            "schemaVersion": 1, "kind": "tide", "model": "tides", "run": "2026101115",
            "coverage": {"from": "2026-10-10T00:00:00Z", "to": "2026-10-19T00:00:00Z"},
            "stations": {"a": {"url": "marine/tides-a.json"}, "b": {"url": "marine/tides-b.json"}}})
        row = check(domain, "tides")
        self.assertEqual(row["filesChecked"], 2)
        self.assertEqual(codes(row), ["missing-files"])

    def test_observations_are_aged_by_their_newest_hour(self):
        domain = Domain({})
        domain.put_json("marine/wind-observations.json", {
            "schemaVersion": 1, "kind": "observation", "model": "wind-obs", "run": "2026101108",
            "stations": {}})
        row = check(domain, "wind-obs")
        self.assertEqual((row["limitHours"], codes(row)), (7.0, ["stale"]))


class Site(unittest.TestCase):
    SITE = "https://site.example.com/"

    def run_site(self, html, allow, status=200):
        def fetch(method, url, headers, timeout):
            if url == self.SITE:
                return status, {}, html.encode()
            if url == BASE + "weather/harmonie.json" and headers.get("Origin") == "https://site.example.com":
                return 200, {"Access-Control-Allow-Origin": allow} if allow else {}, b""
            return 404, {}, b""

        http = monitor.Http(fetch=fetch, sleep=lambda s: None)
        return codes(monitor.check_site(http, self.SITE, BASE, [("harmonie", "")]).as_dict())

    def test_the_meta_and_cors(self):
        meta = f'<meta name="wingfoil:forecast-base" content="{BASE}" />'
        self.assertEqual(self.run_site(meta, allow="https://site.example.com"), [])
        self.assertEqual(self.run_site(meta, allow="*"), [])
        self.assertEqual(self.run_site(meta.replace(BASE, BASE.rstrip("/")), allow="*"), [])
        self.assertEqual(self.run_site(meta, allow=""), ["cors"])
        self.assertEqual(self.run_site("<html></html>", allow="*"), ["site"])
        self.assertEqual(self.run_site(meta.replace("data.", "other."), allow="*"), ["site"])
        self.assertEqual(self.run_site(meta, allow="*", status=522), ["site"])


class Reporting(unittest.TestCase):
    def result(self, *rows):
        return {"checkedAt": "2026-10-11T16:00:00+00:00", "base": BASE, "rows": list(rows)}

    def row(self, model, *problem_codes):
        return {"model": model, "pointer": "", "run": "2026101112", "ageHours": 4.0, "limitHours": 25.0,
                "filesChecked": 4, "note": "", "ok": not problem_codes,
                "problems": [{"code": code, "message": f"{code} | detail {len(model)}"} for code in problem_codes]}

    def test_a_signature_ignores_what_changes_every_run(self):
        one = self.result(self.row("gfs", "stale"), self.row("harmonie"))
        two = self.result(self.row("gfs", "stale"))
        two["rows"][0]["problems"][0]["message"] = "run is 19.4 h old"
        self.assertEqual(monitor.signature(one), monitor.signature(two))
        self.assertEqual(monitor.signature(self.result(self.row("gfs"))), "ok")

    def test_the_table_escapes_cells(self):
        text = monitor.table([self.row("gfs", "stale")])
        self.assertIn("stale \\| detail", text)
        self.assertIn("| gfs | 2026101112 | 4.0 h | 25 h | 4 |", text)

    def test_what_to_do_with_the_issue(self):
        self.assertEqual(monitor.issue_action(None, None, "ok"), "none")
        self.assertEqual(monitor.issue_action(None, None, "gfs:stale"), "open")
        self.assertEqual(monitor.issue_action({"number": 1}, "gfs:stale", "gfs:stale"), "none")
        self.assertEqual(monitor.issue_action({"number": 1}, "gfs:stale", "gfs:stale,tides:pointer"), "comment")
        self.assertEqual(monitor.issue_action({"number": 1}, "gfs:stale", "ok"), "close")
        self.assertEqual(monitor.last_signature([
            "<!-- production-monitor signature: a:x -->", "words", "<!-- production-monitor signature: b:y -->"]),
            "b:y")

    def test_an_empty_base_is_a_problem_not_a_crash(self):
        result = monitor.run_checks("", live=[])
        self.assertEqual(monitor.signature(result), "config:config")


class FakeGitHub(monitor.GitHub):
    def __init__(self, issues=(), comments=()):
        super().__init__("o/r", "t")
        self.issues, self.comments, self.sent = list(issues), list(comments), []

    def call(self, method, path, payload=None):
        self.sent.append((method, path, payload))
        if method == "GET" and path.startswith("/issues?"):
            return 200, self.issues
        if method == "GET" and "/comments" in path:
            return 200, self.comments
        if method == "POST" and path == "/issues":
            return 201, {"number": 7}
        if method == "POST" and path == "/labels":
            return 422, None
        return 200, {}


class TheIssue(unittest.TestCase):
    def result(self, *codes_):
        return {"checkedAt": "t", "base": BASE, "rows": [
            {"model": "gfs", "pointer": "", "run": "r", "ageHours": 1.0, "limitHours": 13.0, "filesChecked": 1,
             "note": "", "ok": not codes_, "problems": [{"code": c, "message": c} for c in codes_]}]}

    def test_opens_one_issue_with_the_label_and_the_failing_rows(self):
        github = FakeGitHub()
        self.assertEqual(monitor.update_issue(self.result("stale"), github, "RUN"), "opened #7")
        method, path, payload = github.sent[-1]
        self.assertEqual((method, path, payload["title"], payload["labels"]),
                         ("POST", "/issues", monitor.ISSUE_TITLE, ["monitor"]))
        self.assertIn("| gfs |", payload["body"])
        self.assertIn("RUN", payload["body"])
        self.assertIn("signature: gfs:stale", payload["body"])

    def test_comments_only_when_the_problems_change_and_closes_when_they_are_gone(self):
        issue = {"number": 3, "title": monitor.ISSUE_TITLE, "body": "<!-- production-monitor signature: gfs:stale -->"}
        github = FakeGitHub([issue])
        self.assertIn("left #3", monitor.update_issue(self.result("stale"), github, "RUN"))
        self.assertFalse([s for s in github.sent if s[0] != "GET"])
        self.assertEqual(monitor.update_issue(self.result("stale", "pointer"), github, "RUN"), "commented on #3")
        github = FakeGitHub([issue])
        self.assertEqual(monitor.update_issue(self.result(), github, "RUN"), "closed #3")
        self.assertEqual(github.sent[-1], ("PATCH", "/issues/3", {"state": "closed", "state_reason": "completed"}))

    def test_ignores_pull_requests_and_other_titles(self):
        github = FakeGitHub([{"number": 1, "title": "Other"},
                             {"number": 2, "title": monitor.ISSUE_TITLE, "pull_request": {}}])
        self.assertIsNone(github.find_issue())


if __name__ == "__main__":
    unittest.main()
