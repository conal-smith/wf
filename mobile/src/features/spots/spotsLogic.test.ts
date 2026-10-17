import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, rateHour } from "../../../../force5/src/stars";
import type { Spot } from "../../../../force5/src/weather";
import { daylightOn, type PlaceHour } from "../../../../src/ratings";
import { stripColumns } from "../../../../src/strip";
import { distanceKm, hourWords, kmText, nearest, placesFor, spotHour, whenLabel } from "./spotsLogic";

const NOW = Date.parse("2026-10-17T07:20:00Z");
const columns = Array.from({ length: 24 * 8 }, (_, i) => ({
  validTime: new Date(Date.parse("2026-10-17T00:00:00Z") + i * 3600000).toISOString(),
  model: "harmonie",
}));
const strip = stripColumns(columns, NOW, 8);
const place = { lat: 52.13, lon: -9.98 };

function hours(wind: (i: number) => number): PlaceHour[] {
  const light = daylightOn(place, strip.map((c) => c.validTime));
  return strip.map((_, i) => {
    const input = { windKn: wind(i), gustKn: wind(i) + 5, from: 225, agreement: "high" as const, daylight: light[i] };
    return { ...input, rating: rateHour(input, { facing: 270 }, DEFAULT_RIDER) };
  });
}

describe("a place at the chart's hour", () => {
  // 14:00 UTC on Saturday 17 October: 15:00 in Ireland, in daylight.
  const at = strip.findIndex((c) => c.time === Date.parse("2026-10-17T14:00:00Z"));
  const night = strip.findIndex((c) => c.time === Date.parse("2026-10-17T22:00:00Z"));

  it("is unknown until its hours are read", () => {
    const hour = spotHour(null, at, "kn");
    expect(hour.kind).toBe("unread");
    expect(hourWords(hour, whenLabel(strip[at]))).toBe("Sat 15:00 not read yet");
  });

  it("gives that hour's stars and wind, and no day's best", () => {
    // Windy only at 03:00 UTC, in the dark: the hour shown is what counts.
    const place = hours((i) => (strip[i].time === Date.parse("2026-10-17T03:00:00Z") ? 18 : 15));
    const hour = spotHour(place, at, "kn");
    expect(hour).toMatchObject({ kind: "rated", rating: place[at].rating, wind: "15 g20 · SW" });
    expect(hourWords(hour, whenLabel(strip[at]))).toMatch(/^Sat 15:00, \d stars?, wind 15 g20 · SW$/);
  });

  it("shows nothing for an hour not rated", () => {
    const hour = spotHour(hours(() => 15), night, "kn");
    expect(hour.kind).toBe("unrated");
    expect(hourWords(hour, whenLabel(strip[night]))).toBe("Sat 23:00 not rated");
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
