"""Spot squares and run directories: the key, the split, the loader and the hash.

`tests/fixtures/squares.json` is read by this suite and by
`force5/src/squares.test.ts`, so the two languages cannot name a square
differently without one of them failing.
"""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import rundir
import squares
from squares import SQUARE_DEGREES, load_spot_data, spot_square, split_spot_data

FIXTURE = Path(__file__).resolve().parents[2] / "tests/fixtures/squares.json"
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
        for relative in ("", "../x", "frames/../../x", "/etc/passwd", "./frames/000.bin",
                         "frames//000.bin", "frames\\000.bin"):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                squares.run_path(base, relative)


class RunDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / "weather"

    def stage(self, prefix="harmonie-eps-2026091312-2h-v1", body=b"frame"):
        target = self.output / prefix / "frames/000.bin"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)

    def write(self, manifest=None, **kwargs):
        self.stage(**kwargs)
        return rundir.write_run(self.output, "harmonie-eps.json", manifest or whole_manifest(),
                                "harmonie-eps-2026091312-2h-v1", SPOTS)

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

    def test_one_changed_byte_lands_in_a_new_directory(self):
        first = self.write()
        second = self.write(body=b"framf")
        self.assertNotEqual(first["base"], second["base"])
        changed = whole_manifest()
        changed["spotForecasts"]["keel"][0]["u"] = 99
        third = self.write(changed)
        self.assertNotIn(third["base"], (first["base"], second["base"]))
        self.assertEqual(len([p for p in self.output.iterdir() if p.is_dir()]), 3)

    def test_the_pointer_names_the_run_relative_to_itself(self):
        pointer = self.write()
        written = json.loads((self.output / "harmonie-eps.json").read_text())
        self.assertEqual(written, pointer)
        self.assertEqual(pointer["frames"][0]["url"], "frames/000.bin")
        directory = self.output / pointer["base"]
        self.assertEqual(sorted(rundir.content_files(directory)),
                         ["frames/000.bin", "spots/n52w008.json", "spots/n52w012.json"])
        self.assertEqual(rundir.digest(rundir.content_files(directory)),
                         rundir.hash_of(pointer["base"]))
        self.assertFalse((self.output / "harmonie-eps-2026091312-2h-v1").exists())

    def test_leftovers_of_an_interrupted_import_are_not_published(self):
        self.stage()
        stale = self.output / "harmonie-eps-2026091312-2h-v1/frames/007.bin"
        stale.write_bytes(b"old")
        Path(str(stale) + ".br").write_bytes(b"old")
        pointer = self.write()
        self.assertEqual(sorted(rundir.content_files(self.output / pointer["base"])),
                         ["frames/000.bin", "spots/n52w008.json", "spots/n52w012.json"])
        self.assertEqual(pointer["base"], self.write()["base"])

    def test_a_frame_outside_the_run_is_refused(self):
        manifest = whole_manifest()
        manifest["frames"][0]["url"] = "weather/elsewhere/frames/000.bin"
        with self.assertRaises(ValueError):
            self.write(manifest)
        manifest["frames"][0]["url"] = "weather/harmonie-eps-2026091312-2h-v1/../x.bin"
        with self.assertRaises(ValueError):
            self.write(manifest)

    def test_a_missing_frame_is_refused_before_the_pointer_moves(self):
        manifest = whole_manifest()
        manifest["frames"].append({"hour": 1, "validTime": "2026-09-13T13:00:00Z",
                                   "url": "weather/harmonie-eps-2026091312-2h-v1/frames/001.bin"})
        with self.assertRaisesRegex(ValueError, "missing"):
            self.write(manifest)
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
        self.assertEqual((self.output / rewritten["base"] / "frames/000.bin").read_bytes(), b"frame")
        merged = load_spot_data(rewritten, lambda path: json.loads((self.output / path).read_text()))
        self.assertEqual(merged["spotForecasts"]["keel"][0]["u"], 42)
        self.assertEqual(json.loads((self.output / "harmonie-eps.json").read_text()), rewritten)


if __name__ == "__main__":
    unittest.main()
