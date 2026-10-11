"""The forecast archive job against real binary bundles on disk and in a fake bucket."""
import contextlib
from datetime import datetime, timedelta, timezone
import gzip
import io
import json
import math
from pathlib import Path
import tempfile
import unittest

import brotli

import archive_forecasts as job
from archive import BucketArchive, LocalArchive, forecast_key, observation_key
import f5bin
from publish_s3 import validate_bundle
from runfixtures import publish_whole, read_whole
from test_publish_s3 import FakeS3

RUN = datetime(2026, 10, 10, 0, tzinfo=timezone.utc)
NOW = RUN + timedelta(hours=3, minutes=15)
# Half-degree cells over the north-west: Malin Head is inside, Valentia south of it.
GRID = {"west": -11.0, "north": 56.0, "dx": 0.5, "dy": 0.5, "width": 10, "height": 8}
POINTS = {"ME_03980": (55.37194, -7.33917), "ME_03953": (51.93833, -10.24083)}


def iso(at):
    return at.isoformat().replace("+00:00", "Z")


def field(hour, base):
    """A field that rises one m/s per cell eastwards, so bilinear sampling is checkable."""
    return [round(base + hour + column, 1) for row in range(GRID["height"])
            for column in range(GRID["width"])]


def write_bundle(public, model="harmonie", run=RUN, hours=(0, 1, 2), ensemble=False):
    """A binary wind run exactly as the adapters publish one, spot squares and all.

    Returns the published pointer with its squares merged back in.
    """
    run_id = run.strftime("%Y%m%d%H")
    directory = f"source/{model}"
    frames = []
    for hour in hours:
        data = f5bin.encode_frame({"run": run_id, "hour": hour, "grid": GRID,
                                   "u": field(hour, 1.0), "v": [-2.0] * 80, "gust": field(hour, 6.0)})
        url = f"{directory}/{hour:03d}.bin"
        (public / url).parent.mkdir(parents=True, exist_ok=True)
        (public / url).write_bytes(data)
        frames.append({"hour": hour, "validTime": iso(run + timedelta(hours=hour)), "url": url,
                       "gustIntervalHours": [max(hour - 1, 0), hour]})
    spots = {"brandon": [{"hour": h, "validTime": iso(run + timedelta(hours=h)),
                          "u": 3.14159, "v": -1.04, "gust": 9.87} for h in hours]}
    manifest = {"schemaVersion": 1, "kind": "wind", "model": model, "run": run_id,
                "runTime": iso(run), "generatedAt": iso(run + timedelta(hours=2, minutes=40)),
                "resolutionKm": 2, "stepHours": 1, "grid": GRID, "encoding": f5bin.ENCODING,
                "frames": frames, "spotForecasts": spots}
    if ensemble:
        manifest["ensemble"] = {"members": 4, "control": None, "description": "test"}
        manifest["spotMembers"] = {"brandon": [
            {"hour": h, "validTime": iso(run + timedelta(hours=h)),
             "u": [3.0, 4.0, 0.0, 6.0], "v": [4.0, 3.0, 2.0, 8.0], "gust": [9.0, None, 7.0, 11.0]}
            for h in hours]}
    path = public / f"weather/{model}.json" if model != "icon-eu" else public / "weather/latest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    # Frame urls are read relative to the directory above weather/, which is public/.
    for info in frames:
        info["url"] = f"weather/../{info['url']}"
    publish_whole(public / "weather", path.name, manifest)
    return read_whole(path)


def observations(public, readings=None):
    manifest = {"schemaVersion": 1, "kind": "observation", "observes": "wind", "model": "wind-obs",
                "run": "2026101002", "runTime": "2026-10-10T02:00:00Z",
                "readingFields": ["time", "speed", "gust", "direction"],
                "units": {"speed": "m/s", "gust": "m/s", "direction": "degrees true, blowing from"},
                "stations": {"ME_03980": {"name": "Malin Head", "lat": 55.37194, "lon": -7.33917,
                                          "source": "met-eireann", "class": "coastal", "heightM": 10,
                                          "readings": readings or [
                                              ["2026-10-09T23:00:00Z", 12.1, 18.0, 280],
                                              ["2026-10-10T00:00:00Z", 12.6, 19.2, 284],
                                              ["2026-10-10T01:00:00Z", 13.0, 20.1, 290]]}},
                "sources": {}, "attribution": "Contains Met Éireann data, CC BY 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"}
    path = public / "marine/wind-observations.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest))
    return manifest


class PieceTests(unittest.TestCase):
    def test_bilinear_sampling_and_its_edges(self):
        values = field(0, 1.0)
        # Halfway between columns 3 and 4: 1 + 3.5.
        self.assertAlmostEqual(job.sample_point(GRID, values, -9.25, 55.0), 4.5)
        self.assertIsNone(job.sample_point(GRID, values, -12.0, 55.0))
        holed = list(values)
        holed[2 * GRID["width"] + 3] = None
        self.assertIsNone(job.sample_point(GRID, holed, -9.25, 55.0))

    def test_percentiles_and_the_member_summary(self):
        self.assertEqual(job.percentile([1, 2, 3, 4, 5], 0.5), 3)
        self.assertAlmostEqual(job.percentile([0, 10], 0.1), 1)
        p10, p50, p90, mean, gust = job.member_summary(
            {"u": [3.0, 4.0, 0.0, 6.0], "v": [4.0, 3.0, 2.0, 8.0], "gust": [9.0, None, 7.0, 11.0]})
        # Member speeds 5, 5, 2, 10.
        self.assertAlmostEqual(p50, 5)
        self.assertAlmostEqual(mean, 5.5)
        self.assertAlmostEqual(p10, 2.9)
        self.assertAlmostEqual(p90, 8.5)
        self.assertAlmostEqual(gust, 9)
        self.assertEqual(job.member_summary({"u": [None], "v": [None]}), (None,) * 5)

    def test_station_points_fall_back_to_the_committed_list(self):
        points, source = job.station_points(None)
        self.assertEqual(source, "committed")
        self.assertIn("MI_M2", points)
        points, source = job.station_points({"stations": {"X_1": {"lat": 1, "lon": 2}}})
        self.assertEqual((points, source), ({"X_1": (1, 2)}, "wind-obs"))


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.public = Path(self.temp.name).resolve()

    def test_a_run_is_sampled_at_stations_and_its_spots_copied(self):
        manifest = write_bundle(self.public)
        frames = job.LocalSource(self.public).frames("harmonie", manifest)
        record = job.forecast_record(manifest, frames, POINTS, "committed", NOW)
        self.assertEqual(record["hours"], [0, 1, 2])
        self.assertEqual(record["gustWindowHours"], [0, 1, 1])
        self.assertEqual(record["generatedAt"], "2026-10-10T02:40:00Z")
        # Valentia is south of the grid: left out, not clamped to the edge.
        self.assertEqual(list(record["stations"]), ["ME_03980"])
        malin = record["stations"]["ME_03980"]
        column = (POINTS["ME_03980"][1] - GRID["west"]) / GRID["dx"]
        self.assertEqual(malin["u"], [round(1.0 + h + column, 1) for h in (0, 1, 2)])
        self.assertEqual(malin["v"], [-2.0, -2.0, -2.0])
        self.assertEqual(record["spots"]["brandon"]["u"], [3.1, 3.1, 3.1])
        self.assertEqual(record["spotHours"], [0, 1, 2])
        self.assertIsNone(record["members"])

    def test_an_ensemble_keeps_its_member_spread_at_spots(self):
        manifest = write_bundle(self.public, model="ecmwf-ens", ensemble=True)
        record = job.forecast_record(manifest, job.LocalSource(self.public).frames(
            "ecmwf-ens", manifest), POINTS, "committed", NOW)
        stats = record["members"]["brandon"]
        self.assertEqual(stats["p50"], [5.0, 5.0, 5.0])
        self.assertEqual(stats["gustMean"], [9.0, 9.0, 9.0])
        self.assertEqual(record["ensemble"], {"members": 4})


class ObservationMergeTests(unittest.TestCase):
    def test_merging_is_idempotent_and_keyed_by_station_and_time(self):
        manifest = observations(Path(tempfile.mkdtemp()))
        days = job.observation_days(manifest)
        self.assertEqual(sorted(days), ["2026-10-09", "2026-10-10"])
        first, added = job.merge_day(None, "2026-10-10", days["2026-10-10"], manifest, NOW)
        self.assertEqual(added, 2)
        self.assertEqual(job.merge_day(first, "2026-10-10", days["2026-10-10"], manifest, NOW),
                         (None, 0))
        revised = [["2026-10-10T01:00:00Z", 13.5, 20.1, 290], ["2026-10-10T02:00:00Z", 14.0, None, 295]]
        merged, added = job.merge_day(json.loads(json.dumps(first)), "2026-10-10",
                                      {"ME_03980": revised}, manifest, NOW)
        self.assertEqual(added, 1)
        self.assertEqual([row[1] for row in merged["readings"]["ME_03980"]], [12.6, 13.5, 14.0])


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.public = Path(self.temp.name).resolve() / "public"
        self.public.mkdir()
        self.out = self.public / job.SUMMARY

    def quietly(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return job.run(*args)

    def test_local_run_archives_once_and_publishes_a_valid_summary(self):
        write_bundle(self.public)
        write_bundle(self.public, model="ecmwf-ens", ensemble=True)
        observations(self.public)
        store = LocalArchive(self.public)
        summary = self.quietly(job.LocalSource(self.public), store, NOW, self.out)
        self.assertEqual(sorted(entry["model"] for entry in summary["archived"]),
                         ["ecmwf-ens", "harmonie"])
        self.assertEqual(summary["stationSource"], "wind-obs")
        self.assertEqual(summary["observations"]["added"], 3)
        self.assertTrue(store.exists(forecast_key("harmonie", "2026101000")))
        self.assertEqual(len(store.read(observation_key("2026-10-10"))["readings"]["ME_03980"]), 2)
        validate_bundle(self.public, "forecast-archive", 3, now=NOW)
        again = self.quietly(job.LocalSource(self.public), store, NOW, self.out)
        self.assertEqual(again["archived"], [])
        self.assertEqual(again["observations"]["added"], 0)
        self.assertEqual(sorted(again["current"]), ["ecmwf-ens", "harmonie"])

    def test_bucket_run_reads_what_the_bucket_serves_and_writes_only_the_archive(self):
        staging = Path(self.temp.name).resolve() / "staging"
        write_bundle(staging)
        manifest = json.loads((staging / "weather/harmonie.json").read_text())
        obs = observations(staging)
        s3 = FakeS3()
        s3.seed("weather/harmonie.json", json.dumps(manifest).encode())
        s3.seed("marine/wind-observations.json", json.dumps(obs).encode())
        for index, info in enumerate(manifest["frames"]):
            key = f"weather/{manifest['base']}{info['url']}"
            data = (staging / key).read_bytes()
            # One frame stored brotli-encoded, one gzip, one plain: each must be read back.
            body, encoding = [(brotli.compress(data), "br"), (gzip.compress(data), "gzip"),
                              (data, None)][index]
            s3.objects[key] = {"Body": body, "ETag": f'"f{index}"', "LastModified": s3.clock,
                               **({"ContentEncoding": encoding} if encoding else {})}
        for square in manifest["spots"]["squares"]:
            key = f"weather/{manifest['base']}spots/{square}.json"
            s3.objects[key] = {"Body": gzip.compress((staging / key).read_bytes()),
                               "ContentEncoding": "gzip", "ETag": '"s"', "LastModified": s3.clock}
        before = set(s3.objects)
        with tempfile.TemporaryDirectory() as scratch:
            summary = self.quietly(job.BucketSource(s3, "bucket", "", scratch),
                                   BucketArchive(s3, "bucket"), NOW, self.out)
        self.assertEqual([entry["model"] for entry in summary["archived"]], ["harmonie"])
        written = set(s3.objects) - before
        self.assertTrue(written)
        self.assertTrue(all(key.startswith("archive/") for key in written), written)
        record = json.loads(gzip.decompress(s3.objects[forecast_key("harmonie", "2026101000")]["Body"]))
        self.assertEqual(list(record["stations"]), ["ME_03980"])
        self.assertEqual(len(record["stations"]["ME_03980"]["u"]), 3)
        # The spots came from the run's square, read through the bucket.
        self.assertEqual(record["spots"]["brandon"]["u"], [3.1, 3.1, 3.1])

    def test_a_corrupt_frame_fails_that_run_only(self):
        harmonie = write_bundle(self.public)
        write_bundle(self.public, model="gfs")
        target = self.public / "weather" / harmonie["base"] / harmonie["frames"][1]["url"]
        # Truncated, which the frame's own header gives away.
        target.write_bytes(target.read_bytes()[:-2])
        summary = self.quietly(job.LocalSource(self.public), LocalArchive(self.public), NOW, self.out)
        self.assertEqual([entry["model"] for entry in summary["archived"]], ["gfs"])
        self.assertEqual([entry["model"] for entry in summary["failed"]], ["harmonie"])
        self.assertFalse(LocalArchive(self.public).exists(forecast_key("harmonie", "2026101000")))
        validate_bundle(self.public, "forecast-archive", 3, now=NOW)


if __name__ == "__main__":
    unittest.main()
