import { describe, expect, it } from "vitest";
import {
  columnAtX,
  dayBest,
  stripGeometry,
  nearestColumn,
  openingColumn,
  stripColumns,
  stripDays,
  stripTrack,
  rainColumns,
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

describe("stripTrack", () => {
  const geometry = (n: number, cw = 60) => ({
    x: Array.from({ length: n }, (_, i) => i * cw),
    w: Array.from({ length: n }, () => cw),
    total: n * cw,
  });
  it("starts the table against the labels and walks the cursor out to the middle", () => {
    const g = geometry(100);
    const track = stripTrack(g, 600);
    // The first hour: no scroll, the cursor on its centre, not in the middle.
    expect(track.scrollFor(0)).toBe(0);
    expect(track.cursorAt(0)).toBe(30);
    // The middle of the week: the cursor stands still in the middle.
    const s = track.scrollFor(50);
    expect(track.cursorAt(s)).toBe(300);
    expect(track.timeAt(s)).toBe(50 * 60 + 30);
    // The last hour: full scroll, the cursor on its centre at the right.
    expect(track.scrollFor(99)).toBe(g.total - 600);
    expect(track.cursorAt(g.total - 600)).toBe(600 - 30);
  });
  it("is its own inverse, and never jumps", () => {
    const g = geometry(100);
    const track = stripTrack(g, 600);
    for (let i = 0; i < 100; i++)
      expect(columnAtX(g, track.timeAt(track.scrollFor(i)))).toBe(i);
    let last = track.timeAt(0);
    for (let s = 7; s <= g.total - 600; s += 7) {
      const t = track.timeAt(s);
      expect(t).toBeGreaterThan(last);
      expect(t - last).toBeLessThanOrEqual(14.01);
      last = t;
    }
  });
  it("walks the cursor the whole way on a strip too short for a still middle", () => {
    const g = geometry(14);
    const track = stripTrack(g, 600);
    expect(track.cursorAt(0)).toBe(30);
    expect(track.cursorAt(g.total - 600)).toBe(600 - 30);
    for (let i = 0; i < 14; i++)
      expect(columnAtX(g, track.timeAt(track.scrollFor(i)))).toBe(i);
    // And one that fits does not scroll at all.
    expect(stripTrack(geometry(5), 600).scrollFor(4)).toBe(0);
  });
});

describe("rainColumns", () => {
  const at = (iso: string) => Date.parse(iso);
  const steps = ["09:00", "12:00", "15:00"].map((h) => ({
    validTime: `2026-10-08T${h}:00Z`,
  }));
  it("prints a total once, at its interval's end, and marks the rest of it", () => {
    const times = ["10:00", "11:00", "12:00", "13:00"].map((h) =>
      at(`2026-10-08T${h}:00Z`),
    );
    const out = rainColumns(times, steps);
    expect(out.map((c) => c && [c.step, c.own])).toEqual([
      [1, false],
      [1, false],
      [1, true],
      [2, true],
    ]);
    expect(out[0]!.hours).toBe(3);
  });
  it("gives a column between steps the interval it falls in", () => {
    // Three-hourly columns an hour before the steps: each inside one interval.
    const times = ["08:00", "11:00", "14:00"].map((h) =>
      at(`2026-10-08T${h}:00Z`),
    );
    expect(rainColumns(times, steps).map((c) => c && [c.step, c.own])).toEqual([
      [0, true],
      [1, true],
      [2, true],
    ]);
  });
  it("leaves a column past the last step empty", () => {
    expect(rainColumns([at("2026-10-08T18:00:00Z")], steps)).toEqual([null]);
  });
});
