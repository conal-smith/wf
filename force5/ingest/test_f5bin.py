"""The binary wind frame: the golden file, the awkward values, and the refusals.

`tests/fixtures/f5bin/golden.bin` is decoded by this suite and by
`tests/f5bin.test.ts`, which also re-encodes it through
`scripts/f5bin.mjs`. Three implementations of one format cannot drift without
one of those two suites failing.
"""
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import f5bin

GOLDEN = Path(__file__).resolve().parents[2] / "tests/fixtures/f5bin/golden.bin"
GOLDEN_VALUES = GOLDEN.with_suffix(".json")


def frame(width=4, height=3, run="2026091712", hour=30, with_gust=True, **fields):
    count = width * height
    payload = {"model": "test", "run": run, "hour": hour,
               "grid": {"width": width, "height": height},
               "u": [1.0] * count, "v": [-2.0] * count,
               "gust": [5.0] * count if with_gust else None}
    payload.update(fields)
    return payload


class GoldenTests(unittest.TestCase):
    """The committed file both languages read, and the encoder that produced it."""

    def setUp(self):
        self.golden = json.loads(GOLDEN_VALUES.read_text())
        self.data = GOLDEN.read_bytes()

    def test_the_encoder_still_produces_the_golden_bytes(self):
        payload = {"model": "golden", "run": self.golden["run"], "hour": self.golden["hour"],
                   "grid": {"width": self.golden["width"], "height": self.golden["height"]},
                   **self.golden["source"]}
        self.assertEqual(f5bin.encode_frame(payload), self.data)
        self.assertEqual(len(self.data), self.golden["bytes"])

    def test_the_golden_file_decodes_to_the_published_values(self):
        decoded = f5bin.decode_frame(self.data)
        for field in ("u", "v", "gust"):
            self.assertEqual(decoded[field], self.golden["expected"][field], field)
        for key in ("run", "hour", "width", "height", "scale", "blockCount"):
            self.assertEqual(decoded[key], self.golden[key], key)

    def test_the_golden_file_carries_the_cases_it_is_meant_to(self):
        """A golden that stopped exercising the hard values would prove nothing."""
        source, expected = self.golden["source"], self.golden["expected"]
        self.assertIn(None, source["u"])  # A missing value inside a delta run.
        self.assertIn(None, expected["u"])
        self.assertEqual(expected["u"][source["u"].index(None)], None)
        # Halves round away from zero in both directions, not to even and not up.
        self.assertEqual((source["u"][0], expected["u"][0]), (0.05, 0.1))
        self.assertEqual((source["u"][1], expected["u"][1]), (-0.05, -0.1))
        self.assertEqual((source["u"][2], expected["u"][2]), (0.25, 0.3))
        self.assertEqual((source["u"][3], expected["u"][3]), (-0.25, -0.3))
        self.assertIn(150.0, expected["u"])  # Both ends of the permitted range.
        self.assertIn(-150.0, expected["u"])
        self.assertEqual(expected["gust"][0], 0.0)  # Zero gust is a value, not a gap.


class RoundTripTests(unittest.TestCase):
    def test_a_missing_value_does_not_disturb_the_rest_of_its_row(self):
        """The wrap-around case: the marker is -32768 and its neighbours survive."""
        values = [1.0, 2.0, None, 3.0, -4.0, None, None, 5.0]
        payload = frame(width=4, height=2, u=values)
        decoded = f5bin.decode_frame(f5bin.encode_frame(payload))
        self.assertEqual(decoded["u"], values)

    def test_a_delta_of_exactly_the_missing_marker_is_an_ordinary_delta(self):
        """-32768 as a *delta* must not be read as a second missing marker."""
        # 0 then the marker: the delta is -32768 - 0 = -32768 exactly.
        values = [0.0, None, 0.0, None]
        data = f5bin.encode_frame(frame(width=2, height=2, u=values, v=[0.0] * 4,
                                        with_gust=False))
        self.assertEqual(struct.unpack_from("<h", data, f5bin.HEADER_BYTES + 2)[0], -32768)
        self.assertEqual(f5bin.decode_frame(data)["u"], values)
        # And back the other way: the marker then 0 wraps to +32768, i.e. -32768.
        values = [None, 0.0, None, 0.0]
        data = f5bin.encode_frame(frame(width=2, height=2, u=values, v=[0.0] * 4,
                                        with_gust=False))
        self.assertEqual(struct.unpack_from("<h", data, f5bin.HEADER_BYTES + 2)[0], -32768)
        self.assertEqual(f5bin.decode_frame(data)["u"], values)

    def test_every_tenth_in_range_survives_a_round_trip(self):
        row = [round(v / 10, 1) for v in range(-1500, 1500, 7)]
        values = row + list(reversed(row))
        payload = frame(width=len(row), height=2, u=values, v=values, with_gust=False)
        self.assertEqual(f5bin.decode_frame(f5bin.encode_frame(payload))["u"], values)

    def test_a_wind_only_run_carries_two_blocks_and_a_null_gust(self):
        decoded = f5bin.decode_frame(f5bin.encode_frame(frame(with_gust=False)))
        self.assertEqual(decoded["blockCount"], 2)
        self.assertIsNone(decoded["gust"])

    def test_the_header_carries_the_run_and_the_hour(self):
        decoded = f5bin.decode_frame(f5bin.encode_frame(frame(run="2026010100", hour=360)))
        self.assertEqual((decoded["run"], decoded["hour"]), ("2026010100", 360))

    def test_the_header_length_is_even_so_the_payload_is_int16_aligned(self):
        self.assertEqual(f5bin.HEADER_BYTES % 2, 0)


class RefusalTests(unittest.TestCase):
    def test_a_truncated_or_oversized_buffer_is_refused(self):
        data = f5bin.encode_frame(frame())
        for broken in (data[:-2], data[:f5bin.HEADER_BYTES], data + b"\0\0", b""):
            with self.subTest(length=len(broken)), self.assertRaises(ValueError):
                f5bin.decode_frame(broken)

    def test_a_foreign_or_future_file_is_refused(self):
        data = bytearray(f5bin.encode_frame(frame()))
        cases = {"magic": (0, b"XXXX"), "version": (4, bytes([2])),
                 "blocks": (5, bytes([4])), "scale": (10, struct.pack("<H", 100))}
        for name, (offset, replacement) in cases.items():
            broken = bytearray(data)
            broken[offset:offset + len(replacement)] = replacement
            with self.subTest(name), self.assertRaises(ValueError):
                f5bin.decode_frame(bytes(broken))

    def test_a_frame_that_uses_the_reserved_bytes_is_refused(self):
        """They are zero today so that giving them a meaning is a visible change.

        A reader that skipped them could not tell a future encoder's file from
        one of its own, and would decode it as though nothing had been added.
        """
        data = f5bin.encode_frame(frame())
        self.assertEqual(data[18:24], b"\0" * 6)
        for offset in range(18, 24):
            broken = bytearray(data)
            broken[offset] = 1
            with self.subTest(offset=offset), self.assertRaises(ValueError) as caught:
                f5bin.decode_frame(bytes(broken))
            self.assertIn("reserved", str(caught.exception))

    def test_implausible_values_are_refused_by_both_ends(self):
        for field, values in [("u", [151.0] * 12), ("gust", [-1.0] * 12)]:
            with self.subTest(field), self.assertRaises(ValueError):
                f5bin.encode_frame(frame(**{field: values}))
        # A file built by hand out of range is refused on the way back in too.
        data = bytearray(f5bin.encode_frame(frame(width=2, height=2, u=[0.0] * 4,
                                                  v=[0.0] * 4, with_gust=False)))
        struct.pack_into("<h", data, f5bin.HEADER_BYTES, 1501)
        with self.assertRaises(ValueError):
            f5bin.decode_frame(bytes(data))

    def test_an_unusable_identity_or_grid_is_refused(self):
        for change in ({"run": "2026-09-17"}, {"run": 2026091712}, {"hour": -1},
                       {"hour": 70000}, {"grid": {"width": 1, "height": 4}},
                       {"grid": {"width": 70000, "height": 4}}):
            with self.subTest(sorted(change)), self.assertRaises((ValueError, TypeError)):
                f5bin.encode_frame(frame(**change))

    def test_a_frame_without_both_components_is_refused(self):
        for change in ({"u": None}, {"v": None}):
            with self.subTest(sorted(change)), self.assertRaises(ValueError):
                f5bin.encode_frame(frame(**change))

    def test_a_field_of_the_wrong_length_is_refused(self):
        with self.assertRaises(ValueError):
            f5bin.encode_frame(frame(u=[1.0] * 11))


class SidecarTests(unittest.TestCase):
    def test_a_frame_is_written_with_a_brotli_and_a_gzip_sidecar(self):
        import brotli
        import gzip
        data = f5bin.encode_frame(frame(width=40, height=30))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "run" / "000-abc.bin"
            f5bin.write_with_sidecars(path, data, sidecars=True)
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(brotli.decompress(Path(str(path) + ".br").read_bytes()), data)
            self.assertEqual(gzip.decompress(Path(str(path) + ".gz").read_bytes()), data)
            # Nothing is left behind, so a half-written sidecar can never be served.
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()),
                             ["000-abc.bin", "000-abc.bin.br", "000-abc.bin.gz"])

    def test_publish_frame_names_a_file_after_its_hour_inside_the_run(self):
        """The run directory is named for its content (rundir.py), so the file need not be."""
        payload = frame()
        with tempfile.TemporaryDirectory() as temp:
            name = f5bin.publish_frame(Path(temp), "model-2026091712-30h-v1", payload)
            self.assertEqual(name, "model-2026091712-30h-v1/frames/030.bin")
            self.assertEqual((Path(temp) / name).read_bytes(), f5bin.encode_frame(payload))

    def test_sidecars_can_be_turned_off_for_a_job_that_only_uploads(self):
        """A bucket-only run serves no sidecar, so it should not spend one per frame."""
        data = f5bin.encode_frame(frame(width=40, height=30))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "000-abc.bin"
            f5bin.write_with_sidecars(path, data, sidecars=False)
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["000-abc.bin"])
            self.assertEqual(path.read_bytes(), data)
        for value, wanted in [("0", False), ("1", True), ("false", False), ("on", True),
                              ("", True), (" 0 ", False)]:
            with self.subTest(value), patch.dict(os.environ, {f5bin.SIDECARS_ENV: value}):
                self.assertIs(f5bin.sidecars_wanted(), wanted)
        with patch.dict(os.environ, {}, clear=True):
            self.assertIs(f5bin.sidecars_wanted(), True)  # Local serving is the default.
        with patch.dict(os.environ, {f5bin.SIDECARS_ENV: "maybe"}), self.assertRaises(ValueError):
            f5bin.sidecars_wanted()

    def test_an_unusable_brotli_quality_is_a_sentence_not_a_traceback(self):
        """It is read at use, so a typo cannot kill every adapter at import time."""
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(f5bin.brotli_quality(), f5bin.DEFAULT_BROTLI_QUALITY)
        with patch.dict(os.environ, {f5bin.QUALITY_ENV: "11"}):
            self.assertEqual(f5bin.brotli_quality(), 11)
        for value in ("high", "", "9.5", "12", "-1"):
            with self.subTest(value), patch.dict(os.environ, {f5bin.QUALITY_ENV: value}):
                with self.assertRaises(ValueError) as caught:
                    f5bin.brotli_quality()
                self.assertIn(f5bin.QUALITY_ENV, str(caught.exception))

    def test_a_changed_value_changes_the_run_directory_it_is_published_in(self):
        """The directory's name is the content hash, which is what makes it immutable."""
        import rundir
        with tempfile.TemporaryDirectory() as temp:
            names = set()
            for payload in (frame(), frame(u=[9.0] * 12), frame(run="2026091713")):
                directory = Path(temp) / payload["run"] / str(len(names))
                f5bin.publish_frame(directory, "p", payload)
                names.add(rundir.directory_name("p", rundir.content_files(directory / "p")))
            self.assertEqual(len(names), 3)


if __name__ == "__main__":
    unittest.main()
