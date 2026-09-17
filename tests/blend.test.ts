// The blend against the sample bundles: HARMONIE (hourly, 24 h, no gusts),
// ICON-EU (3-hourly, 72 h) and ECMWF (3-hourly then 6-hourly, 360 h), all at
// Brandon Bay. The values are synthetic (tests/fixtures/weather), but the run
// times, cadences and gust availability are the ones the adapters publish, which
// is what the axis, the gap bridging and the per-hour statistics are about.
import { describe, expect, it } from "vitest";
import { readBundle } from "./bundles";
import {
  blendInputs,
  blendStats,
  bridgeableGapHours,
  candles,
  commonAxis,
  interpolateSeries,
} from "../force5/src/blend";
import { memberSeries, spotSeries } from "../force5/src/series";
import { validateManifest, type Manifest } from "../force5/src/weather";

const bundled = (name: string): Manifest =>
  validateManifest(readBundle<Manifest>(name));
const harmonie = bundled("harmonie");
const iconEu = bundled("latest");
const ecmwf = bundled("ecmwf");
const all = [harmonie, iconEu, ecmwf];

describe("bundled spot series", () => {
  it("reads Brandon Bay out of all three manifests without touching frames", () => {
    for (const manifest of all) {
      const series = spotSeries(manifest, "brandon")!;
      expect(series.length).toBe(manifest.frames.length);
      expect(series[0].hour).toBe(0);
      expect(Number.isFinite(series[0].u)).toBe(true);
      expect(memberSeries(manifest, "brandon")).toBeNull();
    }
    expect(
      spotSeries(harmonie, "brandon")!.every((point) => point.gust === null),
    ).toBe(true);
    expect(spotSeries(harmonie, "mizen")).toBeNull();
  });
});

describe("axis across the three models", () => {
  it("spans the union of their valid ranges, hourly", () => {
    const axis = commonAxis(all);
    expect(axis[0]).toBe("2026-09-13T00:00:00.000Z");
    expect(axis.at(-1)).toBe("2026-09-28T00:00:00.000Z");
    expect(axis).toHaveLength(15 * 24 + 1);
  });
  it("can restrict itself to the hours all three cover", () => {
    // HARMONIE is the short one at both ends: it starts last and stops first.
    const axis = commonAxis(all, { coverage: "intersection" });
    expect(axis[0]).toBe("2026-09-13T13:00:00.000Z");
    expect(axis.at(-1)).toBe("2026-09-14T13:00:00.000Z");
    expect(axis).toHaveLength(25);
  });
});

describe("interpolating the published series", () => {
  it("leaves an hourly series alone on an hourly axis", () => {
    const points = spotSeries(harmonie, "brandon")!;
    const axis = commonAxis([harmonie]);
    const values = interpolateSeries(points, axis);
    expect(values.speed.every((value) => value !== null)).toBe(true);
    expect(values.gust.every((value) => value === null)).toBe(true);
    // HARMONIE publishes every hour, so every axis hour is a published one:
    // 13 September 14:00 is u 4.24, v -6.03 and nothing is interpolated.
    expect(values.speed[axis.indexOf("2026-09-13T14:00:00.000Z")]).toBeCloseTo(
      Math.hypot(4.24, -6.03),
      10,
    );
  });
  it("puts ICON-EU's three-hourly series on whole hours", () => {
    const points = spotSeries(iconEu, "brandon")!;
    const axis = commonAxis([iconEu]);
    const values = interpolateSeries(points, axis);
    expect(values.speed.every((value) => value !== null)).toBe(true);
    // 13 September 06:00 is a published frame: u 6.34, v -0.48.
    expect(values.speed[axis.indexOf("2026-09-13T06:00:00.000Z")]).toBeCloseTo(
      Math.hypot(6.34, -0.48),
      10,
    );
    // 04:00 sits a third of the way from 03:00 (6.36, -4.52) to 06:00, and the
    // interpolation runs in u/v, never between speeds or bearings.
    expect(values.speed[axis.indexOf("2026-09-13T04:00:00.000Z")]).toBeCloseTo(
      Math.hypot(6.36 + (6.34 - 6.36) / 3, -4.52 + (-0.48 + 4.52) / 3),
      10,
    );
  });
  it("bridges ECMWF's six-hourly tail but not a manufactured hole", () => {
    const points = spotSeries(ecmwf, "brandon")!;
    expect(bridgeableGapHours(points)).toBe(6);
    const tail = interpolateSeries(points, [
      "2026-09-20T03:00:00.000Z",
      "2026-09-20T06:00:00.000Z",
    ]);
    expect(tail.speed.every((value) => value !== null)).toBe(true);
    const gapped = [...points.slice(0, 40), ...points.slice(48)];
    expect(
      interpolateSeries(gapped, ["2026-09-18T06:00:00.000Z"]).speed[0],
    ).toBeNull();
  });
});

describe("blending the three models", () => {
  const axis = commonAxis(all);
  const inputs = blendInputs(
    all,
    "brandon",
    ["harmonie", "icon-eu", "ecmwf"],
    axis,
  );
  const stats = blendStats(inputs, axis);
  const at = (iso: string) => stats[axis.indexOf(iso)];

  it("builds one line per model", () => {
    expect(inputs.map((input) => input.model)).toEqual([
      "harmonie",
      "icon-eu",
      "ecmwf",
    ]);
    expect(inputs.every((input) => input.speed.length === axis.length)).toBe(
      true,
    );
  });
  it("counts only the models that actually cover each hour", () => {
    expect(at("2026-09-14T00:00:00.000Z").n).toBe(3);
    expect(at("2026-09-13T06:00:00.000Z").n).toBe(2);
    expect(at("2026-09-25T00:00:00.000Z").n).toBe(1);
    expect(at("2026-09-25T00:00:00.000Z").spread).toBe(0);
    expect(at("2026-09-25T00:00:00.000Z").agreement).toBe("high");
    // HARMONIE publishes no gusts, so only two models feed the gust row.
    expect(at("2026-09-14T00:00:00.000Z").gust.n).toBe(2);
    expect(at("2026-09-14T00:00:00.000Z").gust.max).toBeGreaterThanOrEqual(
      at("2026-09-14T00:00:00.000Z").gust.median!,
    );
  });
  it("keeps the quantiles ordered and inside the range at every hour", () => {
    for (const hour of stats) {
      if (!hour.n) continue;
      expect(hour.min!).toBeLessThanOrEqual(hour.q25!);
      expect(hour.q25!).toBeLessThanOrEqual(hour.median!);
      expect(hour.median!).toBeLessThanOrEqual(hour.q75!);
      expect(hour.q75!).toBeLessThanOrEqual(hour.max!);
      expect(hour.mean!).toBeGreaterThanOrEqual(hour.min!);
      expect(hour.mean!).toBeLessThanOrEqual(hour.max!);
      expect(hour.spread!).toBeCloseTo(hour.max! - hour.min!, 10);
      expect(hour.max!).toBeLessThan(60);
    }
    // All three cover the day HARMONIE runs for, and only that day.
    expect(stats.filter((hour) => hour.n === 3).length).toBe(25);
  });
  it("condenses the hourly statistics into three-hour candles", () => {
    const columns = candles(stats, 3);
    expect(columns.length).toBeGreaterThan(100);
    expect(columns[0].time).toBe(axis[0]);
    for (const column of columns) {
      expect(column.lo).toBeLessThanOrEqual(column.q25);
      expect(column.q25).toBeLessThanOrEqual(column.q75);
      expect(column.q75).toBeLessThanOrEqual(column.hi);
      expect(column.median).toBeGreaterThanOrEqual(column.lo);
      expect(column.median).toBeLessThanOrEqual(column.hi);
    }
  });
});
