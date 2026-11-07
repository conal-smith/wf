import { describe, expect, it } from "vitest";
import type { Spot } from "../../force5/src/weather";
import type { PlaceHour } from "../ratings";
import { clock, irishDate, irishHour, stripColumns } from "../strip";
import {
  HOUR,
  IRELAND_CENTRE,
  MAX_CARDS,
  NEAREST_COUNT,
  bestStars,
  cardDates,
  chooseCards,
  columnsByTime,
  dayLight,
  dayOpening,
  dayRow,
  distanceKm,
  listFor,
  middayColumn,
  nearSpots,
  nearestHour,
  nearestSpots,
  openingDay,
  openingScope,
  orderSpots,
  pickHour,
  rankSpots,
  scopeAddress,
  scopeInAddress,
  shownColumn,
  spotsInView,
  todayOver,
  todayRow,
  withStars,
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

  it("round the rider's own place, is every place within 30 km, each with its distance", () => {
    const list = listFor("near", SPOTS, [], DUBLIN, true);
    expect(list.map((l) => l.spot.id)).toEqual([
      "dollymount",
      "velvet",
      "bray",
    ]);
    expect(list.every((l) => l.km !== null && l.km <= 30)).toBe(true);
  });

  it("round a place that is not the rider's, is the nearest however far, with no distances", () => {
    // The middle of Ireland has nothing within 30 km.
    expect(nearSpots(SPOTS, IRELAND_CENTRE)).toEqual([]);
    const list = listFor("near", SPOTS, [], IRELAND_CENTRE, false);
    expect(list.map((l) => l.spot.id)).toEqual(
      nearestSpots(SPOTS, IRELAND_CENTRE).map((n) => n.spot.id),
    );
    expect(list).toHaveLength(SPOTS.length);
    expect(list.every((l) => l.km === null)).toBe(true);
  });

  it("the nearest are a dozen at most, nearest first", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      spot(`s${i}`, 51.5 + i * 0.1, -9),
    );
    const nearest = nearestSpots(many, { lat: 51.5, lon: -9 });
    expect(NEAREST_COUNT).toBe(12);
    expect(nearest).toHaveLength(12);
    expect(nearest.map((n) => n.spot.id)).toEqual(
      many.slice(0, 12).map((s) => s.id),
    );
    expect(nearestSpots(many, { lat: 51.5, lon: -9 }, 3)).toHaveLength(3);
  });
});

describe("the tab the finder opens on", () => {
  it("is Favourites once a place is starred", () => {
    expect(openingScope(["brandon"])).toBe("favourites");
  });

  it("is Near you on a first visit, with nothing starred", () => {
    expect(openingScope([])).toBe("near");
  });
});

describe("the tab in the address", () => {
  it("is read from ?tab=, and nothing else is a tab", () => {
    expect(scopeInAddress("?tab=favourites")).toBe("favourites");
    expect(scopeInAddress("?tab=near&settings")).toBe("near");
    expect(scopeInAddress("")).toBeNull();
    expect(scopeInAddress("?tab=all")).toBeNull();
    expect(scopeInAddress("?map")).toBeNull();
  });

  it("is written in, the rest of the address kept", () => {
    expect(scopeAddress("https://wingfoil.ie/", "near")).toBe("/?tab=near");
    expect(
      scopeAddress("https://wingfoil.ie/?tab=near&x=1#top", "favourites"),
    ).toBe("/?tab=favourites&x=1#top");
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

  it("say no distance from a place the rider is not at", () => {
    const [first] = listFor("favourites", SPOTS, ["velvet"], DUBLIN, false);
    expect(first.km).toBeNull();
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
});

describe("the hour now, and the evening", () => {
  // Tuesday 3 November 2026, Irish winter time (GMT): Dublin's light is
  // about 06:50 to 17:25, so its row runs 06:00 to 18:00.
  const strip = (now: number) =>
    hourly(`${irishDate(now)}T00:00:00Z`, 24 * 7, now);
  const KEEL = { lat: 53.97, lon: -10.08 };

  it("is the nearest hour, as a clock is read", () => {
    expect(nearestHour(Date.parse("2026-11-03T19:59:00Z"))).toBe(
      Date.parse("2026-11-03T20:00:00Z"),
    );
    expect(nearestHour(Date.parse("2026-11-03T13:20:00Z"))).toBe(
      Date.parse("2026-11-03T13:00:00Z"),
    );
    expect(nearestHour(Date.parse("2026-11-03T13:30:00Z"))).toBe(
      Date.parse("2026-11-03T14:00:00Z"),
    );
  });

  it("marks the nearest hour on today's row, not the one it is in", () => {
    const now = Date.parse("2026-11-03T13:40:00Z");
    const row = todayRow(strip(now), DUBLIN, now)!;
    expect(irishHour(row.hours.find((h) => h.now)!.time)).toBe(14);
    expect(row.hours.find((h) => irishHour(h.time) === 13)!.gone).toBe(true);
  });

  it("leaves the hour now off the row after dark: 19:59 is not 18:00", () => {
    const now = Date.parse("2026-11-03T19:59:00Z");
    const row = todayRow(strip(now), DUBLIN, now)!;
    expect(irishHour(row.hours.at(-1)!.time)).toBe(18);
    expect(row.hours.some((h) => h.now)).toBe(false);
    expect(row.hours.every((h) => h.gone)).toBe(true);
  });

  it("is over once the hour now is past the end of today's row", () => {
    const at = (iso: string) => Date.parse(iso);
    // 18:00 is still on the row, and 18:29 is nearest it.
    expect(todayOver([DUBLIN], at("2026-11-03T18:00:00Z"))).toBe(false);
    expect(todayOver([DUBLIN], at("2026-11-03T18:29:00Z"))).toBe(false);
    // 18:30 is nearest 19:00, past it; so is the owner's 19:59, and 20:30.
    expect(todayOver([DUBLIN], at("2026-11-03T18:30:00Z"))).toBe(true);
    expect(todayOver([DUBLIN], at("2026-11-03T19:59:00Z"))).toBe(true);
    expect(todayOver([DUBLIN], at("2026-11-03T20:30:00Z"))).toBe(true);
    // Before first light, the day is to come.
    expect(todayOver([DUBLIN], at("2026-11-03T05:00:00Z"))).toBe(false);
    // With none listed, the middle of Ireland stands for them.
    expect(todayOver([], at("2026-11-03T19:59:00Z"))).toBe(true);
    expect(todayOver([], at("2026-11-03T15:00:00Z"))).toBe(false);
  });

  it("waits for the place listed whose light lasts longest", () => {
    // 10 April 2026, Irish summer time: Dublin's last light is about 20:50,
    // its row ending at 21:00; Keel's, out west, about 21:10, its row ending
    // at 22:00. At 21:40 Irish (nearest 22:00) Dublin's day is over, Keel's
    // is not.
    const late = Date.parse("2026-04-10T20:40:00Z");
    expect(todayOver([DUBLIN], late)).toBe(true);
    expect(todayOver([KEEL], late)).toBe(false);
    expect(todayOver([DUBLIN, KEEL], late)).toBe(false);
    const row = dayRow(strip(late), KEEL, "2026-04-10", late)!;
    expect(irishHour(row.hours.at(-1)!.time)).toBe(22);
  });

  it("opens the finder on tomorrow after dark, at tomorrow's early afternoon", () => {
    for (const iso of ["2026-11-03T19:59:00Z", "2026-11-03T20:30:00Z"]) {
      const now = Date.parse(iso);
      const dates = cardDates(now);
      const day = openingDay(dates, [DUBLIN], now);
      expect(day).toBe("2026-11-04");
      const s = strip(now);
      expect(clock(s[dayOpening(s, day, now)!].time)).toBe("13:00");
    }
    // In the afternoon, today.
    const now = Date.parse("2026-11-03T15:00:00Z");
    expect(openingDay(cardDates(now), [DUBLIN], now)).toBe("2026-11-03");
    // Just after midnight it is a new today, not the day after it.
    const night = Date.parse("2026-11-04T00:10:00Z");
    expect(openingDay(cardDates(night), [DUBLIN], night)).toBe("2026-11-04");
  });

  it("rolls over in Irish summer time too, an hour off UTC", () => {
    // 22 June 2026: Dublin's row ends at 23:00 Irish, 22:00 UTC.
    const before = Date.parse("2026-06-22T21:20:00Z"); // 22:20 Irish
    const after = Date.parse("2026-06-22T22:40:00Z"); // 23:40 Irish
    expect(openingDay(cardDates(before), [DUBLIN], before)).toBe("2026-06-22");
    expect(openingDay(cardDates(after), [DUBLIN], after)).toBe("2026-06-23");
  });
});

describe("a day's opening hour", () => {
  const now = Date.parse("2026-10-25T13:20:00Z");
  const start = Date.parse("2026-10-25T00:00:00Z");
  const strip = stripColumns(
    Array.from({ length: 48 }, (_, i) => ({
      validTime: new Date(start + i * HOUR).toISOString(),
      model: "x",
    })),
    now,
  );
  const columns = (date: string) =>
    strip.flatMap((c, at) => (c.date === date ? [at] : []));

  it("is early afternoon, or the last hour on a day past it", () => {
    expect(
      irishHour(strip[middayColumn(strip, columns("2026-10-26"), now)!].time),
    ).toBe(13);
    const late = Date.parse("2026-10-25T15:30:00Z");
    expect(
      irishHour(strip[middayColumn(strip, columns("2026-10-25"), late)!].time),
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

  it("takes a place's best of some days, the soonest day it comes", () => {
    expect(
      bestStars(
        row({ "2026-10-27T12:00:00Z": 4, "2026-10-26T12:00:00Z": 4 }),
        strip,
        dates,
        now,
      ),
    ).toEqual({ stars: 4, day: 1 });
    // Today's hours count from the hour now on, not the morning's.
    expect(
      bestStars(
        row({ "2026-10-25T09:00:00Z": 5, "2026-10-25T15:00:00Z": 3 }),
        strip,
        dates,
        now,
      ),
    ).toEqual({ stars: 3, day: 0 });
    // Past the sixth day, nothing.
    expect(
      bestStars(row({ "2026-10-31T12:00:00Z": 5 }), strip, dates, now),
    ).toEqual({ stars: 0, day: null });
    // Of one day, as the finder asks of the day shown: that day's best.
    expect(
      bestStars(
        row({ "2026-10-27T12:00:00Z": 5, "2026-10-26T12:00:00Z": 2 }),
        strip,
        ["2026-10-26"],
        now,
      ),
    ).toEqual({ stars: 2, day: 0 });
    // Not yet rated.
    expect(bestStars(undefined, strip, dates, now)).toEqual({
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

describe("the list's order and its stars", () => {
  const item = (
    id: string,
    name: string,
    km: number | null,
    stars: number,
  ): Listed => ({
    spot: { ...spot(id, 53, -9), name },
    km,
    best: { stars, day: stars > 0 ? 0 : null },
  });
  const list = [
    item("b", "Brandon Bay", 40, 5),
    item("k", "Keel Beach", null, 3),
    item("d", "Dollymount", 4, 4),
    item("u", "Unrated", 10, -1),
  ];
  const ids = (l: Listed[]) => l.map((x) => x.spot.id);

  it("keeps the ranking for the best first", () => {
    expect(ids(orderSpots(list, "best"))).toEqual(["b", "k", "d", "u"]);
  });

  it("puts the nearest first, a place with no distance last", () => {
    expect(ids(orderSpots(list, "near"))).toEqual(["d", "u", "b", "k"]);
  });

  it("puts the names A to Z", () => {
    expect(ids(orderSpots(list, "name"))).toEqual(["b", "d", "k", "u"]);
  });

  it("keeps the places with at least so many stars, and none not rated yet", () => {
    expect(ids(withStars(list, 0))).toEqual(["b", "k", "d", "u"]);
    expect(ids(withStars(list, 4))).toEqual(["b", "d"]);
    expect(ids(withStars(list, 5))).toEqual(["b"]);
  });
});

describe("the spots in the map's view", () => {
  const place = (id: string, lat: number, lon: number) =>
    ({ id, name: id, lat, lon }) as Spot;
  const dublin = place("dublin", 53.35, -6.26);
  const galway = place("galway", 53.27, -9.05);
  const kerry = place("kerry", 52.25, -10.05);
  const spots = [kerry, galway, dublin];
  const east = { west: -7, south: 53, east: -5, north: 54 };

  it("keeps the spots inside the view and leaves the rest out", () => {
    expect(spotsInView(spots, east, null).map((l) => l.spot.id)).toEqual([
      "dublin",
    ]);
    expect(
      spotsInView(
        spots,
        { west: -11, south: 52, east: -8, north: 54 },
        null,
      ).map((l) => l.spot.id),
    ).toHaveLength(2);
  });

  it("counts a spot on the edge as in view", () => {
    const edge = { west: -6.26, south: 53.35, east: -6, north: 53.5 };
    expect(spotsInView(spots, edge, null)).toHaveLength(1);
  });

  it("is empty over open sea, and for a view that makes no sense", () => {
    const sea = { west: -20, south: 50, east: -15, north: 52 };
    expect(spotsInView(spots, sea, null)).toEqual([]);
    expect(spotsInView(spots, { ...east, west: Number.NaN }, null)).toEqual([]);
    expect(spotsInView(spots, { ...east, west: 0, east: -1 }, null)).toEqual(
      [],
    );
  });

  it("gives the nearest the view's middle first", () => {
    const all = { west: -11, south: 52, east: -5, north: 54 };
    const middling = place("middling", 53, -8);
    expect(spotsInView([kerry, dublin, middling], all, null)[0].spot.id).toBe(
      "middling",
    );
  });

  it("gives a distance only from the rider's own place", () => {
    expect(spotsInView(spots, east, null)[0].km).toBeNull();
    expect(spotsInView(spots, east, dublin)[0].km).toBe(0);
    expect(spotsInView(spots, east, galway)[0].km).toBeCloseTo(
      distanceKm(galway, dublin),
    );
  });

  it("reads a view past the antimeridian, as MapLibre gives it", () => {
    const fiji = place("fiji", -17, 179);
    const samoa = place("samoa", -14, -172);
    const tonga = place("tonga", -21, -175);
    const pacific = { west: 170, south: -25, east: 190, north: -10 };
    expect(
      spotsInView([fiji, samoa, tonga, dublin], pacific, null)
        .map((l) => l.spot.id)
        .sort(),
    ).toEqual(["fiji", "samoa", "tonga"]);
    // And more than one copy of the world.
    expect(
      spotsInView(spots, { west: -400, south: 0, east: 400, north: 60 }, null),
    ).toHaveLength(3);
  });
});

describe("the cards a list comes to", () => {
  const listed = (count: number): Listed[] =>
    Array.from({ length: count }, (_, at) => ({
      spot: {
        id: `s${at}`,
        name: `Spot ${count - at}`,
        lat: 53,
        lon: -8,
      } as Spot,
      km: at,
      best: { stars: at % 5, day: 0 },
    }));

  it("keeps the best up to the cap, and says how many there were", () => {
    const { cards, total } = chooseCards(listed(160), "best", 0, MAX_CARDS);
    expect(cards).toHaveLength(30);
    expect(total).toBe(160);
    expect(cards.every((card) => card.best.stars === 4)).toBe(true);
  });

  it("has no cap unless it is given one", () => {
    expect(chooseCards(listed(149), "best", 0).cards).toHaveLength(149);
  });

  it("counts the spots with the stars asked for, not every one", () => {
    const { cards, total } = chooseCards(listed(160), "best", 4, MAX_CARDS);
    expect(total).toBe(32);
    expect(cards).toHaveLength(30);
  });

  it("puts the best in the rider's order, not the first by name", () => {
    const { cards } = chooseCards(listed(160), "name", 0, MAX_CARDS);
    expect(cards.every((card) => card.best.stars === 4)).toBe(true);
    const names = cards.map((card) => card.spot.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, "en-IE")),
    );
  });
});
