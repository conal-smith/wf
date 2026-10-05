import { describe, expect, it } from "vitest";
import {
  columnAtX,
  dayBest,
  stripGeometry,
  nearestColumn,
  openingColumn,
  stripColumns,
  stripDays,
} from "./strip";

const hours = (from: string, n: number, step = 1) =>
  Array.from({ length: n }, (_, i) => ({
    validTime: new Date(Date.parse(from) + i * step * 3600000).toISOString(),
    model: "harmonie",
  }));

describe("stripColumns", () => {
  // 5 October 2026 is a Monday in Irish summer time (UTC+1).
  const now = Date.parse("2026-10-05T10:20:00Z");

  it("keeps 07:00–20:00 Irish time, for as many days as it is asked", () => {
    const strip = stripColumns(hours("2026-10-05T00:00:00Z", 24 * 9), now, 7);
    const days = stripDays(strip);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe("2026-10-05");
    expect(days.every((d) => d.count === 14)).toBe(true);
    expect(strip[0].hour).toBe(7);
    expect(strip[0].validTime).toBe("2026-10-05T06:00:00.000Z");
    expect(strip[13].hour).toBe(20);
  });

  it("keeps a coarse run's own steps", () => {
    const strip = stripColumns(hours("2026-10-05T00:00:00Z", 8, 3), now);
    expect(strip.map((c) => c.hour)).toEqual([7, 10, 13, 16, 19]);
  });
});

describe("openingColumn", () => {
  const strip = stripColumns(
    hours("2026-10-05T00:00:00Z", 48),
    Date.parse("2026-10-05T10:00:00Z"),
  );
  it("opens on now, or first light when it is dark", () => {
    expect(strip[openingColumn(strip, Date.parse("2026-10-05T12:10:00Z"))].hour).toBe(13);
    const night = openingColumn(strip, Date.parse("2026-10-05T22:30:00Z"));
    expect(strip[night].date).toBe("2026-10-06");
    expect(strip[night].hour).toBe(7);
    expect(nearestColumn(strip, Date.parse("2026-10-05T06:00:00Z"))).toBe(0);
  });
});

describe("dayBest", () => {
  const day = { date: "x", noon: 0, start: 0, count: 6 };
  const r = (...stars: (number | null)[]) =>
    stars.map((s) => (s === null ? null : { stars: s }));
  it("is the longest run of the day's top rating", () => {
    expect(dayBest(r(2, 4, 4, 3, 4, null), day)).toEqual({ from: 1, to: 2, stars: 4 });
    expect(dayBest(r(0, 0, null, null, null, null), day)).toEqual({ from: 0, to: 1, stars: 0 });
    expect(dayBest(r(null, null, null, null, null, null), day)).toBe(null);
  });
  it("leaves out the hours already gone", () => {
    const times = [0, 1, 2, 3, 4, 5].map((h) => h * 3600000);
    expect(dayBest(r(5, 3, 3, 2, 1, 1), day, 1.5 * 3600000, times)).toEqual({
      from: 1,
      to: 2,
      stars: 3,
    });
  });
});

describe("stripGeometry", () => {
  it("narrows the coarse columns, and finds a column by its centre", () => {
    const strip = stripColumns(
      [
        ...hours("2026-10-05T00:00:00Z", 24),
        ...hours("2026-10-06T00:00:00Z", 8, 3),
      ],
      Date.parse("2026-10-05T10:00:00Z"),
    );
    const g = stripGeometry(strip, 60, 48);
    expect(g.w.slice(0, 14).every((w) => w === 60)).toBe(true);
    expect(g.w.slice(14).every((w) => w === 48)).toBe(true);
    expect(g.total).toBe(14 * 60 + 5 * 48);
    expect(columnAtX(g, 0)).toBe(0);
    expect(columnAtX(g, 14 * 60 + 24)).toBe(14);
    expect(columnAtX(g, g.total)).toBe(strip.length - 1);
  });
});
