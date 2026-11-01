import { describe, expect, it } from "vitest";
import type { ForecastHour, RidingSpot } from "../../mcp/api/forecast";
import {
  POINT_NEARBY,
  framesToRead,
  pointHours,
  pointLines,
  pointPlace,
} from "./point";

const HOUR = 3600000;
const T0 = Date.parse("2026-09-14T09:00:00Z");

const spots: RidingSpot[] = [
  { id: "far", name: "Far Strand", county: "Mayo", lat: 54.2, lon: -9.9 },
  { id: "near", name: "Near Bay", county: "Dublin", lat: 53.35, lon: -6.2 },
  { id: "next", name: "Next Pier", county: "Dublin", lat: 53.3, lon: -6.13 },
];

describe("pointPlace", () => {
  it("names the point by its place, nearest riding places first", () => {
    const point = pointPlace(spots, 53.34123, -6.152);
    expect(point.spot).toEqual({
      id: "@53.3412,-6.1520",
      name: "53.34° N, 6.15° W",
      county: "Dublin",
      lat: 53.34123,
      lon: -6.152,
    });
    expect(point.nearby.map((n) => n.id)).toEqual(["near", "next"]);
    expect(point.nearby[0].distance_km).toBeGreaterThan(0);
    expect(point.lender?.id).toBe("near");
  });

  it("keeps the nearest however far, and lends nothing past the limit", () => {
    const point = pointPlace(spots, 52, -12);
    expect(point.nearby.map((n) => n.id)).toEqual(["far"]);
    expect(point.lender).toBeNull();
  });

  it("lists at most a handful", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      county: "",
      lat: 53.34 + i * 0.001,
      lon: -6.15,
    }));
    expect(pointPlace(many, 53.34, -6.15).nearby).toHaveLength(POINT_NEARBY);
  });
});

describe("framesToRead", () => {
  const frames = [0, 3, 6, 9, 12].map((h) => ({
    validTime: new Date(T0 + h * HOUR).toISOString(),
  }));

  it("reads a frame either side of the stretch, and none beyond", () => {
    expect(framesToRead(frames, T0 + 4 * HOUR, T0 + 7 * HOUR)).toEqual([
      1, 2, 3,
    ]);
    expect(framesToRead(frames, T0 - HOUR, T0 + 30 * HOUR)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("starts a run that follows another where that one ends", () => {
    expect(framesToRead(frames, T0, T0 + 12 * HOUR, T0 + 6 * HOUR)).toEqual([
      2, 3, 4,
    ]);
  });
});

describe("pointLines and pointHours", () => {
  const run = {
    model: "harmonie",
    name: "HARMONIE",
    runTime: new Date(T0 - 6 * HOUR).toISOString(),
    samples: [0, 1, 2].map((h) => ({
      time: T0 + h * HOUR,
      // A west wind of 8 m/s, gusting 11.
      wind: { u: 8, v: 0, gust: 11 },
    })),
  };

  it("reads a run as a riding place's line, and leaves an empty one out", () => {
    const lines = pointLines([
      run,
      { ...run, model: "ecmwf", samples: [{ time: T0, wind: null }] },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].run.id).toBe("harmonie");
    expect(lines[0].points.map((p) => p.time)).toEqual([
      T0,
      T0 + HOUR,
      T0 + 2 * HOUR,
    ]);
  });

  it("gives the lender's hours the point's own wind, and no shore or stars", () => {
    const lender = {
      time: new Date(T0 + HOUR).toISOString(),
      local: "",
      daylight: true,
      wind: null,
      shore: "onshore",
      waves: { height_m: 1.2, period_s: 8, direction_deg: 270 },
      rating: { stars: 3 },
      why_not_rated: "",
      water: { ids: ["x"], replaces_rating: false },
    } as unknown as ForecastHour;
    const [hour] = pointHours([lender], pointLines([run]));
    expect(hour.wind?.wind_kn).toBeCloseTo(15.6, 0);
    expect(hour.wind?.lead).toBe("harmonie");
    expect(hour.shore).toBeNull();
    expect(hour.waves).toEqual(lender.waves);
    expect(hour).not.toHaveProperty("rating");
    expect(hour).not.toHaveProperty("water");
  });
});
