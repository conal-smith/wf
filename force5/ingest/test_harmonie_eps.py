from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fetch_forecast import write_json
from fetch_harmonie import GRID
from fetch_harmonie_eps import assemble, cache_path, catalogue, main, source_name, validate
from publish_s3 import validate_bundle, validate_ensemble

SPOTS = [{"id": "brandon", "lat": 52.276, "lon": -10.024},
         {"id": "dollymount", "lat": 53.365, "lon": -6.135}]
HOURS = [0, 3, 6]


def published(*groups):
    return catalogue([{"name": source_name(cycle, step)} for cycle, steps in groups for step in steps])


class AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = patch("fetch_harmonie_eps.ROOT", Path(self.temp.name))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_anchors_on_the_newest_complete_cycle_and_lags_older_ones(self):
        run, members = assemble(published(
            ("2026091620", range(0, 3)),    # newest cycle, still publishing
            ("2026091619", range(0, 61)),   # anchor
            ("2026091618", range(0, 61)),   # lag 1
            ("2026091617", range(12, 61)),  # lag 2, but the steps it owes are gone
            ("2026091612", range(0, 61)),   # lag 7, beyond --max-lag
        ), HOURS)
        self.assertEqual(run, "2026091619")
        self.assertEqual([(m["run"], m["lag"]) for m in members], [("2026091619", 0), ("2026091618", 1)])

    def test_member_cycles_may_come_from_the_cache_after_the_portal_drops_them(self):
        for hour in HOURS:
            path = cache_path(source_name("2026091616", 3 + hour))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"cached")
        _, members = assemble(published(("2026091619", range(0, 61))), HOURS)
        self.assertEqual([(m["run"], m["lag"]) for m in members], [("2026091619", 0), ("2026091616", 3)])

    def test_a_member_axis_may_not_run_past_the_source_horizon(self):
        _, members = assemble(published(("2026091619", range(0, 61)), ("2026091618", range(0, 61))),
                              list(range(0, 61, 3)))
        # The lag-1 member would need +061, which the source never publishes.
        self.assertEqual([(m["run"], m["lag"]) for m in members], [("2026091619", 0)])

    def test_incomplete_or_unknown_anchor_cycles_are_refused(self):
        with self.assertRaises(RuntimeError):
            assemble(published(("2026091619", [0, 3])), HOURS)
        with self.assertRaises(RuntimeError):
            assemble(published(("2026091619", range(0, 61))), HOURS, "2026091600")


class MetadataTests(unittest.TestCase):
    BASE = {"discipline": 0, "parameterCategory": 2, "parameterNumber": 2,
            "typeOfLevel": "heightAboveGround", "level": 10, "gridType": "lambert",
            "uvRelativeToGrid": 1, "shapeOfTheEarth": 6, "centre": "eidb",
            "typeOfProcessedData": "cf", "perturbationNumber": 0, "number": 0,
            "numberOfForecastsInEnsemble": 31, "stepType": "instant", "startStep": 4, "endStep": 4,
            "iScansNegatively": 0, "jScansPositively": 1, "jPointsAreConsecutive": 0,
            "alternativeRowScanning": 0, "DxInMetres": 2000, "DyInMetres": 2000,
            "units": "m s**-1", "numberOfMissing": 0, "dataDate": 20260916, "dataTime": 1800,
            "validityDate": 20260916, "validityTime": 2200}
    MEMBER = {"run": "2026091618", "lag": 1}

    def check(self, values, hour=3):
        with patch("fetch_harmonie_eps.ec.codes_set"), \
             patch("fetch_harmonie_eps.ec.codes_get", side_effect=lambda _, key: values[key]):
            validate(None, "u", self.MEMBER, hour)

    def test_accepts_a_lagged_member_at_its_own_initialization_and_step(self):
        self.check(self.BASE)

    def test_rejects_member_run_level_number_rotation_and_time_mismatches(self):
        for key, wrong in [("perturbationNumber", 1), ("number", 1), ("typeOfProcessedData", "pf"),
                           ("numberOfForecastsInEnsemble", 11), ("level", 100), ("uvRelativeToGrid", 0),
                           ("dataTime", 1900), ("validityTime", 2300), ("startStep", 3),
                           ("endStep", 5), ("stepType", "max"), ("numberOfMissing", 1),
                           ("units", "kt"), ("shapeOfTheEarth", 0)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check({**self.BASE, key: wrong})
        # The same file is wrong for another axis hour: the member's lag shifts its step.
        with self.assertRaises(ValueError):
            self.check(self.BASE, hour=4)


class PublicationTests(unittest.TestCase):
    """Run the importer with fake member fields to check its published shape."""

    MEMBERS = [{"run": "2026091619", "lag": 0, "fake": (4.0, -3.0)},
               {"run": "2026091618", "lag": 1, "fake": (6.0, -3.0)},
               {"run": "2026091617", "lag": 2, "fake": (8.0, -3.0)}]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def fake_decode(self, member, hour, layout=None):
        u, v = member["fake"]
        count = GRID["width"] * GRID["height"]
        return {"u": [u + hour] * count, "v": [v] * count}, "layout"

    def run_importer(self, decode=None, spots=SPOTS, argv=("fetch_harmonie_eps", "--hours", "6", "--step", "3")):
        with patch("fetch_harmonie_eps.ROOT", self.root), patch("sys.argv", list(argv)), \
             patch("fetch_harmonie_eps.inventory", return_value=[]), \
             patch("fetch_harmonie_eps.assemble", return_value=("2026091619", self.MEMBERS)), \
             patch("fetch_harmonie_eps.download", return_value=Path("unused")), \
             patch("fetch_harmonie_eps.digest", return_value="0" * 64), \
             patch("fetch_harmonie_eps.load_spots", return_value=(Path("spots.json"), spots)), \
             patch("fetch_harmonie_eps.decode", side_effect=decode or self.fake_decode):
            main()
        return json.loads((self.root / "public/weather/harmonie-eps.json").read_text())

    def test_publishes_member_series_mean_frames_and_ensemble_metadata(self):
        manifest = self.run_importer()
        self.assertEqual(manifest["model"], "harmonie-eps")
        self.assertEqual(manifest["modelName"], "HARMONIE EPS")
        self.assertEqual(manifest["provider"], "Met Éireann")
        self.assertEqual(manifest["resolutionKm"], 2)
        self.assertEqual(manifest["gustAvailable"], False)
        self.assertEqual(manifest["ensemble"]["members"], 3)
        self.assertEqual(manifest["ensemble"]["control"], 0)
        self.assertEqual(manifest["ensemble"]["memberLagHours"], [0, 1, 2])
        self.assertEqual(manifest["ensemble"]["memberRuns"],
                         ["2026-09-16T19:00:00Z", "2026-09-16T18:00:00Z", "2026-09-16T17:00:00Z"])
        self.assertEqual([f["hour"] for f in manifest["frames"]], [0, 3, 6])
        self.assertEqual([f["gustIntervalHours"] for f in manifest["frames"]], [None] * 3)
        series = manifest["spotMembers"]["brandon"]
        self.assertEqual([entry["validTime"] for entry in series],
                         [frame["validTime"] for frame in manifest["frames"]])
        self.assertEqual(series[0], {"hour": 0, "validTime": "2026-09-16T19:00:00Z",
                                     "u": [4.0, 6.0, 8.0], "v": [-3.0, -3.0, -3.0],
                                     "gust": [None, None, None]})
        self.assertEqual(series[2]["u"], [10.0, 12.0, 14.0])
        # spotForecasts is the ensemble mean, sampled from the published mean grid.
        self.assertEqual([(e["u"], e["v"], e["gust"]) for e in manifest["spotForecasts"]["brandon"]],
                         [(6.0, -3.0, None), (9.0, -3.0, None), (12.0, -3.0, None)])
        frame = json.loads((self.root / "public" / manifest["frames"][2]["url"]).read_text())
        self.assertEqual((frame["u"][0], frame["v"][0], frame["gust"]), (12.0, -3.0, None))
        self.assertEqual(frame["grid"], GRID)
        self.assertEqual(manifest["sourceFiles"][2]["files"],
                         ["fc2026091617+002CONTROL_grib2_ieIoI", "fc2026091617+005CONTROL_grib2_ieIoI",
                          "fc2026091617+008CONTROL_grib2_ieIoI"])

    def test_published_bundle_passes_the_shared_publisher_validation(self):
        manifest = self.run_importer()
        now = datetime(2026, 9, 16, 19, 30, tzinfo=timezone.utc)
        checked, _, objects = validate_bundle(self.root / "public", "harmonie-eps", 12, now)
        self.assertEqual(checked["run"], manifest["run"])
        self.assertEqual(len(objects), 3)

    def test_a_source_failure_keeps_the_previously_published_manifest(self):
        target = self.root / "public/weather/harmonie-eps.json"
        write_json(target, {"previous": "published snapshot"})
        before = target.read_bytes()
        with self.assertRaises(ValueError):
            self.run_importer(ValueError("invalid source"))
        self.assertEqual(target.read_bytes(), before)

    def test_a_spot_outside_the_crop_fails_before_publication(self):
        target = self.root / "public/weather/harmonie-eps.json"
        write_json(target, {"previous": "published snapshot"})
        with self.assertRaises(ValueError):
            self.run_importer(spots=[{"id": "iceland", "lat": 64.1, "lon": -21.9}])
        self.assertEqual(json.loads(target.read_text()), {"previous": "published snapshot"})


class EnsembleValidationTests(unittest.TestCase):
    RUN = datetime(2026, 9, 16, 19, tzinfo=timezone.utc)

    def manifest(self, **overrides):
        entries = [{"hour": hour, "validTime": f"2026-09-16T{19+hour}:00:00Z",
                    "u": [4.0, 6.0], "v": [-3.0, -3.0], "gust": [None, 12.0]} for hour in (0, 1)]
        return {"stepHours": 1, "spotForecasts": {"brandon": []}, "spotMembers": {"brandon": entries},
                "ensemble": {"members": 2, "control": 0,
                             "memberRuns": ["2026-09-16T19:00:00Z", "2026-09-16T18:00:00Z"]}, **overrides}

    def test_accepts_a_complete_member_series(self):
        self.assertEqual(validate_ensemble(self.manifest(), self.RUN), (0, 1))
        self.assertIsNone(validate_ensemble({"stepHours": 1}, self.RUN))

    def test_rejects_broken_member_counts_series_and_values(self):
        cases = {
            "metadata without series": {"spotMembers": None},
            "series without metadata": {"ensemble": None},
            "single member": {"ensemble": {"members": 1, "control": 0}},
            "control outside the members": {"ensemble": {"members": 2, "control": 2}},
            "member run after the published run":
                {"ensemble": {"members": 2, "control": 0,
                              "memberRuns": ["2026-09-16T20:00:00Z", "2026-09-16T18:00:00Z"]}},
            "member runs miscounted":
                {"ensemble": {"members": 2, "control": 0, "memberRuns": ["2026-09-16T19:00:00Z"]}},
            "unknown spot": {"spotForecasts": {"keel": []}},
        }
        for label, override in cases.items():
            with self.subTest(label), self.assertRaises(ValueError):
                validate_ensemble(self.manifest(**override), self.RUN)
        rows = {"short member row": {"u": [4.0]}, "nonfinite": {"u": [4.0, float("nan")]},
                "implausible": {"v": [-3.0, 151.0]}, "negative gust": {"gust": [None, -1.0]},
                "missing component": {"v": [None, -3.0]}, "off-axis hour": {"hour": 5},
                "off-axis valid time": {"validTime": "2026-09-16T23:00:00Z"}}
        for label, entry in rows.items():
            broken = self.manifest()
            broken["spotMembers"]["brandon"][1] = {**broken["spotMembers"]["brandon"][1], **entry}
            with self.subTest(label), self.assertRaises(ValueError):
                validate_ensemble(broken, self.RUN)

    def test_frames_may_be_empty_only_when_an_ensemble_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            public = Path(directory) / "public"
            manifest = {"model": "harmonie-eps", "run": "2026091619", "runTime": "2026-09-16T19:00:00Z",
                        "grid": {"width": 2, "height": 2}, "frames": [], "gustAvailable": False,
                        **self.manifest()}
            write_json(public / "weather/harmonie-eps.json", manifest)
            now = datetime(2026, 9, 16, 19, 30, tzinfo=timezone.utc)
            self.assertEqual(validate_bundle(public, "harmonie-eps", 12, now)[2], [])
            write_json(public / "weather/harmonie-eps.json",
                       {**manifest, "spotMembers": None, "ensemble": None})
            with self.assertRaises(ValueError):
                validate_bundle(public, "harmonie-eps", 12, now)
