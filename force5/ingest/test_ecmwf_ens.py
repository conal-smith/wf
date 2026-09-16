"""ECMWF ENS adapter tests. Fake GRIB and a fake client: no network access."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eccodes as ec

from cadence import expected_hours, ladder_hours
import fetch_ecmwf_ens as ens
from fetch_ecmwf_ens import average, decode_step, load_spots, main, parameter_sets, run_datetime
from publish_s3 import publish, validate_ensemble
from test_publish_s3 import FakeS3

PARAM_IDS = {"10u": 165, "10v": 166, "10fg": 49, "10fg3": 49, "10fg6": 49}


def write_message(stream, param, member, run, hour, value, changes=None):
    """One perturbed-member message shaped like the 0.25-degree open-data product."""
    gust = param.startswith("10fg")
    handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
    try:
        ec.codes_set(handle, "productDefinitionTemplateNumber", 11 if gust else 1)
        metadata = {"typeOfProcessedData": 4, "typeOfEnsembleForecast": 3,
                    "number": member, "paramId": PARAM_IDS[param],
                    "dataDate": int(run[:8]), "dataTime": int(run[-2:]) * 100,
                    "stepUnits": 1, "forecastTime": hour, "Ni": 2, "Nj": 2,
                    "latitudeOfFirstGridPointInDegrees": 54.25,
                    "latitudeOfLastGridPointInDegrees": 54,
                    "longitudeOfFirstGridPointInDegrees": 352,
                    "longitudeOfLastGridPointInDegrees": 352.25,
                    "iDirectionIncrementInDegrees": 0.25,
                    "jDirectionIncrementInDegrees": 0.25, "uvRelativeToGrid": 0}
        if gust:
            metadata.update({"stepType": "max", "startStep": max(hour - 6, 0), "endStep": hour})
        metadata.update(changes or {})
        centre = metadata.pop("centre", "ecmf")
        for key, item in metadata.items():
            ec.codes_set(handle, key, item)
        ec.codes_set(handle, "centre", centre)
        ec.codes_set_values(handle, [value] * 4)
        ec.codes_write(handle, stream)
    finally:
        ec.codes_release(handle)


class FakeClient:
    """Serves the requested members/params from a synthetic ensemble."""
    def __init__(self, run, changes=None, drop=(), duplicate=(), intervals=None):
        self.run, self.changes = run, changes or {}
        self.drop, self.duplicate, self.intervals = set(drop), set(duplicate), intervals or {}
        self.requests = []

    def latest(self, **kwargs):
        return datetime.strptime(self.run, "%Y%m%d%H").replace(tzinfo=timezone.utc)

    def retrieve(self, **kwargs):
        self.requests.append(kwargs)
        hour, params = kwargs["step"], kwargs["param"]
        with Path(kwargs["target"]).open("wb") as stream:
            for param in params:
                for member in kwargs["number"]:
                    if (param, member) in self.drop:
                        continue
                    changes = dict(self.changes)
                    if member in self.intervals and param.startswith("10fg"):
                        changes["startStep"] = self.intervals[member]
                    value = member if param == "10u" else -member if param == "10v" else 10 + member
                    write_message(stream, param, member, self.run, hour, value, changes)
                    if (param, member) in self.duplicate:
                        write_message(stream, param, member, self.run, hour, value, changes)


class ENSTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spots = self.root / "spots.json"
        self.spots.write_text(json.dumps([
            {"id": "brandon", "name": "Brandon Bay", "lat": 54.1, "lon": -7.9},
            {"id": "offgrid", "name": "Elsewhere", "lat": 10.0, "lon": 10.0}]))
        now = datetime.now(timezone.utc)
        self.run = now.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y%m%d%H")

    def grib(self, members=(1, 2, 3, 4), params=("10u", "10v", "10fg"), hour=6, **kwargs):
        path = self.root / "step.grib2"
        client = FakeClient(self.run, **kwargs)
        client.retrieve(step=hour, number=list(members), param=list(params), target=str(path))
        return path

    # --- cadence -------------------------------------------------------------
    def test_uniform_six_hour_and_generic_ladder_cadence(self):
        uniform = {"model": "ecmwf-ens", "stepHours": 6, "frames": [None] * 5}
        self.assertEqual(expected_hours(uniform), (0, 6, 12, 18, 24))
        ladder = {"model": "ecmwf-ens", "stepHours": 6,
                  "stepRanges": [{"throughHour": 12, "stepHours": 6},
                                 {"throughHour": 24, "stepHours": 12}]}
        self.assertEqual(expected_hours(ladder), (0, 6, 12, 24))
        self.assertEqual(ladder_hours([{"throughHour": 144, "stepHours": 6}])[-3:], (132, 138, 144))
        self.assertEqual(expected_hours({"model": "ecmwf-ens", "stepHours": 3, "frames": [None] * 3}),
                         (0, 3, 6))

    def test_cadence_rejects_broken_ladders_and_steps(self):
        for manifest in [{"model": "ecmwf-ens", "stepHours": 4, "frames": [None]},
                         {"model": "ecmwf-ens", "stepHours": 6, "stepRanges": []},
                         {"model": "ecmwf-ens", "stepHours": 6,
                          "stepRanges": [{"throughHour": 145, "stepHours": 6}]},
                         {"model": "ecmwf-ens", "stepHours": 3,
                          "stepRanges": [{"throughHour": 144, "stepHours": 6}]},
                         {"model": "ecmwf-ens", "stepHours": 6,
                          "stepRanges": [{"throughHour": 12, "stepHours": 6},
                                         {"throughHour": 12, "stepHours": 6}]},
                         {"model": "ecmwf-ens", "stepHours": 6,
                          "stepRanges": [{"throughHour": 12, "stepHours": True}]}]:
            with self.subTest(manifest=manifest), self.assertRaises(ValueError):
                expected_hours(manifest)

    def test_ecmwf_control_cadence_is_unchanged(self):
        from cadence import ECMWF_HOURS, ECMWF_RANGES
        self.assertEqual(expected_hours({"model": "ecmwf", "stepHours": 3, "stepRanges": ECMWF_RANGES}),
                         ECMWF_HOURS)
        with self.assertRaises(ValueError):
            expected_hours({"model": "ecmwf", "stepHours": 6, "stepRanges": ECMWF_RANGES})

    # --- decoding and validation --------------------------------------------
    def test_every_member_decodes_with_the_control_product_checks(self):
        fields, layout, interval = decode_step(self.grib(), self.run, 6, [1, 2, 3, 4])
        self.assertEqual(sorted(fields["u"]), [1, 2, 3, 4])
        self.assertEqual(fields["u"][3], [3, 3, 3, 3])
        self.assertEqual(fields["gust"][2], [12, 12, 12, 12])
        self.assertEqual(interval, [0, 6])
        self.assertEqual((layout[2]["west"], layout[2]["dx"]), (-8, 0.25))

    def test_incomplete_member_set_fails_before_any_mean(self):
        with self.assertRaisesRegex(ValueError, "Incomplete ensemble"):
            decode_step(self.grib(drop=[("10v", 3)]), self.run, 6, [1, 2, 3, 4])
        with self.assertRaisesRegex(ValueError, "Incomplete ensemble"):
            decode_step(self.grib(drop=[("10fg", 4)]), self.run, 6, [1, 2, 3, 4])

    def test_rejects_control_wrong_member_duplicates_and_grid(self):
        cases = [({"changes": {"dataType": "fc"}}, "perturbed"),
                 ({"changes": {"dataType": "cf"}}, "perturbed"),
                 ({"changes": {"centre": "edzw"}}, "perturbed"),
                 ({"duplicate": [("10u", 2)]}, "Duplicate"),
                 ({"changes": {"paramId": 130}}, "Unexpected ECMWF ENS parameter"),
                 ({"changes": {"iDirectionIncrementInDegrees": 0.5,
                               "longitudeOfLastGridPointInDegrees": 352.5}}, "0.25-degree")]
        for kwargs, message in cases:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, message):
                decode_step(self.grib(**kwargs), self.run, 6, [1, 2, 3, 4])
        with self.assertRaisesRegex(ValueError, "Unexpected ensemble member"):
            decode_step(self.grib(members=(1, 2, 3, 9)), self.run, 6, [1, 2, 3, 4])

    def test_members_must_agree_on_the_gust_interval(self):
        with self.assertRaisesRegex(ValueError, "disagree on the gust interval"):
            decode_step(self.grib(hour=12, intervals={3: 9}), self.run, 12, [1, 2, 3, 4])
        with self.assertRaisesRegex(ValueError, "gust maximum interval"):
            decode_step(self.grib(members=(1, 2, 3), hour=12,
                                  changes={"startStep": 0, "endStep": 12}), self.run, 12, [1, 2, 3])

    def test_grid_must_not_change_within_a_run(self):
        _, layout, _ = decode_step(self.grib(), self.run, 6, [1, 2, 3, 4])
        moved = self.grib(changes={"latitudeOfFirstGridPointInDegrees": 55,
                                   "latitudeOfLastGridPointInDegrees": 54.75})
        with self.assertRaisesRegex(ValueError, "Grid changed"):
            decode_step(moved, self.run, 6, [1, 2, 3, 4], layout)

    def test_initialization_has_no_gust_and_aliases_follow_the_horizon(self):
        fields, _, interval = decode_step(
            self.grib(members=(1, 2), params=("10u", "10v"), hour=0), self.run, 0, [1, 2])
        self.assertEqual((fields["gust"], interval), ({}, None))
        # A step-0 gust cannot describe a maximum period, whichever check sees it first.
        with self.assertRaisesRegex(ValueError, "gust"):
            decode_step(self.grib(members=(1, 2), hour=0), self.run, 0, [1, 2])
        self.assertEqual([set(s[2:]) for s in parameter_sets(0)], [set()])
        self.assertEqual([s[2] for s in parameter_sets(24)], ["10fg", "10fg3", "10fg6"])
        self.assertEqual([s[2] for s in parameter_sets(120)], ["10fg3", "10fg", "10fg6"])
        self.assertEqual(parameter_sets(240)[0][2], "10fg")

    def test_only_published_cycles_and_horizons_are_accepted(self):
        self.assertEqual(run_datetime("2026091612", 240).hour, 12)
        self.assertEqual(run_datetime("2026091618", 144).hour, 18)
        for run, hours in [("2026091618", 150), ("2026091603", 24), ("20260916", 24)]:
            with self.subTest(run=run), self.assertRaises(ValueError):
                run_datetime(run, hours)

    def test_mean_is_the_member_average(self):
        self.assertEqual(average([[1, 2], [2, 3], [6, 7]]), [3.0, 4.0])
        self.assertEqual(average([[1, 1], [2, 2]]), [1.5, 1.5])

    # --- spot catalogue ------------------------------------------------------
    def test_prefers_riding_locations_and_ignores_unusable_entries(self):
        public = self.root / "public"
        public.mkdir()
        (public / "spots.json").write_text("[]")
        with patch.dict("os.environ", {}, clear=True), patch.object(ens, "PROJECT_ROOT", self.root):
            self.assertEqual(ens.spots_file().name, "spots.json")
            riding = public / "riding-locations.json"
            riding.write_text("[]")
            self.assertEqual(ens.spots_file().name, "riding-locations.json")
        with patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(self.spots)}):
            self.assertEqual(ens.spots_file(), self.spots)
        catalogue = self.root / "riding.json"
        catalogue.write_text(json.dumps({"locations": [
            {"id": "brandon", "lat": 52.276, "lon": -10.024, "kind": "spot"},
            {"id": "brandon", "lat": 1, "lon": 2},
            {"id": "shop", "lat": 53.0, "lon": -9.0, "kind": "operator"},
            {"id": "broken", "lat": None, "lon": -9.0},
            {"lat": 53.0, "lon": -9.0}, "junk"]}))
        self.assertEqual(load_spots(catalogue), [{"id": "brandon", "lat": 52.276, "lon": -10.024}])
        (self.root / "empty.json").write_text("[]")
        with self.assertRaisesRegex(ValueError, "No usable riding locations"):
            load_spots(self.root / "empty.json")

    # --- end to end, offline -------------------------------------------------
    def refresh(self, *extra, client=None):
        client = client or FakeClient(self.run)
        argv = ["fetch_ecmwf_ens.py", "--run", self.run, "--members", "4",
                "--step", "6", "--hours", "12", *extra]
        with patch("sys.argv", argv), patch.object(ens, "ROOT", self.root), \
             patch.dict("os.environ", {"FORCE5_SPOTS_FILE": str(self.spots)}), \
             patch.object(ens, "ens_client", return_value=client):
            main()
        return json.loads((self.root / "public/weather/ecmwf-ens.json").read_text()), client

    def test_publishes_mean_frames_and_per_spot_member_series(self):
        manifest, client = self.refresh()
        self.assertEqual(manifest["model"], "ecmwf-ens")
        self.assertEqual(manifest["modelName"], "ECMWF ENS")
        self.assertEqual(manifest["ensemble"], {"members": 4, "control": None,
                                               "description": manifest["ensemble"]["description"]})
        self.assertIsNone(manifest["ensemble"]["control"])
        self.assertEqual(manifest["stepHours"], 6)
        self.assertEqual(manifest["stepRanges"], [{"throughHour": 12, "stepHours": 6}])
        self.assertEqual([f["hour"] for f in manifest["frames"]], [0, 6, 12])
        self.assertEqual(manifest["gustMissingHours"], [0])
        self.assertEqual(expected_hours(manifest), (0, 6, 12))
        # Members 1..4 hold u = member, v = -member, gust = 10 + member.
        frame = json.loads((self.root / "public" / manifest["frames"][1]["url"]).read_text())
        self.assertEqual(frame["u"], [2.5] * 4)
        self.assertEqual(frame["v"], [-2.5] * 4)
        self.assertEqual(frame["gust"], [12.5] * 4)
        self.assertEqual(frame["gustIntervalHours"], [0, 6])
        self.assertEqual(manifest["frames"][0]["gustIntervalHours"], None)
        mean = manifest["spotForecasts"]["brandon"][1]
        self.assertEqual((mean["u"], mean["v"], mean["gust"]), (2.5, -2.5, 12.5))
        series = manifest["spotMembers"]["brandon"]
        self.assertEqual([entry["hour"] for entry in series], [0, 6, 12])
        self.assertEqual(series[1]["u"], [1, 2, 3, 4])
        self.assertEqual(series[1]["v"], [-1, -2, -3, -4])
        self.assertEqual(series[1]["gust"], [11, 12, 13, 14])
        self.assertEqual(series[0]["gust"], [None] * 4)
        self.assertEqual(series[1]["validTime"], manifest["frames"][1]["validTime"])
        # A spot outside the grid keeps null mean values but publishes no member
        # series, because the publisher rejects null member values.
        self.assertNotIn("offgrid", manifest["spotMembers"])
        self.assertIsNone(manifest["spotForecasts"]["offgrid"][1]["u"])
        self.assertEqual(sorted(client.requests[0]["number"]), [1, 2, 3, 4])
        self.assertEqual(client.requests[0]["stream"], "enfo")
        self.assertEqual(client.requests[0]["type"], "pf")
        self.assertNotIn("cf", [request["type"] for request in client.requests])
        self.assertEqual(client.requests[0]["param"], ["10u", "10v"])
        self.assertEqual(client.requests[1]["param"], ["10u", "10v", "10fg"])

    def test_cached_step_is_revalidated_and_repaired(self):
        self.refresh()
        cache = self.root / ".cache/ecmwf-ens" / self.run / "006-4m-v1.grib2"
        cache.write_bytes(b"GRIBnot-a-message")
        manifest, client = self.refresh()
        self.assertEqual(len(manifest["frames"]), 3)
        self.assertEqual([request["step"] for request in client.requests], [6])

    def test_any_failure_preserves_the_previous_manifest(self):
        published = self.root / "public/weather/ecmwf-ens.json"
        published.parent.mkdir(parents=True)
        published.write_text('{"run":"last-good"}')
        for kwargs in [{"drop": [("10u", 2)]}, {"changes": {"dataType": "cf"}},
                       {"intervals": {2: 3}}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.refresh(client=FakeClient(self.run, **kwargs))
            self.assertEqual(json.loads(published.read_text()), {"run": "last-good"})

    def test_rejects_unusable_arguments_without_downloading(self):
        for extra in [["--members", "1"], ["--members", "51"], ["--hours", "13"],
                      ["--hours", "400"], ["--step", "3", "--hours", "150"], ["--workers", "9"]]:
            with self.subTest(extra=extra), self.assertRaises(SystemExit):
                self.refresh(*extra)

    # --- publisher -----------------------------------------------------------
    def bundle(self, members=4):
        (self.root / "weather/run").mkdir(parents=True, exist_ok=True)
        run = datetime(2026, 9, 16, tzinfo=timezone.utc)
        hours = (0, 6, 12)
        manifest = {"model": "ecmwf-ens", "run": "2026091600", "runTime": run.isoformat(),
                    "stepHours": 6, "stepRanges": [{"throughHour": 12, "stepHours": 6}],
                    "gustAvailable": True, "gustMissingHours": [0],
                    "grid": {"width": 2, "height": 2}, "frames": [],
                    "spotForecasts": {"brandon": []}, "spotMembers": {"brandon": []},
                    "ensemble": {"members": members, "control": None, "description": "test"}}
        for hour in hours:
            valid = (run + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")
            interval = None if hour == 0 else [hour - 6, hour]
            gust = None if hour == 0 else [9.0] * 4
            manifest["frames"].append({"hour": hour, "validTime": valid,
                                       "url": f"weather/run/{hour}.json",
                                       "gustIntervalHours": interval})
            (self.root / f"weather/run/{hour}.json").write_text(json.dumps(
                {"model": "ecmwf-ens", "run": "2026091600", "hour": hour, "validTime": valid,
                 "grid": manifest["grid"], "gustIntervalHours": interval,
                 "u": [1.0] * 4, "v": [2.0] * 4, "gust": gust}))
            manifest["spotForecasts"]["brandon"].append(
                {"hour": hour, "validTime": valid, "u": 1.0, "v": 2.0,
                 "gust": None if hour == 0 else 9.0})
            manifest["spotMembers"]["brandon"].append(
                {"hour": hour, "validTime": valid, "u": [1.0] * members, "v": [2.0] * members,
                 "gust": [None] * members if hour == 0 else [9.0] * members})
        return manifest, run + timedelta(hours=6, minutes=30)

    def write_bundle(self, manifest):
        (self.root / "weather/ecmwf-ens.json").write_text(json.dumps(manifest))

    def test_publisher_accepts_an_ensemble_bundle_pointer_last(self):
        manifest, now = self.bundle()
        self.write_bundle(manifest)
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "ecmwf-ens", "test", max_age_hours=24, now=now),
                         "published")
        self.assertEqual(s3.writes[-1], "weather/ecmwf-ens.json")
        self.assertEqual(len(s3.writes), 5)  # 3 frames + archive + pointer

    def test_publisher_rejects_broken_member_series_before_upload(self):
        manifest, now = self.bundle()

        def broken(mutate):
            copy = json.loads(json.dumps(manifest))
            mutate(copy)
            return copy

        def drop_member(m):
            m["spotMembers"]["brandon"][1]["u"] = [1.0, 1.0, 1.0]

        def bad_value(m):
            m["spotMembers"]["brandon"][1]["v"] = [2.0, 2.0, 2.0, 999.0]

        def gust_at_initialization(m):
            m["spotMembers"]["brandon"][0]["gust"] = [9.0] * 4

        def null_wind(m):
            m["spotMembers"]["brandon"][2]["u"] = [None] * 4

        def missing_spot(m):
            m["spotMembers"] = {}

        def extra_spot(m):
            m["spotMembers"]["ghost"] = m["spotMembers"]["brandon"]

        def misaligned(m):
            m["spotMembers"]["brandon"][1]["hour"] = 9

        def short_series(m):
            m["spotMembers"]["brandon"] = m["spotMembers"]["brandon"][:2]

        def no_series(m):
            del m["spotMembers"]

        def bad_count(m):
            m["ensemble"]["members"] = 1

        for mutate in [drop_member, bad_value, gust_at_initialization, null_wind, missing_spot,
                       extra_spot, misaligned, short_series, no_series, bad_count]:
            with self.subTest(case=mutate.__name__):
                self.write_bundle(broken(mutate))
                s3 = FakeS3()
                with self.assertRaises(ValueError):
                    publish(s3, self.root, "ecmwf-ens", "test", max_age_hours=24, now=now)
                self.assertEqual(s3.writes, [])

    def test_a_smaller_ensemble_cannot_replace_a_larger_published_one(self):
        manifest, now = self.bundle()
        self.write_bundle(manifest)
        s3 = FakeS3()
        self.assertEqual(publish(s3, self.root, "ecmwf-ens", "test", max_age_hours=24, now=now),
                         "published")
        smaller = json.loads(json.dumps(manifest))
        smaller["ensemble"]["members"] = 2
        for entries in smaller["spotMembers"].values():
            for entry in entries:
                for field in ("u", "v", "gust"):
                    entry[field] = entry[field][:2]
        self.write_bundle(smaller)
        writes = len(s3.writes)
        self.assertEqual(publish(s3, self.root, "ecmwf-ens", "test", max_age_hours=24, now=now),
                         "unchanged-or-newer")
        self.assertEqual(len(s3.writes), writes)


if __name__ == "__main__":
    unittest.main()
