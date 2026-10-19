import { describe, it, expect } from "vitest";
import {
  compass,
  convert,
  direction,
  freshness,
  nearestFrame,
  sample,
  validateFrame,
  validateManifest,
  windColor,
  type GridFrame,
  type Manifest,
} from "./weather";
import { tilesFor } from "./testing";

const grid = {
  width: 2,
  height: 2,
  west: -10,
  east: -9,
  north: 54,
  south: 53,
  dx: 1,
  dy: 1,
};
const frame: GridFrame = {
  model: "icon-eu",
  run: "2026091306",
  hour: 0,
  validTime: "2026-09-13T06:00:00Z",
  grid,
  u: [0, 10, 20, 30],
  v: [2, 4, 6, 8],
  gust: [4, 12, 23, 35],
  gustIntervalHours: [0, 0],
};
const manifest = {
  schemaVersion: 2,
  model: "icon-eu",
  run: frame.run,
  runTime: frame.validTime,
  grid,
  base: "icon-eu-2026091306-3h-v1-0a1b2c3d/",
  frames: [
    {
      hour: 0,
      validTime: frame.validTime,
      gustIntervalHours: [0, 0],
    },
    {
      hour: 3,
      validTime: "2026-09-13T09:00:00Z",
      gustIntervalHours: [0, 3],
    },
  ],
  tiles: tilesFor(grid, [{ gustIntervalHours: [0, 0] }]),
  spots: {
    squareDegrees: 2,
    url: "spots/{square}.json",
    squares: ["n52w010"],
    keys: ["spotForecasts"],
  },
} as Manifest;

describe("geographic interpolation", () => {
  it("preserves north-west and south-east grid corners", () => {
    expect(sample(frame, -10, 54)).toEqual({ u: 0, v: 2, gust: 4 });
    expect(sample(frame, -9, 53)).toEqual({ u: 30, v: 8, gust: 35 });
  });
  it("interpolates vectors at the centre, not wrapped wind angles", () => {
    expect(sample(frame, -9.5, 53.5)).toEqual({ u: 15, v: 5, gust: 18.5 });
  });
  it("does not extrapolate outside the domain", () => {
    expect(sample(frame, -10.01, 53.5)).toBeNull();
    expect(sample(frame, -9.5, 54.01)).toBeNull();
    expect(sample(frame, NaN, 53.5)).toBeNull();
  });
});
describe("wind conventions", () => {
  it.each([
    [0, -10, 0, "N"],
    [-10, 0, 90, "E"],
    [0, 10, 180, "S"],
    [10, 0, 270, "W"],
  ])("uses wind-from bearings for u=%s v=%s", (u, v, angle, label) => {
    expect(direction(u as number, v as number)).toBe(angle);
    expect(compass(angle as number)).toBe(label);
  });
  it("converts metres per second to knots", () => {
    expect(convert(10, "kn")).toBeCloseTo(19.4384, 3);
    expect(convert(10, "m/s")).toBe(10);
  });
  it("clamps colour scale without invalid RGB output", () => {
    expect(windColor(-2)).toEqual(windColor(0));
    expect(windColor(100)).toEqual(windColor(65));
  });
  it("uses blue below 10 kn, green to 25, yellow by 30, then orange, red, purple and nearly black", () => {
    const hue = (k: number) => {
      const [r, g, b] = windColor(k).map((v) => v / 255);
      const max = Math.max(r, g, b),
        d = max - Math.min(r, g, b);
      const h =
        max === r
          ? ((g - b) / d) % 6
          : max === g
            ? (b - r) / d + 2
            : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const k of [0, 5, 9]) expect(hue(k), `${k} kn`).toBeGreaterThan(200);
    for (const k of [0, 5, 9]) expect(hue(k), `${k} kn`).toBeLessThan(240);
    for (const k of [10, 15, 20]) expect(hue(k), `${k} kn`).toBeGreaterThan(90);
    for (const k of [10, 15, 20]) expect(hue(k), `${k} kn`).toBeLessThan(170);
    expect(hue(25)).toBeGreaterThan(60);
    expect(hue(25)).toBeLessThan(90);
    expect(hue(30)).toBeGreaterThan(45);
    expect(hue(30)).toBeLessThan(60);
    expect(hue(35)).toBeGreaterThan(25);
    expect(hue(35)).toBeLessThan(45);
    expect(hue(40)).toBeLessThan(20);
    expect(hue(45)).toBeGreaterThan(330);
    expect(hue(50)).toBeGreaterThan(290);
    expect(hue(50)).toBeLessThan(330);
    // Deepening: calm is the palest blue, and the storm end nearly black.
    const light = (k: number) => windColor(k).reduce((a, v) => a + v, 0);
    expect(light(0)).toBeGreaterThan(light(5));
    expect(light(5)).toBeGreaterThan(light(9));
    expect(light(50)).toBeGreaterThan(light(60));
    expect(light(60)).toBeGreaterThan(light(65));
    expect(Math.max(...windColor(65))).toBeLessThan(60);
  });
  it("blends between its stops rather than stepping", () => {
    const [a, b, c] = [windColor(20), windColor(22.5), windColor(25)];
    for (let i = 0; i < 3; i++)
      expect(b[i]).toBe(Math.round((a[i] + c[i]) / 2));
  });
});
describe("forecast integrity and freshness", () => {
  it("allows explicitly missing initialization gusts but never hides a missing later field", () => {
    const m = {
      ...manifest,
      gustAvailable: true,
      gustMissingHours: [0],
      frames: manifest.frames.map((f, i) =>
        i === 0 ? { ...f, gustIntervalHours: null } : f,
      ),
    };
    expect(validateManifest(m)).toBe(m);
    expect(
      validateFrame(
        { ...frame, gust: null, gustIntervalHours: null },
        m,
        m.frames[0],
      ).gust,
    ).toBeNull();
    expect(() =>
      validateFrame(
        { ...frame, gust: null, hour: 3, validTime: m.frames[1].validTime },
        m,
        m.frames[1],
      ),
    ).toThrow();
    expect(() =>
      validateManifest({ ...m, gustMissingHours: [0, 3] }),
    ).toThrow();
    expect(() =>
      validateManifest({ ...m, gustMissingHours: undefined }),
    ).toThrow();
  });
  it("accepts instantaneous gusts valid at every hour, initialization included", () => {
    const instant = {
      ...manifest,
      gustAvailable: true,
      gustKind: "instantaneous" as const,
      frames: manifest.frames.map((f) => ({
        ...f,
        gustIntervalHours: [f.hour, f.hour] as [number, number],
      })),
    };
    expect(validateManifest(instant)).toBe(instant);
    expect(
      validateFrame(
        { ...frame, gustIntervalHours: [0, 0] },
        instant,
        instant.frames[0],
      ).gust,
    ).not.toBeNull();
    // Without that declaration a later zero-length interval is still a mistake.
    expect(() =>
      validateManifest({ ...instant, gustKind: undefined }),
    ).toThrow();
    // An instantaneous gust must not claim a preceding maximum period either.
    expect(() =>
      validateManifest({
        ...instant,
        frames: [
          instant.frames[0],
          {
            ...instant.frames[1],
            gustIntervalHours: [0, 3] as [number, number],
          },
        ],
      }),
    ).toThrow();
  });
  it("keeps missing gusts null only when explicitly declared unavailable", () => {
    const missing = { ...frame, gust: null, gustIntervalHours: null };
    const noGusts = { ...manifest, gustAvailable: false };
    expect(
      validateFrame(missing, noGusts, {
        ...manifest.frames[0],
        gustIntervalHours: null,
      }),
    ).toBe(missing);
    expect(sample(missing, -9.5, 53.5)).toEqual({ u: 15, v: 5, gust: null });
    expect(() =>
      validateFrame(missing, manifest, manifest.frames[0]),
    ).toThrow();
  });
  it("accepts a matching grid and run", () => {
    expect(validateManifest(manifest)).toBe(manifest);
    expect(validateFrame(frame, manifest, manifest.frames[0])).toBe(frame);
  });
  it("rejects a gust field whose period differs from the manifest", () => {
    expect(() =>
      validateFrame(
        { ...frame, gustIntervalHours: [0, 3] },
        manifest,
        manifest.frames[0],
      ),
    ).toThrow(/Gust period/);
  });
  it("rejects mixed runs and invalid grid values", () => {
    expect(() =>
      validateFrame({ ...frame, run: "old" }, manifest, manifest.frames[0]),
    ).toThrow();
    expect(() =>
      validateFrame({ ...frame, u: [1] }, manifest, manifest.frames[0]),
    ).toThrow();
    expect(() =>
      validateFrame(
        { ...frame, u: [1, 2, NaN, 4] },
        manifest,
        manifest.frames[0],
      ),
    ).toThrow();
    expect(() =>
      validateFrame(
        { ...frame, grid: { ...grid, north: 55 } },
        manifest,
        manifest.frames[0],
      ),
    ).toThrow();
    expect(() =>
      validateFrame(
        { ...frame, gust: [1, 2, -1, 4] },
        manifest,
        manifest.frames[0],
      ),
    ).toThrow();
  });
  it("rejects non-sequential times and frames published other than as tiles", () => {
    expect(() =>
      validateManifest({ ...manifest, frames: [...manifest.frames].reverse() }),
    ).toThrow();
    // Frames are tiles: a run with frames needs its tiles block, a whole-frame
    // encoding is an old format, and a run without frames has no tiles.
    expect(() => validateManifest({ ...manifest, tiles: undefined })).toThrow(
      /tiles/,
    );
    expect(() =>
      validateManifest({ ...manifest, encoding: "f5-int16-v1" } as Manifest),
    ).toThrow(/old format/);
    expect(() =>
      validateManifest({
        ...manifest,
        frames: [],
        ensemble: { members: 2, control: 0, description: "Two" },
        horizonHours: 3,
      }),
    ).toThrow(/no tiles/);
  });
  it("checks the tiles block against the grid and the gust periods", () => {
    const tiles = manifest.tiles!;
    const level = tiles.levels[0];
    for (const broken of [
      { ...tiles, encoding: "f5-tile-v2" },
      { ...tiles, url: "tiles/{level}/{x}/{y}/{hour}.bin" },
      { ...tiles, size: 0 },
      { ...tiles, border: 0 },
      { ...tiles, blocks: ["u", "v"] },
      { ...tiles, levels: [] },
      { ...tiles, levels: [{ ...level, x: [1, 2] as [number, number] }] },
      { ...tiles, levels: [{ ...level, dx: 2 }] },
      {
        ...tiles,
        levels: [{ ...level, absent: [[9, 9]] as [number, number][] }],
      },
      {
        ...tiles,
        levels: [
          {
            ...level,
            absent: [
              [level.x[0], level.y[0]],
              [level.x[0], level.y[0]],
            ] as [number, number][],
          },
        ],
      },
    ])
      expect(() => validateManifest({ ...manifest, tiles: broken })).toThrow();
    // A grid off the tile lattice cannot be tiled at all.
    expect(() =>
      validateManifest({
        ...manifest,
        grid: { ...grid, west: -10.3, east: -9.3 },
      }),
    ).toThrow(/lattice/);
    // An absent tile inside the ranges is fine.
    expect(() =>
      validateManifest({
        ...manifest,
        tiles: {
          ...tiles,
          levels: [{ ...level, absent: [[level.x[0], level.y[0]]] }],
        },
      }),
    ).not.toThrow();
  });
  it("is a schemaVersion 2 pointer: a run directory beside it, no spot data inline", () => {
    expect(() => validateManifest({ ...manifest, schemaVersion: 1 })).toThrow(
      /old format/,
    );
    for (const base of [
      "../icon-eu-2026091306-3h-v1-0a1b2c3d/",
      "icon-eu-2026091306-3h-v1-0a1b2c3d",
      "weather/icon-eu-2026091306-3h-v1-0a1b2c3d/",
      "icon-eu-2026091306-3h-v1/",
      "/icon-eu-2026091306-3h-v1-0a1b2c3d/",
    ])
      expect(() => validateManifest({ ...manifest, base })).toThrow(
        /run directory/,
      );
    expect(() =>
      validateManifest({ ...manifest, spotForecasts: { brandon: [] } }),
    ).toThrow(/spot squares/);
    expect(() => validateManifest({ ...manifest, spotMembers: {} })).toThrow(
      /spot squares/,
    );
    for (const spots of [
      undefined,
      { ...manifest.spots, squareDegrees: 1 },
      { ...manifest.spots, url: "../{square}.json" },
      { ...manifest.spots, squares: ["n54w010", "n52w010"] },
      { ...manifest.spots, squares: ["../x"] },
      { ...manifest.spots, keys: ["frames"] },
    ])
      expect(() =>
        validateManifest({ ...manifest, spots } as Manifest),
      ).toThrow();
  });
  it("needs a stated horizon for a run with no map frames", () => {
    const frameless = {
      ...manifest,
      tiles: undefined,
      frames: [],
      ensemble: { members: 2, control: null, description: "Two." },
    };
    expect(() => validateManifest(frameless)).toThrow(/horizon/);
    expect(validateManifest({ ...frameless, horizonHours: 48 }).frames).toEqual(
      [],
    );
    // The pointer alone says how far it reaches: 48 h from 06 UTC on the 13th.
    expect(
      freshness(
        { ...frameless, horizonHours: 48 },
        Date.parse("2026-09-13T12:00Z"),
      ),
    ).toBe("fresh");
    expect(
      freshness(
        { ...frameless, horizonHours: 48 },
        Date.parse("2026-09-15T07:00Z"),
      ),
    ).toBe("expired");
  });
  it("selects the nearest available time and clamps to the forecast period", () => {
    expect(nearestFrame(manifest.frames, Date.parse("2026-09-13T08:00Z"))).toBe(
      1,
    );
    expect(nearestFrame(manifest.frames, 0)).toBe(0);
  });
  it("labels expired snapshots instead of presenting them as current", () => {
    expect(freshness(manifest, Date.parse("2026-09-13T07:00Z"))).toBe("fresh");
    expect(freshness(manifest, Date.parse("2026-09-14T07:00Z"))).toBe(
      "expired",
    );
    const long = {
      ...manifest,
      frames: [
        ...manifest.frames,
        { ...manifest.frames[1], validTime: "2026-09-16T06:00Z" },
      ],
    };
    expect(freshness(long, Date.parse("2026-09-14T07:00Z"))).toBe("stale");
  });
});
