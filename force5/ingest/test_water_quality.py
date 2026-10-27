"""The EPA bathing water job: what it reads, how it places the notices, and its timetable."""
import contextlib
from datetime import date, datetime, timedelta, timezone
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock

import fetch_water_quality
from fetch_water_quality import (
    MANIFEST, build_manifest, incident_notice, irish_midnight, kind_of, read_locations,
    spot_waters)
from fetch_forecast import load_spots
from prune import manifest_urls, prune_published
from publish_s3 import validate_bundle
from registry import MODELS
import scheduler
from status import describe

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FIXTURES = HERE / "fixtures"
# The API's alerts of Monday 15 September 2025, 13:19 UTC, as the Internet
# Archive kept them (web.archive.org/web/20250915131951/data.epa.ie/bw/api/v1/alerts):
# eleven open incidents, near the end of a wet bathing season.
SEASON = json.loads((FIXTURES / "epa-bathing-alerts-20250915.json").read_text())
# The alerts as read on Tuesday 27 October 2026: none, out of season.
WINTER = json.loads((FIXTURES / "epa-bathing-alerts-20261027.json").read_text())
# Every bathing water as read on 27 October 2026, cut to the fields the job reads.
LOCATIONS = json.loads((FIXTURES / "epa-bathing-locations-20261027.json").read_text())
# beaches.ie's own WGS84 place for each identified bathing water, the same day
# (api.beaches.ie/odata/beaches, EtrsY and EtrsX): the check on the grid conversion.
BEACHES_IE = json.loads((FIXTURES / "beaches-ie-places-20261027.json").read_text())
# The file this job publishes from the September alerts at NOW, as the site and the
# MCP server read it (force5/src/waterQuality.test.ts reads the same file).
PUBLISHED = FIXTURES / "water-quality-published-20250915.json"
NOW = datetime(2025, 9, 15, 13, 30, tzinfo=timezone.utc)
# Some riding places as public/riding-locations.json has them, fixed here so the
# published file above does not change with the catalogue: beaches with their own
# bathing water, a harbour beside two, a lake beside the sea, and two with none.
SPOTS = [
    {"id": "portmarnock", "name": "Portmarnock — Velvet Strand", "county": "Dublin", "lat": 53.431328, "lon": -6.123934},
    {"id": "dollymount", "name": "Dollymount", "county": "Dublin", "lat": 53.367583, "lon": -6.144748},
    {"id": "sandymount", "name": "Sandymount Strand", "county": "Dublin", "lat": 53.3289999, "lon": -6.20844},
    {"id": "seapoint", "name": "Seapoint", "county": "Dublin", "lat": 53.2973278, "lon": -6.1588509},
    {"id": "dun-laoghaire", "name": "Dún Laoghaire Harbour", "county": "Dublin", "lat": 53.2975647, "lon": -6.1368705},
    {"id": "spanish-point", "name": "Spanish Point", "county": "Clare", "lat": 52.840184, "lon": -9.4336574},
    {"id": "fi-lahinch-beach", "name": "Lahinch Beach", "county": "Clare", "lat": 52.9336105, "lon": -9.34783},
    {"id": "clonea", "name": "Clonea Strand", "county": "Waterford", "lat": 52.0952697, "lon": -7.5416373},
    {"id": "keel-lake", "name": "Keel Lake — Achill", "county": "Mayo", "lat": 53.9825926, "lon": -10.064315},
    {"id": "kilcrea", "name": "Kilcrea — Malahide Estuary", "county": "Dublin", "lat": 53.4690824, "lon": -6.1755492},
    {"id": "brandon", "name": "Brandon Bay", "county": "Kerry", "lat": 52.276, "lon": -10.024},
]


def to_wgs84():
    return fetch_water_quality.irish_grid_to_wgs84()


def build(alerts=None, now=NOW):
    return build_manifest(SEASON["list"] if alerts is None else alerts, LOCATIONS["list"],
                          SPOTS, now, to_wgs84())


def alert(**fields):
    return {**SEASON["list"][0], **fields}


class ReadTests(unittest.TestCase):
    def test_the_fixtures_are_whole_pages(self):
        for page in (SEASON, WINTER, LOCATIONS):
            self.assertEqual(page["count"], len(page["list"]))

    def test_the_grid_is_placed_where_beaches_ie_places_it(self):
        waters = read_locations(LOCATIONS["list"], to_wgs84())
        off = []
        for code, (lat, lon) in BEACHES_IE.items():
            place = waters[code]["place"]
            off.append(fetch_water_quality.distance_km(lat, lon, *place))
        self.assertGreater(len(off), 150)
        # Nearly all to the metre; beaches.ie's own few odd ones by up to about 200 m.
        self.assertLess(sorted(off)[len(off) // 2], 0.01)
        self.assertLess(max(off), 0.25)

    def test_each_restriction_type_has_its_kind(self):
        seen = {row["bathing_restriction_type"]: kind_of(row["bathing_restriction_type"])
                for row in SEASON["list"]}
        self.assertEqual(seen, {
            "Bathing is prohibited": "prohibition",
            "Bathing is temporarily prohibited": "prohibition",
            "Prior Warning bathing water quality may be affected": "prior-warning",
            "Bathing is advised against": "advice-against",
        })
        self.assertEqual(kind_of("Bathing is temporarily advised against"), "advice-against")
        self.assertEqual(kind_of("Do not Swim"), "prohibition")
        self.assertEqual(kind_of("Swimming not advised"), "advice-against")
        # One this job has not met restricts, the cautious reading.
        self.assertEqual(kind_of("Beach closed"), "restriction")

    def test_a_notice_is_published_as_the_epa_wrote_it(self):
        notice = incident_notice(SEASON["list"][0], 0)
        self.assertEqual(notice, {
            "id": "BWI002046", "water": "IEEABWC070_0000_0200",
            "beach": "Portmarnock, Velvet Strand Beach", "county": "Dublin",
            "authority": "Fingal County Council", "kind": "prohibition",
            "restriction": "Bathing is prohibited",
            "description": "Water quality deteriorated due to suspected storm water overflow",
            "start": "2025-09-14T00:00:00", "expectedDays": 5, "end": None,
            # Midnight in Irish summer time is 23:00 UTC the day before.
            "from": "2025-09-13T23:00:00Z", "until": None,
            "notice": "https://www.beaches.ie/wp-content/files//notice/"
                      "4f7e4dff-48b5-4677-b15f-e38dc0022eea.pdf",
            "updated": "2025-09-15T13:19:05"})

    def test_an_end_date_runs_to_the_end_of_that_irish_day(self):
        notice = incident_notice(alert(incident_end_date="2025-10-26T00:00:00"), 0)
        # The clocks go back on the 26th: the day ends at midnight GMT.
        self.assertEqual(notice["until"], "2025-10-27T00:00:00Z")
        self.assertEqual(irish_midnight(date(2025, 3, 30)), datetime(2025, 3, 30, tzinfo=timezone.utc))
        self.assertEqual(irish_midnight(date(2025, 3, 31)),
                         datetime(2025, 3, 30, 23, tzinfo=timezone.utc))
        self.assertEqual(irish_midnight(date(2025, 10, 26)),
                         datetime(2025, 10, 25, 23, tzinfo=timezone.utc))
        self.assertEqual(irish_midnight(date(2025, 10, 27)),
                         datetime(2025, 10, 27, tzinfo=timezone.utc))

    def test_a_lifted_restriction_is_left_out(self):
        # The API keeps an incident open for months after its restriction is lifted.
        self.assertIsNone(incident_notice(alert(has_bathing_restriction_in_place="No"), 0))

    def test_a_changed_or_broken_feed_fails_rather_than_saying_no_notices(self):
        breakages = {
            "no standing": alert(has_bathing_restriction_in_place=None),
            "no beach": alert(beach_id=""),
            "no restriction": alert(bathing_restriction_type=None),
            "no start": alert(incident_start_date=None),
            "not a date": alert(incident_start_date="soon"),
            "ends first": alert(incident_end_date="2025-09-01T00:00:00"),
            "odd duration": alert(incident_expected_duration="five"),
        }
        for name, row in breakages.items():
            with self.subTest(name), self.assertRaises(ValueError):
                build([row])
        with self.assertRaises(ValueError):
            fetch_water_quality.check_page({"items": []}, "alerts")
        with self.assertRaises(ValueError):
            read_locations([{"beach_id": "X", "beach_name": "Nowhere", "easting": 900000,
                             "northing": 900000}], to_wgs84())


class PlaceTests(unittest.TestCase):
    def setUp(self):
        self.waters = read_locations(LOCATIONS["list"], to_wgs84())
        self.matched = spot_waters(load_spots(), self.waters)

    def test_a_beach_takes_its_own_bathing_water(self):
        self.assertEqual(self.matched["portmarnock"],
                         [{"water": "IEEABWC070_0000_0200",
                           "name": "Portmarnock, Velvet Strand Beach", "km": 0.21}])
        self.assertEqual([w["name"] for w in self.matched["seapoint"]],
                         ["Seapoint", "Blackrock Baths"])

    def test_nothing_is_said_where_no_bathing_water_is_near(self):
        # Kilcrea is up the Malahide estuary, 4 km from the nearest beach the EPA
        # monitors; Northern Ireland has none at all.
        for spot in ("kilcrea", "ballyholme", "portrush", "blessington"):
            self.assertNotIn(spot, self.matched)
        self.assertTrue(all(w["km"] <= 1.5 for near in self.matched.values() for w in near))

    def test_a_lake_never_takes_the_sea_beside_it(self):
        self.assertNotIn("keel-lake", self.matched)
        self.assertIn("keel", self.matched)


class BuildTests(unittest.TestCase):
    def test_the_published_file_is_the_one_the_site_reads(self):
        manifest = build()
        self.assertEqual(manifest, json.loads(PUBLISHED.read_text()))
        self.assertEqual((manifest["run"], manifest["runTime"]), ("2025091513", "2025-09-15T13:00:00Z"))
        self.assertIn("Environmental Protection Agency", manifest["attribution"])
        self.assertEqual(manifest_urls(manifest), set())

    def test_it_carries_every_standing_notice_and_the_all_season_restrictions(self):
        manifest = build()
        kinds = [(n["beach"], n["kind"]) for n in manifest["notices"]]
        self.assertEqual(len(kinds), 12)
        self.assertIn(("Portmarnock, Velvet Strand Beach", "prohibition"), kinds)
        self.assertIn(("Bathing Place at Portumna", "advice-against"), kinds)
        self.assertIn(("Dun Laoghaire Baths", "all-season"), kinds)

    def test_out_of_season_there_is_only_the_all_season_restriction(self):
        manifest = build(WINTER["list"], datetime(2026, 10, 27, 20, 55, tzinfo=timezone.utc))
        self.assertEqual([n["id"] for n in manifest["notices"]], ["season-IEEABWC090_0000_0060"])

    def test_a_failed_fetch_writes_nothing(self):
        with tempfile.TemporaryDirectory() as root, \
                mock.patch.object(fetch_water_quality, "ROOT", Path(root)), \
                mock.patch.object(fetch_water_quality, "fetch_all", side_effect=ValueError("down")), \
                self.assertRaises(ValueError):
            fetch_water_quality.main([])
        self.assertFalse((Path(root) / "public" / MANIFEST).exists())

    def test_every_page_is_read(self):
        pages = [{"count": 3, "list": [1, 2]}, {"count": 3, "list": [3]}]
        response = mock.Mock(json=mock.Mock(side_effect=pages), raise_for_status=mock.Mock())
        with mock.patch.object(fetch_water_quality.SESSION, "get", return_value=response) as get:
            self.assertEqual(fetch_water_quality.fetch_all("https://x", "alerts"), [1, 2, 3])
        self.assertEqual([c.kwargs["params"]["page"] for c in get.call_args_list], [1, 2])


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
        self.save(build())
        manifest, _, objects = validate_bundle(self.public, "water-quality", 6, now=NOW)
        self.assertEqual((len(manifest["notices"]), objects), (12, []))
        row = describe(self.public, "water-quality", NOW)
        self.assertEqual((row["state"], row["ok"]), ("fresh", True))
        row = describe(self.public, "water-quality", NOW + timedelta(hours=7))
        self.assertEqual(row["state"], "stale")
        self.assertEqual(prune_published(self.public, 0, now=NOW)["removed"], [])

    def test_the_validator_refuses_what_must_not_be_published(self):
        good = build()
        breakages = {
            "no attribution": lambda m: m.__setitem__("attribution", ""),
            "not crediting the EPA": lambda m: m.__setitem__("attribution", "Someone"),
            "unknown kind": lambda m: m["notices"][0].__setitem__("kind", "purple"),
            "no beach": lambda m: m["notices"][0].pop("beach"),
            "time without zone": lambda m: m["notices"][0].__setitem__("from", "2025-09-14T00:00:00"),
            "over when written": lambda m: m["notices"][0].__setitem__("until", "2025-09-15T00:00:00Z"),
            "a spot's water unknown": lambda m: m["spots"]["portmarnock"][0].__setitem__("km", "near"),
            "a url": lambda m: m.__setitem__("url", "https://www.beaches.ie/"),
            "written another hour": lambda m: m.__setitem__("generatedAt", "2025-09-15T14:01:00Z"),
        }
        for name, breakage in breakages.items():
            with self.subTest(name):
                manifest = json.loads(json.dumps(good))
                breakage(manifest)
                self.save(manifest)
                with self.assertRaises(ValueError):
                    validate_bundle(self.public, "water-quality", 6, now=NOW)


SITE_RULE = ROOT / "force5" / "src" / "waterQuality.ts"


class TimetableTests(unittest.TestCase):
    @unittest.skipUnless(SITE_RULE.exists(), "force5/src is not in the worker image")
    def test_the_site_trusts_the_file_exactly_as_long_as_the_registry_does(self):
        limit = re.search(r"WATER_QUALITY_MAX_AGE_HOURS = (\d+);", SITE_RULE.read_text())
        self.assertEqual(int(limit.group(1)), MODELS["water-quality"]["maxAgeHours"])

    def test_hourly_and_never_stale_on_time(self):
        with contextlib.redirect_stdout(io.StringIO()):
            job = next(job for job in scheduler.load_jobs(ROOT / "deploy" / "local" / "jobs.toml")
                       if job["id"] == "water-quality")
        self.assertTrue(job["enabled"])
        self.assertEqual(job["hours"], list(range(24)))
        (minute,) = job["minutes"]
        oldest = 1 + (minute * 60 + job["timeout_seconds"]) / 3600
        self.assertLessEqual(oldest + 1, MODELS["water-quality"]["maxAgeHours"])


if __name__ == "__main__":
    unittest.main()
