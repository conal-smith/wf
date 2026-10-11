"""Backfilling a spot series must reproduce the frames and never rewrite history."""
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import backfill_spots
from backfill_spots import backfill, main
import f5bin
from fetch_forecast import sample, write_json
import rundir
from squares import with_spot_data

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


class Published:
    """A run published as an adapter publishes one, from frames kept aside.

    The frames are written once into `source/`, outside public/, so a test can
    change the manifest and publish it again: each `write` copies them into a
    staging directory and `rundir.write_run` names the run for its content and
    moves the spot data into squares, exactly as for a real run.
    """

    def publish(self):
        prefix = f"{self.model}-{RUN}-3h-v1"
        output = self.public / "weather"
        shutil.rmtree(output / prefix, ignore_errors=True)
        frames = []
        for info in self.manifest.get("frames") or []:
            name = rundir.frame_name(prefix, info["hour"], Path(info["url"]).suffix[1:])
            (output / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.source / info["url"], output / name)
            frames.append({**info, "url": f"weather/{name}"})
        self.pointer = rundir.write_run(output, self.path.name,
                                        {**self.manifest, "frames": frames}, prefix, SPOTS)

    def write(self):
        self.publish()

    def bytes(self):
        return self.path.read_bytes()

    def read_pointer(self):
        return json.loads(self.path.read_text())

    def read(self):
        """The pointer with its squares merged back in: the manifest as the adapter held it."""
        return with_spot_data(self.read_pointer(), lambda relative: json.loads(
            (self.path.parent / relative).read_text()))

    def frame(self, index):
        """Where one frame of the run the pointer names is published."""
        pointer = self.read_pointer()
        return self.path.parent / pointer["base"] / pointer["frames"][index]["url"]


class Bundle(Published):
    """A published wind snapshot on disk: a manifest and the frames it references."""

    def __init__(self, root, model="gfs", gust_available=True, missing_gust_hours=(),
                 published=("kept",), encoding=None, **extra):
        self.public = Path(root) / "public"
        self.source = Path(root) / "source"
        self.model = model
        self.path = self.public / "weather" / f"{model}.json"
        self.values = {}
        frames = []
        for hour in HOURS:
            gust = None if not gust_available or hour in missing_gust_hours else field(hour + 2)
            self.values[hour] = {"u": field(hour), "v": field(hour + 1), "gust": gust}
            interval = None if gust is None else [hour, hour]
            frame = {"model": model, "run": RUN, "hour": hour, "validTime": valid_time(hour),
                     "grid": GRID, "gustIntervalHours": interval, **self.values[hour]}
            url = f"{model}/{hour:03d}.{'bin' if encoding else 'json'}"
            self.write_frame(self.source / url, frame, encoding)
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


class WaveBundle(Published):
    """A published wave snapshot: `spotSeries` over frames of one array per variable."""

    def __init__(self, root, published=("kept",), frames=True, hole=False, **extra):
        self.public = Path(root) / "public"
        self.source = Path(root) / "source"
        self.model = "gfs-wave"
        self.path = self.public / "weather" / "gfs-wave.json"
        self.values, listed = {}, []
        for hour in HOURS:
            values = {name: field(hour + seed) for seed, name in enumerate(VARIABLES)}
            if hole:
                # A land cell reaching `added`: every variable is null there, and a
                # null anywhere in the stencil nulls the sampled value.
                for name in VARIABLES:
                    values[name][2 * GRID["width"] + 2] = None
            self.values[hour] = values
            url = f"gfs-wave/{hour:03d}.json"
            write_json(self.source / url, {"model": "gfs-wave", "run": RUN, "hour": hour,
                                           "validTime": valid_time(hour), "grid": WAVE_GRID,
                                           **values})
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
        self.write()

    def sampled(self, hour, name, spot):
        from fetch_gfswave import sample_wave
        return sample_wave(WAVE_GRID, self.values[hour][name], spot["lon"], spot["lat"])


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
        # Merged square by square, so in square order rather than catalogue order.
        self.assertEqual(sorted(series), sorted(spot["id"] for spot in SPOTS))
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
        pointer = bundle.read_pointer()
        self.backfill(bundle)
        after = bundle.read_pointer()
        self.assertEqual(json.dumps(bundle.read()["spotForecasts"]["kept"]), before)
        # Nothing else about the pointer moves, including the key order, except the
        # run directory it names and the squares that now hold every spot.
        moved = ("base", "spots")
        self.assertEqual([key for key in after], [key for key in pointer])
        self.assertEqual({key: value for key, value in after.items() if key not in moved},
                         {key: value for key, value in pointer.items() if key not in moved})

    def test_the_series_are_published_as_a_new_run_directory(self):
        """A run directory is never rewritten: the old one stays whole for its readers."""
        bundle = Bundle(self.root)
        old = bundle.read_pointer()
        self.backfill(bundle)
        new = bundle.read_pointer()
        self.assertNotEqual(new["base"], old["base"])
        weather = bundle.public / "weather"
        self.assertEqual(rundir.digest(rundir.content_files(weather / new["base"])),
                         rundir.hash_of(new["base"]))
        self.assertTrue((weather / old["base"]).is_dir())
        self.assertEqual(rundir.content_files(weather / old["base"])["frames/000.json"],
                         rundir.content_files(weather / new["base"])["frames/000.json"])
        self.assertEqual(old["spots"]["squares"], ["n54w010"])
        self.assertEqual(new["spots"]["squares"], ["n52w010", "n54w002", "n54w010"])

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
        frame = json.loads(bundle.frame(1).read_text())
        frame["v"] = None
        write_json(bundle.frame(1), frame)
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
        for url in ("../../etc/passwd", "frames/../../../etc/passwd", "frames/003.json"):
            with self.subTest(url=url):
                pointer = bundle.read_pointer()
                pointer["frames"][0]["url"] = url
                bundle.path.write_text(json.dumps(pointer))
                with self.assertRaises(ValueError) as caught:
                    self.backfill(bundle)
                self.assertIn("is not where the frame at +0h belongs", str(caught.exception))

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
                frame = {"model": bundle.model, "run": RUN, "hour": HOURS[1],
                         "grid": GRID, **bundle.values[HOURS[1]], **change}
                bundle.frame(1).write_bytes(f5bin.encode_frame(frame))
                with self.assertRaises(ValueError) as caught:
                    self.backfill(bundle)
                self.assertIn("is not the frame the manifest lists", str(caught.exception))

    def test_a_frame_under_another_models_directory_is_a_fault(self):
        """A binary frame carries no model, so the run directory has to say who owns it."""
        bundle = self.bundle()
        pointer = bundle.read_pointer()
        theirs = "icon-eu" + pointer["base"][len(bundle.model):]
        os.replace(bundle.path.parent / pointer["base"], bundle.path.parent / theirs)
        bundle.path.write_text(json.dumps({**pointer, "base": theirs}))
        with self.assertRaises(ValueError) as caught:
            self.backfill(bundle)
        self.assertIn(f"is not named for {bundle.model}", str(caught.exception))

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
        # Merged square by square, so in square order rather than catalogue order.
        self.assertEqual(sorted(series), sorted(spot["id"] for spot in SPOTS))
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
        bundle.write()
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
        bundle.write()
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
