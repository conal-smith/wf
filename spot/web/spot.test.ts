import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, type Rider } from "../../force5/src/stars";
import type { ForecastHour, HourWind } from "../../mcp/api/forecast";
import {
  HOUR,
  bestIn,
  clock,
  compass,
  darkRuns,
  dayNames,
  dayWindow,
  daySun,
  dublinDate,
  dublinMidnight,
  goodWindArcs,
  groupDays,
  gustJumps,
  hourChance,
  meanBearing,
  nextMidnight,
  rowHours,
  shadeBands,
  shoreSummary,
  spotRows,
  tideCurve,
  tideHeightAt,
  tideTrend,
  weekBest,
  windArcs,
  windIn,
  windowHours,
  type TideTurn,
} from "./spot";

const wind = (knots: number, deg = 270, gust: number | null = null) =>
  ({
    wind_kn: knots,
    min_kn: knots - 1,
    max_kn: knots + 1,
    gust_kn: gust,
    gust_max_kn: gust,
    direction_deg: deg,
    direction: compass(deg),
    agreement: "high",
    models: 5,
  }) satisfies HourWind;

const hour = (
  iso: string,
  knots: number | null,
  daylight = true,
  deg = 270,
): ForecastHour => ({
  time: iso,
  local: iso,
  daylight,
  wind: knots === null ? null : wind(knots, deg),
});

describe("Irish time", () => {
  it("dates an instant on the Irish calendar, across the clock change", () => {
    // 23:30 UTC on 10 Oct is 00:30 on the 11th in Irish summer time.
    expect(dublinDate(Date.parse("2026-10-10T23:30:00Z"))).toBe("2026-10-11");
    // After the clocks go back (25 Oct 2026), UTC and Irish time agree.
    expect(dublinDate(Date.parse("2026-11-10T23:30:00Z"))).toBe("2026-11-10");
    expect(clock(Date.parse("2026-10-11T12:00:00Z"))).toBe("13:00");
  });

  it("finds the instant an Irish day starts, and the next one", () => {
    expect(new Date(dublinMidnight("2026-10-11")).toISOString()).toBe(
      "2026-10-10T23:00:00.000Z",
    );
    expect(new Date(dublinMidnight("2026-11-11")).toISOString()).toBe(
      "2026-11-11T00:00:00.000Z",
    );
    // The day the clocks go back is 25 hours long.
    expect(nextMidnight("2026-10-25") - dublinMidnight("2026-10-25")).toBe(
      25 * HOUR,
    );
  });

  it("names today and tomorrow, then the weekday", () => {
    const now = Date.parse("2026-10-09T10:00:00Z"); // a Friday
    expect(dayNames("2026-10-09", now).relative).toBe("Today");
    expect(dayNames("2026-10-10", now).relative).toBe("Tomorrow");
    const sunday = dayNames("2026-10-11", now);
    expect(sunday.relative).toBe("Sunday");
    expect(sunday.short).toBe("Sun");
    expect(sunday.full).toBe("Sunday 11 October");
  });
});

describe("the shore", () => {
  it("finds the cross and cross-on arcs either side of onshore", () => {
    // A west-facing beach: WSW to WNW is onshore (within 30° of west), E
    // offshore; cross-on and cross run from 30° to 110° either side of west.
    const arcs = goodWindArcs(270);
    expect(arcs.map((a) => `${a.from}–${a.to}`)).toEqual(["S–SW", "NW–N"]);
  });

  it("keeps an arc whole when it runs through north", () => {
    // Facing north: onshore N, the arcs either side of it.
    const arcs = goodWindArcs(0);
    expect(arcs.map((a) => `${a.from}–${a.to}`)).toEqual(["NE–E", "W–NW"]);
    const wide = windArcs(0, ["onshore", "cross-on", "cross"]);
    expect(wide.map((a) => `${a.from}–${a.to}`)).toEqual(["W–E"]);
  });

  it("says it in one line, or nothing where the facing is unknown", () => {
    expect(shoreSummary(292.5)).toBe(
      "Faces WNW · best in SSW–WSW or NNW–NNE winds",
    );
    expect(shoreSummary(null)).toBeNull();
  });
});

describe("wind", () => {
  it("converts knots into the reader's units", () => {
    expect(windIn(15.4, "kn")).toBe(15);
    expect(windIn(19.44, "m/s")).toBe(10);
    expect(windIn(10, "km/h")).toBe(19);
  });

  it("averages directions as vectors, weighted by speed", () => {
    expect(
      meanBearing([
        { deg: 350, weight: 1 },
        { deg: 10, weight: 1 },
      ]),
    ).toBeCloseTo(0, 5);
    expect(
      meanBearing([
        { deg: 225, weight: 10 },
        { deg: 270, weight: 10 },
      ]),
    ).toBeCloseTo(247.5, 5);
    expect(meanBearing([])).toBeNull();
  });
});

describe("rows", () => {
  const now = Date.parse("2026-10-09T10:20:00Z");
  const hours = Array.from({ length: 24 * 5 }, (_, i) =>
    hour(
      new Date(Date.parse("2026-10-09T00:00:00Z") + i * HOUR).toISOString(),
      14,
    ),
  );

  it("starts at the current hour, hourly for three days then three-hourly", () => {
    const rows = rowHours(hours, now);
    expect(new Date(rows[0].time).toISOString()).toBe(
      "2026-10-09T10:00:00.000Z",
    );
    const fine = rows.filter((row) => row.step === 1);
    expect(fine).toHaveLength(72);
    const coarse = rows.filter((row) => row.step === 3);
    expect(coarse.length).toBeGreaterThan(0);
    // Every coarse row sits on an Irish hour divisible by three.
    for (const row of coarse)
      expect(Number(clock(row.time).slice(0, 2)) % 3).toBe(0);
  });

  it("rates daylight rows only, and works out the shore angle for all", () => {
    const rows = spotRows(
      [
        hour("2026-10-09T11:00:00Z", 16, true, 225),
        hour("2026-10-09T21:00:00Z", 16, false, 225),
      ],
      now,
      270,
      DEFAULT_RIDER,
    );
    expect(rows[0].rating?.stars).toBeGreaterThan(0);
    expect(rows[0].shore).toBe("cross-on");
    expect(rows[1].rating).toBeNull();
    expect(rows[1].shore).toBe("cross-on");
  });
});

describe("days", () => {
  const now = Date.parse("2026-10-09T06:00:00Z");
  const rider: Rider = { ...DEFAULT_RIDER, wings: [] };
  // A Friday: dark until 07, light 12–18 kn from the SW, dark from 19.
  const friday = Array.from({ length: 18 }, (_, i) => {
    const h = 6 + i;
    const daylight = h >= 7 && h < 19;
    return hour(
      `2026-10-09T${String(h).padStart(2, "0")}:00:00Z`,
      daylight ? 12 + (h % 7) : 8,
      daylight,
      225,
    );
  });

  it("summarises each Irish day from its daylight rows", () => {
    const days = groupDays(spotRows(friday, now, 270, rider));
    // 23:00 UTC is already Saturday in Ireland.
    expect(days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10"]);
    const [day] = days;
    expect(day.windMin).toBe(12);
    expect(day.windMax).toBe(18);
    expect(day.stars).toBeGreaterThan(0);
    expect(day.potential).toBeGreaterThanOrEqual(day.stars);
    expect(compass(day.direction!)).toBe("SW");
    expect(day.best).not.toBeNull();
    expect(day.best!.to).toBeGreaterThan(day.best!.from);
    const saturday = days[1];
    expect(saturday.stars).toBe(0);
    expect(saturday.windMin).toBeNull();
    expect(saturday.best).toBeNull();
  });

  it("names the best window's end as the end of its last row", () => {
    const rows = spotRows(friday, now, 270, rider);
    const best = bestIn(rows)!;
    const last = rows.find((row) => row.time === best.to - HOUR);
    expect(last?.rating?.stars).toBeGreaterThanOrEqual(best.stars);
    expect(best.wing).toBeGreaterThan(0);
    expect(best.own).toBe(false);
  });

  it("folds the dark rows either side of the light ones", () => {
    const rows = spotRows(friday, now, 270, rider);
    const { before, light, after } = darkRuns(rows);
    expect(before).toHaveLength(1);
    expect(light).toHaveLength(12);
    expect(after).toHaveLength(5);
    expect(darkRuns(rows.slice(0, 1)).light).toEqual([]);
  });
});

describe("tide", () => {
  const t = (iso: string) => Date.parse(iso);
  const turns: TideTurn[] = [
    { time: t("2026-10-09T03:00:00Z"), tide: "high", height: 4 },
    { time: t("2026-10-09T09:12:00Z"), tide: "low", height: 1 },
    { time: t("2026-10-09T15:24:00Z"), tide: "high", height: 4.2 },
  ];

  it("passes through every turn and half way at mid-tide", () => {
    expect(tideHeightAt(turns, turns[0].time)).toBeCloseTo(4);
    expect(tideHeightAt(turns, turns[1].time)).toBeCloseTo(1);
    expect(tideHeightAt(turns, t("2026-10-09T06:06:00Z"))).toBeCloseTo(2.5);
  });

  it("is flat at a turn and steepest at mid-tide (cosine, not straight lines)", () => {
    const near = tideHeightAt(turns, turns[1].time - 10 * 60000)!;
    const mid = tideHeightAt(turns, t("2026-10-09T06:06:00Z"))!;
    const midNext = tideHeightAt(turns, t("2026-10-09T06:16:00Z"))!;
    expect(near - 1).toBeLessThan(mid - midNext);
  });

  it("does not extrapolate past the published turns", () => {
    expect(tideHeightAt(turns, t("2026-10-09T02:00:00Z"))).toBeNull();
    expect(tideHeightAt(turns, t("2026-10-09T16:00:00Z"))).toBeNull();
    const curve = tideCurve(
      turns,
      t("2026-10-09T00:00:00Z"),
      t("2026-10-10T00:00:00Z"),
      30,
    );
    expect(curve[0].time).toBe(turns[0].time);
    expect(curve.at(-1)!.time).toBeLessThanOrEqual(turns[2].time);
  });

  it("knows whether it is coming in or going out", () => {
    expect(tideTrend(turns, t("2026-10-09T05:00:00Z"))).toBe("falling");
    expect(tideTrend(turns, t("2026-10-09T12:00:00Z"))).toBe("rising");
    expect(tideTrend(turns, t("2026-10-09T01:00:00Z"))).toBeNull();
  });
});

describe("daylight", () => {
  // Brandon Bay, on an October day.
  const sun = daySun(52.27, -10.0, "2026-10-09");

  it("orders first light, sunrise, sunset and last light", () => {
    expect(sun.firstLight).toBeLessThan(sun.sunrise!);
    expect(sun.sunrise).toBeLessThan(sun.sunset!);
    expect(sun.sunset).toBeLessThan(sun.lastLight!);
    expect(clock(sun.sunrise!)).toMatch(/^0[78]:/);
    expect(clock(sun.sunset!)).toMatch(/^1[89]:/);
  });

  it("shades night and twilight across the day, and nothing in daylight", () => {
    const start = dublinMidnight("2026-10-09");
    const end = nextMidnight("2026-10-09");
    const bands = shadeBands(sun, start, end);
    expect(bands.map((b) => b.kind)).toEqual([
      "night",
      "twilight",
      "twilight",
      "night",
    ]);
    expect(bands[0].from).toBe(start);
    expect(bands[3].to).toBe(end);
    expect(bands[1].to).toBe(sun.sunrise);
    expect(bands[2].from).toBe(sun.sunset);
  });

  it("shades the whole day when the sun never rises", () => {
    expect(
      shadeBands(
        { firstLight: null, sunrise: null, sunset: null, lastLight: null },
        0,
        10,
      ),
    ).toEqual([{ kind: "night", from: 0, to: 10 }]);
  });
});

describe("the day's window and the pen's note", () => {
  const now = Date.parse("2026-10-09T06:00:00Z");
  const rider: Rider = { ...DEFAULT_RIDER, wings: [] };
  // Light all day from the SW onto a beach facing W: cross-onshore. 8 kn in
  // the morning, a 16 kn sweet spot 13:00–15:00 UTC, then 11 kn till dark.
  const knots = (h: number) => (h < 12 ? 8 : h <= 15 ? 16 : 11);
  const rowsFor = (until: number) =>
    spotRows(
      Array.from({ length: until - 6 }, (_, i) => {
        const h = 6 + i;
        return hour(
          `2026-10-09T${String(h).padStart(2, "0")}:00:00Z`,
          knots(h),
          h >= 7 && h < 18,
          225,
        );
      }),
      now,
      270,
      rider,
    );

  it("is the longest run at the day's best stars, and the pen says it", () => {
    const rows = rowsFor(20);
    const window = dayWindow(rows)!;
    expect(window.stars).toBe(
      Math.max(...rows.map((r) => r.rating?.stars ?? 0)),
    );
    expect(
      rows
        .slice(window.first, window.last + 1)
        .every((r) => r.rating?.stars === window.stars),
    ).toBe(true);
    expect(clock(window.from)).toBe("13:00");
    expect(clock(window.to)).toBe("17:00");
    expect(windowHours(window)).toBe("13–16");
    expect(window.tillDark).toBe(false);
  });

  it("picks the week's best by stars, then length", () => {
    const rows = rowsFor(20);
    const window = dayWindow(rows)!;
    const short = { ...window, last: window.first };
    const best = weekBest([
      { date: "2026-10-09", window: short },
      { date: "2026-10-10", window },
      { date: "2026-10-11", window: null },
    ])!;
    expect(best.date).toBe("2026-10-10");
  });

  it("marks a gust that jumps ten knots or sixty per cent", () => {
    expect(gustJumps(8, 13)).toBe(true);
    expect(gustJumps(20, 29)).toBe(false);
    expect(gustJumps(20, 30)).toBe(true);
    expect(gustJumps(12, null)).toBe(false);
  });
});

describe("the chance it rides", () => {
  const rider: Rider = { ...DEFAULT_RIDER, wings: [] };
  const base = hour("2026-10-09T12:00:00Z", 12);

  it("re-rates the members for the rider when the forecast kept them", () => {
    const ensemble = {
      members: 4,
      models: ["GEFS"],
      p10_kn: 6,
      p50_kn: 11,
      p90_kn: 15,
      chance_pct: 75,
      samples: [
        [6, null],
        [9.7, 15.6],
        [11.7, null],
        [15.6, null],
      ] as [number, number | null][],
    };
    expect(hourChance({ ...base, ensemble }, rider)).toBe(75);
    expect(
      hourChance({ ...base, ensemble }, { ...rider, skill: "beginner" }),
    ).toBe(25);
    expect(
      hourChance(
        { ...base, ensemble: { ...ensemble, samples: undefined } },
        { ...rider, skill: "beginner" },
      ),
    ).toBe(75);
    expect(hourChance(base, rider)).toBeNull();
  });
});
