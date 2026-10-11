import contextlib
from datetime import datetime, timezone
import gzip
import hashlib
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import f5bin
import f5tile
import publish_s3
import rundir
from publish_s3 import publish, validate_bundle, already_current
from registry import MANIFESTS, MODELS, UNCHANGED_EXIT
from runfixtures import TINY_GRID


FIXTURE = object()  # "use the test's own fake bucket", which None cannot mean here.


class S3Error(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class FakeS3:
    """Enough S3 to test publication order, immutability, deletion and listing.

    `reject_conditional` is the case the R2 fallback exists for: a backend that
    refuses the conditional *header* rather than reporting that the condition
    failed. The two answers mean opposite things and must not be confused.
    """

    def __init__(self):
        self.objects = {}
        self.writes = []
        self.deleted = []
        self.delete_calls = 0
        self.list_calls = 0
        self.fail_frame = False
        self.fail_key = "/harmonie-a/"
        self.fail_delete = False
        self.reject_conditional = False
        self.reject_code = "NotImplemented"
        self.lost_ack = False
        self.deny = set()
        self.race = None
        self.page_size = 1000
        self.clock = datetime(2026, 9, 13, 12, tzinfo=timezone.utc)

    def seed(self, key, body, modified=None, metadata=None):
        """Put an object there without going through the publisher."""
        self.objects[key] = {"Body": body, "ETag": f'"seed{len(self.objects)}"',
                             "Metadata": metadata or {}, "LastModified": modified or self.clock}
        return key

    def get_object(self, Bucket, Key):
        if Key in self.deny:
            raise S3Error("AccessDenied")
        if Key not in self.objects:
            raise S3Error("NoSuchKey")
        value = self.objects[Key]
        return {**value, "Body": BytesIO(value["Body"])}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise S3Error("404")
        return self.objects[Key]

    def put_object(self, **args):
        key = args["Key"]
        if self.fail_frame and self.fail_key in key:
            raise S3Error("ServiceUnavailable")
        if self.reject_conditional and ("IfNoneMatch" in args or "IfMatch" in args):
            raise S3Error(self.reject_code)
        if self.lost_ack and key == "weather/harmonie.json":
            # The write lands but its answer never arrives; the retry sees the object.
            self.lost_ack = False
            self.objects[key] = {**args, "ETag": f'"{len(self.writes)}"',
                                 "LastModified": self.clock}
            self.writes.append(key)
            raise S3Error("PreconditionFailed")
        if key == "weather/harmonie.json" and self.race:
            newer = self.race
            self.race = None
            self.objects[key] = {"Body": json.dumps(newer).encode(), "ETag": '"newer"'}
        old = self.objects.get(key)
        if args.get("IfNoneMatch") == "*" and old:
            raise S3Error("PreconditionFailed")
        if "IfMatch" in args and (not old or old["ETag"] != args["IfMatch"]):
            raise S3Error("PreconditionFailed")
        self.objects[key] = {**args, "ETag": f'"{len(self.writes)}"', "LastModified": self.clock}
        self.writes.append(key)

    def delete_objects(self, Bucket, Delete):
        self.delete_calls += 1
        if self.fail_delete:
            raise S3Error("AccessDenied")
        keys = [item["Key"] for item in Delete["Objects"]]
        if len(keys) > 1000:
            raise S3Error("MalformedXML")
        for key in keys:
            self.objects.pop(key, None)
            self.deleted.append(key)
        return {"Deleted": [{"Key": key} for key in keys]}

    def list_objects_v2(self, Bucket, Prefix="", MaxKeys=1000, ContinuationToken=None):
        self.list_calls += 1
        keys = sorted(key for key in self.objects if key.startswith(Prefix))
        start = keys.index(ContinuationToken) if ContinuationToken else 0
        page = keys[start:start + min(MaxKeys, self.page_size)]
        following = keys[start + len(page):]
        return {"Contents": [{"Key": key,
                              "LastModified": self.objects[key].get("LastModified", self.clock),
                              "Size": len(self.objects[key].get("Body") or b"")} for key in page],
                "IsTruncated": bool(following),
                **({"NextContinuationToken": following[0]} if following else {})}


SPOTS = [{"id": "dollymount", "lat": 53.365, "lon": -6.135},
         {"id": "brandon", "lat": 52.276, "lon": -10.024}]


# The native tile a frame of TINY_GRID publishes, at each hour.
TILE = "t/0/2/0/{hour:03d}.bin"


class BundleFixture:
    """A validated three-frame HARMONIE run on disk and an empty fake bucket.

    The run is written as an adapter writes one: each frame's tiles into a
    staging directory (f5bin.publish_frame), then `rundir.write_run`, which
    settles the tiles, moves the spot series into squares and names the run
    directory for its content.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 9, 13, 12, 30, tzinfo=timezone.utc)
        self.build("2026091312")
        self.s3 = FakeS3()

    def build(self, run, frame=None, whole=None, gusts=False, spots=SPOTS):
        """Write a run of this hour: `frame` and `whole` may change a frame or the manifest,
        and `spots` is the catalogue it is split into squares by."""
        prefix = f"harmonie-{run}-2h-v1"
        grid = dict(TINY_GRID)
        start = int(run[-2:])
        frames, forecasts = [], {spot["id"]: [] for spot in SPOTS}
        shutil.rmtree(self.root / "weather" / prefix, ignore_errors=True)
        for hour in range(3):
            valid = f"2026-09-13T{start + hour}:00:00Z"
            interval = ([hour - 1, hour] if hour else None) if gusts else None
            payload = {"model": "harmonie", "run": run, "hour": hour, "validTime": valid,
                       "grid": grid, "gustIntervalHours": interval, "u": [1] * 4, "v": [2] * 4,
                       "gust": [4] * 4 if interval else None}
            payload = frame(hour, payload) if frame else payload
            f5bin.publish_frame(self.root / "weather", prefix, payload)
            frames.append({"hour": hour, "validTime": valid, "gustIntervalHours": interval})
            for spot in forecasts.values():
                spot.append({"hour": hour, "validTime": valid, "u": 1, "v": 2, "gust": None})
        manifest = {"schemaVersion": 1, "model": "harmonie", "run": run,
                    "runTime": f"2026-09-13T{start}:00:00Z", "stepHours": 1,
                    "grid": grid, "frames": frames, "spotForecasts": forecasts}
        if gusts:
            manifest["gustMissingHours"] = [0]
        else:
            manifest["gustAvailable"] = False
        manifest = whole(manifest) if whole else manifest
        self.manifest = rundir.write_run(self.root / "weather", "harmonie.json", manifest,
                                         prefix, spots)
        return self.manifest

    def save(self):
        (self.root / "weather/harmonie.json").write_text(json.dumps(self.manifest))

    def keys(self, manifest=None):
        """Every object key of a run: its frames' tiles and its squares."""
        manifest = manifest or self.manifest
        directory = f"weather/{manifest['base']}"
        return ([directory + path for path in sorted(f5tile.run_tiles(manifest))]
                + [f"{directory}spots/{square}.json" for square in manifest["spots"]["squares"]])

    def run_publish(self):
        return publish(self.s3, self.root, "harmonie", "test", now=self.now)

    def quietly(self, call):
        """Run a publish with its JSON events captured rather than printed."""
        out, err = StringIO(), StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            result = call()
        return result, out.getvalue() + err.getvalue()


class PublishTests(BundleFixture, unittest.TestCase):
    def test_pointer_last_and_retry_is_idempotent(self):
        self.assertEqual(self.run_publish(), "published")
        self.assertEqual(self.s3.writes[-1], "weather/harmonie.json")
        self.assertEqual(sorted(self.s3.writes[:-1]), sorted(self.keys()))
        for key in self.keys():
            # Tiles are brotli, JSON (the squares) gzip.
            self.assertEqual(self.s3.objects[key]["ContentEncoding"],
                             "br" if key.endswith(".bin") else "gzip")
            self.assertEqual(self.s3.objects[key]["CacheControl"], publish_s3.IMMUTABLE_CACHE)
        before = list(self.s3.writes)
        self.assertEqual(self.run_publish(), "unchanged-or-newer")
        self.assertEqual(before, self.s3.writes)

    def test_the_pointer_is_small_and_the_squares_carry_the_spots(self):
        self.run_publish()
        pointer = json.loads(self.s3.objects["weather/harmonie.json"]["Body"])
        self.assertEqual(pointer["schemaVersion"], 2)
        self.assertNotIn("spotForecasts", pointer)
        self.assertEqual(pointer["spots"]["squares"], ["n52w008", "n52w012"])
        square = json.loads(gzip.decompress(self.s3.objects[
            f"weather/{pointer['base']}spots/n52w008.json"]["Body"]))
        self.assertEqual(list(square["spotForecasts"]), ["dollymount"])

    def test_republishing_the_same_content_lands_in_the_same_directory(self):
        first = self.manifest["base"]
        self.assertEqual(self.build("2026091312")["base"], first)
        self.assertEqual(sorted(p.name for p in (self.root / "weather").iterdir()
                                if p.is_dir()), [first[:-1]])

    def test_upload_failure_does_not_publish_pointer(self):
        self.s3.fail_frame, self.s3.fail_key = True, "/harmonie-2026091312-"
        with self.assertRaises(S3Error):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)

    def test_existing_pointer_is_preserved_on_upload_failure(self):
        self.s3.objects["weather/harmonie.json"] = {"Body": json.dumps({**self.manifest, "run": "2026091311"}).encode(), "ETag": '"old"'}
        self.s3.fail_frame, self.s3.fail_key = True, "/harmonie-2026091312-"
        before = self.s3.objects["weather/harmonie.json"]["Body"]
        with self.assertRaises(S3Error):
            self.run_publish()
        self.assertEqual(before, self.s3.objects["weather/harmonie.json"]["Body"])

    def test_concurrent_newer_run_wins(self):
        self.s3.race = {**self.manifest, "run": "2026091313"}
        self.assertEqual(self.run_publish(), "unchanged-or-newer")
        self.assertEqual(json.loads(self.s3.objects["weather/harmonie.json"]["Body"])["run"], "2026091313")

    def test_invalid_frame_or_path_rejected_before_any_upload(self):
        for url in ("../outside.json", "frames/../../outside.json", "/etc/passwd",
                    "frames/001.bin"):
            with self.subTest(url=url):
                self.manifest["frames"][1]["url"] = url
                self.save()
                with self.assertRaises(ValueError):
                    self.run_publish()
        self.assertEqual(self.s3.writes, [])

    def test_a_base_outside_its_own_directory_is_refused(self):
        good = self.manifest["base"]
        for base in ("../weather/" + good, good[:-1], "harmonie/" + good, "/" + good,
                     "harmonie-eps-2026091312-2h-v1-00000000/", "harmonie-2026091312-x/",
                     "./" + good):
            with self.subTest(base=base):
                self.manifest["base"] = base
                self.save()
                with self.assertRaises(ValueError):
                    self.run_publish()
        self.assertEqual(self.s3.writes, [])

    def test_spot_data_inline_in_the_pointer_is_refused(self):
        square = json.loads((self.root / "weather" / self.manifest["base"]
                             / "spots/n52w008.json").read_text())
        self.manifest["spotForecasts"] = square["spotForecasts"]
        self.save()
        with self.assertRaisesRegex(ValueError, "spot squares"):
            validate_bundle(self.root, "harmonie", now=self.now)

    def test_a_missing_or_unlisted_square_is_refused(self):
        directory = self.root / "weather" / self.manifest["base"]
        listed = list(self.manifest["spots"]["squares"])
        self.manifest["spots"]["squares"] = listed[:1]
        self.save()
        with self.assertRaisesRegex(ValueError, "unreferenced"):
            validate_bundle(self.root, "harmonie", now=self.now)
        self.manifest["spots"]["squares"] = listed + ["n54w010"]
        self.save()
        with self.assertRaisesRegex(ValueError, "missing"):
            validate_bundle(self.root, "harmonie", now=self.now)
        self.manifest["spots"]["squares"] = listed
        self.save()
        validate_bundle(self.root, "harmonie", now=self.now)
        (directory / "spots/n52w012.json").unlink()
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "harmonie", now=self.now)

    def test_a_square_of_another_run_or_a_spot_in_two_squares_is_refused(self):
        for change in ({"run": "2026091311"}, {"square": "n52w012"}, {"model": "gfs"},
                       {"schemaVersion": 1}, {"spotForecasts": {"brandon": []}},
                       {"spotMembers": {}}):
            with self.subTest(change=change):
                self.build("2026091312")
                path = self.root / "weather" / self.manifest["base"] / "spots/n52w008.json"
                square = json.loads(path.read_text())
                if "spotForecasts" in change:
                    square["spotForecasts"].update(change["spotForecasts"])
                else:
                    square.update(change)
                path.write_text(json.dumps(square))
                # Re-hash, so the directory's name is not what refuses it.
                files = rundir.content_files(path.parents[1])
                name = rundir.directory_name("harmonie-2026091312-2h-v1", files)
                shutil.rmtree(self.root / "weather" / name, ignore_errors=True)
                os.replace(path.parents[1], self.root / "weather" / name)
                self.manifest["base"] = f"{name}/"
                self.save()
                with self.assertRaises(ValueError):
                    validate_bundle(self.root, "harmonie", now=self.now)

    def test_a_spot_filed_in_a_square_the_catalogue_does_not_give_it_is_refused(self):
        # Split by a catalogue that had Dollymount elsewhere: a reader looks in the
        # square the catalogue names, and would never find it.
        moved = [dict(SPOTS[0], lat=55.1), SPOTS[1]]
        self.build("2026091312", spots=moved)
        with self.assertRaisesRegex(ValueError, "catalogue puts in n52w008"):
            validate_bundle(self.root, "harmonie", now=self.now)
        # By that catalogue it publishes.
        catalogue = self.root / "moved.json"
        catalogue.write_text(json.dumps(moved))
        with patch.dict(os.environ, {"FORCE5_SPOTS_FILE": str(catalogue)}):
            self.assertTrue(validate_bundle(self.root, "harmonie", now=self.now))

    def test_a_directory_whose_content_does_not_match_its_name_is_refused(self):
        path = self.root / "weather" / self.manifest["base"] / TILE.format(hour=1)
        _, tiles = f5tile.build_pyramid(TINY_GRID, [1, 1, 1, 2], [2] * 4, None, 1, "2026091312")
        path.write_bytes(tiles[0][3])
        with self.assertRaisesRegex(ValueError, "content its name claims"):
            validate_bundle(self.root, "harmonie", now=self.now)

    def test_a_stray_file_in_the_run_directory_is_refused(self):
        (self.root / "weather" / self.manifest["base"] / "t/0/2/0/099.bin").write_text("{}")
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "harmonie", now=self.now)

    def test_a_version_1_pointer_is_refused(self):
        self.manifest["schemaVersion"] = 1
        self.save()
        with self.assertRaisesRegex(ValueError, "schemaVersion 2"):
            validate_bundle(self.root, "harmonie", now=self.now)

    def test_missing_frame_rejected_before_any_upload(self):
        (self.root / "weather" / self.manifest["base"] / TILE.format(hour=1)).unlink()
        with self.assertRaises(ValueError):
            self.run_publish()
        self.assertEqual(self.s3.writes, [])

    def test_bad_vectors_and_mixed_run_rejected(self):
        for change in [{"u": [float("nan")] * 4}, {"run": "2026091311"}, {"gust": [1] * 4}]:
            with self.subTest(change=change):
                self.build("2026091312",
                           frame=lambda hour, payload: {**payload, **change} if hour == 1 else payload)
                with self.assertRaises(ValueError):
                    self.run_publish()
        self.assertEqual(self.s3.writes, [])

    def test_stale_run_rejected(self):
        with self.assertRaises(ValueError):
            validate_bundle(self.root, "harmonie", now=datetime(2026, 9, 15, tzinfo=timezone.utc))

    def test_same_run_cannot_downgrade_hourly_cadence(self):
        self.assertTrue(already_current(self.manifest, {**self.manifest, "stepHours": 3}))

    def test_old_worker_cannot_remove_gusts_from_the_same_run(self):
        self.assertTrue(already_current({**self.manifest, "gustAvailable": True}, self.manifest))

    def test_a_smaller_ensemble_cannot_replace_a_fuller_one(self):
        fuller = {**self.manifest, "ensemble": {"members": 30}}
        self.assertTrue(already_current(fuller, {**self.manifest, "ensemble": {"members": 2}}))

    def test_gusts_require_matching_periods_and_only_initialization_can_be_missing(self):
        self.build("2026091312", gusts=True)
        self.assertEqual(self.run_publish(), "published")
        self.manifest["frames"][1]["gustIntervalHours"] = [0, 2]
        self.save()
        with self.assertRaises(ValueError):
            self.run_publish()
        self.build("2026091312", gusts=True, whole=lambda m: {**m, "gustMissingHours": [0, 1]})
        with self.assertRaises(ValueError):
            self.run_publish()

    def test_immutable_collision_cannot_publish(self):
        key = self.keys()[0]
        self.s3.objects[key] = {"Body": b"wrong", "Metadata": {"sha256": "wrong"}, "ETag": '"old"'}
        with self.assertRaises(ValueError):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)


class SupersededRunTest(BundleFixture, unittest.TestCase):
    """The run a publish replaces stays for readers holding the old pointer."""

    def served(self):
        return json.loads(self.s3.objects["weather/harmonie.json"]["Body"])

    def test_a_publish_keeps_the_run_directory_it_replaced_and_names_it(self):
        self.assertEqual(self.run_publish(), "published")
        replaced, old = self.keys(), self.manifest["base"]
        self.assertNotIn("superseded", self.served())
        self.build("2026091313")
        self.assertEqual(self.quietly(self.run_publish)[0], "published")
        self.assertEqual(self.s3.deleted, [])
        for key in replaced + self.keys():
            self.assertIn(key, self.s3.objects)
        self.assertEqual(self.served()["superseded"],
                         [{"base": old, "at": "2026-09-13T12:30:00Z"}])

    def test_the_list_is_the_buckets_not_the_work_directorys(self):
        # The work directory replaced a run of its own; the bucket never saw it.
        self.build("2026091313")
        self.assertTrue(self.manifest["superseded"])
        self.assertEqual(self.run_publish(), "published")
        self.assertNotIn("superseded", self.served())

    def test_a_pointer_remembers_what_it_superseded_for_six_hours_only(self):
        a, b, c, d = (f"harmonie-2026091312-2h-v1-{n}a0b0c0d/" for n in "0123")
        previous = {"model": "harmonie", "base": c, "superseded": [
            {"base": a, "at": "2026-09-13T12:00:00Z"}, {"base": b, "at": "2026-09-13T13:00:00Z"},
            {"base": "../escape-0a0b0c0d/", "at": "2026-09-13T13:00:00Z"}, "junk"]}
        later = datetime(2026, 9, 13, 18, 30, tzinfo=timezone.utc)
        self.assertEqual(publish_s3.retire(previous, {"base": d}, later),
                         [{"base": b, "at": "2026-09-13T13:00:00Z"},
                          {"base": c, "at": "2026-09-13T18:30:00Z"}])

    def test_a_directory_named_again_is_live_not_superseded(self):
        a, b = "harmonie-2026091312-2h-v1-0a0b0c0d/", "harmonie-2026091312-2h-v1-1a1b1c1d/"
        previous = {"model": "harmonie", "base": b,
                    "superseded": [{"base": a, "at": "2026-09-13T12:00:00Z"}]}
        self.assertEqual(publish_s3.retire(previous, {"base": a}, self.now),
                         [{"base": b, "at": "2026-09-13T12:30:00Z"}])
        self.assertEqual(publish_s3.retire({"model": "harmonie", "base": a}, {"base": a},
                                           self.now), [])

    def test_republishing_the_same_content_is_still_a_no_op(self):
        self.assertEqual(self.run_publish(), "published")
        self.build("2026091313")
        self.quietly(self.run_publish)
        writes = list(self.s3.writes)
        # The work directory's own list differs from the bucket's; that is not a change.
        self.assertEqual(self.run_publish(), "unchanged-or-newer")
        self.assertEqual(writes, self.s3.writes)

    def test_a_reused_directory_the_sweep_emptied_meanwhile_is_put_back(self):
        # The same content again lands in the same directory, and put_immutable
        # leaves what is already there alone. Should a bucket sweep delete that
        # directory between those uploads and the pointer swap, the publisher puts
        # it back once its pointer is in place.
        self.assertEqual(self.run_publish(), "published")
        del self.s3.objects["weather/harmonie.json"]
        swept = self.keys()[:2]
        original = self.s3.put_object

        def sweep_then_put(**args):
            if args["Key"] == "weather/harmonie.json":
                for key in swept:
                    self.s3.objects.pop(key, None)
            return original(**args)

        self.s3.put_object = sweep_then_put
        status, log = self.quietly(self.run_publish)
        self.assertEqual(status, "published")
        self.assertIn("run_directory_restored", log)
        for key in self.keys():
            self.assertIn(key, self.s3.objects)

    def test_a_pointer_put_whose_answer_was_lost_is_success_and_deletes_nothing(self):
        self.assertEqual(self.run_publish(), "published")
        replaced = self.keys()
        self.build("2026091313")
        self.s3.lost_ack = True
        status, _ = self.quietly(self.run_publish)
        self.assertEqual(status, "unchanged-or-newer")
        for key in replaced + self.keys():
            self.assertIn(key, self.s3.objects)
        self.assertEqual(self.s3.deleted, [])

    def test_an_unreadable_previous_pointer_publishes_and_names_nothing(self):
        self.s3.seed("weather/harmonie.json", b"{not json")
        status, log = self.quietly(self.run_publish)
        self.assertEqual(status, "published")
        self.assertIn("unreadable_pointer", log)
        self.assertNotIn("superseded", self.served())

    def test_a_foreign_previous_pointer_names_nothing(self):
        other = {"model": "gfs", "base": "gfs-2026091600-240h-v1-0a0b0c0d/"}
        body = json.loads(publish_s3.pointer_body(self.manifest, other, self.now))
        self.assertNotIn("superseded", body)


class ConditionalPutFallbackTest(BundleFixture, unittest.TestCase):
    """R2's support for If-None-Match is unverified, so the publisher must cope without it."""

    def test_a_backend_that_refuses_the_header_still_publishes_immutably(self):
        self.s3.reject_conditional = True
        status, log = self.quietly(self.run_publish)
        self.assertEqual(status, "published")
        self.assertEqual(self.s3.writes[-1], "weather/harmonie.json")
        key = self.keys()[0]
        self.assertEqual(self.s3.objects[key]["ContentEncoding"], "br")
        self.assertEqual(self.s3.objects[key]["CacheControl"],
                         "public, max-age=31536000, immutable")
        # Asked once for the immutable objects and once for the pointer, not per object.
        self.assertEqual(log.count("conditional_put_unsupported"), 2)

    def test_a_collision_is_still_detected_without_conditional_puts(self):
        self.s3.reject_conditional = True
        self.s3.seed(self.keys()[0], b"wrong", metadata={"sha256": "wrong"})
        with contextlib.redirect_stdout(StringIO()), self.assertRaises(ValueError):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)

    def test_republishing_the_same_bytes_without_conditional_puts_is_a_no_op(self):
        self.quietly(self.run_publish)
        self.s3.reject_conditional = True
        before = list(self.s3.writes)
        self.assertEqual(self.quietly(self.run_publish)[0], "unchanged-or-newer")
        self.assertEqual(before, self.s3.writes)

    def test_an_unrelated_error_is_never_mistaken_for_a_missing_feature(self):
        self.s3.fail_frame, self.s3.fail_key = True, "/harmonie-2026091312-"
        with self.assertRaises(S3Error):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)

    def test_a_malformed_request_does_not_pass_for_a_missing_feature(self):
        # InvalidArgument also means "your request was wrong". Treating it as "this
        # backend has no conditional writes" would throw the compare-and-swap away
        # on a bug, so it must fail the job instead.
        self.s3.reject_conditional, self.s3.reject_code = True, "InvalidArgument"
        with self.assertRaises(S3Error):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)

    def test_giving_up_the_pointers_compare_and_swap_is_logged_as_a_downgrade(self):
        self.s3.reject_conditional = True
        _, log = self.quietly(self.run_publish)
        self.assertIn("pointer_put_unconditional", log)


class WorkerUnchangedRunTest(unittest.TestCase):
    """An empty disk makes the bucket the only record of what has been imported."""

    def setUp(self):
        import worker
        self.worker = worker
        self.s3 = FakeS3()
        self.s3.seed("weather/ecmwf.json", json.dumps(
            {"model": "ecmwf", "run": "2026091300",
             "frames": [{"url": "weather/e/0.json"}]}).encode())
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.args = SimpleNamespace(models=["ecmwf"], step=1, run=None, ecmwf_source="ecmwf",
                                    ecmwf_cycle=None, noaa_source="nomads",
                                    bucket="test", prefix="", publish_only=False,
                                    max_age_hours=None, timeout_seconds=60)

    def run_models(self, code, s3=FIXTURE):
        """Run the worker with the adapter replaced by a process that exits `code`."""
        self.seen = {}

        def fake_run(command, **kwargs):
            self.seen = dict(kwargs.get("env") or {})
            self.command = command
            return subprocess.CompletedProcess(command, code)

        out, err = StringIO(), StringIO()
        with patch.object(self.worker.subprocess, "run", fake_run), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = self.worker.run_models(self.args, Path(self.temp.name),
                                            self.s3 if s3 is FIXTURE else s3)
        lines = (out.getvalue() + err.getvalue()).splitlines()
        return status, json.loads(lines[-1])

    def test_nothing_new_is_success_with_its_own_event_and_no_upload(self):
        status, event = self.run_models(UNCHANGED_EXIT)
        self.assertEqual(status, 0)
        self.assertEqual(self.seen.get("FORCE5_PUBLISHED_RUN"), "2026091300")
        self.assertEqual((event["event"], event["run"]), ("forecast_unchanged", "2026091300"))
        self.assertEqual(self.s3.writes, [])

    def test_every_adapter_in_the_contract_is_told_its_own_models_run(self):
        for model in [name for name, entry in MODELS.items() if entry.get("readsPublishedRun")]:
            with self.subTest(model=model):
                self.args.models = [model]
                self.s3.seed(MANIFESTS[model], json.dumps(
                    {"model": model, "run": "2026091312", "frames": []}).encode())
                status, event = self.run_models(UNCHANGED_EXIT)
                self.assertEqual(self.seen.get("FORCE5_PUBLISHED_RUN"), "2026091312")
                self.assertEqual((status, event["event"], event["model"]),
                                 (0, "forecast_unchanged", model))

    def test_gefs_alone_is_told_which_noaa_source_to_read(self):
        self.args.models, self.args.noaa_source = ["gefs"], "s3"
        self.run_models(1)
        self.assertEqual(self.command[-2:], ["--source", "s3"])
        self.args.models = ["gfs"]
        self.run_models(1)
        self.assertNotIn("--source", self.command)

    def test_only_the_ecmwf_control_is_told_which_cycle_to_take(self):
        self.args.ecmwf_cycle = "00"
        self.run_models(1)
        self.assertEqual(self.command[-4:], ["--source", "ecmwf", "--cycle", "00"])
        for model in ["ecmwf-ens", "aifs", "ecmwf-wave"]:
            self.args.models = [model]
            self.run_models(1)
            self.assertNotIn("--cycle", self.command, model)

    def test_a_real_failure_is_still_a_failure(self):
        status, event = self.run_models(1)
        self.assertEqual(status, 1)
        self.assertEqual(event["event"], "forecast_failed")

    def test_without_a_bucket_the_adapter_is_told_nothing_and_cannot_claim_success(self):
        self.args.bucket = None
        status, event = self.run_models(UNCHANGED_EXIT, s3=None)
        self.assertNotIn("FORCE5_PUBLISHED_RUN", self.seen)
        self.assertEqual((status, event["event"]), (1, "forecast_failed"))

    def test_an_unreadable_pointer_makes_exit_three_an_ordinary_failure(self):
        # We never told the adapter what the bucket serves, so its "nothing new"
        # cannot be about the bucket and must not be laundered into success.
        self.s3.deny.add("weather/ecmwf.json")
        status, event = self.run_models(UNCHANGED_EXIT)
        self.assertNotIn("FORCE5_PUBLISHED_RUN", self.seen)
        self.assertEqual((status, event["event"]), (1, "forecast_failed"))

    def test_an_adapter_outside_the_contract_is_never_asked_and_never_skips(self):
        # Tides keys its `run` by the hour the job ran, so it never declares the contract.
        self.args.models = ["tides"]
        self.s3.seed("marine/tides.json", json.dumps(
            {"model": "tides", "run": "2026091300", "stations": {}}).encode())
        status, event = self.run_models(UNCHANGED_EXIT)
        self.assertNotIn("FORCE5_PUBLISHED_RUN", self.seen)
        self.assertEqual((status, event["event"]), (1, "forecast_failed"))

    def test_a_stray_published_run_in_the_environment_is_not_inherited(self):
        self.args.models = ["tides"]
        with patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": "2026091300"}):
            status, event = self.run_models(UNCHANGED_EXIT)
        self.assertNotIn("FORCE5_PUBLISHED_RUN", self.seen)
        self.assertEqual((status, event["event"]), (1, "forecast_failed"))


class BinaryUploadTests(unittest.TestCase):
    """One encoding per object: a frame is stored compressed once, typed as binary.

    The `.br`/`.gz` sidecars the ingest worker writes beside a frame exist only on
    the local Caddy deployment's disk. Nothing here ever uploads them, because the
    run directory's content leaves them out (rundir.content_files).
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 9, 13, 12, 30, tzinfo=timezone.utc)
        grid = dict(TINY_GRID)
        frames, bodies = [], {}
        prefix = "harmonie-2026091312-2h-v1"
        for hour in range(3):
            valid = f"2026-09-13T{12 + hour}:00:00Z"
            payload = {"model": "harmonie", "run": "2026091312", "hour": hour,
                       "grid": grid, "u": [1.5] * 4, "v": [-2.5] * 4, "gust": None}
            # Written exactly as an adapter writes it, sidecars and all. Asked for
            # explicitly so the suite does not depend on FORCE5_SIDECARS.
            with patch.dict(os.environ, {"FORCE5_SIDECARS": "1"}):
                f5bin.publish_frame(self.root / "weather", prefix, payload)
            name = TILE.format(hour=hour)
            bodies[name] = (self.root / "weather" / prefix / name).read_bytes()
            frames.append({"hour": hour, "validTime": valid, "gustIntervalHours": None})
        whole = {"schemaVersion": 1, "model": "harmonie", "run": "2026091312",
                 "runTime": "2026-09-13T12:00:00Z", "stepHours": 1,
                 "gustAvailable": False, "grid": grid, "frames": frames,
                 "spotForecasts": {"dollymount": [
                     {"hour": hour, "validTime": f"2026-09-13T{12 + hour}:00:00Z",
                      "u": 1.5, "v": -2.5, "gust": None} for hour in range(3)]}}
        with patch.dict(os.environ, {"FORCE5_SIDECARS": "1"}):
            self.manifest = rundir.write_run(self.root / "weather", "harmonie.json", whole,
                                             prefix, SPOTS)
        self.directory = f"weather/{self.manifest['base']}"
        self.bodies = {self.directory + name: data for name, data in bodies.items()}
        self.s3 = FakeS3()

    def stored(self, key):
        return self.s3.objects[key]

    def test_a_frame_is_uploaded_brotli_encoded_as_binary_by_default(self):
        import brotli
        self.assertEqual(publish(self.s3, self.root, "harmonie", "test", now=self.now),
                         "published")
        for key, body in self.bodies.items():
            with self.subTest(key):
                stored = self.stored(key)
                self.assertEqual(stored["ContentType"], "application/octet-stream")
                self.assertEqual(stored["ContentEncoding"], "br")
                self.assertEqual(brotli.decompress(stored["Body"]), body)
                # The digest is over the frame, not over the compressed body, so
                # the collision check keeps working if the compression changes.
                self.assertEqual(stored["Metadata"]["sha256"],
                                 hashlib.sha256(body).hexdigest())
        # No sidecar ever becomes an object of its own.
        self.assertFalse([key for key in self.s3.objects
                          if key.endswith(".br") or key.endswith(".gz")])
        # The square is JSON, gzip-encoded as every JSON object is.
        square = self.stored(f"{self.directory}spots/n52w008.json")
        self.assertEqual((square["ContentType"], square["ContentEncoding"]),
                         ("application/json", "gzip"))

    def test_gzip_is_available_as_a_fallback_by_option_and_by_environment(self):
        self.assertEqual(publish(self.s3, self.root, "harmonie", "test",
                                 now=self.now, encoding="gzip"), "published")
        key = next(iter(self.bodies))
        self.assertEqual(self.stored(key)["ContentEncoding"], "gzip")
        self.assertEqual(gzip.decompress(self.stored(key)["Body"]), self.bodies[key])
        self.s3 = FakeS3()
        with patch.dict(os.environ, {"FORCE5_BUCKET_ENCODING": "gzip"}):
            self.assertEqual(publish(self.s3, self.root, "harmonie", "test",
                                     now=self.now), "published")
        self.assertEqual(self.stored(key)["ContentEncoding"], "gzip")

    def test_an_unusable_encoding_is_refused_before_anything_is_uploaded(self):
        with self.assertRaises(ValueError):
            publish(self.s3, self.root, "harmonie", "test", now=self.now, encoding="zstd")
        self.assertEqual(self.s3.writes, [])

    def test_the_manifest_stays_gzipped_json(self):
        publish(self.s3, self.root, "harmonie", "test", now=self.now)
        pointer = self.stored("weather/harmonie.json")
        self.assertEqual(pointer["ContentType"], "application/json")
        self.assertNotIn("ContentEncoding", pointer)

    def test_a_frame_is_uploaded_from_its_sidecar_rather_than_compressed_twice(self):
        """The adapter already brotli'd every frame; doing it again is pure cost."""
        import brotli
        compressed = []
        original = brotli.compress
        with patch.object(brotli, "compress",
                          lambda *args, **kwargs: compressed.append(1) or original(*args, **kwargs)):
            publish(self.s3, self.root, "harmonie", "test", now=self.now)
        self.assertEqual(compressed, [])  # Three frames, no second compression.
        for key, body in self.bodies.items():
            self.assertEqual(self.stored(key)["Body"],
                             Path(str(self.root / key) + ".br").read_bytes())
            self.assertEqual(brotli.decompress(self.stored(key)["Body"]), body)

    def test_a_sidecar_that_is_not_this_frame_is_never_uploaded(self):
        """Reuse is only safe because the bytes are checked rather than trusted.

        A stale, truncated or half-written sidecar falls through to compressing
        here, which is always correct; an unreadable one says so in the log.
        """
        import brotli
        key = next(iter(self.bodies))
        sidecar = Path(str(self.root / key) + ".br")
        for broken, unusable in [(brotli.compress(b"a different frame"), False),
                                 (b"not brotli at all", True), (b"", True)]:
            with self.subTest(len(broken)):
                s3, out, err = FakeS3(), StringIO(), StringIO()
                sidecar.write_bytes(broken)
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    publish(s3, self.root, "harmonie", "test", now=self.now)
                self.assertEqual(unusable, "sidecar_unusable" in out.getvalue() + err.getvalue())
                # Whatever the sidecar held, the object is this frame.
                self.assertEqual(brotli.decompress(s3.objects[key]["Body"]), self.bodies[key])

    def test_a_run_with_no_sidecars_still_uploads_one_compressed_object(self):
        """FORCE5_SIDECARS=0 is what a bucket-only job sets; the uploader copes."""
        import brotli
        for key in self.bodies:
            Path(str(self.root / key) + ".br").unlink()
            Path(str(self.root / key) + ".gz").unlink()
        self.assertEqual(publish(self.s3, self.root, "harmonie", "test", now=self.now),
                         "published")
        for key, body in self.bodies.items():
            self.assertEqual(self.stored(key)["ContentEncoding"], "br")
            self.assertEqual(brotli.decompress(self.stored(key)["Body"]), body)

    def test_the_gzip_fallback_reuses_the_gzip_sidecar(self):
        publish(self.s3, self.root, "harmonie", "test", now=self.now, encoding="gzip")
        for key, body in self.bodies.items():
            self.assertEqual(self.stored(key)["Body"],
                             Path(str(self.root / key) + ".gz").read_bytes())
            self.assertEqual(gzip.decompress(self.stored(key)["Body"]), body)

    def test_sidecars_are_neither_hashed_nor_uploaded_nor_left_after_a_delete(self):
        """The run directory's content leaves them out, so its hash and its upload do.

        The bucket has no sidecars to delete, and the local sweep removes a run
        directory whole, so neither path can be confused by one.
        """
        written = sorted(p.name for p in (self.root / self.directory / "t/0/2/0").iterdir())
        self.assertEqual(len(written), 9)
        self.assertTrue(any(name.endswith(".br") for name in written))
        files = rundir.content_files(self.root / self.directory)
        self.assertFalse([name for name in files if name.endswith((".br", ".gz"))])
        _, _, objects = validate_bundle(self.root, "harmonie", now=self.now)
        self.assertEqual(sorted(path for path, _ in objects),
                         sorted([*self.bodies, f"{self.directory}spots/n52w008.json"]))

    def test_republishing_the_same_frame_bytes_is_not_a_collision(self):
        publish(self.s3, self.root, "harmonie", "test", now=self.now)
        before = len(self.s3.writes)
        # Re-upload the frames directly: the digest matches, so nothing is raised.
        for key, body in self.bodies.items():
            publish_s3.put_immutable(self.s3, "test", key, body)
        self.assertEqual(len(self.s3.writes), before)
        # A different frame under the same key is what the check is there for.
        with self.assertRaises(ValueError):
            publish_s3.put_immutable(self.s3, "test", next(iter(self.bodies)), b"other")


if __name__ == "__main__":
    unittest.main()
