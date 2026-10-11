import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
// The Node writer the sample generator uses, held to the Python writer byte for
// byte by tests/f5tile-writer.test.ts: here it is the server.
import { buildPyramid } from "../../scripts/f5tile.mjs";
import {
  decodeTile,
  decodeTileValues,
  sampleTile,
  tileLevels,
  tilesCovering,
  type Tile,
} from "./f5tile";
import {
  TILE_CACHE_SIZE,
  TiledField,
  WASH_STEP,
  chooseLevel,
  clearTileCache,
  loadFrame,
  mapView,
  samplePoint,
  setMapView,
  tileCacheSize,
  type MapView,
} from "./tiledField";
import { tilesFor } from "./testing";
import { sample, type Grid, type Manifest } from "./weather";

/* ---- a run, served ---- */

type Values = (number | null)[];
interface Source {
  u: Values;
  v: Values;
  gust: Values | null;
}

const RUN = "2026091712";
const RUN_TIME = "2026-09-17T12:00:00Z";
const at = (hour: number) =>
  new Date(Date.parse(RUN_TIME) + hour * 3600000)
    .toISOString()
    .replace(".000", "");

/**
 * A wind run on `grid`, published as tiles of `size` by the Node writer, and a
 * fetch that serves them at the URLs the site asks for. Every URL asked is
 * recorded; `hold` keeps every request pending until released.
 */
function serve(
  grid: Grid,
  hours: number[],
  field: (hour: number) => Source,
  {
    size = 128,
    model = "golden",
    hold = false,
    run = RUN,
  }: { size?: number; model?: string; hold?: boolean; run?: string } = {},
) {
  const files = new Map<string, Buffer>();
  const base = `${model}-${RUN}-test-v1-0a0b0c0d/`;
  const absent = new Map<number, Set<string>>();
  const counts = new Map<string, number>();
  for (const hour of hours) {
    const { tiles } = buildPyramid(grid, field(hour), hour, run, {
      size,
      keepEmpty: true,
    });
    for (const tile of tiles) {
      files.set(
        `/weather/${base}t/${tile.level}/${tile.x}/${tile.y}/${String(hour).padStart(3, "0")}.bin`,
        tile.bytes,
      );
      // Absent: every cell it owns is missing at every hour.
      const key = `${tile.level}/${tile.x}/${tile.y}`;
      counts.set(key, (counts.get(key) ?? 0) + (owned(tile.bytes) ? 1 : 0));
    }
  }
  for (const [key, count] of counts)
    if (!count) {
      const [level, x, y] = key.split("/").map(Number);
      if (!absent.has(level)) absent.set(level, new Set());
      absent.get(level)!.add(`${x}/${y}`);
    }
  const frames = hours.map((hour) => ({
    hour,
    validTime: at(hour),
    gustIntervalHours: field(hour).gust
      ? ([Math.max(0, hour - 1), hour] as [number, number])
      : null,
  }));
  const absentPairs = Object.fromEntries(
    [...absent].map(([level, set]) => [
      level,
      [...set]
        .map((pair) => pair.split("/").map(Number) as [number, number])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    ]),
  );
  for (const [level, pairs] of Object.entries(absentPairs))
    for (const [x, y] of pairs)
      for (const hour of hours)
        files.delete(
          `/weather/${base}t/${level}/${x}/${y}/${String(hour).padStart(3, "0")}.bin`,
        );
  const manifest = {
    schemaVersion: 2,
    model,
    modelName: model,
    provider: "test",
    run,
    runTime: RUN_TIME,
    generatedAt: RUN_TIME,
    resolutionKm: 2,
    stepHours: 1,
    grid,
    tiles: tilesFor(grid, frames, { size, absent: absentPairs }),
    base,
    frames,
    spots: {
      squareDegrees: 2,
      url: "spots/{square}.json",
      squares: [],
      keys: [],
    },
    sourceUrl: "https://example.test/",
    attribution: "Test",
    licenseUrl: "https://example.test/",
  } as Manifest;
  const asked: string[] = [];
  const waiting: (() => void)[] = [];
  const fetcher = vi.fn(async (input: string) => {
    const path = new URL(String(input), "http://site.test").pathname;
    asked.push(path);
    if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
    const body = files.get(path);
    return body
      ? new Response(new Uint8Array(body))
      : new Response("Not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  return {
    manifest,
    asked,
    fetcher,
    files,
    release: () => waiting.splice(0).forEach((resolve) => resolve()),
  };
}

/** Whether a tile owns any present cell (header then deltas, as f5tile.py lays out). */
function owned(bytes: Buffer) {
  const tile = decodeTileValues(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    {
      level: bytes.readUInt8(6),
      x: bytes.readUInt16LE(18),
      y: bytes.readUInt16LE(20),
      hour: bytes.readUInt16LE(12),
      run: String(bytes.readUInt32LE(14)),
      size: bytes.readUInt16LE(8),
      border: bytes.readUInt8(7),
      blocks: bytes.readUInt8(5) as 2 | 3,
    },
  );
  const { side, border, size } = tile;
  for (let r = border; r < border + size; r++)
    for (let c = border; c < border + size; c++)
      if (tile.u[r * side + c] !== -32768) return true;
  return false;
}

/** A grid with its east and south edges, as a manifest carries it. */
const withEdges = (grid: Omit<Grid, "east" | "south">): Grid => ({
  ...grid,
  east: grid.west + (grid.width - 1) * grid.dx,
  south: grid.north - (grid.height - 1) * grid.dy,
});

/** The stored tenths a writer keeps of a value, as the decoder gives them back. */
const stored = (values: Values) =>
  values.map((value) => {
    if (value === null) return NaN;
    const scaled = value * 10;
    return (Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5)) / 10 + 0;
  });

/** A view of the whole grid at a scale that wants this level. */
const viewAt = (
  grid: Grid,
  pxPerLon: number,
  pxPerLat = pxPerLon,
): MapView => ({
  west: grid.west - 1,
  east: grid.east + 1,
  north: grid.north + 1,
  south: grid.south - 1,
  pxPerLon,
  pxPerLat,
});
const NATIVE = 1e6; // So many pixels a degree that only level 0 is fine enough.
/** Dublin Bay zoomed in: native, one or two tiles. */
const BAY: MapView = {
  west: -6.3,
  east: -5.9,
  north: 53.45,
  south: 53.2,
  pxPerLon: 1000,
  pxPerLat: 1700,
};
const COARSEST = 0;

beforeEach(() => {
  clearTileCache();
  setMapView(null);
});
afterEach(() => vi.unstubAllGlobals());

/* ---- the golden pyramids, read through the field ---- */

const FIXTURES = new URL("../../tests/fixtures/f5tile/", import.meta.url);
interface Pyramid {
  name: string;
  grid: Grid;
  size: number;
  border: number;
  hour: number;
  run: string;
  source: Source;
}
const golden: { pyramids: Pyramid[] } = JSON.parse(
  readFileSync(new URL("golden.json", FIXTURES), "utf8"),
);

describe("a tiled field at level 0", () => {
  for (const pyramid of golden.pyramids)
    it(`samples exactly what the whole frame does: ${pyramid.name}`, async () => {
      const grid = withEdges(pyramid.grid);
      const { manifest, files } = serve(
        grid,
        [pyramid.hour],
        () => pyramid.source,
        {
          size: pyramid.size,
          run: pyramid.run,
        },
      );
      // The served tiles are the golden files, byte for byte.
      for (const [path, body] of files) {
        const golden = readFileSync(
          new URL(
            `${pyramid.name}/${path.split("/").slice(3).join("/")}`,
            FIXTURES,
          ),
        );
        expect(Buffer.compare(body, golden)).toBe(0);
      }
      const field = new TiledField(manifest, 0);
      await field.load(viewAt(grid, NATIVE));
      expect(field.level).toBe(0);
      const whole = {
        grid,
        u: stored(pyramid.source.u),
        v: stored(pyramid.source.v),
        gust: pyramid.source.gust ? stored(pyramid.source.gust) : null,
      };
      let compared = 0;
      for (let j = 0; j < 4 * grid.height + 4; j++)
        for (let i = 0; i < 4 * grid.width + 4; i++) {
          const lat = grid.north + 0.2 * grid.dy - (j * grid.dy) / 4;
          const lon = grid.west - 0.2 * grid.dx + (i * grid.dx) / 4;
          const expected = sample(whole, lon, lat);
          const tiled = field.sample(lat, lon);
          // The whole-frame sampler stops at the grid's east edge; a global
          // field's tiles wrap round it, which is the one place they may differ.
          const wraps =
            grid.width * grid.dx === 360 &&
            (lon >= grid.east || lon < grid.west);
          if (
            !expected ||
            Number.isNaN(expected.u) ||
            Number.isNaN(expected.v)
          ) {
            if (!(wraps && !expected)) expect(tiled).toBeNull();
            continue;
          }
          compared++;
          expect(tiled).toEqual({
            u: expected.u,
            v: expected.v,
            gust:
              expected.gust === null || Number.isNaN(expected.gust)
                ? null
                : expected.gust,
          });
        }
      expect(compared).toBeGreaterThan(100);
    });
});

/* ---- a HARMONIE-sized run ---- */

const HARMONIE = withEdges({
  west: -10.9,
  north: 55.7,
  dx: 0.025,
  dy: 0.02,
  width: 233,
  height: 236,
});
/** A smooth field, different each hour, with a hole in the north-west. */
function harmonie(hour: number): Source {
  const u: Values = [],
    v: Values = [],
    gust: Values = [];
  for (let row = 0; row < HARMONIE.height; row++)
    for (let column = 0; column < HARMONIE.width; column++) {
      // Rows 0-9 of columns 0-9: all missing, which empties no tile.
      const hole = row < 10 && column < 10;
      u.push(hole ? null : Math.round(80 * Math.sin(column / 17 + hour)) / 10);
      v.push(hole ? null : Math.round(60 * Math.cos(row / 13 - hour)) / 10);
      gust.push(hole ? null : 12 + ((column + row + hour) % 7));
    }
  return { u, v, gust };
}

describe("choosing a level", () => {
  const tiles = tilesFor(HARMONIE, [{ gustIntervalHours: null }]);
  const world = (zoom: number) => (512 * 2 ** zoom) / 360;
  const mercator = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  /** The view MapLibre's fitBounds gives a box in a viewport, padded 20 px. */
  function fitted(
    width: number,
    height: number,
    [[west, south], [east, north]]: [[number, number], [number, number]],
  ) {
    const padding = 20;
    const across = ((east - west) / 360) * 512;
    const down = ((mercator(north) - mercator(south)) / (2 * Math.PI)) * 512;
    const zoom = Math.log2(
      Math.min((width - 2 * padding) / across, (height - 2 * padding) / down),
    );
    return centred((west + east) / 2, (south + north) / 2, zoom, width, height);
  }
  /** The view at a centre and zoom, measured as viewOf measures it. */
  function centred(
    lng: number,
    lat: number,
    zoom: number,
    width: number,
    height: number,
  ): MapView {
    const scale = world(zoom);
    const y = (latitude: number) => (mercator(latitude) * 180) / Math.PI;
    const latAt = (yy: number) =>
      (2 * Math.atan(Math.exp((yy * Math.PI) / 180)) - Math.PI / 2) *
      (180 / Math.PI);
    const halfX = (width / 2 + width / 3) / scale;
    const halfY = (height / 2 + height / 3) / scale;
    return {
      west: lng - halfX,
      east: lng + halfX,
      north: latAt(y(lat) + halfY),
      south: latAt(y(lat) - halfY),
      pxPerLon: scale,
      pxPerLat: (y(lat + 0.5) - y(lat - 0.5)) * scale,
    };
  }
  const IRELAND: [[number, number], [number, number]] = [
    [-10.75, 51.38],
    [-5.42, 55.42],
  ];

  it("gives a phone showing all of Ireland HARMONIE's level 1", () => {
    const view = fitted(390, 844, IRELAND);
    expect(chooseLevel(tiles, view)).toBe(1);
    // Level 1's cells are under the wash's step there; level 2's are not.
    expect(0.04 * view.pxPerLat).toBeLessThanOrEqual(WASH_STEP);
    expect(0.08 * view.pxPerLat).toBeGreaterThan(WASH_STEP);
  });

  it("gives a desktop showing all of Ireland the native grid", () => {
    expect(chooseLevel(tiles, fitted(1440, 900, IRELAND))).toBe(0);
  });

  it("gives a bay the native grid, from one or two tiles", () => {
    const bay = centred(-6.1, 53.33, 10, 390, 844);
    expect(chooseLevel(tiles, bay)).toBe(0);
    const covering = tilesCovering(HARMONIE, tiles.levels[0], bay);
    expect(covering.length).toBeGreaterThanOrEqual(1);
    expect(covering.length).toBeLessThanOrEqual(2);
  });

  it("is never finer than native, and the coarsest a view at no scale at all", () => {
    expect(chooseLevel(tiles, { pxPerLon: 1e9, pxPerLat: 1e9 })).toBe(0);
    expect(chooseLevel(tiles, { pxPerLon: 0, pxPerLat: 0 })).toBe(2);
  });

  it("measures the cell's taller side: HARMONIE's rows are the coarser on screen", () => {
    // 0.025° across but 0.02° down, which at 53° N is 0.033° of screen.
    expect(chooseLevel(tiles, { pxPerLon: 100, pxPerLat: 166 })).toBe(0);
    expect(chooseLevel(tiles, { pxPerLon: 100, pxPerLat: 100 })).toBe(1);
  });
});

describe("loading tiles for a view", () => {
  it("loads only the tiles covering the view, at its level", async () => {
    const { manifest, asked } = serve(HARMONIE, [0, 1], harmonie);
    const field = new TiledField(manifest, 0);
    // A phone's all-Ireland scale: level 1, all four of its tiles.
    await field.load(viewAt(HARMONIE, 66, 110));
    expect(field.level).toBe(1);
    expect(asked.map((url) => url.split("/t/")[1]).sort()).toEqual([
      "1/26/6/000.bin",
      "1/26/7/000.bin",
      "1/27/6/000.bin",
      "1/27/7/000.bin",
    ]);
    // Zoomed into Dublin Bay: native, and only what covers the bay.
    asked.length = 0;
    const bay = {
      west: -6.3,
      east: -5.9,
      north: 53.45,
      south: 53.2,
      pxPerLon: 1000,
      pxPerLat: 1700,
    };
    expect(field.want(bay).tiles).toEqual(
      tilesCovering(HARMONIE, manifest.tiles!.levels[0], bay),
    );
    await field.load(bay);
    // The native tiles covering the bay, and the coarsest level's one tile as a
    // base under them.
    const native = asked.filter((url) => url.includes("/t/0/"));
    expect(native.length).toBe(field.want(bay).tiles.length);
    expect(native.length).toBeLessThanOrEqual(2);
    expect(
      asked
        .filter((url) => !url.includes("/t/0/"))
        .map((url) => url.split("/t/")[1]),
    ).toEqual(["2/13/3/000.bin"]);
  });

  it("never asks for a tile the manifest lists as absent", async () => {
    // Tiles of 8 cells, so a hole of 10 × 10 in the north-west empties one.
    const grid = withEdges({
      west: -11,
      north: 56,
      dx: 0.5,
      dy: 0.4,
      width: 20,
      height: 12,
    });
    const field = (hour: number): Source => {
      const u: Values = [],
        v: Values = [];
      for (let row = 0; row < grid.height; row++)
        for (let column = 0; column < grid.width; column++) {
          const empty = column < 14 && row < 10;
          u.push(empty ? null : 1 + hour);
          v.push(empty ? null : -2);
        }
      return { u, v, gust: null };
    };
    const { manifest, asked } = serve(grid, [0, 1], field, { size: 8 });
    const level0 = manifest.tiles!.levels[0];
    expect(level0.absent.length).toBeGreaterThan(0);
    const tiled = new TiledField(manifest, 1);
    const view = viewAt(grid, NATIVE);
    const wanted = tiled.want(view).tiles;
    for (const [x, y] of level0.absent)
      expect(wanted).not.toContainEqual({ x, y });
    await tiled.load(view);
    for (const [x, y] of level0.absent)
      expect(asked.some((url) => url.includes(`/t/0/${x}/${y}/`))).toBe(false);
    // Inside an absent tile there is no wind, and no request is made for it.
    const [x, y] = level0.absent[0];
    const inside = {
      lat: 90 - (y * 8 + 3) * grid.dy,
      lon: -180 + (x * 8 + 3) * grid.dx,
    };
    expect(tiled.sample(inside.lat, inside.lon)).toBeNull();
    expect(await samplePoint(manifest, 1, inside.lat, inside.lon)).toBeNull();
    // Elsewhere there is.
    expect(tiled.sample(grid.south + 0.2, grid.east - 0.3)).toEqual({
      u: 2,
      v: -2,
      gust: null,
    });
  });

  it("shares requests in flight and the decoded tiles between frames", async () => {
    const { manifest, fetcher } = serve(HARMONIE, [0], harmonie);
    const view = viewAt(HARMONIE, COARSEST);
    await Promise.all([
      new TiledField(manifest, 0).load(view),
      new TiledField(manifest, 0).load(view),
      loadFrame(manifest, 0),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // A new field for the same hour starts with what the cache holds.
    const again = new TiledField(manifest, 0);
    expect(again.request(view)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the most recently used tiles and lets the oldest go", async () => {
    // Tiles of 16: HARMONIE's native level is 15 × 15 tiles, more than the cache.
    const { manifest, fetcher } = serve(HARMONIE, [0], harmonie, { size: 16 });
    const field = new TiledField(manifest, 0);
    const level0 = manifest.tiles!.levels[0];
    const count =
      (level0.x[1] - level0.x[0] + 1) * (level0.y[1] - level0.y[0] + 1);
    expect(count).toBeGreaterThan(TILE_CACHE_SIZE);
    // Without the coarsest tile under them, so only the native ones are counted.
    await field.load(viewAt(HARMONIE, NATIVE), { base: false });
    expect(tileCacheSize()).toBe(TILE_CACHE_SIZE);
    expect(fetcher).toHaveBeenCalledTimes(count);
    // The field already holds them all, so it draws on regardless...
    expect(field.sample(53, -8)).not.toBeNull();
    // ...but a new frame of the same hour has to fetch the evicted ones again.
    await new TiledField(manifest, 0).load(viewAt(HARMONIE, NATIVE), {
      base: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2 * count - TILE_CACHE_SIZE);
  });

  it("never lets the next hour push out the tiles the view on screen draws from", async () => {
    // Tiles of 16, and a native view of more than half the cache's worth.
    const { manifest, fetcher } = serve(HARMONIE, [0, 1], harmonie, {
      size: 16,
    });
    const view: MapView = {
      west: -9.6,
      east: -5.6,
      north: 55.2,
      south: 52.2,
      pxPerLon: NATIVE,
      pxPerLat: NATIVE,
    };
    const shown = new TiledField(manifest, 0);
    const wanted = shown.want(view).tiles.length;
    expect(wanted).toBeGreaterThan(TILE_CACHE_SIZE / 2);
    await shown.load(view);
    // The next hour, prefetched for the same view, as the map does.
    await new TiledField(manifest, 1).load(view, { base: false });
    const asked = fetcher.mock.calls.length;
    // Back to the hour on screen, or a new frame of it: every tile still there.
    expect(new TiledField(manifest, 0).request(view)).toBeNull();
    // And the next hour's too: the cache made room for both.
    expect(new TiledField(manifest, 1).request(view, { base: false })).toBeNull();
    expect(fetcher.mock.calls.length).toBe(asked);
    expect(tileCacheSize()).toBeGreaterThan(TILE_CACHE_SIZE);
    expect(tileCacheSize()).toBeLessThanOrEqual(2 * wanted + 1);
  });

  it("reads through the cache for a bare point, without filling it", async () => {
    const { manifest, fetcher } = serve(HARMONIE, [0, 1, 2], harmonie);
    for (const index of [0, 1, 2])
      await samplePoint(manifest, index, 53.3, -6.1, { keep: false });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(tileCacheSize()).toBe(0);
  });

  it("refuses a tile served under another tile's name", async () => {
    const { manifest, files } = serve(HARMONIE, [0], harmonie);
    const base = `/weather/${manifest.base}t/2/13/3/`;
    files.set(
      `${base}000.bin`,
      files.get(`/weather/${manifest.base}t/1/26/6/000.bin`)!,
    );
    await expect(loadFrame(manifest, 0)).rejects.toThrow(
      /not the one requested/,
    );
  });

  it("treats a listed tile that is not there as the error it is", async () => {
    const { manifest, files } = serve(HARMONIE, [0], harmonie);
    files.delete(`/weather/${manifest.base}t/2/13/3/000.bin`);
    await expect(loadFrame(manifest, 0)).rejects.toThrow(/could not be loaded/);
  });

  it("loads the frame for the map's view once there is one", async () => {
    const { manifest, asked } = serve(HARMONIE, [0], harmonie);
    // No view yet: the whole grid at its coarsest, one tile.
    expect(mapView()).toBeNull();
    const frame = await loadFrame(manifest, 0);
    expect(asked.map((url) => url.split("/t/")[1])).toEqual(["2/13/3/000.bin"]);
    expect(frame.field.level).toBe(2);
    expect(frame.gustIntervalHours).toEqual([0, 0]);
    // With a view, its tiles.
    asked.length = 0;
    setMapView(viewAt(HARMONIE, 66, 110));
    expect((await loadFrame(manifest, 0)).field.level).toBe(1);
    expect(asked).toHaveLength(4);
  });
});

describe("drawing while tiles load", () => {
  it("draws from a coarser level until the wanted one arrives", async () => {
    const served = serve(HARMONIE, [0], harmonie);
    const field = new TiledField(served.manifest, 0);
    await field.load(viewAt(HARMONIE, COARSEST));
    const coarse = field.sample(53.3, -8.2);
    expect(coarse).not.toBeNull();
    // Zoom in: level 0 is asked for and held back.
    served.fetcher.mockClear();
    const top = decodeTile(
      new Uint8Array(
        served.files.get(`/weather/${served.manifest.base}t/2/13/3/000.bin`)!,
      ).buffer as ArrayBuffer,
      {
        level: 2,
        x: 13,
        y: 3,
        hour: 0,
        run: RUN,
        size: 128,
        border: 1,
        blocks: 3,
      },
    );
    vi.stubGlobal(
      "fetch",
      () => new Promise<Response>(() => {}), // Never arrives.
    );
    const pending = field.request(viewAt(HARMONIE, NATIVE));
    expect(pending).not.toBeNull();
    expect(field.level).toBe(0);
    // The screen does not go blank: the level-2 tile answers, exactly as itself.
    expect(field.sample(53.3, -8.2)).toEqual(
      sampleTile(top, HARMONIE, 53.3, -8.2),
    );
  });

  it("falls back to a finer tile along the edge an overview cannot reach, else nothing", async () => {
    const served = serve(HARMONIE, [0], harmonie);
    const field = new TiledField(served.manifest, 0);
    // A point inside the grid's last row of cells: level 2's values stop at the
    // centres of its edge cells, a cell and a half of native rows short of it.
    const lat = HARMONIE.south + 0.01;
    const lon = -8;
    await field.load(viewAt(HARMONIE, COARSEST));
    expect(field.level).toBe(2);
    expect(field.sample(lat, lon)).toBeNull(); // Only level 2 loaded: missing.
    await field.load(viewAt(HARMONIE, NATIVE));
    field.request(viewAt(HARMONIE, COARSEST)); // Want level 2 again.
    expect(field.level).toBe(2);
    const native = field.sample(lat, lon);
    expect(native).not.toBeNull();
    // It is level 0's value, the whole frame's.
    const whole = { grid: HARMONIE, ...harmonie(0) };
    const expected = sample(
      {
        grid: HARMONIE,
        u: stored(whole.u),
        v: stored(whole.v),
        gust: stored(whole.gust!),
      },
      lon,
      lat,
    )!;
    expect(native).toEqual(expected);
  });

  it("bumps its version as tiles arrive, so a painter knows to paint again", async () => {
    const { manifest } = serve(HARMONIE, [0], harmonie);
    const field = new TiledField(manifest, 0);
    const before = field.version;
    await field.load(viewAt(HARMONIE, 66, 110));
    expect(field.version).toBeGreaterThan(before);
    const loaded = field.version;
    expect(field.request(viewAt(HARMONIE, 66, 110))).toBeNull();
    expect(field.version).toBe(loaded);
  });

  it("keeps the coarsest tile under a native view, so a zoom out is never blank", async () => {
    const served = serve(HARMONIE, [0, 1], harmonie);
    const field = new TiledField(served.manifest, 0);
    await field.load(BAY);
    await vi.waitFor(() =>
      expect(served.asked.map((url) => url.split("/t/")[1])).toContain(
        "2/13/3/000.bin",
      ),
    );
    await vi.waitFor(() => expect(tileCacheSize()).toBe(served.asked.length));
    // Out to all of Ireland, with nothing arriving: Kerry is in none of the
    // bay's native tiles, and is drawn from the base rather than left blank.
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    expect(field.request(viewAt(HARMONIE, 66, 110))).not.toBeNull();
    expect(field.level).toBe(1);
    expect(field.sample(52.2, -9.8)).not.toBeNull();
  });

  it("adds no base at a coarse level, nor to a frame not yet shown", async () => {
    const { manifest, asked } = serve(HARMONIE, [0, 1], harmonie);
    const field = new TiledField(manifest, 0);
    await field.load(viewAt(HARMONIE, 66, 110));
    expect(asked.every((url) => url.includes("/t/1/"))).toBe(true);
    asked.length = 0;
    field.prefetchNext(BAY);
    await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      asked.every((url) => url.includes("/t/0/") && url.endsWith("/001.bin")),
    ).toBe(true);
    clearTileCache();
    asked.length = 0;
    setMapView(BAY);
    await loadFrame(manifest, 1, { base: false });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((url) => url.includes("/t/0/"))).toBe(true);
  });

  it("prefetches the next hour's tiles for the same view", async () => {
    const { manifest, asked } = serve(HARMONIE, [0, 1], harmonie);
    const field = new TiledField(manifest, 0);
    const view = viewAt(HARMONIE, 66, 110);
    await field.load(view);
    asked.length = 0;
    field.prefetchNext(view);
    await vi.waitFor(() => expect(tileCacheSize()).toBe(8));
    expect(asked.every((url) => url.endsWith("/001.bin"))).toBe(true);
    expect(asked).toHaveLength(4);
  });
});

describe("a bare point's series", () => {
  it("reads one native tile an hour and gives the whole frame's values", async () => {
    const hours = [0, 1, 2, 3];
    const { manifest, asked } = serve(HARMONIE, hours, harmonie);
    const point = { lat: 53.31, lon: -6.07 };
    for (const [index, hour] of hours.entries()) {
      const wind = await samplePoint(manifest, index, point.lat, point.lon, {
        keep: false,
      });
      const source = harmonie(hour);
      expect(wind).toEqual(
        sample(
          {
            grid: HARMONIE,
            u: stored(source.u),
            v: stored(source.v),
            gust: stored(source.gust!),
          },
          point.lon,
          point.lat,
        ),
      );
    }
    expect(asked).toHaveLength(hours.length);
    expect(asked.every((url) => url.includes("/t/0/"))).toBe(true);
    // Off the grid there is nothing, and nothing is fetched.
    asked.length = 0;
    expect(await samplePoint(manifest, 0, 40, -6)).toBeNull();
    expect(asked).toHaveLength(0);
  });
});

describe("decoding a tile", () => {
  it("takes well under a millisecond for HARMONIE's 130 × 130 × 3", () => {
    const { tiles } = buildPyramid(HARMONIE, harmonie(0), 0, RUN);
    const tile = tiles.find((entry: { level: number }) => entry.level === 0)!;
    const buffer = new Uint8Array(tile.bytes).buffer as ArrayBuffer;
    const request = {
      level: 0,
      x: tile.x,
      y: tile.y,
      hour: 0,
      run: RUN,
      size: 128,
      border: 1,
      blocks: 3 as const,
    };
    for (let i = 0; i < 20; i++) decodeTileValues(buffer, request); // Warm up.
    const rounds = 200;
    const start = performance.now();
    for (let i = 0; i < rounds; i++) decodeTileValues(buffer, request);
    const each = (performance.now() - start) / rounds;
    console.info(`Decoding one 130 × 130 × 3 tile: ${each.toFixed(3)} ms`);
    // A generous bound for a slow CI machine; it measures about 0.1 ms.
    expect(each).toBeLessThan(5);
  });

  it("keeps a tile in a quarter of the memory of its float form", () => {
    const { tiles } = buildPyramid(HARMONIE, harmonie(0), 0, RUN);
    const bytes = tiles[0].bytes as Buffer;
    const request = {
      level: tiles[0].level,
      x: tiles[0].x,
      y: tiles[0].y,
      hour: 0,
      run: RUN,
      size: 128,
      border: 1,
      blocks: 3 as const,
    };
    const buffer = new Uint8Array(bytes).buffer as ArrayBuffer;
    const values = decodeTileValues(buffer, request);
    const floats: Tile = decodeTile(buffer, request);
    expect(values.u.byteLength * 4).toBe(floats.u.byteLength);
    expect(tileLevels(HARMONIE).length).toBe(3);
  });
});
