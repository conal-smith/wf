"""The Met Éireann warnings job: what it copies, what it refuses, and its timetable."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock

import fetch_warnings
from fetch_warnings import MANIFEST, build_manifest, current_warnings
from prune import manifest_urls, prune_published
from publish_s3 import validate_bundle
from registry import MODELS
import scheduler
from status import describe

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
# The live feed of Sunday 25 October 2026, read at 10:00 UTC.
FEED = json.loads((HERE / "fixtures" / "met-eireann-warnings-20261025.json").read_text())
NOW = datetime(2026, 10, 25, 9, 30, tzinfo=timezone.utc)


def orange(**fields):
    return {**FEED[2], "id": 9, "capId": "2.49.0.1.372.0.test", "level": "orange",
            "severity": "Severe", "headline": "Status Orange - Wind warning for Mayo",
            **fields}


class BuildTests(unittest.TestCase):
    def test_it_copies_every_current_warning_exactly(self):
        manifest = build_manifest(FEED, NOW)
        self.assertEqual(manifest["warnings"], FEED)
        self.assertEqual((manifest["run"], manifest["runTime"]), ("2026102509", "2026-10-25T09:00:00Z"))
        self.assertEqual((manifest["kind"], manifest["model"]), ("warnings", "warnings"))
        self.assertIn("Met Éireann", manifest["attribution"])
        self.assertIn("do not materially change", manifest["conditions"])
        # The pruner reads every "url" as an object to keep; this file names none.
        self.assertEqual(manifest_urls(manifest), set())

    def test_it_leaves_out_what_has_expired(self):
        # Connacht's yellow wind warning ran to 10:00 UTC.
        later = build_manifest(FEED, datetime(2026, 10, 25, 10, 0, tzinfo=timezone.utc))
        self.assertNotIn(FEED[2], later["warnings"])
        self.assertEqual(len(later["warnings"]), len(FEED) - 1)

    def test_it_shows_yellow_orange_and_red_and_leaves_green_out(self):
        feed = [orange(), orange(capId="r", level="red"), orange(capId="g", level="green")]
        self.assertEqual([w["capId"] for w in current_warnings(feed, NOW)],
                         ["2.49.0.1.372.0.test", "r"])

    def test_a_changed_or_broken_feed_fails_rather_than_saying_no_warnings(self):
        breakages = {
            "not a list": {"warnings": FEED},
            "unknown level": [orange(level="purple")],
            "no headline": [orange(headline=None)],
            "time without zone": [orange(expiry="2026-10-26T10:00:00")],
            "not a time": [orange(onset="tomorrow")],
            "no regions": [orange(regions=[])],
            "odd region": [orange(regions=["Mayo"])],
            "expires before onset": [orange(onset="2026-10-26T10:00:00+00:00",
                                            expiry="2026-10-26T09:00:00+00:00")],
        }
        for name, feed in breakages.items():
            with self.subTest(name), self.assertRaises(ValueError):
                build_manifest(feed, NOW)

    def test_an_empty_feed_is_no_warnings(self):
        self.assertEqual(build_manifest([], NOW)["warnings"], [])

    def test_a_failed_fetch_writes_nothing(self):
        with tempfile.TemporaryDirectory() as root, \
                mock.patch.object(fetch_warnings, "ROOT", Path(root)), \
                mock.patch.object(fetch_warnings, "fetch_feed", side_effect=ValueError("down")), \
                self.assertRaises(ValueError):
            fetch_warnings.main([])
        self.assertFalse((Path(root) / "public" / MANIFEST).exists())


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.public = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def save(self, manifest):
        path = self.public / MANIFEST
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest))

    def test_the_bundle_validates_and_reports_its_age(self):
        self.save(build_manifest(FEED, NOW))
        manifest, _, objects = validate_bundle(self.public, "warnings", 6, now=NOW)
        self.assertEqual((len(manifest["warnings"]), objects), (len(FEED), []))
        row = describe(self.public, "warnings", NOW)
        self.assertEqual((row["state"], row["ok"]), ("fresh", True))
        row = describe(self.public, "warnings", NOW + timedelta(hours=7))
        self.assertEqual(row["state"], "stale")
        self.assertEqual(prune_published(self.public, 0, now=NOW)["removed"], [])

    def test_the_validator_refuses_what_must_not_be_published(self):
        good = build_manifest(FEED, NOW)
        breakages = {
            "no attribution": lambda m: m.__setitem__("attribution", ""),
            "not crediting Met Éireann": lambda m: m.__setitem__("attribution", "Someone"),
            "expired when written": lambda m: m["warnings"].append(
                orange(expiry="2026-10-25T09:00:00+00:00")),
            "green": lambda m: m["warnings"].append(orange(level="green")),
            "missing field": lambda m: m["warnings"][0].pop("certainty"),
            "a url": lambda m: m.__setitem__("url", "https://www.met.ie/"),
            "written another hour": lambda m: m.__setitem__("generatedAt", "2026-10-25T10:01:00Z"),
        }
        for name, breakage in breakages.items():
            with self.subTest(name):
                manifest = json.loads(json.dumps(good))
                breakage(manifest)
                self.save(manifest)
                with self.assertRaises(ValueError):
                    validate_bundle(self.public, "warnings", 6, now=NOW)


SITE_RULE = ROOT / "force5" / "src" / "warnings.ts"


class TimetableTests(unittest.TestCase):
    @unittest.skipUnless(SITE_RULE.exists(), "force5/src is not in the worker image")
    def test_the_site_trusts_the_file_exactly_as_long_as_the_registry_does(self):
        source = SITE_RULE.read_text()
        limit = re.search(r"WARNINGS_MAX_AGE_HOURS = (\d+);", source)
        self.assertEqual(int(limit.group(1)), MODELS["warnings"]["maxAgeHours"])

    def test_hourly_and_never_stale_on_time(self):
        with contextlib.redirect_stdout(io.StringIO()):
            job = next(job for job in scheduler.load_jobs(ROOT / "deploy" / "local" / "jobs.toml")
                       if job["id"] == "warnings")
        self.assertTrue(job["enabled"])
        self.assertEqual((job["hours"], job["minutes"]), (list(range(24)), [25]))
        # Just before the next run lands, the file is an hour and its minutes old,
        # counted from the hour it was read in; one failed run may pass too.
        oldest = (1 + (25 * 60 + job["timeout_seconds"]) / 3600)
        self.assertLessEqual(oldest + 1, MODELS["warnings"]["maxAgeHours"])


if __name__ == "__main__":
    unittest.main()
