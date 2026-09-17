import contextlib
from datetime import datetime, timezone
import gzip
import hashlib
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import f5bin
import publish_s3
from publish_s3 import publish, superseded_objects, validate_bundle, already_current
from registry import UNCHANGED_EXIT


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


class BundleFixture:
    """A validated three-frame HARMONIE bundle on disk and an empty fake bucket."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "weather/harmonie-a").mkdir(parents=True)
        self.now = datetime(2026, 9, 13, 12, 30, tzinfo=timezone.utc)
        grid = {"width": 2, "height": 2}
        self.manifest = {"model": "harmonie", "run": "2026091312", "runTime": "2026-09-13T12:00:00Z",
                         "stepHours": 1, "gustAvailable": False, "grid": grid, "frames": []}
        for i in range(3):
            valid = f"2026-09-13T{12+i}:00:00Z"
            path = f"weather/harmonie-a/{i}.json"
            self.manifest["frames"].append({"hour": i, "validTime": valid, "url": path})
            (self.root / path).write_text(json.dumps({"model": "harmonie", "run": "2026091312",
                "hour": i, "validTime": valid, "grid": grid, "u": [1]*4, "v": [2]*4, "gust": None}))
        self.save()
        self.s3 = FakeS3()

    def save(self):
        (self.root / "weather/harmonie.json").write_text(json.dumps(self.manifest))

    def rerun(self, run, directory):
        """Replace the bundle on disk with a newer run in its own object directory."""
        grid, frames = self.manifest["grid"], []
        (self.root / "weather" / directory).mkdir(parents=True, exist_ok=True)
        for i in range(3):
            valid = f"2026-09-13T{int(run[-2:]) + i}:00:00Z"
            path = f"weather/{directory}/{i}.json"
            frames.append({"hour": i, "validTime": valid, "url": path})
            (self.root / path).write_text(json.dumps({"model": "harmonie", "run": run, "hour": i,
                "validTime": valid, "grid": grid, "u": [1]*4, "v": [2]*4, "gust": None}))
        self.manifest.update(run=run, runTime=f"2026-09-13T{run[-2:]}:00:00Z", frames=frames)
        self.save()
        return frames

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
        self.assertIn("/manifests/harmonie/", self.s3.writes[-2])
        self.assertEqual(self.s3.objects["weather/harmonie-a/0.json"]["ContentEncoding"], "gzip")
        before = list(self.s3.writes)
        self.assertEqual(self.run_publish(), "unchanged-or-newer")
        self.assertEqual(before, self.s3.writes)

    def test_upload_failure_does_not_publish_pointer(self):
        self.s3.fail_frame = True
        with self.assertRaises(S3Error):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)

    def test_existing_pointer_is_preserved_on_upload_failure(self):
        self.s3.objects["weather/harmonie.json"] = {"Body": json.dumps({**self.manifest, "run": "2026091311"}).encode(), "ETag": '"old"'}
        self.s3.fail_frame = True
        before = self.s3.objects["weather/harmonie.json"]["Body"]
        with self.assertRaises(S3Error):
            self.run_publish()
        self.assertEqual(before, self.s3.objects["weather/harmonie.json"]["Body"])

    def test_concurrent_newer_run_wins(self):
        self.s3.race = {**self.manifest, "run": "2026091313"}
        self.assertEqual(self.run_publish(), "unchanged-or-newer")
        self.assertEqual(json.loads(self.s3.objects["weather/harmonie.json"]["Body"])["run"], "2026091313")

    def test_invalid_frame_or_path_rejected_before_any_upload(self):
        self.manifest["frames"][1]["url"] = "../outside.json"
        self.save()
        with self.assertRaises(ValueError):
            self.run_publish()
        self.assertEqual(self.s3.writes, [])

    def test_missing_frame_rejected_before_any_upload(self):
        (self.root / "weather/harmonie-a/1.json").unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_publish()
        self.assertEqual(self.s3.writes, [])

    def test_bad_vectors_and_mixed_run_rejected(self):
        target = self.root / "weather/harmonie-a/1.json"
        original = json.loads(target.read_text())
        for change in [{"u": [float("nan")]*4}, {"run": "2026091311"}, {"gust": [1]*4}]:
            target.write_text(json.dumps({**original, **change}))
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

    def test_gusts_require_matching_periods_and_only_initialization_can_be_missing(self):
        self.manifest.update(gustAvailable=True, gustMissingHours=[0])
        for info in self.manifest["frames"]:
            hour = info["hour"]
            info["gustIntervalHours"] = [hour-1, hour] if hour else None
            path = self.root / info["url"]
            data = json.loads(path.read_text())
            data.update(gust=[4]*4 if hour else None, gustIntervalHours=info["gustIntervalHours"])
            path.write_text(json.dumps(data))
        self.save()
        self.assertEqual(self.run_publish(), "published")
        self.manifest["frames"][1]["gustIntervalHours"] = [0, 2]
        self.save()
        with self.assertRaises(ValueError):
            self.run_publish()
        self.manifest["gustMissingHours"] = [0, 1]
        self.save()
        with self.assertRaises(ValueError):
            self.run_publish()

    def test_immutable_collision_cannot_publish(self):
        self.s3.objects["weather/harmonie-a/0.json"] = {"Body": b"wrong", "Metadata": {"sha256": "wrong"}, "ETag": '"old"'}
        with self.assertRaises(ValueError):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)


class SupersededDeleteTest(BundleFixture, unittest.TestCase):
    """The bucket must not grow for ever, and must never lose a live object."""

    def test_a_publish_deletes_exactly_what_the_manifest_it_replaced_referenced(self):
        self.assertEqual(self.run_publish(), "published")
        replaced = [info["url"] for info in self.manifest["frames"]]
        frames = self.rerun("2026091313", "harmonie-b")
        self.assertEqual(self.quietly(self.run_publish)[0], "published")
        for url in replaced:
            self.assertNotIn(url, self.s3.objects)
        for info in frames:
            self.assertIn(info["url"], self.s3.objects)
        self.assertIn("weather/harmonie.json", self.s3.objects)
        # Archived manifests are a few kilobytes each and are the rollback path.
        self.assertTrue(any("/manifests/harmonie/" in key for key in self.s3.objects))

    def test_deletes_happen_only_after_the_new_pointer_is_in_place(self):
        self.assertEqual(self.run_publish(), "published")
        self.rerun("2026091313", "harmonie-b")
        self.s3.fail_frame, self.s3.fail_key = True, "/harmonie-b/"
        with self.assertRaises(S3Error):
            publish(self.s3, self.root, "harmonie", "test", now=self.now)
        self.assertEqual(self.s3.deleted, [])

    def test_a_delete_failure_never_fails_the_forecast_that_just_published(self):
        self.assertEqual(self.run_publish(), "published")
        self.rerun("2026091313", "harmonie-b")
        self.s3.fail_delete = True
        status, log = self.quietly(self.run_publish)
        self.assertEqual(status, "published")
        self.assertIn("superseded_delete_failed", log)
        self.assertIn("weather/harmonie-a/0.json", self.s3.objects)
        self.assertEqual(json.loads(self.s3.objects["weather/harmonie.json"]["Body"])["run"],
                         "2026091313")

    def test_a_pointer_put_whose_answer_was_lost_still_deletes_the_previous_run(self):
        # The PUT succeeded server-side; only its response went missing. The retry
        # finds our own manifest already published, which is success, not a reason
        # to leak the run it replaced until the next sweep.
        self.assertEqual(self.run_publish(), "published")
        replaced = [info["url"] for info in self.manifest["frames"]]
        frames = self.rerun("2026091313", "harmonie-b")
        self.s3.lost_ack = True
        status, log = self.quietly(self.run_publish)
        self.assertEqual(status, "unchanged-or-newer")
        self.assertIn("superseded_deleted", log)
        for url in replaced:
            self.assertNotIn(url, self.s3.objects)
        for info in frames:
            self.assertIn(info["url"], self.s3.objects)

    def test_a_newer_run_arriving_mid_publish_deletes_nothing_of_ours(self):
        # already_current for a reason other than "this is our manifest": another
        # machine won, so we published nothing and must delete nothing.
        self.assertEqual(self.run_publish(), "published")
        self.rerun("2026091313", "harmonie-b")
        self.s3.race = {**self.manifest, "run": "2026091314"}
        status, _ = self.quietly(self.run_publish)
        self.assertEqual(status, "unchanged-or-newer")
        self.assertEqual(self.s3.deleted, [])

    def test_an_unreadable_previous_pointer_publishes_and_deletes_nothing(self):
        self.s3.seed("weather/harmonie.json", b"{not json")
        status, log = self.quietly(self.run_publish)
        self.assertEqual(status, "published")
        self.assertIn("unreadable_pointer", log)
        self.assertEqual(self.s3.deleted, [])

    def test_nothing_the_new_manifest_still_references_is_ever_deleted(self):
        previous = {"model": "harmonie", "frames": [{"url": "weather/harmonie-a/0.json"},
                                                    {"url": "weather/harmonie-a/1.json"}]}
        incoming = {"model": "harmonie", "frames": [{"url": "weather/harmonie-a/1.json"}]}
        self.assertEqual(superseded_objects("harmonie", previous, incoming), ["weather/harmonie-a/0.json"])

    def test_pointers_archives_and_foreign_paths_are_never_deleted(self):
        previous = {"model": "harmonie", "frames": [
            {"url": "weather/harmonie.json"}, {"url": "weather/manifests/harmonie/x.json"},
            {"url": "marine/tides-DUBLIN.json"}, {"url": "https://example.invalid/x.json"},
            {"url": "/etc/passwd"}, {"url": "weather/../escape.json"},
            {"url": "weather/harmonie-a/0.json"}]}
        self.assertEqual(superseded_objects("harmonie", previous, {"frames": []}),
                         ["weather/harmonie-a/0.json"])

    def test_an_object_named_for_another_model_is_left_to_the_sweep(self):
        # Same object root, another model's run directory: a corrupt or hand-edited
        # manifest must not be able to delete a live forecast that is not its own.
        previous = {"model": "harmonie", "frames": [
            {"url": "weather/gfs-2026091600-240h-v1/000.json"},
            {"url": "weather/harmonie-eps-2026091600-48h-v1/000.json"},
            {"url": "weather/harmonie-2026091600-60h-v2/000.json"}]}
        self.assertEqual(superseded_objects("harmonie", previous, {"frames": []}),
                         ["weather/harmonie-2026091600-60h-v2/000.json"])

    def test_a_missing_or_foreign_previous_manifest_deletes_nothing(self):
        other = {"model": "gfs", "frames": [{"url": "weather/gfs-2026091600-240h-v1/0.json"}]}
        for previous in (None, "", {}, other):
            self.assertEqual(superseded_objects("harmonie", previous, self.manifest), [])


class ConditionalPutFallbackTest(BundleFixture, unittest.TestCase):
    """R2's support for If-None-Match is unverified, so the publisher must cope without it."""

    def test_a_backend_that_refuses_the_header_still_publishes_immutably(self):
        self.s3.reject_conditional = True
        status, log = self.quietly(self.run_publish)
        self.assertEqual(status, "published")
        self.assertEqual(self.s3.writes[-1], "weather/harmonie.json")
        self.assertEqual(self.s3.objects["weather/harmonie-a/0.json"]["ContentEncoding"], "gzip")
        self.assertEqual(self.s3.objects["weather/harmonie-a/0.json"]["CacheControl"],
                         "public, max-age=31536000, immutable")
        # Asked once for the immutable objects and once for the pointer, not per object.
        self.assertEqual(log.count("conditional_put_unsupported"), 2)

    def test_a_collision_is_still_detected_without_conditional_puts(self):
        self.s3.reject_conditional = True
        self.s3.seed("weather/harmonie-a/0.json", b"wrong", metadata={"sha256": "wrong"})
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
        self.s3.fail_frame = True
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
                                    bucket="test", prefix="", publish_only=False,
                                    max_age_hours=None, timeout_seconds=60)

    def run_models(self, code, s3=FIXTURE):
        """Run the worker with the adapter replaced by a process that exits `code`."""
        self.seen = {}

        def fake_run(command, **kwargs):
            self.seen = dict(kwargs.get("env") or {})
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
        self.args.models = ["harmonie"]
        self.s3.seed("weather/harmonie.json", json.dumps(
            {"model": "harmonie", "run": "2026091300", "frames": []}).encode())
        status, event = self.run_models(UNCHANGED_EXIT)
        self.assertNotIn("FORCE5_PUBLISHED_RUN", self.seen)
        self.assertEqual((status, event["event"]), (1, "forecast_failed"))

    def test_a_stray_published_run_in_the_environment_is_not_inherited(self):
        self.args.models = ["harmonie"]
        with patch.dict(os.environ, {"FORCE5_PUBLISHED_RUN": "2026091300"}):
            status, event = self.run_models(UNCHANGED_EXIT)
        self.assertNotIn("FORCE5_PUBLISHED_RUN", self.seen)
        self.assertEqual((status, event["event"]), (1, "forecast_failed"))


class BinaryUploadTests(unittest.TestCase):
    """One encoding per object: a frame is stored compressed once, typed as binary.

    The `.br`/`.gz` sidecars the ingest worker writes beside a frame exist only on
    the local Caddy deployment's disk. Nothing here ever uploads them, because the
    uploader only ever sees the paths a manifest references.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "weather/harmonie-bin").mkdir(parents=True)
        self.now = datetime(2026, 9, 13, 12, 30, tzinfo=timezone.utc)
        grid = {"width": 2, "height": 2}
        frames = []
        self.bodies = {}
        for hour in range(3):
            valid = f"2026-09-13T{12 + hour}:00:00Z"
            payload = {"model": "harmonie", "run": "2026091312", "hour": hour,
                       "grid": grid, "u": [1.5] * 4, "v": [-2.5] * 4, "gust": None}
            data = f5bin.encode_frame(payload)
            name = f5bin.frame_name("harmonie-bin", hour, data)
            # Written exactly as an adapter writes it, sidecars and all.
            f5bin.write_with_sidecars(self.root / "weather" / name, data)
            self.bodies[f"weather/{name}"] = data
            frames.append({"hour": hour, "validTime": valid, "url": f"weather/{name}"})
        self.manifest = {"model": "harmonie", "run": "2026091312",
                         "runTime": "2026-09-13T12:00:00Z", "stepHours": 1,
                         "gustAvailable": False, "grid": grid,
                         "encoding": f5bin.ENCODING, "frames": frames}
        (self.root / "weather/harmonie.json").write_text(json.dumps(self.manifest))
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

    def test_the_manifest_and_its_archive_stay_gzipped_json(self):
        publish(self.s3, self.root, "harmonie", "test", now=self.now)
        archive = next(key for key in self.s3.writes if "/manifests/" in key)
        self.assertEqual(self.stored(archive)["ContentType"], "application/json")
        self.assertEqual(self.stored(archive)["ContentEncoding"], "gzip")
        pointer = self.stored("weather/harmonie.json")
        self.assertEqual(pointer["ContentType"], "application/json")
        self.assertNotIn("ContentEncoding", pointer)

    def test_the_superseded_delete_can_never_name_a_sidecar(self):
        """It works from the replaced manifest's urls, and no manifest lists a sidecar.

        The bucket has no sidecars to delete, and the local sweep removes a run
        directory whole, so neither path can be confused by one. This pins the
        reason: the only names that reach `delete_keys` are frame urls.
        """
        previous = json.loads(json.dumps(self.manifest))
        newer = {**self.manifest, "run": "2026091313",
                 "frames": [{**frame, "url": frame["url"].replace("harmonie-bin",
                                                                  "harmonie-bin2")}
                            for frame in self.manifest["frames"]]}
        stale = superseded_objects("harmonie", previous, newer)
        self.assertEqual(sorted(stale), sorted(self.bodies))
        self.assertTrue(all(url.endswith(".bin") for url in stale))
        # The sidecars are on disk beside the frames and still are not named.
        written = sorted(p.name for p in (self.root / "weather/harmonie-bin").iterdir())
        self.assertEqual(len(written), 9)
        self.assertTrue(any(name.endswith(".br") for name in written))

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
