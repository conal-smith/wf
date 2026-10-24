import { describe, expect, it } from "vitest";
import type { Spot } from "../../force5/src/weather";
import type { PlaceHour } from "../ratings";
import { stripColumns, stripDays } from "../strip";
import {
  distanceKm,
  hourAt,
  listFor,
  markAt,
  nearSpots,
  nearestSpot,
  rankSpots,
  stepHour,
  timelineDays,
  timelineHours,
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

const hour = (stars: number | null): PlaceHour => ({
  windKn: 15,
  gustKn: 20,
  from: 270,
  agreement: null,
  daylight: stars !== null,
  rating: stars === null ? null : ({ stars } as PlaceHour["rating"]),
  model: "harmonie",
});

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

  it("finds the place nearest a point", () => {
    expect(nearestSpot(SPOTS, { lat: 52.3, lon: -10 })?.id).toBe("brandon");
    expect(nearestSpot([], DUBLIN)).toBeNull();
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

describe("the ranking", () => {
  const listed = (
    id: string,
    stars: number | null,
    km: number | null,
  ): Listed => ({
    spot: SPOTS.find((s) => s.id === id)!,
    hour: hour(stars),
    km,
  });

  it("puts the most stars at the chosen hour first", () => {
    const ranked = rankSpots([
      listed("velvet", 2, null),
      listed("bray", 5, null),
      listed("brittas", 4, null),
    ]);
    expect(ranked.map((r) => r.spot.id)).toEqual(["bray", "brittas", "velvet"]);
  });

  it("breaks a tie by the nearer, then by the order they came in", () => {
    const ranked = rankSpots([
      listed("brittas", 3, 60),
      listed("velvet", 3, 9),
      listed("bray", 3, null),
      listed("dollymount", 3, null),
    ]);
    expect(ranked.map((r) => r.spot.id)).toEqual([
      "velvet",
      "brittas",
      "bray",
      "dollymount",
    ]);
  });

  it("puts a dark or unrated hour last", () => {
    const ranked = rankSpots([
      { spot: SPOTS[0], hour: null, km: 1 },
      listed("bray", null, 2),
      listed("brittas", 0, 50),
    ]);
    expect(ranked.map((r) => r.spot.id)).toEqual(["brittas", "velvet", "bray"]);
  });
});

describe("the timeline", () => {
  // 24 October 2026, a Saturday in Irish summer time (UTC+1); the clocks go
  // back on the 25th. Hourly for three days, then three-hourly.
  const now = Date.parse("2026-10-24T13:10:00Z");
  const start = Date.parse("2026-10-23T23:00:00Z");
  const columns = [
    ...Array.from({ length: 72 }, (_, i) => start + i * 3600000),
    ...Array.from(
      { length: 40 },
      (_, i) => start + 72 * 3600000 + i * 3 * 3600000,
    ),
  ].map((t) => ({ validTime: new Date(t).toISOString(), model: "harmonie" }));
  const strip = stripColumns(columns, now);
  const days = stripDays(strip);
  const timeline = timelineDays(strip, days, DUBLIN);
  const at = (iso: string) =>
    strip.findIndex((c) => c.time === Date.parse(iso));

  it("is seven days of daylight hours, labelled by the day", () => {
    expect(timeline).toHaveLength(7);
    expect(timeline[0].label).toBe("Sat 24");
    expect(timeline[1].label).toBe("Sun 25");
    // Dublin's light on 24 October: about 08:10 to 18:15 Irish time.
    const first = timeline[0].hours;
    expect(strip[first[0].at].hour).toBe(9);
    expect(strip[first[first.length - 1].at].hour).toBe(18);
    expect(first.every((h) => h.span === 1)).toBe(true);
  });

  it("keeps a three-hourly day as wide as its hours", () => {
    const later = timeline[4];
    expect(later.hours.every((h) => h.span === 3)).toBe(true);
    expect(later.width).toBe(later.hours.length * 3);
  });

  it("picks the hour under a press along a day", () => {
    const day = timeline[0];
    expect(hourAt(timeline, 0, 0)).toBe(day.hours[0].at);
    expect(hourAt(timeline, 0, 1)).toBe(day.hours[day.hours.length - 1].at);
    expect(hourAt(timeline, 0, 0.5)).toBe(
      day.hours[Math.floor(day.hours.length / 2)].at,
    );
    // Past either end of the strip, the end it is past.
    expect(hourAt(timeline, -3, 0.2)).toBe(hourAt(timeline, 0, 0.2));
    expect(hourAt(timeline, 9, 1)).toBe(timelineHours(timeline).at(-1)!.at);
  });

  it("stands the mark in the middle of the chosen hour, and at the edge of the light in the dark", () => {
    const two = at("2026-10-24T13:00:00Z");
    const mark = markAt(timeline, strip, two)!;
    expect(mark.day).toBe(0);
    expect(hourAt(timeline, mark.day, mark.fraction)).toBe(two);
    expect(markAt(timeline, strip, at("2026-10-24T02:00:00Z"))).toEqual({
      day: 0,
      fraction: 0,
    });
    expect(markAt(timeline, strip, at("2026-10-24T21:00:00Z"))).toEqual({
      day: 0,
      fraction: 1,
    });
  });

  it("moves with the keys along the light, a day at a time, and to the ends", () => {
    const two = at("2026-10-24T13:00:00Z");
    expect(
      strip[stepHour(timeline, strip, days, two, "ArrowRight")!].time,
    ).toBe(Date.parse("2026-10-24T14:00:00Z"));
    expect(strip[stepHour(timeline, strip, days, two, "ArrowLeft")!].time).toBe(
      Date.parse("2026-10-24T12:00:00Z"),
    );
    // From the last light of the day, the next morning's first.
    const last = timeline[0].hours.at(-1)!.at;
    expect(stepHour(timeline, strip, days, last, "ArrowRight")).toBe(
      timeline[1].hours[0].at,
    );
    // The same hour tomorrow: 14:00 Irish time on Sunday, in winter time.
    const tomorrow = stepHour(timeline, strip, days, two, "PageDown")!;
    expect(strip[tomorrow].date).toBe("2026-10-25");
    expect(strip[tomorrow].hour).toBe(14);
    expect(stepHour(timeline, strip, days, two, "Home")).toBe(
      timeline[0].hours[0].at,
    );
    expect(stepHour(timeline, strip, days, two, "End")).toBe(
      timelineHours(timeline).at(-1)!.at,
    );
    expect(stepHour(timeline, strip, days, two, "a")).toBeNull();
  });
});
