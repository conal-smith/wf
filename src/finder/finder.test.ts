import { describe, expect, it } from "vitest";
import type { Spot } from "../../force5/src/weather";
import { windCss } from "../../force5/src/weather";
import type { PlaceHour } from "../ratings";
import { clock, irishHour, stripColumns } from "../strip";
import { BAND_TOP_KN, windBand } from "./band";
import {
  HOUR,
  bestStars,
  cardDates,
  centredScroll,
  columnsByTime,
  dayLight,
  dayOpening,
  dayPlan,
  dayRow,
  distanceKm,
  listFor,
  middayColumn,
  nearSpots,
  pickHour,
  rankSpots,
  rideableRun,
  rowEnds,
  rowPosition,
  rowTime,
  shownColumn,
  starColour,
  steppedScroll,
  todayRow,
  weekBest,
  windiest,
  type Listed,
} from "./finder";

const spot = (id: string, lat: number, lon: number): Spot => ({
  id,
  name: id,
  lat,
  lon,
  county: "",
  note: "",
  facing: 90,
});

// Dublin Bay, and places along the east coast and across the country.
const SPOTS = [
  spot("velvet", 53.418, -6.125),
  spot("dollymount", 53.367, -6.145),
  spot("bray", 53.2, -6.095),
  spot("brittas", 52.88, -6.05),
  spot("brandon", 52.276, -10.024),
];
const DUBLIN = { lat: 53.35, lon: -6.26 };

const hour = (
  stars: number | null,
  windKn: number | null = 15,
  gustKn: number | null = 20,
): PlaceHour => ({
  windKn,
  gustKn,
  from: 270,
  agreement: null,
  daylight: stars !== null,
  rating: stars === null ? null : ({ stars } as PlaceHour["rating"]),
  model: "harmonie",
});

/** An hourly strip from `start` for `count` hours, as the chart builds one. */
function hourly(start: string, count: number, now: number) {
  const t0 = Date.parse(start);
  return stripColumns(
    Array.from({ length: count }, (_, i) => ({
      validTime: new Date(t0 + i * HOUR).toISOString(),
      model: "harmonie",
    })),
    now,
  );
}

describe("near you", () => {
  it("measures along the ground", () => {
    // Dublin to Galway is about 186 km as the crow flies.
    expect(distanceKm(DUBLIN, { lat: 53.27, lon: -9.05 })).toBeGreaterThan(180);
    expect(distanceKm(DUBLIN, { lat: 53.27, lon: -9.05 })).toBeLessThan(192);
    expect(distanceKm(DUBLIN, DUBLIN)).toBe(0);
  });

  it("lists the places within 30 km, nearest first", () => {
    const near = nearSpots(SPOTS, DUBLIN);
    expect(near.map((n) => n.spot.id)).toEqual([
      "dollymount",
      "velvet",
      "bray",
    ]);
    expect(near.every((n) => n.km <= 30)).toBe(true);
  });

  it("is empty with no idea where the rider is", () => {
    expect(listFor("near", SPOTS, [], null)).toEqual([]);
  });
});

describe("favourites", () => {
  it("are the starred places, in the order they were starred, and nothing unknown", () => {
    const list = listFor(
      "favourites",
      SPOTS,
      ["brittas", "gone", "velvet"],
      null,
    );
    expect(list.map((l) => l.spot.id)).toEqual(["brittas", "velvet"]);
    expect(list.every((l) => l.km === null)).toBe(true);
  });

  it("say how far each is once the rider is placed", () => {
    const [first] = listFor("favourites", SPOTS, ["velvet"], DUBLIN);
    expect(first.km).toBeGreaterThan(5);
  });
});

describe("the six days", () => {
  it("are today and the five after it, across the clocks going back", () => {
    // Saturday 24 October 2026, 23:30 Irish summer time; the clocks go back
    // at 02:00 on the Sunday, a day of 25 hours.
    expect(cardDates(Date.parse("2026-10-24T22:30:00Z"))).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
    ]);
  });

  it("have first light and last light at the place, civil dawn to civil dusk", () => {
    const light = dayLight(DUBLIN, "2026-10-25")!;
    // Dublin on 25 October, in winter time: about 06:40 to 17:40.
    expect(clock(light.firstLight)).toMatch(/^06:[2-5]\d$/);
    expect(clock(light.lastLight)).toMatch(/^17:[2-5]\d$/);
  });
});

describe("today's row of hours", () => {
  it("runs from the hour before first light to the hour after last light", () => {
    // Sunday 25 October 2026, 13:20 Irish (and UTC) time.
    const now = Date.parse("2026-10-25T13:20:00Z");
    const strip = hourly("2026-10-25T00:00:00Z", 48, now);
    const row = todayRow(strip, DUBLIN, now)!;
    const light = dayLight(DUBLIN, "2026-10-25")!;
    expect(row.firstLight).toBe(light.firstLight);
    const first = row.hours[0];
    const last = row.hours[row.hours.length - 1];
    expect(irishHour(first.time)).toBe(irishHour(light.firstLight));
    expect(first.time).toBeLessThan(light.firstLight);
    expect(light.firstLight - first.time).toBeLessThanOrEqual(HOUR);
    expect(last.time).toBeGreaterThan(light.lastLight);
    expect(last.time - light.lastLight).toBeLessThanOrEqual(HOUR);
    // An hour a column, each with its own column of the strip.
    row.hours.forEach((h, i) => {
      if (i) expect(h.time - row.hours[i - 1].time).toBe(HOUR);
      expect(strip[h.at!].time).toBe(h.time);
    });
    // The two ends are the dark; the hours in between are lit.
    expect(first.dark).toBe(true);
    expect(last.dark).toBe(true);
    expect(row.hours.slice(1, -1).every((h) => !h.dark)).toBe(true);
    // Now is 13:00, and the hours before it are gone.
    const now13 = row.hours.find((h) => h.now)!;
    expect(irishHour(now13.time)).toBe(13);
    expect(row.hours.filter((h) => h.now)).toHaveLength(1);
    expect(
      row.hours.filter((h) => h.gone).every((h) => h.time < now13.time),
    ).toBe(true);
    expect(row.hours.filter((h) => !h.gone)[0]).toBe(now13);
  });

  it("holds a long June day, 04:00 to 23:00, as the mock-up's June", () => {
    const now = Date.parse("2026-06-21T11:00:00Z");
    const strip = hourly("2026-06-20T23:00:00Z", 30, now);
    const row = todayRow(strip, DUBLIN, now)!;
    expect(irishHour(row.hours[0].time)).toBe(4);
    expect(irishHour(row.hours.at(-1)!.time)).toBe(23);
    expect(row.hours).toHaveLength(20);
  });

  it("keeps an hour the forecast does not reach, with no column", () => {
    const now = Date.parse("2026-10-25T13:20:00Z");
    // The run starts at 10:00: the morning's hours have no column.
    const strip = hourly("2026-10-25T10:00:00Z", 30, now);
    const row = todayRow(strip, DUBLIN, now)!;
    expect(row.hours[0].at).toBeNull();
    expect(row.hours.find((h) => irishHour(h.time) === 10)!.at).toBe(0);
  });
});

describe("a day chosen, hour by hour", () => {
  const now = Date.parse("2026-10-25T13:20:00Z");
  // Hourly for two days, then three-hourly.
  const start = Date.parse("2026-10-25T00:00:00Z");
  const strip = stripColumns(
    [
      ...Array.from({ length: 48 }, (_, i) => start + i * HOUR),
      ...Array.from({ length: 40 }, (_, i) => start + (48 + i * 3) * HOUR),
    ].map((t) => ({ validTime: new Date(t).toISOString(), model: "x" })),
    now,
  );

  it("is a column an hour where the run is hourly, none now and none gone", () => {
    const row = dayRow(strip, DUBLIN, "2026-10-26", now)!;
    expect(row.date).toBe("2026-10-26");
    const light = dayLight(DUBLIN, "2026-10-26")!;
    expect(row.hours[0].time).toBeLessThan(light.firstLight);
    expect(row.hours.at(-1)!.time).toBeGreaterThan(light.lastLight);
    row.hours.forEach((h, i) => {
      if (i) expect(h.time - row.hours[i - 1].time).toBe(HOUR);
      expect(h.at).not.toBeNull();
    });
    expect(row.hours.some((h) => h.now || h.gone)).toBe(false);
    expect(row.hours[0].dark && row.hours.at(-1)!.dark).toBe(true);
  });

  it("is the run's own steps where it is three-hourly, from the one before first light to the one after last", () => {
    const row = dayRow(strip, DUBLIN, "2026-10-29", now)!;
    const light = dayLight(DUBLIN, "2026-10-29")!;
    // About 06:45 to 17:30: 06:00 to 18:00, three hours a column.
    expect(row.hours.map((h) => irishHour(h.time))).toEqual([6, 9, 12, 15, 18]);
    expect(row.hours.every((h) => h.at !== null)).toBe(true);
    expect(row.hours[0].time).toBeLessThan(light.firstLight);
    expect(row.hours.at(-1)!.time).toBeGreaterThan(light.lastLight);
    expect(row.hours.map((h) => h.dark)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  it("keeps the hour now where the strip steps over it", () => {
    // Fifteen and seventeen hundred, and the time now between them.
    const late = Date.parse("2026-10-25T16:20:00Z");
    const gap = stripColumns(
      [15, 17, 18, 19].map((h) => ({
        validTime: new Date(start + h * HOUR).toISOString(),
        model: "x",
      })),
      late,
    );
    const row = dayRow(gap, DUBLIN, "2026-10-25", late)!;
    const hours = row.hours.map((h) => irishHour(h.time));
    expect(hours).toContain(16);
    expect(row.hours.find((h) => h.now)!.at).toBeNull();
    // The morning before the strip begins is kept, empty.
    expect(hours.slice(0, 3)).toEqual([6, 7, 8]);
  });

  it("opens on the day's early afternoon", () => {
    expect(irishHour(strip[dayOpening(strip, "2026-10-26", now)!].time)).toBe(
      13,
    );
    expect(irishHour(strip[dayOpening(strip, "2026-10-29", now)!].time)).toBe(
      12,
    );
    expect(dayOpening(strip, "2026-12-25", now)).toBeNull();
  });

  it("stands a time along its columns, and back", () => {
    const h = (n: number) => start + n * HOUR;
    // Hourly, then three-hourly.
    const times = [h(6), h(7), h(8), h(11), h(14)];
    expect(rowPosition(times, h(7))).toBe(1);
    expect(rowPosition(times, h(7.5))).toBe(1.5);
    expect(rowPosition(times, h(9.5))).toBe(2.5);
    expect(rowPosition(times, h(14))).toBe(4);
    // Past either end, an hour a column.
    expect(rowPosition(times, h(5.5))).toBe(-0.5);
    expect(rowPosition(times, h(14.5))).toBe(4.5);
    for (const p of [-0.5, 0, 0.25, 1, 2.5, 3.75, 4, 4.5])
      expect(rowPosition(times, rowTime(times, p))).toBeCloseTo(p, 9);
    expect(rowPosition([], h(3))).toBe(0);
  });
});

describe("the next days", () => {
  const now = Date.parse("2026-10-25T13:20:00Z");
  // Hourly for two days, then three-hourly.
  const start = Date.parse("2026-10-25T00:00:00Z");
  const strip = stripColumns(
    [
      ...Array.from({ length: 48 }, (_, i) => start + i * HOUR),
      ...Array.from({ length: 40 }, (_, i) => start + (48 + i * 3) * HOUR),
    ].map((t) => ({ validTime: new Date(t).toISOString(), model: "x" })),
    now,
  );

  it("keep each day's columns from first light to last, at the run's cadence", () => {
    const monday = dayPlan(strip, DUBLIN, "2026-10-26")!;
    const light = dayLight(DUBLIN, "2026-10-26")!;
    expect(monday.columns.length).toBeGreaterThan(9);
    for (const at of monday.columns) {
      expect(strip[at].time).toBeGreaterThanOrEqual(light.firstLight);
      expect(strip[at].time).toBeLessThanOrEqual(light.lastLight);
    }
    const thursday = dayPlan(strip, DUBLIN, "2026-10-29")!;
    expect(thursday.columns.length).toBeLessThan(6);
    expect(
      strip[thursday.columns[1]].time - strip[thursday.columns[0]].time,
    ).toBe(3 * HOUR);
  });

  it("say a day's best stars, its run worth riding and its windiest hour", () => {
    const row = [
      hour(0, 8),
      hour(2, 14),
      hour(4, 18),
      hour(3, 22),
      hour(0, 26),
      hour(1, 12),
    ];
    const all = [0, 1, 2, 3, 4, 5];
    expect(bestStars(row, all)).toBe(4);
    expect(bestStars(row, [0, 4])).toBe(0);
    expect(rideableRun(row, all)).toEqual({ from: 1, to: 3, stars: 4 });
    expect(rideableRun(row, [0, 4])).toBeNull();
    expect(windiest(row, all)).toBe(4);
    expect(windiest([hour(null, null)], [0])).toBeNull();
  });

  it("sum a day up at early afternoon, or now on a day past it", () => {
    const monday = dayPlan(strip, DUBLIN, "2026-10-26")!;
    expect(
      irishHour(strip[middayColumn(strip, monday.columns, now)!].time),
    ).toBe(13);
    const today = dayPlan(strip, DUBLIN, "2026-10-25")!;
    const late = Date.parse("2026-10-25T15:30:00Z");
    expect(
      irishHour(strip[middayColumn(strip, today.columns, late)!].time),
    ).toBe(15);
    expect(middayColumn(strip, [], now)).toBeNull();
  });
});

describe("the order", () => {
  const now = Date.parse("2026-10-25T13:20:00Z");
  const strip = hourly("2026-10-25T00:00:00Z", 24 * 7, now);
  const dates = cardDates(now);
  const at = (iso: string) => columnsByTime(strip).get(Date.parse(iso))!;
  /** A row with stars at the given hours, none elsewhere. */
  const row = (stars: Record<string, number>) => {
    const r: (PlaceHour | null)[] = strip.map(() => hour(0));
    for (const [iso, n] of Object.entries(stars)) r[at(iso)] = hour(n);
    return r;
  };

  it("takes a place's best of the six days, the soonest day it comes", () => {
    expect(
      weekBest(
        row({ "2026-10-27T12:00:00Z": 4, "2026-10-26T12:00:00Z": 4 }),
        strip,
        dates,
        now,
      ),
    ).toEqual({ stars: 4, day: 1 });
    // Today's hours count from the hour now on, not the morning's.
    expect(
      weekBest(
        row({ "2026-10-25T09:00:00Z": 5, "2026-10-25T15:00:00Z": 3 }),
        strip,
        dates,
        now,
      ),
    ).toEqual({ stars: 3, day: 0 });
    // Past the sixth day, nothing.
    expect(
      weekBest(row({ "2026-10-31T12:00:00Z": 5 }), strip, dates, now),
    ).toEqual({ stars: 0, day: null });
    // Not yet rated.
    expect(weekBest(undefined, strip, dates, now)).toEqual({
      stars: -1,
      day: null,
    });
  });

  const listed = (
    id: string,
    stars: number,
    day: number | null,
    km: number | null,
  ): Listed => ({
    spot: SPOTS.find((s) => s.id === id)!,
    km,
    best: { stars, day },
  });

  it("puts the most stars first, then the soonest, then the nearest", () => {
    const ranked = rankSpots([
      listed("velvet", 3, 0, 5),
      listed("bray", 5, 4, 30),
      listed("brittas", 5, 1, 60),
      listed("dollymount", 5, 1, 4),
    ]);
    expect(ranked.map((r) => r.spot.id)).toEqual([
      "dollymount",
      "brittas",
      "bray",
      "velvet",
    ]);
  });

  it("breaks a last tie by the order they came in, and puts the unrated last", () => {
    const ranked = rankSpots([
      listed("bray", -1, null, 1),
      listed("brittas", 0, null, null),
      listed("velvet", 0, null, null),
      listed("dollymount", 2, 3, null),
    ]);
    expect(ranked.map((r) => r.spot.id)).toEqual([
      "dollymount",
      "brittas",
      "velvet",
      "bray",
    ]);
  });
});

describe("the hour picked", () => {
  const now = Date.parse("2026-10-25T13:20:00Z");
  const strip = hourly("2026-10-25T00:00:00Z", 48, now);

  it("is the hour pressed, and none again for the hour now", () => {
    expect(pickHour(Date.parse("2026-10-25T16:00:00Z"), now)).toBe(
      Date.parse("2026-10-25T16:00:00Z"),
    );
    expect(pickHour(Date.parse("2026-10-25T09:00:00Z"), now)).toBe(
      Date.parse("2026-10-25T09:00:00Z"),
    );
    expect(pickHour(Date.parse("2026-10-25T13:00:00Z"), now)).toBeNull();
  });

  it("on a day chosen, is none again for the hour the day opens on", () => {
    const opening = Date.parse("2026-10-27T13:00:00Z");
    expect(pickHour(Date.parse("2026-10-27T13:00:00Z"), opening)).toBeNull();
    expect(pickHour(Date.parse("2026-10-27T09:00:00Z"), opening)).toBe(
      Date.parse("2026-10-27T09:00:00Z"),
    );
  });

  it("turns every card's rose to its column, or the chart's opening one with none", () => {
    const opening = 13;
    expect(shownColumn(strip, null, opening)).toBe(13);
    expect(
      strip[shownColumn(strip, Date.parse("2026-10-25T16:00:00Z"), opening)!]
        .time,
    ).toBe(Date.parse("2026-10-25T16:00:00Z"));
    expect(
      shownColumn(strip, Date.parse("2026-11-05T16:00:00Z"), opening),
    ).toBeNull();
    expect(shownColumn([], null, 0)).toBeNull();
  });
});

describe("the row's scroll", () => {
  it("stands a column in the middle, held to the ends", () => {
    // 13 columns of 54px in a 300px view.
    const all = 13 * 54;
    expect(centredScroll(7 * 54, 54, 300, all)).toBe(7 * 54 + 27 - 150);
    expect(centredScroll(0, 54, 300, all)).toBe(0);
    expect(centredScroll(12 * 54, 54, 300, all)).toBe(all - 300);
    expect(centredScroll(3 * 54, 54, 900, all)).toBe(0);
  });

  it("steps most of a view either way, and stops at the ends", () => {
    expect(steppedScroll(100, 1, 300, 700)).toBe(280);
    expect(steppedScroll(100, -1, 300, 700)).toBe(0);
    expect(steppedScroll(380, 1, 300, 700)).toBe(400);
  });

  it("says whether there is more either side", () => {
    expect(rowEnds(0, 300, 700)).toEqual({ before: false, after: true });
    expect(rowEnds(200, 300, 700)).toEqual({ before: true, after: true });
    expect(rowEnds(400, 300, 700)).toEqual({ before: true, after: false });
    expect(rowEnds(0, 700, 700)).toEqual({ before: false, after: false });
  });
});

describe("the stars' colours", () => {
  it("are the theme's, one to five, and none has none", () => {
    expect([1, 2, 3, 4, 5].map(starColour)).toEqual([
      "var(--color-stars-1)",
      "var(--color-stars-2)",
      "var(--color-stars-3)",
      "var(--color-stars-4)",
      "var(--color-stars-5)",
    ]);
    expect(starColour(0)).toBeNull();
    expect(starColour(null)).toBeNull();
    expect(starColour(undefined)).toBeNull();
    expect(starColour(7)).toBe("var(--color-stars-5)");
  });
});

describe("the wind band", () => {
  const box = { x0: 0, x1: 100, top: 10, base: 100 };

  it("fills from the base up to the mean, held out to either edge", () => {
    const band = windBand(
      [
        { x: 25, mean: 0, gust: null },
        { x: 75, mean: BAND_TOP_KN, gust: null },
      ],
      box,
    )!;
    expect(band.area).toBe("M0 100L0 100L25 100L75 10L100 10L100 100Z");
    expect(band.line).toBe("M0 100L25 100L75 10L100 10");
    // No gust over the mean: no gust layer.
    expect(band.gusts).toBeNull();
    expect(band.gustLine).toBeNull();
  });

  it("lays the gusts over the mean in their own colour, and the mean in its", () => {
    const band = windBand(
      [
        { x: 0, mean: 15, gust: 25 },
        { x: 50, mean: 20, gust: null },
        { x: 100, mean: 10, gust: 30 },
      ],
      box,
    )!;
    expect(band.gusts).toMatch(/^M.*Z$/);
    expect(band.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(band.stops[0]).toEqual({
      offset: 0,
      mean: windCss(15),
      gust: windCss(25),
    });
    // Where there is no gust, the layer closes onto the mean.
    expect(band.stops[1].gust).toBe(windCss(20));
  });

  it("draws nothing with no wind", () => {
    expect(windBand([], box)).toBeNull();
  });
});
