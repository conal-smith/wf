import { describe, expect, it } from "vitest";
import {
  columnAtX,
  dayStep,
  stripGeometry,
  nearestColumn,
  openingColumn,
  stripColumns,
  stripDays,
  stripTrack,
  timeSpoken,
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
  /** Irish midnight starting 5 October. */
  const midnight = "2026-10-04T23:00:00Z";

  it("keeps every hour of the day and the night, for as many days as it is asked", () => {
    const strip = stripColumns(hours(midnight, 24 * 9), now, 7);
    const days = stripDays(strip);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe("2026-10-05");
    expect(days.every((d) => d.count === 24)).toBe(true);
    expect(strip[0].hour).toBe(0);
    expect(strip[0].validTime).toBe("2026-10-04T23:00:00.000Z");
    expect(strip.slice(0, 24).map((c) => c.hour)).toEqual(
      Array.from({ length: 24 }, (_, h) => h),
    );
    // No night gap anywhere: every column is an hour after the one before.
    for (let i = 1; i < strip.length; i++)
      expect(strip[i].time - strip[i - 1].time).toBe(3600000);
  });

  it("keeps a coarse run's own steps, through the night as well", () => {
    const strip = stripColumns(hours("2026-10-05T00:00:00Z", 8, 3), now);
    expect(strip.map((c) => c.hour)).toEqual([1, 4, 7, 10, 13, 16, 19, 22]);
  });

  it("keeps each run's cadence across the seams, leaving nothing out", () => {
    // Hourly for two days, three-hourly for four, six-hourly to the end.
    const fine = hours(midnight, 48);
    const coarse = hours("2026-10-06T23:00:00Z", 32, 3);
    const far = hours("2026-10-10T23:00:00Z", 20, 6);
    const columns = [...fine, ...coarse, ...far];
    const strip = stripColumns(columns, now);
    expect(strip.map((c) => c.validTime)).toEqual(
      columns.map((c) => c.validTime),
    );
    const steps = strip
      .slice(1)
      .map((c, i) => (c.time - strip[i].time) / 3600000);
    expect(new Set(steps.slice(0, 47))).toEqual(new Set([1]));
    expect(new Set(steps.slice(48, 79))).toEqual(new Set([3]));
    expect(new Set(steps.slice(80))).toEqual(new Set([6]));
    // A six-hourly day is four columns, midnight to evening.
    const days = stripDays(strip);
    expect(strip.slice(days[7].start, days[7].start + days[7].count).map((c) => c.hour)).toEqual([0, 6, 12, 18]);
  });

  it("drops the days outside the strip, and only those", () => {
    const strip = stripColumns(hours("2026-10-04T12:00:00Z", 24 * 20), now);
    expect(strip[0].date).toBe("2026-10-05");
    expect(strip[0].hour).toBe(0);
    expect(stripDays(strip)).toHaveLength(15);
  });
});

describe("openingColumn", () => {
  const strip = stripColumns(
    hours("2026-10-04T23:00:00Z", 48),
    Date.parse("2026-10-05T10:00:00Z"),
  );
  it("opens on now, by day", () => {
    expect(strip[openingColumn(strip, Date.parse("2026-10-05T12:10:00Z"))].hour).toBe(13);
    expect(nearestColumn(strip, Date.parse("2026-10-05T06:00:00Z"))).toBe(7);
  });
  it("opens on now at night too, not on the next morning", () => {
    // 22:10 Irish time: the 22:00 column of the same day, not Tuesday 07:00.
    const night = openingColumn(strip, Date.parse("2026-10-05T21:10:00Z"));
    expect(strip[night].date).toBe("2026-10-05");
    expect(strip[night].hour).toBe(22);
    // And the small hours are columns of their own.
    const small = openingColumn(strip, Date.parse("2026-10-06T02:00:00Z"));
    expect(strip[small].date).toBe("2026-10-06");
    expect(strip[small].hour).toBe(3);
  });
  it("goes to the next column when the strip has not started, and the last when it is over", () => {
    expect(openingColumn(strip, Date.parse("2026-10-04T12:00:00Z"))).toBe(0);
    expect(openingColumn(strip, Date.parse("2026-10-09T12:00:00Z"))).toBe(
      strip.length - 1,
    );
  });
});

describe("a selected time at night", () => {
  // The bug this strip was rebuilt for: with the night cut out, a time in it
  // resolved to the next morning's first column, and the selected line was
  // drawn on Tuesday 07:00 for a time on Monday night.
  const fine = hours("2026-10-04T23:00:00Z", 48);
  const coarse = hours("2026-10-06T23:00:00Z", 16, 3);
  const strip = stripColumns(
    [...fine, ...coarse],
    Date.parse("2026-10-05T10:00:00Z"),
  );
  it("resolves to its own column, hourly or three-hourly", () => {
    for (const [iso, date, hour] of [
      ["2026-10-05T20:00:00Z", "2026-10-05", 21],
      ["2026-10-05T22:00:00Z", "2026-10-05", 23],
      ["2026-10-05T23:00:00Z", "2026-10-06", 0],
      ["2026-10-06T02:00:00Z", "2026-10-06", 3],
      ["2026-10-07T02:00:00Z", "2026-10-07", 3],
      ["2026-10-07T20:00:00Z", "2026-10-07", 21],
    ] as const) {
      const at = nearestColumn(strip, Date.parse(iso));
      expect(strip[at].time).toBe(Date.parse(iso));
      expect([strip[at].date, strip[at].hour]).toEqual([date, hour]);
    }
  });
  it("sits under the cursor where its own column is, not the morning's", () => {
    const g = stripGeometry(strip, 60, 48);
    const track = stripTrack(g, 600);
    const at = nearestColumn(strip, Date.parse("2026-10-05T22:00:00Z"));
    const morning = strip.findIndex(
      (c) => c.date === "2026-10-06" && c.hour === 7,
    );
    expect(columnAtX(g, track.timeAt(track.scrollFor(at)))).toBe(at);
    expect(at).toBeLessThan(morning);
    expect(g.x[morning] - g.x[at]).toBe(8 * 60);
  });
});

describe("dayStep", () => {
  const strip = stripColumns(
    [
      // Monday from 14:00, hourly to Tuesday midnight, then three-hourly.
      ...hours("2026-10-05T13:00:00Z", 34),
      ...hours("2026-10-06T23:00:00Z", 16, 3),
    ],
    Date.parse("2026-10-05T14:00:00Z"),
  );
  const days = stripDays(strip);
  const at = (date: string, hour: number) =>
    strip.findIndex((c) => c.date === date && c.hour === hour);
  it("goes to the same hour of the next or the last day", () => {
    expect(days.map((d) => d.count)).toEqual([10, 24, 8, 8]);
    expect(dayStep(strip, days, at("2026-10-05", 22), 1)).toBe(
      at("2026-10-06", 22),
    );
    expect(dayStep(strip, days, at("2026-10-06", 3), -1)).toBe(
      at("2026-10-05", 14),
    );
  });
  it("finds the nearest hour on a day of coarser columns", () => {
    // Wednesday is three-hourly from midnight: 00, 03, … 18, 21.
    expect(dayStep(strip, days, at("2026-10-06", 20), 1)).toBe(
      at("2026-10-07", 21),
    );
    expect(at("2026-10-07", 21)).toBeGreaterThan(0);
    expect(dayStep(strip, days, at("2026-10-07", 12), -1)).toBe(
      at("2026-10-06", 12),
    );
  });
  it("stays in the first or the last day at the ends", () => {
    expect(dayStep(strip, days, at("2026-10-08", 3), 1)).toBe(
      at("2026-10-08", 3),
    );
    expect(dayStep(strip, days, 0, -1)).toBe(0);
  });
});

describe("stripGeometry", () => {
  it("narrows the coarse columns, and finds a column by its centre", () => {
    const strip = stripColumns(
      [
        ...hours("2026-10-04T23:00:00Z", 24),
        ...hours("2026-10-05T23:00:00Z", 8, 3),
      ],
      Date.parse("2026-10-05T10:00:00Z"),
    );
    const g = stripGeometry(strip, 60, 48);
    expect(g.w.slice(0, 24).every((w) => w === 60)).toBe(true);
    expect(g.w.slice(24).every((w) => w === 48)).toBe(true);
    expect(g.total).toBe(24 * 60 + 8 * 48);
    expect(columnAtX(g, 0)).toBe(0);
    expect(columnAtX(g, 24 * 60 + 24)).toBe(24);
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

describe("timeSpoken", () => {
  it("says an hour's day, date and Irish time", () => {
    // 13:00 UTC is 14:00 in Irish summer time.
    expect(timeSpoken(Date.parse("2026-10-20T13:00:00Z"))).toBe(
      "Tue 20 Oct, 14:00",
    );
    // And the same as UTC in winter, past midnight's day change.
    expect(timeSpoken(Date.parse("2026-12-01T00:30:00Z"))).toBe(
      "Tue 1 Dec, 00:30",
    );
  });
});
