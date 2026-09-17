"""Backfilling a spot series must reproduce the frames and never rewrite history."""
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backfill_spots
from backfill_spots import backfill, main
import f5bin
from fetch_forecast import sample, write_json

RUN = "2026091612"
RUN_TIME = datetime.strptime(RUN, "%Y%m%d%H").replace(tzinfo=timezone.utc)
GRID = {"width": 5, "height": 4, "west": -11.0, "east": -7.0, "north": 56.0, "south": 53.0,
        "dx": 1.0, "dy": 1.0, "order": "north-to-south, west-to-east", "units": "m/s"}
WAVE_GRID = {key: value for key, value in GRID.items() if key != "units"}
HOURS = [0, 3]
# `offgrid` sits well east of the crop: the adapters publish nulls for it rather
# than clamping it onto the edge, and so must the backfill.
SPOTS = [{"id": "kept", "name": "Kept", "lat": 54.5, "lon": -9.5},
         {"id": "added", "name": "Added", "lat": 53.25, "lon": -8.1},
         {"id": "offgrid", "name": "Off grid", "lat": 54.0, "lon": -2.0}]
VARIABLES = {"swh": {"units": "m", "label": "Wave height", "description": "Combined height"},
             "pp1d": {"units": "s", "label": "Peak period", "description": "Primary period"}}


def valid_time(hour):
    return (RUN_TIME + timedelta(hours=hour)).isoformat().replace("+00:00", "Z")


def field(seed):
    return [round(index * 0.25 + seed, 2) for index in range(GRID["width"] * GRID["height"])]


def wind_point(values, spot, order=("u", "v", "gust")):
    return {name: None if values[name] is None
            else sample(GRID, values[name], spot["lon"], spot["lat"]) for name in order}


class Bundle:
    """A published wind snapshot on disk: a manifest and the frames it references."""

    def __init__(self, root, model="gfs", gust_available=True, missing_gust_hours=(),
                 published=("kept",), encoding=None, **extra):
        self.public = Path(root) / "public"
        self.model = model
        self.path = self.public / "weather" / f"{model}.json"
        self.values = {}
        frames = []
        for index, hour in enumerate(HOURS):
            gust = None if not gust_available or hour in missing_gust_hours else field(hour + 2)
            self.values[hour] = {"u": field(hour), "v": field(hour + 1), "gust": gust}
            interval = None if gust is None else [hour, hour]
            frame = {"model": model, "run": RUN, "hour": hour, "validTime": valid_time(hour),
                     "grid": GRID, "gustIntervalHours": interval, **self.values[hour]}
            # A binary frame is content-addressed, exactly as publish_frame names
            # it: the reader checks the name against the bytes, so a fixture that
            # invented a name would be refused.
            name = (f5bin.basename(hour, f5bin.encode_frame(frame)) if encoding
                    else f"{hour:03d}-frame{index}.json")
            url = f"weather/{model}-{RUN}-3h-v1/{name}"
            self.write_frame(self.public / url, frame, encoding)
            frames.append({"hour": hour, "validTime": valid_time(hour), "url": url,
                           "gustIntervalHours": interval})
        if encoding:
            extra = {"encoding": encoding, **extra}
        self.manifest = {
            "schemaVersion": 1, "model": model, "modelName": model.upper(), "provider": "Test",
            "run": RUN, "runTime": RUN_TIME.isoformat().replace("+00:00", "Z"),
            "generatedAt": "2026-09-16T21:19:54.197819+00:00", "stepHours": 3, "grid": GRID,
            "frames": frames,
            "spotForecasts": {spot["id"]: [
                {"hour": hour, "validTime": valid_time(hour), **wind_point(self.values[hour], spot)}
                for hour in HOURS] for spot in SPOTS if spot["id"] in published},
            "gustAvailable": gust_available, "attribution": "Test data", **extra}
        if missing_gust_hours:
            self.manifest["gustMissingHours"] = list(missing_gust_hours)
        self.write()

    @staticmethod
    def write_frame(path, frame, encoding):
        if not encoding:
            return write_json(path, frame)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f5bin.encode_frame(frame))

    def write(self):
        write_json(self.path, self.manifest)

    def bytes(self):
        return self.path.read_bytes()

    def read(self):
        return json.loads(self.path.read_text())


class WaveBundle:
    """A published wave snapshot: `spotSeries` over frames of one array per variable."""

    def __init__(self, root, published=("kept",), frames=True, hole=False, **extra):
        self.public = Path(root) / "public"
        self.model = "gfs-wave"
        self.path = self.public / "weather" / "gfs-wave.json"
        self.values, listed = {}, []
        for index, hour in enumerate(HOURS):
            values = {name: field(hour + seed) for seed, name in enumerate(VARIABLES)}
            if hole:
                # A land cell reaching `added`: every variable is null there, and a
                # null anywhere in the stencil nulls the sampled value.
                for name in VARIABLES:
                    values[name][2 * GRID["width"] + 2] = None
            self.values[hour] = values
            url = f"weather/gfs-wave-{RUN}-3h-v1/{hour:03d}-frame{index}.json"
            write_json(self.public / url, {"model": "gfs-wave", "run": RUN, "hour": hour,
                                          "validTime": valid_time(hour), "grid": WAVE_GRID, **values})
            listed.append({"hour": hour, "validTime": valid_time(hour), "url": url})
        self.manifest = {
            "schemaVersion": 1, "kind": "wave", "model": "gfs-wave", "modelName": "GFS-Wave",
            "provider": "Test", "run": RUN,
            "runTime": RUN_TIME.isoformat().replace("+00:00", "Z"), "stepHours": 3,
            "grid": WAVE_GRID, "variables": VARIABLES,
            "frames": listed if frames else [],
            "spotSeries": {spot["id"]: [
                {"hour": hour, "validTime": valid_time(hour),
                 "values": {name: self.sampled(hour, name, spot) for name in VARIABLES}}
                for hour in HOURS] for spot in SPOTS if spot["id"] in published},
            "spotCoverage": {spot["id"]: {"landMasked": False, "resolved": True, "note": "Water."}
                             for spot in SPOTS},
            "attribution": "Test data", **extra}
        write_json(self.path, self.manifest)

    def sampled(self, hour, name, spot):
        from fetch_gfswave import sample_wave
        return sample_wave(WAVE_GRID, self.values[hour][name], spot["lon"], spot["lat"])

    def read(self):
        return json.loads(self.path.read_text())


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = []

    def backfill(self, bundle, **kwargs):
        return backfill(bundle.public, bundle.model, SPOTS, log=self.log.append, **kwargs)

    def test_missing_spots_are_added_from_the_frames(self):
        bundle = Bundle(self.root)
        self.assertEqual(self.backfill(bundle), ["added", "offgrid"])
        series = bundle.read()["spotForecasts"]
        self.assertEqual(list(series), [spot["id"] for spot in SPOTS])
        for spot in SPOTS:
            for index, hour in enumerate(HOURS):
                entry = series[spot["id"]][index]
                self.assertEqual(entry["hour"], hour)
                self.assertEqual(entry["validTime"], valid_time(hour))
                for name in ("u", "v", "gust"):
                    self.assertEqual(entry[name],
                                     sample(GRID, bundle.values[hour][name], spot["lon"], spot["lat"]),
                                     f"{spot['id']} {name} +{hour}h")

    def test_published_series_survive_byte_for_byte(self):
        bundle = Bundle(self.root)
        before = json.dumps(bundle.read()["spotForecasts"]["kept"])
        self.backfill(bundle)
        after = bundle.read()
        self.assertEqual(json.dumps(after["spotForecasts"]["kept"]), before)
        # Nothing else about the manifest moves, including the key order.
        self.assertEqual([key for key in after if key != "spotForecasts"],
                         [key for key in bundle.manifest if key != "spotForecasts"])
        self.assertEqual({key: value for key, value in after.items() if key != "spotForecasts"},
                         {key: value for key, value in bundle.manifest.items()
                          if key != "spotForecasts"})

    def test_a_new_series_keeps_the_published_key_order(self):
        # ECMWF and GFS write gust before u/v; ICON-EU and HARMONIE write it last.
        for order in [("u", "v", "gust"), ("gust", "u", "v")]:
            with self.subTest(order=order):
                bundle = Bundle(Path(tempfile.mkdtemp(dir=self.root)))
                bundle.manifest["spotForecasts"] = {"kept": [
                    {"hour": hour, "validTime": valid_time(hour),
                     **wind_point(bundle.values[hour], SPOTS[0], order)} for hour in HOURS]}
                bundle.write()
                self.backfill(bundle)
                entry = bundle.read()["spotForecasts"]["added"][1]
                self.assertEqual(list(entry), ["hour", "validTime", *order])

    def test_a_spot_outside_the_grid_is_published_as_nulls(self):
        bundle = Bundle(self.root)
        self.backfill(bundle)
        for entry in bundle.read()["spotForecasts"]["offgrid"]:
            self.assertEqual([entry["u"], entry["v"], entry["gust"]], [None, None, None])

    def test_a_manifest_that_disagrees_with_its_frames_is_refused(self):
        bundle = Bundle(self.root)
        bundle.manifest["spotForecasts"]["kept"][1]["u"] += 0.02
        bundle.write()
        before = bundle.bytes()
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("kept +3h u", str(caught.exception))
        self.assertIn("refusing to rewrite", str(caught.exception))
        self.assertEqual(bundle.bytes(), before)

    def test_rounding_noise_inside_the_tolerance_is_accepted(self):
        bundle = Bundle(self.root)
        bundle.manifest["spotForecasts"]["kept"][1]["v"] += 0.004
        bundle.write()
        self.assertEqual(self.backfill(bundle), ["added", "offgrid"])

    def test_a_published_valid_time_that_does_not_match_is_refused(self):
        bundle = Bundle(self.root)
        bundle.manifest["spotForecasts"]["kept"][1]["validTime"] = "2026-09-16T23:00:00Z"
        bundle.write()
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("published valid time", str(caught.exception))

    def test_unavailable_gusts_stay_null_everywhere(self):
        bundle = Bundle(self.root, gust_available=False)
        self.backfill(bundle)
        series = bundle.read()["spotForecasts"]
        for spot in SPOTS:
            for entry in series[spot["id"]]:
                self.assertIsNone(entry["gust"], spot["id"])
        # Unavailable gusts null only the gust: the wind components stay real.
        for entry in series["added"]:
            self.assertIsNotNone(entry["u"])
            self.assertIsNotNone(entry["v"])

    def test_an_explicitly_missing_gust_hour_is_null_and_later_hours_are_not(self):
        bundle = Bundle(self.root, missing_gust_hours=(0,))
        self.backfill(bundle)
        series = bundle.read()["spotForecasts"]["added"]
        self.assertIsNone(series[0]["gust"])
        self.assertEqual(series[1]["gust"],
                         sample(GRID, bundle.values[3]["gust"], SPOTS[1]["lon"], SPOTS[1]["lat"]))

    def test_a_gust_the_manifest_calls_unavailable_is_a_fault_not_a_series(self):
        bundle = Bundle(self.root)
        bundle.manifest["gustAvailable"] = False
        bundle.write()
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("calls unavailable", str(caught.exception))

    def test_a_frame_missing_a_wind_component_is_a_fault(self):
        bundle = Bundle(self.root)
        url = bundle.manifest["frames"][1]["url"]
        frame = json.loads((bundle.public / url).read_text())
        frame["v"] = None
        write_json(bundle.public / url, frame)
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("missing its v field", str(caught.exception))

    def test_a_frame_whose_identity_drifted_is_a_fault(self):
        bundle = Bundle(self.root)
        bundle.manifest["frames"][1]["validTime"] = "2026-09-16T23:00:00Z"
        bundle.write()
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("not the frame the manifest lists", str(caught.exception))

    def test_an_unsafe_frame_url_is_refused(self):
        bundle = Bundle(self.root)
        bundle.manifest["frames"][0]["url"] = "weather/../../etc/passwd"
        bundle.write()
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("Unsafe object path", str(caught.exception))

    def test_an_ensemble_is_refused_because_members_are_not_in_the_mean(self):
        for extra in [{"spotMembers": {"kept": []}},
                      {"ensemble": {"members": 2, "control": None, "description": "Two."}}]:
            with self.subTest(extra=list(extra)):
                bundle = Bundle(Path(tempfile.mkdtemp(dir=self.root)), **extra)
                before = bundle.bytes()
                with self.assertRaises(ValueError) as caught:
                    self.backfill(bundle)
                self.assertIn("members cannot be recomputed", str(caught.exception))
                self.assertEqual(bundle.bytes(), before)

    def test_a_manifest_whose_kind_contradicts_the_registry_is_refused(self):
        bundle = Bundle(self.root, kind="wave")
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("not the registry's 'wind'", str(caught.exception))

    def test_a_published_spot_that_left_the_catalogue_is_never_dropped(self):
        bundle = Bundle(self.root, published=("kept",))
        with self.assertRaises(ValueError) as caught:
            backfill(bundle.public, bundle.model, SPOTS[1:], log=self.log.append)
        self.assertIn("refusing to drop a published series", str(caught.exception))

    def test_a_frameless_manifest_is_skipped_with_a_message(self):
        bundle = Bundle(self.root)
        bundle.manifest["frames"] = []
        bundle.write()
        before = bundle.bytes()
        self.assertEqual(self.backfill(bundle), [])
        self.assertEqual(bundle.bytes(), before)
        self.assertIn("no frames are bundled", " ".join(self.log))


class BinaryBackfillTests(unittest.TestCase):
    """The same job over F5 int16 frames, which are lossier than the series they check."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = []

    def bundle(self, **kwargs):
        return Bundle(self.root, encoding=f5bin.ENCODING, **kwargs)

    def backfill(self, bundle, **kwargs):
        return backfill(bundle.public, bundle.model, SPOTS, log=self.log.append, **kwargs)

    def test_missing_spots_are_added_from_the_decoded_frames(self):
        bundle = self.bundle()
        self.assertEqual(self.backfill(bundle), ["added", "offgrid"])
        series = bundle.read()["spotForecasts"]
        for spot in SPOTS[:2]:
            for index, hour in enumerate(HOURS):
                entry = series[spot["id"]][index]
                self.assertEqual((entry["hour"], entry["validTime"]), (hour, valid_time(hour)))
                for name in ("u", "v", "gust"):
                    exact = sample(GRID, bundle.values[hour][name], spot["lon"], spot["lat"])
                    # Recomputed from tenths, so near the exact value but not on it.
                    self.assertLessEqual(abs(entry[name] - exact),
                                         backfill_spots.BINARY_TOLERANCE,
                                         f"{spot['id']} {name} +{hour}h")

    def test_the_quantisation_alone_is_not_a_disagreement(self):
        """The published series is full precision; the frames are tenths. That is fine.

        The fixture's fields are multiples of 0.25, so every other value is exactly
        0.05 from its stored tenth: the worst case the tolerance is sized for.
        """
        bundle = self.bundle(published=("kept", "added", "offgrid"))
        self.assertEqual(self.backfill(bundle), [])
        self.assertIn("3 published series verified", " ".join(self.log))
        # The JSON tolerance would have called the same bundle corrupt.
        with patch.object(backfill_spots, "BINARY_TOLERANCE", backfill_spots.TOLERANCE):
            with self.assertRaises(ValueError) as caught:
                self.backfill(bundle)
        self.assertIn("disagree with the published spotForecasts", str(caught.exception))

    def test_a_real_disagreement_is_still_caught(self):
        bundle = self.bundle()
        published = bundle.manifest["spotForecasts"]["kept"]
        published[1]["u"] = published[1]["u"] + 1.0
        bundle.write()
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("kept +3h u", str(caught.exception))

    def test_a_frame_from_another_run_or_hour_is_a_fault(self):
        for change in ({"run": "2026091600"}, {"hour": 9}):
            with self.subTest(**change):
                bundle = self.bundle()
                url = bundle.manifest["frames"][1]["url"]
                frame = {"model": bundle.model, "run": RUN, "hour": HOURS[1],
                         "grid": GRID, **bundle.values[HOURS[1]], **change}
                (bundle.public / url).write_bytes(f5bin.encode_frame(frame))
                with self.assertRaises(ValueError) as caught:
                    self.backfill(bundle)
                self.assertIn("is not the frame the manifest lists", str(caught.exception))

    def test_a_frame_under_another_models_directory_is_a_fault(self):
        """A binary frame carries no model, so the run directory has to say who owns it."""
        bundle = self.bundle()
        info = bundle.manifest["frames"][1]
        moved = f"weather/icon-eu-{RUN}-3h-v1/{Path(info['url']).name}"
        (bundle.public / moved).parent.mkdir(parents=True, exist_ok=True)
        (bundle.public / moved).write_bytes((bundle.public / info["url"]).read_bytes())
        info["url"] = moved
        bundle.write()
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn(f"is not named for {bundle.model}", str(caught.exception))

    def test_a_frame_whose_bytes_are_not_its_name_is_a_fault(self):
        """The name is the hash, so a frame swapped for another of the same shape shows."""
        bundle = self.bundle()
        info = bundle.manifest["frames"][1]
        swapped = dict(bundle.values[HOURS[1]], u=[9.0] * (GRID["width"] * GRID["height"]))
        (bundle.public / info["url"]).write_bytes(f5bin.encode_frame(
            {"model": bundle.model, "run": RUN, "hour": HOURS[1], "grid": GRID, **swapped}))
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("does not hold the frame its name claims", str(caught.exception))

    def test_an_unreadable_encoding_is_refused(self):
        bundle = self.bundle()
        bundle.manifest["encoding"] = "f5-int16-v2"
        bundle.write()
        with self.assertRaises(ValueError):
            self.backfill(bundle)

    def test_unavailable_gusts_stay_null_over_binary_frames_too(self):
        bundle = self.bundle(gust_available=False)
        self.assertEqual(self.backfill(bundle), ["added", "offgrid"])
        for series in bundle.read()["spotForecasts"].values():
            self.assertEqual([entry["gust"] for entry in series], [None] * len(HOURS))


class WaveBackfillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = []

    def backfill(self, bundle, **kwargs):
        return backfill(bundle.public, bundle.model, SPOTS, log=self.log.append, **kwargs)

    def test_wave_spot_series_are_recomputed_from_the_frames(self):
        bundle = WaveBundle(self.root)
        before = json.dumps(bundle.read()["spotSeries"]["kept"])
        self.assertEqual(self.backfill(bundle), ["added", "offgrid"])
        series = bundle.read()["spotSeries"]
        self.assertEqual(json.dumps(series["kept"]), before)
        self.assertEqual(list(series), [spot["id"] for spot in SPOTS])
        for spot in SPOTS:
            for index, hour in enumerate(HOURS):
                entry = series[spot["id"]][index]
                self.assertEqual(list(entry["values"]), list(VARIABLES))
                for name in VARIABLES:
                    self.assertEqual(entry["values"][name], bundle.sampled(hour, name, spot))
        for entry in series["offgrid"]:
            self.assertEqual(set(entry["values"].values()), {None})

    def test_a_land_cell_nulls_the_whole_stencil(self):
        bundle = WaveBundle(self.root, hole=True)
        self.backfill(bundle)
        series = bundle.read()["spotSeries"]["added"]
        self.assertEqual(set(series[0]["values"].values()), {None})

    def test_a_wave_manifest_that_disagrees_with_its_frames_is_refused(self):
        bundle = WaveBundle(self.root)
        bundle.manifest["spotSeries"]["kept"][0]["values"]["swh"] += 0.02
        write_json(bundle.path, bundle.manifest)
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn("kept +0h swh", str(caught.exception))

    def test_frames_that_carry_only_a_subset_of_the_variables_are_skipped(self):
        bundle = WaveBundle(self.root, frameVariables=["swh"])
        self.assertEqual(self.backfill(bundle), [])
        self.assertIn("cannot be recomputed", " ".join(self.log))

    def test_a_location_with_no_published_coverage_is_skipped(self):
        bundle = WaveBundle(self.root)
        del bundle.manifest["spotCoverage"]["added"]
        write_json(bundle.path, bundle.manifest)
        self.assertEqual(self.backfill(bundle), [])
        self.assertIn("native land mask", " ".join(self.log))
        self.assertNotIn("added", bundle.read()["spotSeries"])

    def test_a_frameless_wave_bundle_is_skipped(self):
        bundle = WaveBundle(self.root, frames=False)
        self.assertEqual(self.backfill(bundle), [])
        self.assertIn("no frames are bundled", " ".join(self.log))


class CommandLineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.catalogue = self.root / "spots.json"
        self.catalogue.write_text(json.dumps(SPOTS))
        self.environment = patch.dict("os.environ",
                                      {"FORCE5_SPOTS_FILE": str(self.catalogue)})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def run_main(self, *argv):
        output = io.StringIO()
        with patch("sys.stdout", output), patch("sys.stderr", output):
            code = main(list(argv))
        return code, output.getvalue()

    def test_check_reports_what_would_change_and_writes_nothing(self):
        bundle = Bundle(self.root)
        before = bundle.bytes()
        code, output = self.run_main("gfs", "--public", str(bundle.public), "--check")
        self.assertEqual(code, 0)
        self.assertEqual(bundle.bytes(), before)
        self.assertIn("would gain 2 of 3", output)
        self.assertIn("dry run", output)

    def test_a_run_without_check_writes_the_manifest(self):
        bundle = Bundle(self.root)
        code, output = self.run_main("gfs", "--public", str(bundle.public))
        self.assertEqual(code, 0)
        self.assertIn("gains 2 of 3", output)
        self.assertEqual(len(bundle.read()["spotForecasts"]), 3)

    def test_all_sweeps_the_manifests_that_exist_and_steps_over_ensembles(self):
        wind = Bundle(self.root)
        wave = WaveBundle(self.root)
        ensemble = Bundle(self.root, model="ecmwf",
                          ensemble={"members": 2, "control": None, "description": "Two."},
                          spotMembers={"kept": []})
        before = ensemble.bytes()
        code, output = self.run_main("--all", "--public", str(wind.public))
        self.assertEqual(code, 0)
        self.assertIn("ecmwf: an ensemble's members cannot be recomputed", output)
        self.assertEqual(ensemble.bytes(), before)
        self.assertEqual(len(wind.read()["spotForecasts"]), 3)
        self.assertEqual(len(wave.read()["spotSeries"]), 3)
        # Models with no local manifest are simply not in the sweep.
        self.assertNotIn("harmonie", output)

    def test_a_failure_is_reported_and_exits_non_zero(self):
        bundle = Bundle(self.root)
        bundle.manifest["spotForecasts"]["kept"][0]["u"] += 1
        bundle.write()
        before = bundle.bytes()
        code, output = self.run_main("gfs", "--public", str(bundle.public))
        self.assertEqual(code, 1)
        self.assertIn("kept +0h u", output)
        self.assertEqual(bundle.bytes(), before)

    def test_an_unknown_or_absent_model_is_a_usage_error(self):
        for argv in [["not-a-model"], []]:
            with self.subTest(argv=argv), self.assertRaises(SystemExit):
                with patch("sys.stderr", io.StringIO()):
                    main(argv + ["--public", str(self.root / "public")])

    def test_the_default_public_directory_is_the_working_tree(self):
        with patch("backfill_spots.backfill") as recomputed, patch("sys.stdout", io.StringIO()):
            self.assertEqual(main(["gfs"]), 0)
        self.assertEqual(recomputed.call_args.args[0], str(backfill_spots.ROOT / "public"))


if __name__ == "__main__":
    unittest.main()
