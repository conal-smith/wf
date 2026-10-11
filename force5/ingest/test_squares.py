"""Spot squares and run directories: the key, the split, the loader and the hash.

`tests/fixtures/squares.json` is read by this suite and by
`force5/src/squares.test.ts`, so the two languages cannot name a square
differently without one of them failing; `tests/fixtures/superseded.json` holds
the `superseded` list a pointer carries to both writers of pointers likewise.
"""
import copy
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import f5bin
import f5tile
import rundir
import squares
from squares import SQUARE_DEGREES, load_spot_data, spot_square, split_spot_data

FIXTURE = Path(__file__).resolve().parents[2] / "tests/fixtures/squares.json"
SUPERSEDED = Path(__file__).resolve().parents[2] / "tests/fixtures/superseded.json"
SPOTS = [{"id": "dollymount", "lat": 53.365, "lon": -6.135},
         {"id": "bull", "lat": 53.36, "lon": -6.15},
         {"id": "brandon", "lat": 52.276, "lon": -10.024},
         {"id": "keel", "lat": 53.971, "lon": -10.067}]


def whole_manifest(members=True):
    """A manifest as an adapter holds it, every per-spot key inline."""
    def steps(seed):
        return [{"hour": hour, "validTime": f"2026-09-13T{12 + hour}:00:00Z",
                 "u": seed + hour, "v": -seed, "gust": None} for hour in range(3)]
    manifest = {"schemaVersion": 1, "model": "harmonie-eps", "run": "2026091312",
                "runTime": "2026-09-13T12:00:00Z", "stepHours": 1,
                "frames": [{"hour": 0, "validTime": "2026-09-13T12:00:00Z",
                            "url": "weather/harmonie-eps-2026091312-2h-v1/frames/000.bin"}],
                "spotForecasts": {spot["id"]: steps(index)
                                  for index, spot in enumerate(SPOTS)},
                "spotCoverage": {"keel": {"landMasked": True, "note": "Over land."}},
                "spotCells": {"brandon": {"dataset": None, "reason": "Too far."}},
                "spotForecastsDescription": "Means; the members are in spotMembers."}
    if members:
        manifest["spotMembers"] = {spot["id"]: [{"hour": 0, "validTime": "2026-09-13T12:00:00Z",
                                                 "u": [1, 2], "v": [3, 4], "gust": [None, None]}]
                                   for spot in SPOTS}
    return manifest


class SquareKeyTests(unittest.TestCase):
    def test_every_shared_case(self):
        fixture = json.loads(FIXTURE.read_text())
        self.assertEqual(fixture["squareDegrees"], SQUARE_DEGREES)
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(spot_square(case["lat"], case["lon"]), case["square"])

    def test_a_square_name_always_matches_the_published_pattern(self):
        for lat in range(-90, 91, 7):
            for lon in range(-180, 181, 13):
                self.assertRegex(spot_square(lat + 0.3 if lat < 90 else lat, lon),
                                 squares.SQUARE_NAME)

    def test_impossible_points_have_no_square(self):
        for lat, lon in ((91, 0), (-91, 0), (float("nan"), 0), (0, float("inf"))):
            with self.subTest(lat=lat, lon=lon), self.assertRaises(ValueError):
                spot_square(lat, lon)
        # Past the edges of the world: a catalogue typo, refused in all three.
        for case in json.loads(FIXTURE.read_text())["refused"]:
            with self.subTest(case["name"]), self.assertRaises(ValueError):
                spot_square(case["lat"], case["lon"])

    def test_a_square_name_is_ascii_digits_only(self):
        self.assertIsNone(squares.SQUARE_NAME.fullmatch("n\u0665\u0662w010"))
        with self.assertRaises(ValueError):
            squares.square_index({"spots": {"squareDegrees": 2, "url": "spots/{square}.json",
                                            "squares": ["n\u0665\u0662w010"],
                                            "keys": ["spotForecasts"]}})

    def test_squares_for_a_list_of_spots_is_sorted_and_distinct(self):
        self.assertEqual(squares.squares_for(SPOTS), ["n52w008", "n52w012"])


class SplitTests(unittest.TestCase):
    def read_from(self, pointer, documents):
        base = "harmonie-eps-2026091312-2h-v1-0a0b0c0d/"
        pointer = {**pointer, "base": base}
        files = {f"{base}spots/{square}.json": json.loads(json.dumps(document))
                 for square, document in documents.items()}
        return pointer, files.__getitem__

    def test_loading_every_square_gives_back_exactly_what_was_split(self):
        manifest = whole_manifest()
        original = copy.deepcopy(manifest)
        pointer, documents = split_spot_data(manifest, SPOTS)
        self.assertEqual(manifest, original)  # The caller's manifest is left alone.
        pointer, read = self.read_from(pointer, documents)
        merged = load_spot_data(pointer, read)
        for key in squares.SPOT_KEYS:
            if key in original:
                self.assertEqual(merged[key], original[key], key)
        self.assertEqual(set(merged), {key for key in squares.SPOT_KEYS if key in original})

    def test_the_pointer_keeps_everything_but_the_spot_data(self):
        pointer, documents = split_spot_data(whole_manifest(), SPOTS)
        self.assertEqual(pointer["schemaVersion"], 2)
        for key in squares.SPOT_KEYS:
            self.assertNotIn(key, pointer)
        self.assertEqual(pointer["spotForecastsDescription"],
                         "Means; the members are in spotMembers.")
        self.assertEqual(pointer["spots"], {
            "squareDegrees": 2, "url": "spots/{square}.json",
            "squares": ["n52w008", "n52w012"],
            "keys": ["spotForecasts", "spotCoverage", "spotMembers", "spotCells"]})
        self.assertEqual(documents["n52w008"]["square"], "n52w008")
        self.assertEqual(sorted(documents["n52w008"]["spotForecasts"]), ["bull", "dollymount"])
        self.assertNotIn("spotCells", documents["n52w008"])
        self.assertEqual(sorted(documents["n52w012"]["spotForecasts"]), ["brandon", "keel"])
        self.assertEqual((documents["n52w012"]["model"], documents["n52w012"]["run"],
                          documents["n52w012"]["schemaVersion"]),
                         ("harmonie-eps", "2026091312", 2))

    def test_an_empty_key_survives_the_round_trip(self):
        manifest = whole_manifest(members=False)
        manifest["spotMembers"] = {}
        pointer, documents = split_spot_data(manifest, SPOTS)
        pointer, read = self.read_from(pointer, documents)
        self.assertEqual(load_spot_data(pointer, read)["spotMembers"], {})

    def test_some_squares_only(self):
        pointer, documents = split_spot_data(whole_manifest(), SPOTS)
        pointer, read = self.read_from(pointer, documents)
        asked = []
        merged = load_spot_data(pointer, lambda path: asked.append(path) or read(path),
                                ["n52w008", "s10e010", "n52w008"])
        self.assertEqual(sorted(merged["spotForecasts"]), ["bull", "dollymount"])
        self.assertEqual(merged["spotCells"], {})
        self.assertEqual(len(asked), 1)  # Unlisted squares and repeats cost nothing.

    def test_a_spot_with_no_coordinates_is_refused(self):
        with self.assertRaisesRegex(ValueError, "no coordinates"):
            split_spot_data(whole_manifest(), SPOTS[:3])

    def test_a_manifest_already_split_or_with_its_own_spots_key_is_refused(self):
        pointer, _ = split_spot_data(whole_manifest(), SPOTS)
        with self.assertRaises(ValueError):
            split_spot_data(pointer, SPOTS)
        with self.assertRaises(ValueError):
            split_spot_data({**whole_manifest(), "spots": {"keel": {}}}, SPOTS)

    def test_a_frameless_run_states_its_horizon_in_the_pointer(self):
        manifest = {**whole_manifest(), "frames": []}
        pointer, _ = split_spot_data(manifest, SPOTS)
        self.assertEqual(pointer["horizonHours"], 2)
        pointer, _ = split_spot_data({**manifest, "horizonHours": 6}, SPOTS)
        self.assertEqual(pointer["horizonHours"], 6)
        # A wave run's series count too, frames empty or absent, as in
        # scripts/runs.mjs (seriesHorizon).
        waves = {"model": "gfs-wave", "run": "2026101106",
                 "spotSeries": {"keel": [{"hour": 0}, {"hour": 9}], "brandon": [{"hour": 6}]}}
        for manifest in (waves, {**waves, "frames": []}):
            pointer, _ = split_spot_data(manifest, SPOTS)
            self.assertEqual(pointer["horizonHours"], 9)
        self.assertIsNone(squares.series_horizon(
            {"spotForecasts": {"keel": [{"hour": "9"}], "brandon": []}}))

    def test_a_square_from_elsewhere_is_refused(self):
        pointer, documents = split_spot_data(whole_manifest(), SPOTS)
        for change in ({"run": "2026091311"}, {"model": "harmonie"}, {"square": "n52w012"},
                       {"schemaVersion": 1}, {"spotSeries": {"x": []}}, {"spotForecasts": {}}):
            with self.subTest(change=change):
                broken = {**documents, "n52w008": {**documents["n52w008"], **change}}
                ready, read = self.read_from(pointer, broken)
                with self.assertRaises(ValueError):
                    load_spot_data(ready, read)
        duplicated = {**documents, "n52w008": {**documents["n52w008"], "spotForecasts": {
            **documents["n52w008"]["spotForecasts"], "keel": []}}}
        ready, read = self.read_from(pointer, duplicated)
        with self.assertRaisesRegex(ValueError, "more than one"):
            load_spot_data(ready, read)

    def test_an_unusable_index_or_base_is_refused(self):
        pointer, documents = split_spot_data(whole_manifest(), SPOTS)
        ready, read = self.read_from(pointer, documents)
        for spots in ({**ready["spots"], "squareDegrees": 1}, {**ready["spots"], "url": "../x"},
                      {**ready["spots"], "squares": ["n52w012", "n52w008"]},
                      {**ready["spots"], "squares": ["../../x"]},
                      {**ready["spots"], "keys": ["spotForecasts", "frames"]}, None):
            with self.subTest(spots=spots), self.assertRaises(ValueError):
                load_spot_data({**ready, "spots": spots}, read)
        for base in ("../harmonie-eps-2026091312-2h-v1-0a0b0c0d/",
                     "harmonie-eps-2026091312-2h-v1-0a0b0c0d", "/tmp/", "a/b-0a0b0c0d/",
                     "harmonie-eps-2026091312-2h-v1-0A0B0C0D/", None):
            with self.subTest(base=base), self.assertRaises(ValueError):
                load_spot_data({**ready, "base": base}, read)

    def test_run_paths_never_leave_the_run(self):
        base = "harmonie-2026091312-2h-v1-0a0b0c0d/"
        self.assertEqual(squares.run_path(base, "frames/000.bin"), base + "frames/000.bin")
        # The cases spotData.ts checkRunPath is held to: "." is not the run itself.
        paths = json.loads(FIXTURE.read_text())["runPaths"]
        for relative in paths["accepted"]:
            self.assertEqual(squares.run_path(base, relative), base + relative)
        for relative in paths["refused"]:
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                squares.run_path(base, relative)
        for relative in ("", "../x", "frames/../../x", "/etc/passwd", "./frames/000.bin",
                         "frames//000.bin", "frames\\000.bin",
                         # What a browser would read as something else: an encoded
                         # `..` or `/`, a tab or newline it drops, a query, a fragment.
                         "%2e%2e/x", "frames/%2E%2E/%2e%2e/x", "frames%2F000.bin",
                         "frames/.\t./x", "frames/000.bin?x", "frames/000.bin#x",
                         "frames/0 0.bin", "frames/ü.bin"):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                squares.run_path(base, relative)

    def test_the_catalogue_is_found_as_the_adapters_find_it(self):
        import fetch_forecast
        self.assertEqual(squares.catalogue_file(), fetch_forecast.spots_file())
        with patch.dict(os.environ, {"FORCE5_SPOTS_FILE": "/somewhere/else.json"}):
            self.assertEqual(squares.catalogue_file(), fetch_forecast.spots_file())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spots.json"
            path.write_text(json.dumps({"spots": SPOTS + [{"id": "nowhere", "lat": None}]}))
            self.assertEqual(squares.catalogue_squares(path),
                             {spot["id"]: spot_square(spot["lat"], spot["lon"])
                              for spot in SPOTS})

    def test_a_square_may_hold_only_the_spots_the_catalogue_puts_in_it(self):
        where = {spot["id"]: spot_square(spot["lat"], spot["lon"]) for spot in SPOTS}
        squares.check_square_places("n52w008", {"spotForecasts": {"dollymount": []}}, where)
        for document, message in (({"spotForecasts": {"brandon": []}}, "puts in n52w012"),
                                  ({"spotMembers": {"nowhere": []}}, "does not have")):
            with self.subTest(message), self.assertRaisesRegex(ValueError, message):
                squares.check_square_places("n52w008", document, where)


# A small grid on the lattice whose native level straddles two tiles (global
# columns 338-387 at 0.5°, tiles of 128 columns), so absence can be tested.
GRID = {"west": -11.0, "north": 56.0, "dx": 0.5, "dy": 0.4, "width": 50, "height": 14,
        "east": 13.5, "south": 50.8}
PREFIX = "harmonie-eps-2026091312-2h-v1"


def run_manifest(hours=(0,)):
    """The whole manifest as a wind adapter holds it once its tiles are written."""
    manifest = whole_manifest()
    manifest["grid"] = GRID
    manifest["frames"] = [{"hour": hour, "validTime": f"2026-09-13T{12 + hour}:00:00Z",
                           "gustIntervalHours": None} for hour in hours]
    return manifest


def field(value, missing_columns=()):
    """A frame's field: `value` everywhere but the listed global columns, missing."""
    column0 = 338
    return [None if column0 + index % GRID["width"] in missing_columns else value
            for index in range(GRID["width"] * GRID["height"])]


class RunDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / "weather"

    def stage(self, prefix=PREFIX, u=1.0, hour=0, missing_columns=()):
        """One frame's tiles, as f5bin.publish_frame writes them for an adapter."""
        f5bin.publish_frame(self.output, prefix, {
            "run": "2026091312", "hour": hour, "grid": GRID,
            "u": field(u, missing_columns), "v": field(-2.0, missing_columns), "gust": None})

    def write(self, manifest=None, **kwargs):
        self.stage(**kwargs)
        return rundir.write_run(self.output, "harmonie-eps.json", manifest or run_manifest(),
                                PREFIX, SPOTS)

    def test_the_hash_is_over_sorted_paths_and_file_hashes(self):
        files = {"spots/n52w008.json": b"{}", "frames/000.bin": b"frame"}
        self.assertEqual(len(rundir.digest(files)), 8)
        self.assertEqual(rundir.digest(files), rundir.digest(dict(reversed(list(files.items())))))
        self.assertNotEqual(rundir.digest(files), rundir.digest({**files, "frames/000.bin": b"framf"}))
        self.assertNotEqual(rundir.digest(files),
                            rundir.digest({"frames/001.bin": b"frame", "spots/n52w008.json": b"{}"}))

    def test_the_shared_digest_fixture(self):
        """tests/squares.test.ts holds scripts/runs.mjs to the same two hashes."""
        fixture = json.loads((FIXTURE.parent / "run-digest.json").read_text())
        files = {path: text.encode() for path, text in fixture["files"].items()}
        self.assertEqual(rundir.digest(files), fixture["digest"])
        changed = fixture["oneByteChanged"]
        files[changed["path"]] = changed["content"].encode()
        self.assertEqual(rundir.digest(files), changed["digest"])
        self.assertNotEqual(changed["digest"], fixture["digest"])
        # Nested tile paths sort byte by byte: t/0/1/… before t/0/10/….
        nested = fixture["nested"]
        self.assertEqual(sorted(nested["files"]), nested["order"])
        self.assertEqual(rundir.digest({path: text.encode()
                                        for path, text in nested["files"].items()}),
                         nested["digest"])

    def test_the_hash_matches_the_documented_recipe(self):
        import hashlib
        files = {"b": b"2", "a": b"1"}
        recipe = "".join(f"{name} {hashlib.sha256(files[name]).hexdigest()}\n"
                         for name in ("a", "b"))
        self.assertEqual(rundir.digest(files), hashlib.sha256(recipe.encode()).hexdigest()[:8])

    def test_the_same_content_lands_in_the_same_directory(self):
        first = self.write()
        second = self.write()
        self.assertEqual(first["base"], second["base"])
        self.assertEqual([p.name for p in self.output.iterdir() if p.is_dir()],
                         [first["base"][:-1]])
        self.assertRegex(first["base"], r"^harmonie-eps-2026091312-2h-v1-[0-9a-f]{8}/$")

    def test_one_changed_value_lands_in_a_new_directory(self):
        first = self.write()
        second = self.write(u=1.1)
        self.assertNotEqual(first["base"], second["base"])
        changed = run_manifest()
        changed["spotForecasts"]["keel"][0]["u"] = 99
        third = self.write(changed)
        self.assertNotIn(third["base"], (first["base"], second["base"]))
        self.assertEqual(len([p for p in self.output.iterdir() if p.is_dir()]), 3)

    def test_the_pointer_names_the_run_relative_to_itself(self):
        pointer = self.write()
        written = json.loads((self.output / "harmonie-eps.json").read_text())
        self.assertEqual(written, pointer)
        self.assertNotIn("url", pointer["frames"][0])
        directory = self.output / pointer["base"]
        self.assertEqual(sorted(rundir.content_files(directory)),
                         ["spots/n52w008.json", "spots/n52w012.json",
                          "t/0/2/0/000.bin", "t/0/3/0/000.bin", "t/1/1/0/000.bin"])
        self.assertEqual(rundir.digest(rundir.content_files(directory)),
                         rundir.hash_of(pointer["base"]))
        self.assertFalse((self.output / PREFIX).exists())

    def test_the_pointer_describes_the_tiles(self):
        tiles = self.write()["tiles"]
        self.assertEqual(tiles, {
            "size": 128, "border": 1, "encoding": "f5-tile-v1", "blocks": ["u", "v"],
            "url": "t/{level}/{x}/{y}/{hour}.bin",
            "levels": [{"level": 0, "dx": 0.5, "dy": 0.4, "x": [2, 3], "y": [0, 0], "absent": []},
                       {"level": 1, "dx": 1.0, "dy": 0.8, "x": [1, 1], "y": [0, 0], "absent": []}]})

    def test_the_tile_size_the_manifest_states_is_the_one_cut(self):
        # Sixteen-cell tiles, as the committed sample bundles use: the native level
        # is four tiles wide here, not two, and has a third level above it.
        f5tile.write_pyramid(self.output / PREFIX, GRID, field(1.0), field(-2.0), None, 0,
                             "2026091312", size=16, keep_empty=True)
        manifest = {**run_manifest(), "tiles": {"size": 16, "border": 1}}
        pointer = rundir.write_run(self.output, "harmonie-eps.json", manifest, PREFIX, SPOTS)
        tiles = pointer["tiles"]
        self.assertEqual((tiles["size"], tiles["border"]), (16, 1))
        self.assertEqual([(level["x"], level["y"]) for level in tiles["levels"]],
                         [(spec["x"], spec["y"]) for spec in f5tile.levels(GRID, 16)])
        self.assertGreater(len(tiles["levels"]), 2)
        published = sorted(path for path in rundir.content_files(
            self.output / pointer["base"]) if path.startswith("t/"))
        self.assertEqual(published, sorted(f5tile.run_tiles(pointer)))
        self.assertEqual(f5tile.check_tiles(pointer), tiles)

    def test_a_tile_missing_in_every_hour_is_absent_and_not_published(self):
        # Global columns 384-387 are tile (3, 0)'s at level 0: all missing, both hours.
        self.stage(hour=1, missing_columns=range(384, 388))
        pointer = self.write(run_manifest((0, 1)), missing_columns=range(384, 388))
        self.assertEqual(pointer["tiles"]["levels"][0]["absent"], [[3, 0]])
        self.assertEqual(pointer["tiles"]["levels"][1]["absent"], [])
        self.assertEqual(sorted(path for path in rundir.content_files(
            self.output / pointer["base"]) if path.startswith("t/")),
            ["t/0/2/0/000.bin", "t/0/2/0/001.bin", "t/1/1/0/000.bin", "t/1/1/0/001.bin"])
        self.assertFalse(any((self.output / pointer["base"] / "t/0/3").rglob("*")))

    def test_a_tile_missing_in_one_hour_only_is_published_for_every_hour(self):
        self.stage(hour=1)
        pointer = self.write(run_manifest((0, 1)), missing_columns=range(384, 388))
        self.assertEqual([level["absent"] for level in pointer["tiles"]["levels"]], [[], []])
        files = rundir.content_files(self.output / pointer["base"])
        self.assertIn("t/0/3/0/000.bin", files)
        self.assertIn("t/0/3/0/001.bin", files)
        self.assertTrue(f5tile.owned_empty(files["t/0/3/0/000.bin"]))

    def test_a_tile_written_for_some_hours_only_is_refused(self):
        self.stage(hour=1)
        (self.output / PREFIX / "t/0/3/0/001.bin").unlink()
        with self.assertRaisesRegex(ValueError, "Tile 0/3/0 is missing at \\+1h"):
            self.write(run_manifest((0, 1)))
        self.assertFalse((self.output / "harmonie-eps.json").exists())

    def test_leftovers_of_an_interrupted_import_are_not_published(self):
        self.stage()
        for stale in ("frames/007.bin", "t/0/2/0/007.bin"):
            path = self.output / PREFIX / stale
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"old")
            Path(str(path) + ".br").write_bytes(b"old")
        pointer = self.write()
        self.assertEqual(sorted(rundir.content_files(self.output / pointer["base"])),
                         ["spots/n52w008.json", "spots/n52w012.json",
                          "t/0/2/0/000.bin", "t/0/3/0/000.bin", "t/1/1/0/000.bin"])
        self.assertEqual(pointer["base"], self.write()["base"])

    def test_a_reused_staging_directory_keeps_no_stale_sidecar(self):
        # An interrupted import wrote this hour with sidecars; the retry, with
        # them off, rewrites the tile and must not leave the old .br beside it.
        for stale in ("t/0/2/0/000.bin", "spots/n52w008.json"):
            f5bin.write_with_sidecars(self.output / PREFIX / stale, b"old", sidecars=True)
        with patch.dict(os.environ, {f5bin.SIDECARS_ENV: "0"}):
            pointer = self.write()
        directory = self.output / pointer["base"]
        self.assertEqual(sorted(path.relative_to(directory).as_posix()
                                for path in directory.rglob("*") if path.is_file()),
                         ["spots/n52w008.json", "spots/n52w012.json",
                          "t/0/2/0/000.bin", "t/0/3/0/000.bin", "t/1/1/0/000.bin"])

    def test_a_wind_frame_that_names_a_file_is_refused(self):
        manifest = run_manifest()
        manifest["frames"][0]["url"] = "weather/harmonie-eps-2026091312-2h-v1/frames/000.bin"
        with self.assertRaisesRegex(ValueError, "names a url"):
            self.write(manifest)
        with self.assertRaisesRegex(ValueError, "retired"):
            self.write({**run_manifest(), "encoding": "f5-int16-v1"})

    def test_a_frame_outside_the_run_is_refused(self):
        manifest = run_manifest()
        manifest.update(kind="wave", frames=[{"hour": 0, "validTime": "2026-09-13T12:00:00Z",
                                              "url": "weather/elsewhere/frames/000.json"}])
        with self.assertRaises(ValueError):
            self.write(manifest)
        manifest["frames"][0]["url"] = "weather/harmonie-eps-2026091312-2h-v1/../x.json"
        with self.assertRaises(ValueError):
            self.write(manifest)

    def test_a_missing_frame_is_refused_before_the_pointer_moves(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            self.write(run_manifest((0, 1)))
        self.assertFalse((self.output / "harmonie-eps.json").exists())

    def test_rewriting_a_run_makes_a_new_directory_and_keeps_the_old(self):
        pointer = self.write()
        old = self.output / pointer["base"]
        whole = {**pointer, **load_spot_data(
            pointer, lambda path: json.loads((self.output / path).read_text()))}
        whole["spotForecasts"]["keel"][0]["u"] = 42
        rewritten = rundir.rewrite_run(self.output, "harmonie-eps.json", whole, SPOTS)
        self.assertNotEqual(rewritten["base"], pointer["base"])
        self.assertTrue(old.is_dir())
        self.assertEqual(rewritten["tiles"], pointer["tiles"])
        for tile in ("t/0/2/0/000.bin", "t/0/3/0/000.bin", "t/1/1/0/000.bin"):
            self.assertEqual((self.output / rewritten["base"] / tile).read_bytes(),
                             (old / tile).read_bytes())
        merged = load_spot_data(rewritten, lambda path: json.loads((self.output / path).read_text()))
        self.assertEqual(merged["spotForecasts"]["keel"][0]["u"], 42)
        self.assertEqual(json.loads((self.output / "harmonie-eps.json").read_text()), rewritten)

    def test_rewriting_keeps_absent_tiles_absent(self):
        self.stage(hour=1, missing_columns=range(384, 388))
        pointer = self.write(run_manifest((0, 1)), missing_columns=range(384, 388))
        whole = {**pointer, **load_spot_data(
            pointer, lambda path: json.loads((self.output / path).read_text()))}
        whole["spotForecasts"]["keel"][0]["u"] = 42
        rewritten = rundir.rewrite_run(self.output, "harmonie-eps.json", whole, SPOTS)
        self.assertEqual(rewritten["tiles"], pointer["tiles"])



class SupersededTests(unittest.TestCase):
    """What a pointer remembers of the run directories it replaced."""

    def test_the_shared_cases(self):
        for case in json.loads(SUPERSEDED.read_text())["cases"]:
            with self.subTest(case["name"]):
                now = datetime.fromisoformat(case["now"].replace("Z", "+00:00"))
                self.assertEqual(squares.retire(case["previous"], {"base": case["base"]}, now),
                                 case["expected"])

    def test_write_run_names_the_run_directory_the_pointer_on_disk_named(self):
        with tempfile.TemporaryDirectory() as directory:
            weather = Path(directory) / "weather"
            frameless = dict(whole_manifest(), frames=[])
            first = rundir.write_run(weather, "harmonie-eps.json", frameless,
                                     "harmonie-eps-2026091312-2h-v1", SPOTS)
            self.assertNotIn("superseded", first)
            changed = copy.deepcopy(frameless)
            changed["spotForecasts"]["keel"][0]["u"] = 99
            now = datetime.fromisoformat("2026-09-13T13:00:00+00:00")
            second = rundir.write_run(weather, "harmonie-eps.json", changed,
                                      "harmonie-eps-2026091312-2h-v1", SPOTS, now=now)
            self.assertEqual(second["superseded"],
                             [{"base": first["base"], "at": "2026-09-13T13:00:00Z"}])
            self.assertEqual(json.loads((weather / "harmonie-eps.json").read_text()), second)


if __name__ == "__main__":
    unittest.main()
