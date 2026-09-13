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
  type Frame,
  type Manifest,
} from "./weather";

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
const frame: Frame = {
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
  schemaVersion: 1,
  model: "icon-eu",
  run: frame.run,
  runTime: frame.validTime,
  grid,
  frames: [
    {
      hour: 0,
      validTime: frame.validTime,
      url: "weather/a.json",
      gustIntervalHours: [0, 0],
    },
    {
      hour: 3,
      validTime: "2026-09-13T09:00:00Z",
      url: "weather/b.json",
      gustIntervalHours: [0, 3],
    },
  ],
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
  it("uses blue below 10 kn, green through 30 kn, then warm and purple speed bands", () => {
    for (const k of [0, 5, 9]) {
      const [r, g, b] = windColor(k);
      expect(b).toBeGreaterThan(g);
      expect(b).toBeGreaterThan(r);
    }
    for (const k of [10, 15, 20, 25, 30]) {
      const [r, g, b] = windColor(k);
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    }
    expect(windColor(35)[0]).toBeGreaterThan(windColor(35)[1]);
    expect(windColor(45)[0]).toBeGreaterThan(windColor(45)[1] * 2);
    expect(windColor(65)[2]).toBeGreaterThan(windColor(65)[1]);
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
  it("rejects non-sequential times and external paths", () => {
    expect(() =>
      validateManifest({ ...manifest, frames: [...manifest.frames].reverse() }),
    ).toThrow();
    expect(() =>
      validateManifest({
        ...manifest,
        frames: [{ ...manifest.frames[0], url: "https://bad.example/frame" }],
      }),
    ).toThrow();
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
