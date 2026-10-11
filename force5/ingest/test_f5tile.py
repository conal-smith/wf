"""Tiled wind frames: the lattice, the overviews, the borders, sampling, refusals.

`tests/fixtures/f5tile/` holds two golden pyramids built by `golden()` below: a
regional grid with holes, and a tiny global grid that wraps. This suite checks
the writer still produces those exact bytes; `force5/src/f5tile.test.ts`
decodes the same files and checks the same ranges and samples, so the two
languages cannot drift apart without one suite failing.

Regenerate after a deliberate format change with
`.venv/bin/python force5/ingest/test_f5tile.py --write-golden`.
"""
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import unittest

import numpy as np

from archive_forecasts import sample_point
import f5bin
import f5tile

FIXTURES = Path(__file__).resolve().parents[2] / "tests/fixtures/f5tile"
GOLDEN = FIXTURES / "golden.json"

HARMONIE = {"west": -10.9, "north": 55.7, "dx": 0.025, "dy": 0.02, "width": 233, "height": 236}
ICON_EU = {"west": -18.0, "north": 59.0, "dx": 0.0625, "dy": 0.0625, "width": 321, "height": 177}
ECMWF = {"west": -18.0, "north": 59.0, "dx": 0.25, "dy": 0.25, "width": 81, "height": 45}


def with_edges(grid):
    """A grid with the east and south edges the manifests and weather.ts carry."""
    return dict(grid, east=grid["west"] + (grid["width"] - 1) * grid["dx"],
                south=grid["north"] - (grid["height"] - 1) * grid["dy"])


def regional():
    """20 × 14 cells at 0.25°, tiles of 8: three levels, two tiles all land.

    The north-west 6 × 4 corner is missing in every field, which leaves level-0
    tile (85, 17) and level-1 tile (42, 8) with nothing they own, so neither is
    written. The rest carries
    f5bin's awkward values: halves to round, both ends of the range beside each
    other and beside a missing cell (a delta that wraps int16), and holes in one
    field but not the others.
    """
    grid = with_edges({"west": -9.5, "north": 55.0, "dx": 0.25, "dy": 0.25,
                       "width": 20, "height": 14})
    width, height = grid["width"], grid["height"]
    u, v, gust = [], [], []
    for row in range(height):
        for column in range(width):
            noise = ((column * 7 + row * 13) % 11 - 5) / 10
            u.append(round(8 * math.sin(column / 3) + noise - row * 0.4, 2))
            v.append(round(-6 + 5 * math.cos(row / 2) - noise + column * 0.15, 2))
            gust.append(round(math.hypot(u[-1], v[-1]) * 1.3 + 0.5, 2))
    for row in range(4):
        for column in range(6):
            u[row * width + column] = v[row * width + column] = None
            gust[row * width + column] = None
    u[2 * width + 6], u[2 * width + 7] = 150.0, -150.0  # Beside the hole: a wrapping delta.
    v[2 * width + 6], v[2 * width + 7] = -149.95, 149.95
    u[5 * width:5 * width + 4] = [0.05, -0.05, 0.25, -0.25]
    u[10 * width + 8] = None  # A hole in u only.
    v[3 * width + 9] = None  # A hole in v only.
    gust[12 * width + 5] = None  # And in gust only.
    gust[13 * width + 0] = 0.0
    return {"name": "regional", "grid": grid, "size": 8, "border": 1, "hour": 42,
            "run": "2026091712", "source": {"u": u, "v": v, "gust": gust}}


def global_grid():
    """8 × 5 cells at 45° × 30°, all the way round: tiles of 4 wrap at 180°."""
    grid = with_edges({"west": -180.0, "north": 60.0, "dx": 45.0, "dy": 30.0,
                       "width": 8, "height": 5})
    u = [round(column * 1.5 - row * 2.25 - 3, 2) for row in range(5) for column in range(8)]
    v = [round(4 - column * 0.85 + row, 2) for row in range(5) for column in range(8)]
    u[3 * 8 + 7] = None
    return {"name": "global", "grid": grid, "size": 4, "border": 1, "hour": 7,
            "run": "2026101106", "source": {"u": u, "v": v, "gust": None}}


SAMPLE_POINTS = {
    # Edges of the domain and of tiles, grid points, cell middles, points
    # outside, and 52.1 / -8.2 beside the lone gust hole.
    "regional": ([55.1, 55.0, 54.875, 54.0, 53.9, 53.0, 52.3, 52.1, 51.75, 51.7],
                 [-9.6, -9.5, -9.4, -8.2, -8.0, -7.875, -6.0, -5.9, -4.75, -4.7]),
    "global": ([65.0, 60.0, 45.0, 30.0, 0.0, -20.0, -60.0, -61.0],
               [-180.0, -170.0, -135.0, 0.0, 22.5, 135.0, 157.5, 170.0, 179.999]),
}


def lookup(tiles):
    """A `tile_lookup` over decoded tiles keyed by (level, x, y)."""
    decoded = {(level, x, y): f5tile.decode_tile(data) for level, x, y, data in tiles}
    return lambda level, x, y: decoded.get((level, x, y))


def build(case):
    source = case["source"]
    return f5tile.build_pyramid(case["grid"], source["u"], source["v"], source["gust"],
                                case["hour"], case["run"], case["size"], case["border"])


def golden():
    """Both golden pyramids as golden.json describes them, plus their bytes by path."""
    cases, files = [], {}
    for case in (regional(), global_grid()):
        spec, tiles = build(case)
        listed = []
        for level, x, y, data in tiles:
            path = f"{case['name']}/{f5tile.tile_path(level, x, y, case['hour'])}"
            files[path] = data
            decoded = f5tile.decode_tile(data)
            listed.append({"level": level, "x": x, "y": y, "path": path, "bytes": len(data),
                           "sha256": hashlib.sha256(data).hexdigest(),
                           "expected": {field: decoded[field] for field in f5tile.FIELDS}})
        written = {(tile["level"], tile["x"], tile["y"]) for tile in listed}
        skipped = [[level["level"], x, y] for level in spec
                   for y in range(level["y"][0], level["y"][1] + 1)
                   for x in range(level["x"][0], level["x"][1] + 1)
                   if (level["level"], x, y) not in written]
        read = lookup(tiles)
        lats, lons = SAMPLE_POINTS[case["name"]]
        samples = [{"level": level["level"], "lat": lat, "lon": lon,
                    "tile": f5tile.tile_of(case["grid"], level["level"], lat, lon, case["size"]),
                    "expected": f5tile.sample(read, case["grid"], level["level"], lat, lon,
                                              case["size"])}
                   for level in spec for lat in lats for lon in lons]
        for sample in samples:
            sample["tile"] = None if sample["tile"] is None else list(sample["tile"])
        cases.append(dict(case, levels=spec, tiles=listed, skipped=skipped, samples=samples))
    note = ("Regenerate with `.venv/bin/python force5/ingest/test_f5tile.py --write-golden`. "
            "force5/ingest/f5tile.py must build exactly these tiles from `source`, and every "
            "reader must decode `expected` from them and sample `samples` the same. See "
            "force5/ingest/test_f5tile.py and force5/src/f5tile.test.ts.")
    return {"note": note, "pyramids": cases}, files


def dump(value, indent=0):
    """JSON with each list of numbers on one line, so a diff shows which cells moved."""
    pad = "  " * indent
    if isinstance(value, dict):
        items = [f'{pad}  {json.dumps(key)}: {dump(item, indent + 1).lstrip()}'
                 for key, item in value.items()]
        return pad + "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(value, list) and any(isinstance(item, (dict, list)) for item in value):
        return pad + "[\n" + ",\n".join(dump(item, indent + 1) for item in value) + "\n" + pad + "]"
    return pad + json.dumps(value)


def write_golden():
    description, files = golden()
    shutil.rmtree(FIXTURES, ignore_errors=True)
    for path, data in files.items():
        f5bin.write_with_sidecars(FIXTURES / path, data, sidecars=False)
    GOLDEN.write_text(dump(description) + "\n")


class GoldenTests(unittest.TestCase):
    """The committed pyramids both languages read, and the writer that made them."""

    def setUp(self):
        self.golden = json.loads(GOLDEN.read_text())
        self.description, self.files = golden()

    def test_the_writer_still_produces_the_golden_tiles(self):
        on_disk = {str(path.relative_to(FIXTURES)) for path in FIXTURES.rglob("*.bin")}
        self.assertEqual(on_disk, set(self.files))
        for path, data in self.files.items():
            with self.subTest(path):
                self.assertEqual((FIXTURES / path).read_bytes(), data)
        for built, committed in zip(self.description["pyramids"], self.golden["pyramids"]):
            self.assertEqual([(t["path"], t["sha256"], t["bytes"]) for t in built["tiles"]],
                             [(t["path"], t["sha256"], t["bytes"]) for t in committed["tiles"]])

    def test_the_golden_tiles_decode_to_the_published_values(self):
        for pyramid in self.golden["pyramids"]:
            for tile in pyramid["tiles"]:
                decoded = f5tile.decode_tile((FIXTURES / tile["path"]).read_bytes())
                with self.subTest(tile["path"]):
                    for field in f5tile.FIELDS:
                        self.assertEqual(decoded[field], tile["expected"][field], field)
                    self.assertEqual((decoded["level"], decoded["x"], decoded["y"]),
                                     (tile["level"], tile["x"], tile["y"]))
                    self.assertEqual((decoded["hour"], decoded["run"], decoded["size"],
                                      decoded["border"]),
                                     (pyramid["hour"], pyramid["run"], pyramid["size"],
                                      pyramid["border"]))

    def test_the_golden_levels_and_samples_are_what_the_library_computes(self):
        for built, committed in zip(self.description["pyramids"], self.golden["pyramids"]):
            with self.subTest(committed["name"]):
                self.assertEqual(built["levels"], committed["levels"])
                self.assertEqual(built["skipped"], committed["skipped"])
                self.assertEqual(built["samples"], committed["samples"])

    def test_the_golden_carries_the_cases_it_is_meant_to(self):
        """A golden that stopped exercising the hard values would prove nothing."""
        regional_, global_ = self.golden["pyramids"]
        self.assertEqual([level["level"] for level in regional_["levels"]], [0, 1, 2])
        # The all-land corner empties one tile at level 0 and, by the same cells,
        # one at level 1.
        self.assertEqual(regional_["skipped"], [[0, 85, 17], [1, 42, 8]])
        self.assertEqual(len(regional_["tiles"]), 9 + 4 + 1 - 2)
        cells = [value for tile in regional_["tiles"] for value in tile["expected"]["u"]]
        self.assertIn(None, cells)
        self.assertIn(150.0, cells)
        self.assertIn(-150.0, cells)
        self.assertIn(-0.1, cells)  # -0.05 rounded away from zero.
        self.assertIsNotNone(regional_["tiles"][0]["expected"]["gust"])
        self.assertIsNone(global_["tiles"][0]["expected"]["gust"])
        samples = regional_["samples"] + global_["samples"]
        self.assertTrue(any(s["expected"] is None for s in samples))
        self.assertTrue(any(s["expected"] is not None and s["expected"]["gust"] is None
                            for s in regional_["samples"]))
        # A delta from the missing marker to 150 m/s wraps int16 on the wire.
        tile = next(t for t in regional_["tiles"] if (t["level"], t["x"], t["y"]) == (0, 85, 18)
                    or (t["level"], t["x"], t["y"]) == (0, 86, 17))
        data = (FIXTURES / tile["path"]).read_bytes()
        deltas = np.frombuffer(data, dtype="<i2", offset=f5tile.HEADER_BYTES)
        self.assertTrue(np.any(deltas == 1500 - f5bin.MISSING - 65536))


class LatticeTests(unittest.TestCase):
    def test_the_real_grids_sit_on_the_lattice(self):
        self.assertEqual(f5tile.lattice_origin(HARMONIE), (6764, 1715))
        self.assertEqual(f5tile.lattice_origin(ICON_EU), (2592, 496))
        self.assertEqual(f5tile.lattice_origin(ECMWF), (648, 124))

    def test_a_misaligned_grid_is_refused(self):
        for change in ({"west": -10.91}, {"north": 55.71}, {"dx": 0.03}, {"dx": 0},
                       {"west": -181.0}, {"north": 90.5}):
            with self.subTest(change), self.assertRaises(ValueError):
                f5tile.lattice_origin(dict(HARMONIE, **change))

    def test_the_real_grids_tile_as_the_design_says(self):
        def ranges(grid):
            return [(level["level"], level["x"], level["y"]) for level in f5tile.levels(grid)]
        self.assertEqual(ranges(HARMONIE), [(0, [52, 54], [13, 15]), (1, [26, 27], [6, 7]),
                                            (2, [13, 13], [3, 3])])
        self.assertEqual(ranges(ICON_EU), [(0, [20, 22], [3, 5]), (1, [10, 11], [1, 2]),
                                           (2, [5, 5], [0, 1]), (3, [2, 2], [0, 0])])
        self.assertEqual(ranges(ECMWF), [(0, [5, 5], [0, 1]), (1, [2, 2], [0, 0])])

    def test_a_level_reports_its_cells_and_cell_size(self):
        level = f5tile.levels(HARMONIE)[2]
        self.assertEqual((level["columns"], level["rows"]), ([1691, 1749], [428, 487]))
        self.assertAlmostEqual(level["dx"], 0.1)
        self.assertAlmostEqual(level["dy"], 0.08)

    def test_levels_stop_at_fifteen(self):
        wide = {"west": -180.0, "north": 90.0, "dx": 0.001, "dy": 0.001, "width": 300000,
                "height": 2}
        self.assertEqual(len(f5tile.levels(wide, size=1)), f5tile.MAX_LEVELS)

    def test_a_tile_path_pads_the_hour_like_a_frame(self):
        self.assertEqual(f5tile.tile_path(0, 52, 13, 7), "t/0/52/13/007.bin")
        self.assertEqual(f5tile.tile_path(2, 13, 3, 120), "t/2/13/3/120.bin")


def small_grid(width, height):
    """A grid at lattice origin (4, 4): with tiles of 2, level 1 is one tile."""
    return {"west": -180.0 + 4 * 0.5, "north": 90.0 - 4 * 0.5, "dx": 0.5, "dy": 0.5,
            "width": width, "height": height}


def owned(tile):
    """A decoded tile's owned cells as rows, border stripped."""
    side, border, size = tile["side"], tile["border"], tile["size"]
    return {field: None if tile[field] is None else
            [tile[field][(border + row) * side + border:(border + row) * side + border + size]
             for row in range(size)] for field in f5tile.FIELDS}


class OverviewTests(unittest.TestCase):
    def test_an_overview_is_the_mean_of_the_cells_that_are_there(self):
        grid = small_grid(4, 4)
        u = [1.0, 3.0, None, None,
             5.0, None, None, None,
             0.1, 0.2, -0.1, -0.2,
             0.0, 0.1, -0.1, -0.2]
        v = [2.0, 2.0, 4.0, None,
             2.0, 2.0, None, None,
             1.0, 1.0, 1.0, 1.0,
             1.0, 1.0, 1.0, 1.0]
        spec, tiles = f5tile.build_pyramid(grid, u, v, None, 0, "2026101100", size=2)
        self.assertEqual([level["level"] for level in spec], [0, 1])
        tile = f5tile.decode_tile(next(data for level, *_, data in tiles if level == 1))
        cells = owned(tile)
        # u and v each over the cells present: (1+3+5)/3, nothing at all, then
        # 0.4/4 = 0.1 and -0.6/4 = -0.15, which rounds away from zero.
        self.assertEqual(cells["u"], [[3.0, None], [0.1, -0.2]])
        self.assertEqual(cells["v"], [[2.0, 4.0], [1.0, 1.0]])
        self.assertIsNone(cells["gust"])

    def test_a_coarser_level_averages_native_cells_not_means_of_means(self):
        """Level 2 of a 4×4 block with three cells in one corner and one elsewhere.

        Means of the level-1 means would weigh the lone cell as heavily as the
        three; the overview counts native cells, so it does not depend on how the
        levels were built.
        """
        grid = {"west": -180.0, "north": 90.0, "dx": 0.5, "dy": 0.5, "width": 4, "height": 4}
        u = [None] * 16
        u[0], u[1], u[4] = 1.0, 1.0, 1.0
        u[15] = 9.0
        v = [0.0] * 16
        spec, tiles = f5tile.build_pyramid(grid, u, v, None, 0, "2026101100", size=1)
        self.assertEqual(spec[-1]["level"], 2)
        top = f5tile.decode_tile(next(data for level, *_, data in tiles if level == 2))
        self.assertEqual(owned(top)["u"], [[3.0]])  # (1+1+1+9)/4, not (1+9)/2.

    def test_an_overview_of_a_ragged_edge_uses_the_cells_inside_the_domain(self):
        # An odd lattice origin: the first level-1 cell holds one native column.
        grid = {"west": -180.0 + 0.5, "north": 90.0, "dx": 0.5, "dy": 0.5, "width": 3,
                "height": 2}
        u = [1.0, 2.0, 4.0, 3.0, 4.0, 8.0]
        spec, tiles = f5tile.build_pyramid(grid, u, [0.0] * 6, None, 0, "2026101100", size=2)
        self.assertEqual(spec[1]["columns"], [0, 1])
        top = f5tile.decode_tile(next(data for level, *_, data in tiles if level == 1))
        self.assertEqual(owned(top)["u"], [[2.0, 4.5], [None, None]])


class BorderTests(unittest.TestCase):
    def test_every_stored_cell_agrees_with_every_other_copy_of_it(self):
        """Borders are the neighbours' owned cells, so all copies of a cell agree.

        A border cell that no written tile owns lies in a skipped tile, or
        outside the domain, so it must be missing in every field.
        """
        for case in (regional(), global_grid()):
            spec, tiles = build(case)
            size, border = case["size"], case["border"]
            wraps = f5tile.around(case["grid"])
            for level in spec:
                copies, owners = {}, {}
                for _, x, y, data in (t for t in tiles if t[0] == level["level"]):
                    decoded = f5tile.decode_tile(data)
                    side = decoded["side"]
                    for index in range(side * side):
                        row, column = divmod(index, side)
                        key = (x * size - border + column, y * size - border + row)
                        if wraps:
                            key = (key[0] % -(-wraps >> level["level"]), key[1])
                        cell = tuple(None if decoded[field] is None else decoded[field][index]
                                     for field in f5tile.FIELDS)
                        if border <= row < border + size and border <= column < border + size:
                            owners[key] = cell
                        copies.setdefault(key, []).append(cell)
                for key, found in copies.items():
                    expected = owners.get(key, (None, None, None))
                    with self.subTest(case["name"], level=level["level"], cell=key):
                        self.assertEqual(set(found), {expected})

    def test_a_border_is_the_neighbouring_tiles_edge(self):
        case = regional()
        _, tiles = build(case)
        decoded = {(level, x, y): f5tile.decode_tile(data) for level, x, y, data in tiles}
        west, east = decoded[(0, 86, 18)], decoded[(0, 87, 18)]
        side, size = west["side"], west["size"]
        for row in range(side):
            # The west tile's east border is the east tile's first owned column, and
            # the east tile's west border is the west tile's last owned column.
            self.assertEqual(west["u"][row * side + size + 1], east["u"][row * side + 1])
            self.assertEqual(east["u"][row * side], west["u"][row * side + size])
        north, south = decoded[(0, 86, 17)], decoded[(0, 86, 18)]
        self.assertEqual(north["v"][(size + 1) * side:], south["v"][side:2 * side])
        self.assertEqual(south["v"][:side], north["v"][size * side:(size + 1) * side])

    def test_a_regional_grid_does_not_wrap(self):
        grid = {"west": -180.0, "north": 0.0, "dx": 10.0, "dy": 10.0, "width": 3, "height": 2}
        _, tiles = f5tile.build_pyramid(grid, [1.0] * 6, [2.0] * 6, None, 0, "2026101100",
                                        size=4)
        tile = f5tile.decode_tile(tiles[0][3])
        self.assertEqual(tile["u"][tile["side"]], None)  # West of -180 is not 170° E.


class WrapTests(unittest.TestCase):
    def test_a_global_grid_wraps_at_the_date_line(self):
        case = global_grid()
        spec, tiles = build(case)
        self.assertEqual([(level["x"], level["columns"]) for level in spec],
                         [([0, 1], [0, 7]), ([0, 0], [0, 3])])
        decoded = {(level, x, y): f5tile.decode_tile(data) for level, x, y, data in tiles}
        west, east = decoded[(0, 0, 0)], decoded[(0, 1, 0)]
        side = west["side"]
        u = case["source"]["u"]
        # Tile 0's west border is the last column, 135° E; tile 1's east border
        # is the first, 180° W. Stored row 2 is native row 1 (row 0 is 90° N).
        self.assertEqual(west["u"][2 * side], u[0 * 8 + 7])
        self.assertEqual(east["u"][2 * side + side - 1], u[0 * 8 + 0])
        top = decoded[(1, 0, 0)]
        self.assertEqual(top["u"][1 * top["side"]], top["u"][1 * top["side"] + 4])

    def test_a_sample_across_the_date_line_reads_both_sides(self):
        case = global_grid()
        _, tiles = build(case)
        read, grid = lookup(tiles), case["grid"]
        # Halfway from 135° E to 180°: the mean of the last and first columns.
        result = f5tile.sample(read, grid, 0, 60.0, 157.5, size=4)
        self.assertAlmostEqual(result["u"], (case["source"]["u"][7] + case["source"]["u"][0]) / 2)
        self.assertEqual(f5tile.tile_of(grid, 0, 60.0, 157.5, 4), (1, 0))
        # And a longitude given the other way round is the same place.
        self.assertEqual(f5tile.sample(read, grid, 0, 45.0, -200.0, size=4),
                         f5tile.sample(read, grid, 0, 45.0, 160.0, size=4))


def frame_values(grid, source):
    """A whole frame as the browser and the archiver read it: f5bin's own round trip."""
    payload = {"run": "2026091712", "hour": 0, "grid": grid, **source}
    return f5bin.decode_frame(f5bin.encode_frame(payload))


def noisy_field(grid, seed=7):
    """A smooth field with noise, for grids too big to write out by hand."""
    random = np.random.default_rng(seed)
    rows, columns = np.mgrid[0:grid["height"], 0:grid["width"]]
    u = 9 * np.sin(columns / 37) + 4 * np.cos(rows / 23) + random.normal(0, 0.6, rows.shape)
    v = -5 + 7 * np.cos(columns / 29 + rows / 41) + random.normal(0, 0.6, rows.shape)
    gust = np.hypot(u, v) * 1.35 + 1 + np.abs(random.normal(0, 0.4, rows.shape))
    return {"u": u.ravel().round(2).tolist(), "v": v.ravel().round(2).tolist(),
            "gust": gust.ravel().round(2).tolist()}


class SamplingTests(unittest.TestCase):
    def assert_level_zero_matches_the_frame(self, grid, source, size, lats, lons):
        frame = frame_values(grid, source)
        _, tiles = f5tile.build_pyramid(grid, source["u"], source["v"], source["gust"], 0,
                                        "2026091712", size=size)
        read = lookup(tiles)
        compared = 0
        for lat in lats:
            for lon in lons:
                whole = {field: sample_point(grid, frame[field], lon, lat)
                         for field in ("u", "v", "gust")}
                tiled = f5tile.sample(read, grid, 0, lat, lon, size=size)
                with self.subTest(lat=lat, lon=lon):
                    if whole["u"] is None or whole["v"] is None:
                        self.assertIsNone(tiled)
                        continue
                    compared += 1
                    # Exactly equal, not nearly: same corner, weights and arithmetic.
                    self.assertEqual(tiled, whole)
        return compared

    def test_level_zero_is_the_whole_frame_sampler_everywhere(self):
        case = regional()
        grid = case["grid"]
        # Every quarter cell from outside the west edge to outside the east,
        # which lands on every grid point, every cell middle and every tile edge.
        lats = [grid["north"] + 0.2 - i * grid["dy"] / 4 for i in range(4 * 14 + 4)]
        lons = [grid["west"] - 0.2 + i * grid["dx"] / 4 for i in range(4 * 20 + 4)]
        compared = self.assert_level_zero_matches_the_frame(grid, case["source"], 8, lats, lons)
        self.assertGreater(compared, 3000)

    def test_level_zero_matches_on_harmonie_tile_edges(self):
        grid = with_edges(HARMONIE)
        source = noisy_field(grid)
        # Tile edges at 128-cell steps, the grid's own edges, and points just off them.
        edge_lons = [-180 + c * 0.025 for c in (6764, 6784, 6911, 6912, 6913, 7039, 7040, 6996)]
        edge_lats = [90 - r * 0.02 for r in (1715, 1791, 1792, 1793, 1919, 1920, 1950)]
        lons = [lon + d for lon in edge_lons for d in (-0.0125, -1e-9, 0, 1e-9, 0.0125)]
        lats = [lat + d for lat in edge_lats for d in (-0.01, -1e-9, 0, 1e-9, 0.01)]
        random = np.random.default_rng(3)
        lons += (grid["west"] + random.random(40) * (grid["east"] - grid["west"])).tolist()
        lats += (grid["south"] + random.random(40) * (grid["north"] - grid["south"])).tolist()
        self.assertGreater(
            self.assert_level_zero_matches_the_frame(grid, source, 128, lats, lons), 3000)

    def test_an_overview_samples_the_mean_at_its_cells_centre(self):
        grid = {"west": -180.0, "north": 90.0, "dx": 1.0, "dy": 1.0, "width": 4, "height": 4}
        u = [float(column) for row in range(4) for column in range(4)]
        _, tiles = f5tile.build_pyramid(grid, u, [0.0] * 16, None, 0, "2026101100", size=1)
        read = lookup(tiles)
        # Level-1 cell 0 averages columns 0 and 1, so 0.5 sits at native column 0.5.
        for lon in (-179.5, -179.0, -178.0, -177.5):
            with self.subTest(lon=lon):
                self.assertAlmostEqual(f5tile.sample(read, grid, 1, 89.5, lon, size=1)["u"],
                                       lon + 180)
        # Outside the centres of the edge cells the overview has nothing to say.
        self.assertIsNone(f5tile.sample(read, grid, 1, 89.5, -180.0, size=1))

    def test_outside_the_domain_or_in_a_skipped_tile_is_nothing(self):
        case = regional()
        _, tiles = build(case)
        read, grid = lookup(tiles), case["grid"]
        self.assertIsNone(f5tile.sample(read, grid, 0, 55.5, -7.0, size=8))
        self.assertIsNone(f5tile.sample(read, grid, 0, 53.0, -4.0, size=8))
        self.assertIsNone(f5tile.sample(read, grid, 0, float("nan"), -7.0, size=8))
        self.assertEqual(f5tile.tile_of(grid, 0, 54.9, -9.4, 8), (85, 17))
        self.assertIsNone(read(0, 85, 17))
        self.assertIsNone(f5tile.sample(read, grid, 0, 54.9, -9.4, size=8))

    def test_a_lookup_that_returns_another_tile_is_a_bug(self):
        case = regional()
        _, tiles = build(case)
        wrong = f5tile.decode_tile(tiles[-1][3])
        with self.assertRaises(ValueError):
            f5tile.sample(lambda *_: wrong, case["grid"], 0, 53.0, -7.0, size=8)


class SkipTests(unittest.TestCase):
    def test_an_all_missing_frame_writes_no_tiles_but_keeps_its_ranges(self):
        grid = small_grid(4, 4)
        spec, tiles = f5tile.build_pyramid(grid, [None] * 16, [None] * 16, None, 0,
                                           "2026101100", size=2)
        self.assertEqual(tiles, [])
        self.assertEqual(spec, f5tile.levels(grid, 2))

    def test_a_tile_with_only_border_data_is_skipped(self):
        """Data in a tile's border but none in what it owns is the neighbour's, not its."""
        grid = small_grid(4, 2)
        u = [1.0, 1.0, None, None, 1.0, 1.0, None, None]
        spec, tiles = f5tile.build_pyramid(grid, u, u, None, 0, "2026101100", size=2)
        self.assertEqual(spec[0]["x"], [2, 3])
        self.assertEqual([(level, x, y) for level, x, y, _ in tiles], [(0, 2, 2), (1, 1, 1)])


def tile(level=0, x=1, y=2, hour=30, run="2026091712", size=2, border=1, with_gust=True,
         **fields):
    side = size + 2 * border
    values = {"u": [1.0] * side * side, "v": [-2.0] * side * side,
              "gust": [5.0] * side * side if with_gust else None}
    values.update(fields)
    return f5tile.encode_tile(level, x, y, hour, run, values["u"], values["v"], values["gust"],
                              size, border)


class RoundTripTests(unittest.TestCase):
    def test_a_tile_carries_its_identity(self):
        decoded = f5tile.decode_tile(tile(level=3, x=1000, y=65535, hour=360, run="2026010100"))
        self.assertEqual({key: decoded[key] for key in ("level", "x", "y", "hour", "run", "size",
                                                        "border", "side", "blockCount")},
                         {"level": 3, "x": 1000, "y": 65535, "hour": 360, "run": "2026010100",
                          "size": 2, "border": 1, "side": 4, "blockCount": 3})

    def test_missing_values_and_wrapping_deltas_survive(self):
        values = [None, 150.0, -150.0, None, 0.0, None, 0.0, 12.3,
                  -0.05, 0.05, None, None, 149.9, None, -149.9, 0.0]
        decoded = f5tile.decode_tile(tile(u=values, with_gust=False))
        self.assertEqual(decoded["u"], [None, 150.0, -150.0, None, 0.0, None, 0.0, 12.3,
                                        -0.1, 0.1, None, None, 149.9, None, -149.9, 0.0])
        self.assertIsNone(decoded["gust"])

    def test_the_header_is_laid_out_as_documented(self):
        data = tile(level=2, x=13, y=3, hour=42, size=128, border=1)
        self.assertEqual(data[:4], b"F5T1")
        self.assertEqual(struct.unpack_from("<BBBBHHHIHH", data, 4),
                         (1, 3, 2, 1, 128, 10, 42, 2026091712, 13, 3))
        self.assertEqual(data[22:24], b"\0\0")
        self.assertEqual(len(data), 24 + 3 * 130 * 130 * 2)


class RefusalTests(unittest.TestCase):
    def test_a_truncated_or_oversized_buffer_is_refused(self):
        data = tile()
        for broken in (data[:-2], data[:f5tile.HEADER_BYTES], data + b"\0\0", b""):
            with self.subTest(length=len(broken)), self.assertRaises(ValueError):
                f5tile.decode_tile(broken)

    def test_a_foreign_or_future_file_is_refused(self):
        data = tile()
        cases = {"magic": (0, b"F5F1"), "version": (4, bytes([2])), "blocks": (5, bytes([4])),
                 "scale": (10, struct.pack("<H", 100)), "size": (8, struct.pack("<H", 0)),
                 "reserved": (22, b"\0\1")}
        for name, (offset, replacement) in cases.items():
            broken = bytearray(data)
            broken[offset:offset + len(replacement)] = replacement
            with self.subTest(name), self.assertRaises(ValueError):
                f5tile.decode_tile(bytes(broken))
        # A whole frame is not a tile, however plausible its bytes.
        frame = f5bin.encode_frame({"run": "2026091712", "hour": 0,
                                    "grid": {"width": 4, "height": 4},
                                    "u": [0.0] * 16, "v": [0.0] * 16, "gust": None})
        with self.assertRaises(ValueError):
            f5tile.decode_tile(frame)

    def test_implausible_values_are_refused_by_both_ends(self):
        for field, value in (("u", 151.0), ("gust", -1.0)):
            with self.subTest(field), self.assertRaises(ValueError):
                tile(**{field: [value] * 16})
        data = bytearray(tile(with_gust=False))
        struct.pack_into("<h", data, f5tile.HEADER_BYTES, 1501)
        with self.assertRaises(ValueError):
            f5tile.decode_tile(bytes(data))

    def test_an_identity_that_does_not_fit_is_refused(self):
        for change in ({"level": 256}, {"x": -1}, {"y": 65536}, {"hour": 70000},
                       {"run": "2026-09-17"}, {"run": 2026091712}, {"border": 256},
                       {"size": 0}):
            with self.subTest(change), self.assertRaises(ValueError):
                tile(**change)

    def test_a_field_of_the_wrong_length_is_refused(self):
        with self.assertRaises(ValueError):
            tile(u=[1.0] * 15)
        with self.assertRaises(ValueError):
            f5tile.build_pyramid(HARMONIE, [0.0] * 10, [0.0] * 10, None, 0, "2026091712")


class WriteTests(unittest.TestCase):
    def test_a_pyramid_is_written_with_sidecars_and_hashes(self):
        import brotli
        case = regional()
        source = case["source"]
        with tempfile.TemporaryDirectory() as temp:
            spec, written = f5tile.write_pyramid(temp, case["grid"], source["u"], source["v"],
                                                 source["gust"], case["hour"], case["run"],
                                                 case["size"], sidecars=True)
            self.assertEqual(spec, f5tile.levels(case["grid"], case["size"]))
            self.assertEqual(len(written), 12)
            self.assertIn("t/0/86/18/042.bin", written)
            self.assertNotIn("t/0/85/17/042.bin", written)
            for path, digest in written.items():
                data = (Path(temp) / path).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
                self.assertEqual(brotli.decompress((Path(temp) / (path + ".br")).read_bytes()),
                                 data)
            files = sorted(str(p.relative_to(temp)) for p in Path(temp).rglob("*") if p.is_file())
            self.assertEqual(len(files), 3 * 12)  # No .tmp left behind.


if __name__ == "__main__":
    if "--write-golden" in sys.argv:
        write_golden()
        print(f"Wrote {GOLDEN}")
    else:
        unittest.main()
