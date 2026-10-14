import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, rateHour } from "../../../../force5/src/stars";
import type { Spot } from "../../../../force5/src/weather";
import { daylightOn, type PlaceHour } from "../../../../src/ratings";
import { stripColumns, stripDays } from "../../../../src/strip";
import { distanceKm, kmText, nearest, placesFor, weekStars, weekTop, weekWords } from "./spotsLogic";

const NOW = Date.parse("2026-10-17T07:20:00Z");
const columns = Array.from({ length: 24 * 8 }, (_, i) => ({
  validTime: new Date(Date.parse("2026-10-17T00:00:00Z") + i * 3600000).toISOString(),
  model: "harmonie",
}));
const strip = stripColumns(columns, NOW, 8);
const days = stripDays(strip);
const place = { lat: 52.13, lon: -9.98 };

function hours(wind: (i: number) => number): PlaceHour[] {
  const light = daylightOn(place, strip.map((c) => c.validTime));
  return strip.map((_, i) => {
    const input = { windKn: wind(i), gustKn: wind(i) + 5, from: 225, agreement: "high" as const, daylight: light[i] };
    return { ...input, rating: rateHour(input, { facing: 270 }, DEFAULT_RIDER) };
  });
}

describe("a place's week", () => {
  it("is unknown until its hours are read, never no stars", () => {
    const week = weekStars(null, days, strip, NOW);
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.kind === "unread")).toBe(true);
    expect(weekWords(week)).toMatch(/^Sat not read yet/);
    expect(weekTop(week)).toBe(0);
  });

  it("gives each day's best stars", () => {
    const week = weekStars(hours((i) => (i % 24 === 13 ? 18 : 5)), days, strip, NOW);
    expect(week[0]).toMatchObject({ kind: "rated", label: "Sat" });
    expect(weekTop(week)).toBeGreaterThanOrEqual(3);
    expect(weekWords(week)).toMatch(/Sat \d stars?/);
  });

  it("says when a day has nothing left", () => {
    const late = Date.parse("2026-10-17T20:00:00Z");
    expect(weekStars(hours(() => 15), days, strip, late)[0].kind).toBe("dark");
  });
});

describe("near me", () => {
  const spots = [
    { id: "a", name: "A", county: "", note: "", lat: 53.35, lon: -6.2 },
    { id: "b", name: "B", county: "", note: "", lat: 52.13, lon: -9.98 },
    { id: "c", name: "C", county: "", note: "", lat: 53.27, lon: -9.05 },
  ] as Spot[];

  it("puts the nearest first", () => {
    const list = nearest(spots, { lat: 53.34, lon: -6.25 }, 2);
    expect(list.map((x) => x.spot.id)).toEqual(["a", "c"]);
    expect(kmText(list[0].km)).toMatch(/^\d\.\d km$/);
    expect(kmText(148.4)).toBe("148 km");
    expect(distanceKm(spots[0], spots[0])).toBe(0);
  });

  it("keeps the rider's order and drops places that are gone", () => {
    const byId = (id: string) => spots.find((s) => s.id === id);
    expect(placesFor(["c", "gone", "a"], byId).map((s) => s.id)).toEqual(["c", "a"]);
  });
});
