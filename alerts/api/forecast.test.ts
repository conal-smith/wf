/**
 * The service reads the blend by its own road (forecast.ts says why); here it
 * is held to the map's, value for value, so a notification's stars are the
 * chart's.
 */
import { describe, expect, it } from "vitest";
import base from "../../public/spots.json";
import { DEFAULT_RIDER, standardRating, type Rider } from "../../force5/src/stars";
import type { Spot } from "../../force5/src/weather";
import { ridingLocations } from "../../src/locations";
import { daylightOn, type RatedPlace } from "../../src/ratings";
import {
  checkBlendSpots,
  parseSpotBlend,
  SPOT_BLEND_MAX_AGE_HOURS,
  SPOT_BLEND_PATH,
  spotBlendHours,
} from "../../src/spotBlend";
import {
  BLEND_MAX_AGE_HOURS,
  BLEND_PATH,
  blendHours,
  daylight,
  parseBlendPointer,
  modelHours,
  PLACES,
  ratingCache,
  readBlend,
  ridesApart,
  staleBlend,
  type ModelWind,
} from "./forecast";
import { blendFiles, blendSource } from "./testing";

const riders: Rider[] = [
  DEFAULT_RIDER,
  { weightKg: 95, skill: "beginner", wings: [5] },
  { weightKg: 60, skill: "advanced", wings: [3, 4.5] },
  {
    weightKg: 70,
    skill: "intermediate",
    wings: [],
    custom: {
      ...standardRating(DEFAULT_RIDER, "beginner"),
      wind: { min: 15, sweetLow: 18, sweetHigh: 23, max: 27 },
      gust: { fine: 24, worst: 30, most: 3 },
    },
  },
];

/** Two days of everything: calm to a gale, every direction, every agreement. */
const options = {
  start: "2026-10-16T00:00:00Z",
  hours: 48,
  spots: {
    brandon: (_: number, i: number) => ({
      wind: (i * 7) % 34,
      gust: i % 5 ? ((i * 7) % 34) * 1.4 : null,
      from: (i * 37) % 360,
      agreement: (["h", "m", "l", "-"] as const)[i % 4],
    }),
    dollymount: (_: number, i: number) => ({ wind: i % 3 ? 15 + (i % 9) : null, gust: 22, from: 200 }),
  },
};

describe("the blend, as the service reads it", () => {
  it("names its places as the map does, with the same shore", () => {
    const map = new Map(ridingLocations(base as Spot[]).map((s) => [s.id, s]));
    expect(PLACES.size).toBeGreaterThan(100);
    for (const place of PLACES.values()) {
      const spot = map.get(place.id);
      expect(spot, place.id).toBeDefined();
      expect([place.lat, place.lon, place.facing]).toEqual([spot!.lat, spot!.lon, spot!.facing ?? null]);
    }
  });

  it("reads the pointer as parseSpotBlend does, and trusts it as long", () => {
    const { pointer } = blendFiles(options);
    expect(BLEND_PATH).toBe(SPOT_BLEND_PATH);
    expect(BLEND_MAX_AGE_HOURS).toBe(SPOT_BLEND_MAX_AGE_HOURS);
    expect(parseBlendPointer(structuredClone(pointer))).toEqual(parseSpotBlend(structuredClone(pointer)));
    for (const broken of [
      { ...pointer, kind: "wind" },
      { ...pointer, schemaVersion: 1 },
      { ...pointer, times: ["soon"] },
      { ...pointer, base: "../x/" },
      { ...pointer, spots: { ...pointer.spots, keys: ["spotForecasts"] } },
    ]) {
      expect(() => parseBlendPointer(broken)).toThrow();
      expect(() => parseSpotBlend(broken)).toThrow();
    }
    const at = Date.parse(pointer.generatedAt);
    expect(staleBlend(pointer, at + 6 * 3_600_000)).toBe(false);
    expect(staleBlend(pointer, at + 6 * 3_600_000 + 1)).toBe(true);
  });

  it("rates every hour as spotBlendHours does, for every rider", async () => {
    const blend = (await readBlend(blendSource(options)))!;
    const { times } = blendFiles(options);
    const asMap = {
      times,
      sources: blendFiles(options).pointer.sources,
      spotBlend: checkBlendSpots({ times }, blend.spots),
    };
    for (const id of ["brandon", "dollymount"]) {
      const place = PLACES.get(id)!;
      const rated: RatedPlace = { id, lat: place.lat, lon: place.lon, facing: place.facing };
      for (const rider of riders) {
        const ours = blendHours(blend, place, rider)!;
        const map = spotBlendHours(asMap, rated, times, rider)!.map(
          ({ model: _model, ...hour }) => hour,
        );
        expect(ours).toEqual(map);
      }
    }
    // Some of everything was rated, and the night was not.
    const hours = blendHours(blend, PLACES.get("brandon")!, DEFAULT_RIDER)!;
    expect(new Set(hours.map((h) => h.rating?.stars ?? null)).size).toBeGreaterThan(3);
    expect(hours.some((h) => h.windKn !== null && h.rating === null)).toBe(true);
  });

  it("finds the dark where the map does", () => {
    const axis = blendFiles({ ...options, hours: 24 * 9, step: 1 }).times;
    for (const id of ["brandon", "dollymount"]) {
      const place = PLACES.get(id)!;
      expect(daylight(place, axis)).toEqual(daylightOn(place, axis));
    }
  });

  it("rates each place once per rider, and knows nothing of a place it was not given", async () => {
    const blend = (await readBlend(blendSource(options)))!;
    const ratings = ratingCache(blend);
    const a = ratings({ ...DEFAULT_RIDER })("brandon");
    expect(ratings({ ...DEFAULT_RIDER })("brandon")).toBe(a);
    expect(ratings({ weightKg: 70, skill: "advanced", wings: [] })("brandon")).not.toBe(a);
    // A rider's own rating is a rider of its own.
    const own = { ...DEFAULT_RIDER, custom: standardRating(DEFAULT_RIDER, "advanced") };
    expect(ratings(own)("brandon")).not.toBe(a);
    expect(ratings({ ...own })("brandon")).toBe(ratings(own)("brandon"));
    expect(ratings(DEFAULT_RIDER)("keel")).toBeNull();
    expect(ratings(DEFAULT_RIDER)("nowhere")).toBeNull();
  });

  it("rates a rider who picked another model from that model, and only it", async () => {
    const blend = (await readBlend(blendSource(options)))!;
    const gfs: Rider = { ...DEFAULT_RIDER, starsFrom: { model: "gfs" } };
    expect(ridesApart(blend.pointer, DEFAULT_RIDER)).toBe(false);
    expect(ridesApart(blend.pointer, gfs)).toBe(true);
    // A blend from before the ruling serves nobody's stars.
    const old = (await readBlend(blendSource({ ...options, ruleBefore: true })))!;
    expect(ridesApart(old.pointer, DEFAULT_RIDER)).toBe(true);

    // Without the models, a place rated apart is unknown rather than the blend's.
    expect(ratingCache(blend)(gfs)("brandon")).toBeNull();
    expect(ratingCache(blend)(DEFAULT_RIDER)("brandon")).toEqual(
      blendHours(blend, PLACES.get("brandon")!, DEFAULT_RIDER),
    );

    // With them: GFS's own wind, never HARMONIE's.
    const at = Date.parse(options.start);
    const run = (id: string) => ({
      id,
      name: id,
      provider: "test",
      run_time: options.start,
      until: blend.pointer.times.at(-1)!,
      stale: false,
      attribution: "",
      license_url: "",
    });
    const series = (u: number) =>
      blend.pointer.times.map((validTime) => ({ validTime, u, v: 0, gust: u + 2 }));
    const wind = {
      loaded: [
        { run: run("harmonie"), manifest: { spotForecasts: { brandon: series(-9), dollymount: series(-9) } } },
        { run: run("gfs"), manifest: { spotForecasts: { brandon: series(-4), dollymount: series(-4) } } },
      ],
      unavailable: [],
    } as unknown as ModelWind;
    const hours = ratingCache(blend, wind)(gfs)("brandon")!;
    const noon = blend.pointer.times.findIndex((t) => Date.parse(t) === at + 12 * 3_600_000);
    expect(hours[noon].windKn).toBeCloseTo(4 * 1.94384449, 1);
    expect(hours[noon].from).toBe(90);
    expect(hours).toEqual(modelHours(wind, PLACES.get("brandon")!, blend.pointer.times, gfs));
  });

  it("has no blend when none is published", async () => {
    expect(await readBlend({ json: async () => null })).toBeNull();
  });
});
