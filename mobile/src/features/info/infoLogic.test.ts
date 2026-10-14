import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, rateHour } from "../../../../force5/src/stars";
import type { Spot } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import { workedHour } from "./infoLogic";

const NOW = Date.parse("2026-10-17T09:00:00Z");
const strip = Array.from({ length: 72 }, (_, i) => ({ time: NOW + (i - 2) * 3600000 }));
const spot = { id: "inch", name: "Inch", county: "Kerry", note: "", lat: 52.13, lon: -9.98, facing: 270 } as Spot;

const hour = (windKn: number, from: number, daylight = true): PlaceHour => {
  const input = { windKn, gustKn: windKn + 4, from, agreement: "high" as const, daylight };
  return { ...input, rating: rateHour(input, { facing: 270 }, DEFAULT_RIDER) };
};

describe("the worked example", () => {
  it("prefers an hour that lost a star, so there is something to show", () => {
    const row = strip.map((_, i) => (i === 5 ? hour(18, 270) : i === 6 ? hour(18, 225) : hour(4, 225)));
    const picked = workedHour(["inch"], new Map([["inch", row]]), strip, DEFAULT_RIDER, () => spot, NOW)!;
    expect(picked.time).toBe(strip[5].time);
    expect(picked.result.stars).toBeLessThan(picked.result.potential);
    expect(picked.result.stars).toBe(row[5].rating!.stars);
  });

  it("skips the dark, the past and places not read", () => {
    const row = strip.map((_, i) => (i < 2 ? hour(18, 225) : hour(18, 225, false)));
    expect(workedHour(["inch"], new Map([["inch", row]]), strip, DEFAULT_RIDER, () => spot, NOW)).toBeNull();
    expect(workedHour(["inch"], new Map(), strip, DEFAULT_RIDER, () => spot, NOW)).toBeNull();
  });
});
