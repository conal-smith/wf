import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../../force5/src/manifests";
import { KNOTS } from "../../force5/src/units";
import {
  WAVE_MODELS,
  WEATHER_MODELS,
  WIND_MODELS,
  findSessions,
  findSpot,
  loadSpots,
  rideChance,
  spotForecast,
  windowFor,
  type RidingSpot,
} from "./forecast";
import { FIXTURE_NOW, fixtureSource } from "./testing";
import { WAVE_SOURCE_PREFERENCE } from "../../force5/src/waves";

const HOUR = 3600000;
const pick = (kind: string) =>
  MODEL_CATALOG.filter((m) => m.kind === kind && !m.planned).map((m) => ({
    id: m.id,
    manifestUrl: m.manifestUrl,
  }));
const strip = (list: readonly { id: string; manifestUrl: string }[]) =>
  list.map(({ id, manifestUrl }) => ({ id, manifestUrl }));

describe("the model catalogue", () => {
  it("matches the map's live wind, wave and weather models", () => {
    expect(strip(WIND_MODELS)).toEqual(pick("wind"));
    expect(strip(WEATHER_MODELS)).toEqual(pick("weather"));
    expect(WAVE_MODELS.map((m) => m.id)).toEqual(WAVE_SOURCE_PREFERENCE);
    expect(
      [...strip(WAVE_MODELS)].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(pick("wave").sort((a, b) => a.id.localeCompare(b.id)));
  });
});

describe("findSpot", () => {
  const spots: RidingSpot[] = [
    {
      id: "dollymount",
      name: "Dollymount",
      county: "Dublin",
      lat: 53.4,
      lon: -6.1,
    },
    {
      id: "fi-seancheibh",
      name: "Seancheibh an Spidéil",
      county: "Galway",
      lat: 53.2,
      lon: -9.3,
    },
    {
      id: "rusheen",
      name: "Rusheen Bay",
      county: "Galway",
      lat: 53.3,
      lon: -9.1,
    },
    {
      id: "brandon",
      name: "Brandon Bay",
      county: "Kerry",
      lat: 52.3,
      lon: -10,
    },
  ];
  const id = (query: string) => findSpot(spots, query).spot?.id ?? null;

  it("finds a spot by id, by name without accents and by part of a name", () => {
    expect(id("dollymount")).toBe("dollymount");
    expect(id("seancheibh an spideil")).toBe("fi-seancheibh");
    expect(id("Rusheen")).toBe("rusheen");
    expect(id("the Dollymount strand")).toBe("dollymount");
    expect(findSpot(spots, "Achill")).toEqual({ spot: null, candidates: [] });
  });

  it("offers the candidates instead of guessing", () => {
    const bays = findSpot(spots, "bay");
    expect(bays.spot).toBeNull();
    expect(!bays.spot && bays.candidates.map((s) => s.id)).toEqual([
      "rusheen",
      "brandon",
    ]);
    const galway = findSpot(spots, "Galway");
    expect(!galway.spot && galway.candidates.map((s) => s.id)).toEqual([
      "fi-seancheibh",
      "rusheen",
    ]);
    expect(id("Kerry")).toBe("brandon");
  });
});

describe("windowFor", () => {
  const now = Date.parse("2026-09-16T18:25:00Z");

  it("starts at the top of the hour and steps hourly for a day", () => {
    const w = windowFor(now, { hours: 12 });
    expect(new Date(w.from).toISOString()).toBe("2026-09-16T18:00:00.000Z");
    expect(w.to - w.from).toBe(12 * HOUR);
    expect(w.stepHours).toBe(1);
  });

  it("never starts in the past and caps the length", () => {
    const w = windowFor(now, { from: "2026-09-01T00:00:00Z", hours: 999 });
    expect(new Date(w.from).toISOString()).toBe("2026-09-16T18:00:00.000Z");
    expect(w.to - w.from).toBe(240 * HOUR);
    expect(w.stepHours).toBe(3);
    expect(windowFor(now, { from: "2026-09-17T09:30:00Z" }).from).toBe(
      Date.parse("2026-09-17T10:00:00Z"),
    );
  });
});

describe("spotForecast", () => {
  const source = fixtureSource();

  async function dollymount() {
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    return spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6, stepHours: 3 }),
      { perModel: true, now: FIXTURE_NOW },
    );
  }

  it("reads only the runs that are still live", async () => {
    const forecast = await dollymount();
    expect(forecast.sources.wind.map((r) => r.id).sort()).toEqual([
      "arpege",
      "ecmwf",
      "gfs",
    ]);
    const gone = forecast.sources.unavailable.map(
      (u) => `${u.id}: ${u.reason}`,
    );
    expect(gone).toContain(
      "harmonie: The latest published run has already ended.",
    );
    expect(gone).toContain("aifs: Not published.");
    expect(forecast.sources.wind.find((r) => r.id === "ecmwf")?.stale).toBe(
      true,
    );
  });

  it("gives the median, range and agreement of the models in knots", async () => {
    const forecast = await dollymount();
    const first = forecast.hours[0];
    expect(first.time).toBe("2026-09-16T18:00:00.000Z");
    expect(first.local).toBe("Wed, 16 Sept, 19:00");

    // The same hour straight from the fixture files, one model at a time.
    const speeds = await Promise.all(
      ["ecmwf", "gfs", "arpege"].map(async (model) => {
        const m = (await source.json(`weather/${model}.json`)) as {
          spotForecasts: Record<
            string,
            { validTime: string; u: number; v: number }[]
          >;
        };
        const row = m.spotForecasts.dollymount.find(
          (r) => r.validTime === "2026-09-16T18:00:00Z",
        )!;
        return Math.hypot(row.u, row.v) * KNOTS;
      }),
    );
    speeds.sort((a, b) => a - b);
    const wind = first.wind!;
    expect(wind.models).toBe(3);
    expect(wind.wind_kn).toBeCloseTo(speeds[1], 1);
    expect(wind.min_kn).toBeCloseTo(speeds[0], 1);
    expect(wind.max_kn).toBeCloseTo(speeds[2], 1);
    const spread = speeds[2] - speeds[0];
    expect(wind.agreement).toBe(
      spread < 4 ? "high" : spread < 8 ? "moderate" : "low",
    );
    expect(Object.keys(wind.by_model!).sort()).toEqual([
      "arpege",
      "ecmwf",
      "gfs",
    ]);
  });

  it("adds waves, weather, daylight and sunrise beside the wind", async () => {
    const forecast = await dollymount();
    expect(forecast.sources.waves?.id).toBe("gfs-wave");
    expect(forecast.hours[0].waves?.height_m).toEqual(expect.any(Number));
    expect(forecast.hours[0].weather?.air_c).toEqual(expect.any(Number));
    // 19:00 Irish time in mid-September is before sunset; 21:00 is after.
    expect(forecast.hours.map((h) => h.daylight)).toEqual([true, false, false]);
    expect(forecast.sun[0].sunset).toMatch(/^Wed, 16 Sept, 19:\d\d$/);
    // No tide or sea-temperature bundle in the fixtures: said, not invented.
    expect(forecast.tides).toBeNull();
    expect(forecast.sea_temperature).toBeNull();
  });

  it("lists the tides inside the window with their datum", async () => {
    const withTides = fixtureSource({
      "marine/tides.json": {
        schemaVersion: 1,
        kind: "tide",
        stations: [{ id: "DUB", name: "Dublin Port", lat: 53.3, lon: -6.2 }],
        spots: { dollymount: { station: "DUB", distanceKm: 4.2 } },
        attribution: "Marine Institute",
      },
      "marine/tides/DUB.json": {
        stepMinutes: 10,
        from: "2026-09-16T00:00:00Z",
        to: "2026-09-18T00:00:00Z",
        datum: "LAT",
        curve: [1, 2],
        events: [
          { time: "2026-09-16T12:00:00Z", kind: "high", height: 3.9 },
          { time: "2026-09-16T20:12:00Z", kind: "low", height: 0.61 },
        ],
      },
    });
    const spot = findSpot(await loadSpots(withTides), "dollymount").spot!;
    const forecast = await spotForecast(
      withTides,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.tides).toEqual({
      station: "Dublin Port",
      distance_km: 4.2,
      datum: "LAT",
      events: [
        {
          time: "2026-09-16T20:12:00.000Z",
          local: "Wed, 16 Sept, 21:12",
          tide: "low",
          height_m: 0.61,
        },
      ],
      attribution: "Marine Institute",
    });
  });
});

describe("the chance it rides", () => {
  // Four members, steady from 12:00 to 00:00 UTC: 3, 5, 6 and 8 m/s (5.8, 9.7,
  // 11.7 and 15.6 kn), the second gusting 8 m/s (15.6 kn).
  const frames = ["12", "18"].map((h, i) => ({
    hour: i * 6,
    validTime: `2026-09-16T${h}:00:00Z`,
    u: [0, 0, 0, 0],
    v: [-3, -5, -6, -8],
    gust: [null, 8, null, null],
  }));
  frames.push({ ...frames[1], hour: 12, validTime: "2026-09-17T00:00:00Z" });
  const gefs = {
    schemaVersion: 1,
    model: "gefs",
    modelName: "GEFS",
    runTime: "2026-09-16T12:00:00Z",
    gustAvailable: true,
    ensemble: { members: 4, control: 0, description: "test" },
    spotForecasts: {
      dollymount: frames.map((f) => ({
        hour: f.hour,
        validTime: f.validTime,
        u: 0,
        v: -5.5,
        gust: 7,
      })),
    },
    spotMembers: { dollymount: frames },
  };
  const source = fixtureSource({ "weather/gefs.json": gefs });

  async function forecastFor(
    options: Partial<Parameters<typeof spotForecast>[3]> = {},
  ) {
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    return spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 3, stepHours: 3 }),
      { now: FIXTURE_NOW, ...options },
    );
  }

  it("is the share of members whose rideable wind reaches the rider's floor", async () => {
    const forecast = await forecastFor();
    const hour = forecast.hours[0].ensemble!;
    // 15.6 and 11.7 reach an intermediate's 10 kn; 9.7 does too once its
    // gust lifts it to 11.4; 5.8 does not.
    expect(hour.chance_pct).toBe(75);
    expect(hour.members).toBe(4);
    expect(hour.models).toEqual(["GEFS"]);
    expect(hour.p50_kn).toBeCloseTo(10.7, 1);
    expect(hour.p10_kn).toBeLessThan(hour.p90_kn);
    expect(hour.samples).toBeUndefined();
    expect(forecast.ride_chance).toEqual({
      skill: "intermediate",
      weight_kg: 80,
      floor_kn: 10,
      ensembles: ["GEFS"],
    });
    // Interpolated between frames, like any model's wind.
    expect(forecast.hours[1].ensemble!.chance_pct).toBe(75);
  });

  it("asks more of a learner, and keeps the members to re-rate when asked", async () => {
    const forecast = await forecastFor({
      rider: { weightKg: null, skill: "beginner", wings: [] },
      members: true,
    });
    const hour = forecast.hours[0].ensemble!;
    expect(hour.chance_pct).toBe(25);
    expect(forecast.ride_chance?.floor_kn).toBe(12);
    expect(hour.samples).toHaveLength(4);
    expect(
      rideChance(hour.samples!, {
        weightKg: null,
        skill: "intermediate",
        wings: [],
      }),
    ).toBe(75);
  });

  it("is left out where no ensemble publishes its members", async () => {
    const spot = findSpot(await loadSpots(fixtureSource()), "dollymount").spot!;
    const forecast = await spotForecast(
      fixtureSource(),
      spot,
      windowFor(FIXTURE_NOW, { hours: 3 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.ride_chance).toBeNull();
    expect(forecast.hours[0].ensemble).toBeUndefined();
  });
});

describe("findSessions", () => {
  it("ranks spots by hours in the range and groups them into sessions", async () => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 12, stepHours: 1 });
    const all = await findSessions(source, spots, window, {
      minKnots: 0,
      maxKnots: 80,
      daylightOnly: false,
      minSessionHours: 1,
      limit: 30,
      now: FIXTURE_NOW,
    });
    expect(all.searched).toBe(spots.length);
    for (const result of all.spots) {
      expect(result.rideable_hours).toBe(
        result.sessions.reduce((sum, s) => sum + s.hours, 0),
      );
      for (const s of result.sessions) {
        expect(s.agreement).not.toBe("low");
        expect(s.agreement === null).toBe(s.models === 1);
      }
    }
    const hours = all.spots.map((s) => s.rideable_hours);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));

    const dark = await findSessions(source, spots, window, {
      minKnots: 0,
      maxKnots: 80,
      daylightOnly: true,
      minSessionHours: 2,
      county: "Dublin",
      limit: 30,
      now: FIXTURE_NOW,
    });
    // Only 18:00 UTC is before sunset and the window ends before sunrise:
    // one daylight hour is short of a two-hour session.
    expect(dark.spots).toEqual([]);
    expect(dark.searched).toBe(
      spots.filter((s) => s.county === "Dublin").length,
    );
  });
});
