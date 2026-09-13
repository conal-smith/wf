from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest

from publish_s3 import publish, validate_bundle, already_current


class S3Error(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.writes = []
        self.fail_frame = False
        self.race = None

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise S3Error("NoSuchKey")
        value = self.objects[Key]
        return {**value, "Body": BytesIO(value["Body"])}

    def head_object(self, Bucket, Key):
        return self.objects[Key]

    def put_object(self, **args):
        key = args["Key"]
        if self.fail_frame and "/run/" in key:
            raise S3Error("ServiceUnavailable")
        if key == "weather/harmonie.json" and self.race:
            newer = self.race
            self.race = None
            self.objects[key] = {"Body": json.dumps(newer).encode(), "ETag": '"newer"'}
        old = self.objects.get(key)
        if args.get("IfNoneMatch") == "*" and old:
            raise S3Error("PreconditionFailed")
        if "IfMatch" in args and (not old or old["ETag"] != args["IfMatch"]):
            raise S3Error("PreconditionFailed")
        self.objects[key] = {**args, "ETag": f'"{len(self.writes)}"'}
        self.writes.append(key)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "weather/run").mkdir(parents=True)
        self.now = datetime(2026, 9, 13, 12, 30, tzinfo=timezone.utc)
        grid = {"width": 2, "height": 2}
        self.manifest = {"model": "harmonie", "run": "2026091312", "runTime": "2026-09-13T12:00:00Z",
                         "stepHours": 1, "gustAvailable": False, "grid": grid, "frames": []}
        for i in range(3):
            valid = f"2026-09-13T{12+i}:00:00Z"
            path = f"weather/run/{i}.json"
            self.manifest["frames"].append({"hour": i, "validTime": valid, "url": path})
            (self.root / path).write_text(json.dumps({"model": "harmonie", "run": "2026091312",
                "hour": i, "validTime": valid, "grid": grid, "u": [1]*4, "v": [2]*4, "gust": None}))
        self.save()
        self.s3 = FakeS3()

    def save(self):
        (self.root / "weather/harmonie.json").write_text(json.dumps(self.manifest))

    def run_publish(self):
        return publish(self.s3, self.root, "harmonie", "test", now=self.now)

    def test_pointer_last_and_retry_is_idempotent(self):
        self.assertEqual(self.run_publish(), "published")
        self.assertEqual(self.s3.writes[-1], "weather/harmonie.json")
        self.assertIn("/manifests/harmonie/", self.s3.writes[-2])
        self.assertEqual(self.s3.objects["weather/run/0.json"]["ContentEncoding"], "gzip")
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
        (self.root / "weather/run/1.json").unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_publish()
        self.assertEqual(self.s3.writes, [])

    def test_bad_vectors_and_mixed_run_rejected(self):
        target = self.root / "weather/run/1.json"
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
        self.s3.objects["weather/run/0.json"] = {"Body": b"wrong", "Metadata": {"sha256": "wrong"}, "ETag": '"old"'}
        with self.assertRaises(ValueError):
            self.run_publish()
        self.assertNotIn("weather/harmonie.json", self.s3.objects)


if __name__ == "__main__":
    unittest.main()
