import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../../force5/src/stars";
import type { ForecastHour } from "../../../mcp/api/forecast";
import {
  atFromSearch,
  gustReading,
  modelSeries,
  rainPerHour,
  rowIndexAt,
  rowRain,
} from "./detail";

const HOUR = 3600000;
const T0 = Date.parse("2026-09-14T09:00:00Z");
const at = (h: number) => new Date(T0 + h * HOUR).toISOString();

/** An hour with only the weather the rain reads. */
const wet = (h: number, rain: Partial<NonNullable<ForecastHour["weather"]>>) =>
  ({
    time: at(h),
    weather: { air_c: 14, rain_mm: null, cloud_pct: 50, ...rain },
  }) as ForecastHour;

describe("gustReading", () => {
  it("reads the factor, and what the gust does to the rider's stars", () => {
    expect(gustReading(16, 20, DEFAULT_RIDER)).toEqual({
      factor: 1.25,
      text: "1.2×",
      kind: "fine",
    });
    // Read 5 kn lighter, a 30 kn gust is past the sweet spot: a star off.
    expect(gustReading(18, 30, DEFAULT_RIDER)?.kind).toBe("costs");
    // Past the rider's too much: no stars at all.
    expect(gustReading(20, 36, DEFAULT_RIDER)?.kind).toBe("over");
  });

  it("has no factor without a gust, or in a near calm", () => {
    expect(gustReading(16, null, DEFAULT_RIDER)).toBeNull();
    expect(gustReading(3, 9, DEFAULT_RIDER)).toBeNull();
    expect(gustReading(null, 20, DEFAULT_RIDER)).toBeNull();
  });
});

describe("rainPerHour", () => {
  it("spreads a longer interval's total evenly over its hours", () => {
    const hours = [0, 1, 2, 3, 4, 5].map((h) =>
      wet(h, h === 3 ? { rain_mm: 1.5, rain_interval_hours: 3 } : {}),
    );
    const rates = rainPerHour(hours);
    expect(rates.get(T0 + HOUR)).toBe(0.5);
    expect(rates.get(T0 + 2 * HOUR)).toBe(0.5);
    expect(rates.get(T0 + 3 * HOUR)).toBe(0.5);
    // Before the interval, and after it: no figure, not a dry one.
    expect(rates.has(T0)).toBe(false);
    expect(rates.has(T0 + 4 * HOUR)).toBe(false);
  });

  it("ends an interval at rain_until where it is given, and keeps a dry hour", () => {
    const hours = [
      wet(0, { rain_mm: 0, rain_interval_hours: 1 }),
      wet(1, { rain_mm: 0.8, rain_interval_hours: 2, rain_until: at(2) }),
      wet(2, {}),
    ];
    const rates = rainPerHour(hours);
    expect(rates.get(T0)).toBe(0);
    expect(rates.get(T0 + HOUR)).toBe(0.4);
    expect(rates.get(T0 + 2 * HOUR)).toBe(0.4);
  });
});

describe("rowRain", () => {
  it("is the mean of a row's hours, or null with none", () => {
    const rates = new Map([
      [T0, 0.3],
      [T0 + HOUR, 0.9],
    ]);
    expect(rowRain(rates, { time: T0, step: 1 })).toBe(0.3);
    expect(rowRain(rates, { time: T0, step: 3 })).toBeCloseTo(0.6);
    expect(rowRain(rates, { time: T0 + 5 * HOUR, step: 1 })).toBeNull();
  });
});

describe("modelSeries", () => {
  const row = (h: number, byModel: Record<string, number>, step = 1) => ({
    time: T0 + h * HOUR,
    step,
    hour: {
      wind: {
        by_model: Object.fromEntries(
          Object.entries(byModel).map(([id, kn]) => [
            id,
            { wind_kn: kn, gust_kn: null, direction_deg: 270 },
          ]),
        ),
      },
    } as unknown as ForecastHour,
  });

  it("draws the rider's models, in their order, each from its own readings", () => {
    const rows = [
      row(0, { harmonie: 14, ecmwf: 12 }),
      row(1, { harmonie: 15, ecmwf: 13, gfs: 9 }),
      row(2, { ecmwf: 14, gfs: 10 }),
    ];
    const series = modelSeries(rows, ["ecmwf", "harmonie", "gfs", "icon-eu"]);
    expect(series.map((s) => s.id)).toEqual(["ecmwf", "harmonie", "gfs"]);
    expect(series[0].points.map((p) => p.kn)).toEqual([12, 13, 14]);
    expect(series[1].points.map((p) => p.time)).toEqual([T0, T0 + HOUR]);
  });

  it("leaves out a model with fewer than two readings", () => {
    expect(modelSeries([row(0, { gfs: 9 }), row(1, {})], ["gfs"])).toEqual([]);
  });
});

describe("the hour an address opens at", () => {
  const rows = [
    { time: T0, step: 1 },
    { time: T0 + HOUR, step: 1 },
    { time: T0 + 2 * HOUR, step: 3 },
  ];

  it("reads ?at=, and nothing that is not a time", () => {
    expect(atFromSearch("?at=2026-09-14T10:00:00Z")).toBe(T0 + HOUR);
    expect(atFromSearch("?at=2026-09-14T10%3A00%3A00.000Z")).toBe(T0 + HOUR);
    expect(atFromSearch("?at=tomorrow")).toBeNull();
    expect(atFromSearch("?spot=brandon")).toBeNull();
    expect(atFromSearch("")).toBeNull();
  });

  it("finds the row an instant falls in, and none outside the week", () => {
    expect(rowIndexAt(rows, T0)).toBe(0);
    expect(rowIndexAt(rows, T0 + 1.5 * HOUR)).toBe(1);
    // A three-hour row holds all three of its hours.
    expect(rowIndexAt(rows, T0 + 4.5 * HOUR)).toBe(2);
    expect(rowIndexAt(rows, T0 - 1)).toBeNull();
    expect(rowIndexAt(rows, T0 + 5 * HOUR)).toBeNull();
  });

  it("opens an hour between the hourly rows and the three-hourly ones on the nearer", () => {
    const rows = [
      { time: T0, step: 1 },
      { time: T0 + 1 * HOUR, step: 1 },
      { time: T0 + 4 * HOUR, step: 3 },
    ];
    expect(rowIndexAt(rows, T0 + 2 * HOUR)).toBe(1);
    expect(rowIndexAt(rows, T0 + 3 * HOUR)).toBe(2);
  });
});
