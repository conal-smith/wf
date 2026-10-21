import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../../force5/src/manifests";
import { KNOTS } from "../../force5/src/units";
import {
  agreementFrom,
  leadHours,
  modelWeight,
  weightedMedian,
} from "../../force5/src/weights";
import {
  WAVE_MODELS,
  WEATHER_MODELS,
  GUSTY_SPREAD_KN,
  WIND_MODELS,
  axis,
  confidenceOf,
  countyKey,
  distanceKm,
  findPlace,
  findSessions,
  shoreOf,
  findSpot,
  hourEnsemble,
  hourWind,
  loadSpots,
  modelStatus,
  rainByHour,
  spotForecast,
  windowFor,
  type RidingSpot,
} from "./forecast";
import { FIXTURE_NOW, fixtureSource } from "./testing";
import { shoreFacing } from "../../force5/src/shoreFacing";
import { shoreAngle } from "../../force5/src/stars";
import { SOURCE_CACHE_LIMIT, cached } from "./httpSource";
import { WAVE_SOURCE_PREFERENCE } from "../../force5/src/waves";
import {
  squaresFor,
  withSpotSquares,
  type RunPointer,
} from "../../force5/src/spotData";

const HOUR = 3600000;
const pick = (kind: string) =>
  MODEL_CATALOG.filter(
    (m) => m.kind === kind && !m.planned && !m.retired,
  ).map((m) => ({
    id: m.id,
    manifestUrl: m.manifestUrl,
  }));
const strip = (list: readonly { id: string; manifestUrl: string }[]) =>
  list.map(({ id, manifestUrl }) => ({ id, manifestUrl }));

describe("the model catalogue", () => {
  it("matches the map's live wind, wave and weather models", () => {
    expect(strip(WIND_MODELS)).toEqual(pick("wind"));
    expect(strip(WEATHER_MODELS)).toEqual(pick("weather"));
    // Finest first, as the dock prefers them, less any retired source.
    expect(WAVE_MODELS.map((m) => m.id)).toEqual(
      WAVE_SOURCE_PREFERENCE.filter((id) =>
        pick("wave").some((m) => m.id === id),
      ),
    );
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

  it("gives N hours as N steps, the end exclusive", () => {
    const hours = (n: number, stepHours?: number) =>
      axis(windowFor(now, { hours: n, stepHours }));
    expect(hours(1)).toEqual([Date.parse("2026-09-16T18:00:00Z")]);
    expect(hours(24)).toHaveLength(24);
    expect(hours(48)).toHaveLength(16);
    expect(hours(12, 6)).toHaveLength(2);
    expect(hours(24).at(-1)).toBe(Date.parse("2026-09-17T17:00:00Z"));
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
    // ARPEGE is in the fixtures but retired, so it is not read.
    expect(forecast.sources.wind.map((r) => r.id).sort()).toEqual([
      "ecmwf",
      "gfs",
    ]);
    const gone = forecast.sources.unavailable.map(
      (u) => `${u.id}: ${u.reason}`,
    );
    expect(gone).toContain(
      "harmonie: The latest published run has already ended.",
    );
    expect(gone.some((reason) => reason.startsWith("arpege"))).toBe(false);
    expect(forecast.sources.wind.find((r) => r.id === "ecmwf")?.stale).toBe(
      true,
    );
  });

  it("gives ECMWF's own wind where HARMONIE has ended, with every model's range and agreement", async () => {
    const forecast = await dollymount();
    const first = forecast.hours[0];
    expect(first.time).toBe("2026-09-16T18:00:00.000Z");
    expect(first.local).toBe("Wed, 16 Sept, 19:00");

    // The same hour straight from the fixture files, one model at a time.
    const valid = Date.parse("2026-09-16T18:00:00Z");
    const rows = await Promise.all(
      ["ecmwf", "gfs"].map(async (model) => {
        // The pointer, and the square holding Dollymount, through the loader.
        const path = `weather/${model}.json`;
        const m = (await withSpotSquares(
          (file) => source.json(file),
          path,
          (await source.json(path)) as RunPointer,
          ["n52w008"],
        )) as unknown as {
          runTime: string;
          spotForecasts: Record<
            string,
            { validTime: string; u: number; v: number }[]
          >;
        };
        const row = m.spotForecasts.dollymount.find(
          (r) => Date.parse(r.validTime) === valid,
        )!;
        const lead = leadHours(m.runTime, valid);
        return {
          model,
          speed: Math.hypot(row.u, row.v) * KNOTS,
          lead,
        };
      }),
    );
    const speeds = rows.map((r) => r.speed).sort((a, b) => a - b);
    const wind = first.wind!;
    expect(wind.models).toBe(2);
    // One model's own, never the two models' median.
    expect(wind.wind_kn).toBeCloseTo(
      rows.find((r) => r.model === "ecmwf")!.speed,
      1,
    );
    expect(wind.lead).toBe("ecmwf");
    expect(wind.min_kn).toBeCloseTo(speeds[0], 1);
    expect(wind.max_kn).toBeCloseTo(speeds[1], 1);
    expect(wind.agreement).toBe(
      agreementFrom(speeds, Math.min(...rows.map((r) => r.lead))),
    );
    expect(Object.keys(wind.by_model!).sort()).toEqual([
      "ecmwf",
      "gfs",
    ]);
  });

  it("adds waves, weather, daylight and sunrise beside the wind", async () => {
    const forecast = await dollymount();
    expect(forecast.sources.waves?.id).toBe("gfs-wave");
    expect(forecast.hours[0].waves?.height_m).toEqual(expect.any(Number));
    expect(forecast.hours[0].weather?.air_c).toEqual(expect.any(Number));
    // 19:00 Irish time in mid-September is before sunset; 22:00 is after.
    // Six hours at three-hourly steps is two rows: the end is exclusive.
    expect(forecast.hours.map((h) => h.daylight)).toEqual([true, false]);
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

  it("credits the spot's own station, not the manifest's first source", async () => {
    const withTides = fixtureSource({
      "marine/tides.json": {
        schemaVersion: 1,
        kind: "tide",
        stations: {
          Bangor: {
            name: "Bangor",
            lat: 54.665,
            lon: -5.67,
            provider: "wingfoil.ie",
            attribution: "Tidal predictions by wingfoil.ie from Environment Agency tide gauge data",
            url: "marine/tides-Bangor.json",
          },
        },
        spots: { dollymount: { station: "Bangor", distanceKm: 3.1 } },
        attribution: "Tidal predictions © Marine Institute, CC BY 4.0; Northern Ireland: wingfoil.ie",
      },
      "marine/tides-Bangor.json": {
        stepMinutes: 10,
        from: "2026-09-16T00:00:00Z",
        to: "2026-09-18T00:00:00Z",
        datum: "LAT",
        curve: [1, 2],
        events: [{ time: "2026-09-16T20:12:00Z", kind: "low", height: 0.61 }],
      },
    });
    const spot = findSpot(await loadSpots(withTides), "dollymount").spot!;
    const forecast = await spotForecast(
      withTides,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.tides && "attribution" in forecast.tides && forecast.tides.attribution).toBe(
      "Tidal predictions by wingfoil.ie from Environment Agency tide gauge data",
    );
  });

  it("says a lake has no tide", async () => {
    const withTides = fixtureSource({
      "marine/tides.json": {
        schemaVersion: 1,
        kind: "tide",
        stations: [{ id: "DUB", name: "Dublin Port", lat: 53.3, lon: -6.2 }],
        spots: {
          dollymount: { station: null, distanceKm: 30, noTide: true, reason: "No tide: a freshwater lake." },
        },
      },
    });
    const spot = findSpot(await loadSpots(withTides), "dollymount").spot!;
    const forecast = await spotForecast(withTides, spot, windowFor(FIXTURE_NOW, { hours: 6 }), {
      now: FIXTURE_NOW,
    });
    expect(forecast.tides).toEqual({ note: "No tide: a freshwater lake." });
  });
});

describe("rain", () => {
  // ICON-EU's shape: a step every three hours from the run, each step's
  // precip the total over the three hours ending at it, none at
  // initialization. The step at 15:00 on the 17th has lost its rain.
  const RUN = Date.parse("2026-09-16T18:00:00Z");
  const TOTALS = [null, 0.8, 0.1, 0, 2.4, 1.3, 0.5, null, 0.7];
  const BASE = "weather/icon-eu-weather-2026091618-3h-v1-e1ed202a/";
  const SQUARE = `${BASE}spots/n52w008.json`;
  const at = (iso: string) => Date.parse(iso);

  async function rainForecast(
    window: { from?: string; hours: number; stepHours: number },
    options: {
      totals?: (number | null)[];
      /** Leave the first steps out, so the run starts after the window. */
      skip?: number;
      /** Drop the stated intervals, so the gaps between steps say them. */
      unstated?: boolean;
    } = {},
  ) {
    const totals = options.totals ?? TOTALS;
    const inner = fixtureSource();
    const pointer = (await inner.json(
      "weather/icon-eu-weather.json",
    )) as Record<string, unknown>;
    const square = (await inner.json(SQUARE)) as {
      spotSeries: Record<string, unknown>;
    };
    const series = totals
      .map((precip, k) => ({
        hour: 3 * k,
        validTime: new Date(RUN + 3 * k * HOUR).toISOString(),
        ...(!options.unstated && {
          precipIntervalHours: k ? [3 * k - 3, 3 * k] : null,
        }),
        values: { t2m: 10 + k, precip, clct: 40 + k, ww: 61 },
      }))
      .slice(options.skip ?? 0);
    const source = fixtureSource({
      "weather/icon-eu-weather.json": {
        ...pointer,
        frames: [],
        horizonHours: 3 * (totals.length - 1),
      },
      [SQUARE]: {
        ...square,
        spotSeries: { ...square.spotSeries, dollymount: series },
      },
    });
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    return spotForecast(source, spot, windowFor(FIXTURE_NOW, window), {
      now: FIXTURE_NOW,
    });
  }
  const rainOf = (forecast: Awaited<ReturnType<typeof rainForecast>>) =>
    forecast.hours.map((h) => [
      h.time.slice(11, 16),
      h.weather?.rain_mm ?? null,
      h.weather?.rain_interval_hours ?? null,
      h.weather?.rain_until?.slice(11, 16) ?? null,
    ]);
  const sum = (values: (number | null | undefined)[]) =>
    values.reduce<number>((total, v) => total + (v ?? 0), 0);

  it("gives each three-hour total once, at the hour its interval ends", async () => {
    const forecast = await rainForecast({ hours: 24, stepHours: 1 });
    expect(forecast.window.weather_step_hours).toBe(3);
    expect(rainOf(forecast).filter(([, mm]) => mm !== null)).toEqual([
      ["21:00", 0.8, 3, null],
      ["00:00", 0.1, 3, null],
      ["03:00", 0, 3, null],
      ["06:00", 2.4, 3, null],
      ["09:00", 1.3, 3, null],
      ["12:00", 0.5, 3, null],
      // The window ends at 18:00, inside the last interval: its last hour
      // carries it, and says the hour it runs to.
      ["17:00", 0.7, 3, "18:00"],
    ]);
    // The hours inside an interval have none of their own.
    expect(rainOf(forecast).slice(0, 4)).toEqual([
      ["18:00", null, null, null],
      ["19:00", null, null, null],
      ["20:00", null, null, null],
      ["21:00", 0.8, 3, null],
    ]);
  });

  it("adds up over the hours to the three-hour totals, not three times them", async () => {
    const forecast = await rainForecast({ hours: 24, stepHours: 1 });
    const hours = forecast.hours.map((h) => ({
      time: Date.parse(h.time),
      mm: h.weather?.rain_mm,
    }));
    const between = (from: string, to: string) =>
      sum(
        hours
          .filter((h) => h.time > at(from) && h.time <= at(to))
          .map((h) => h.mm),
      );
    // Each interval's hours add up to its own total.
    TOTALS.forEach((total, k) => {
      if (!k || total === null) return;
      const end = RUN + 3 * k * HOUR;
      if (end >= RUN + 24 * HOUR) return;
      expect(
        sum(
          hours
            .filter((h) => h.time > end - 3 * HOUR && h.time <= end)
            .map((h) => h.mm),
        ),
      ).toBeCloseTo(total, 5);
    });
    // Overnight, 21:00 to 06:00 UTC: the three intervals ending at 00, 03, 06.
    expect(between("2026-09-16T21:00:00Z", "2026-09-17T06:00:00Z")).toBeCloseTo(
      0.1 + 0 + 2.4,
      5,
    );
    // The whole day: every total once, where each read into all three of its
    // hours would say three times the rain.
    expect(sum(hours.map((h) => h.mm))).toBeCloseTo(5.8, 5);
    // The other weather repeats the nearest step's: three-hourly, not hourly.
    expect(forecast.hours.slice(2, 5).map((h) => h.weather?.air_c)).toEqual([
      11, 11, 11,
    ]);
  });

  it("leaves an interval whose rain is missing empty, not zero", async () => {
    const forecast = await rainForecast({ hours: 24, stepHours: 1 });
    // 12:00 to 15:00 on the 17th has no total.
    const afternoon = forecast.hours.filter(
      (h) =>
        Date.parse(h.time) > at("2026-09-17T12:00:00Z") &&
        Date.parse(h.time) <= at("2026-09-17T15:00:00Z"),
    );
    expect(afternoon).toHaveLength(3);
    for (const h of afternoon) {
      expect(h.weather?.rain_mm).toBeNull();
      expect(h.weather).not.toHaveProperty("rain_interval_hours");
      expect(h.weather?.air_c).toEqual(expect.any(Number));
    }
  });

  it("says when an interval the window's end cuts through ends", async () => {
    // 18:00 to 23:00: the interval to midnight is printed at 22:00, its last
    // hour in the window, with the hour it runs to.
    const forecast = await rainForecast({ hours: 5, stepHours: 1 });
    expect(rainOf(forecast)).toEqual([
      ["18:00", null, null, null],
      ["19:00", null, null, null],
      ["20:00", null, null, null],
      ["21:00", 0.8, 3, null],
      ["22:00", 0.1, 3, "00:00"],
    ]);
  });

  it("has no rain before the run's first interval or past its last step", async () => {
    // The run starts at midnight: nothing before it, then its first interval.
    const late = await rainForecast(
      { hours: 8, stepHours: 1 },
      { skip: 2, unstated: true },
    );
    expect(rainOf(late)).toEqual([
      ["18:00", null, null, null],
      ["19:00", null, null, null],
      ["20:00", null, null, null],
      ["21:00", null, null, null],
      ["22:00", null, null, null],
      ["23:00", null, null, null],
      ["00:00", 0.1, 3, null],
      ["01:00", 0, 3, "03:00"],
    ]);
    // Out of the steps' reach the hour has no weather at all.
    expect(late.hours[0].weather).toBeNull();
    expect(late.hours[5].weather?.air_c).toBe(12);
    // The run ends at 12:00 on the 17th: its last total there, then none.
    const short = await rainForecast(
      { hours: 24, stepHours: 1 },
      { totals: TOTALS.slice(0, 7) },
    );
    const tail = short.hours.filter(
      (h) => Date.parse(h.time) >= at("2026-09-17T12:00:00Z"),
    );
    expect(tail[0].weather?.rain_mm).toBe(0.5);
    expect(tail[1].weather?.rain_mm).toBeNull();
    expect(tail[1].weather?.air_c).toBe(16);
    expect(tail.slice(2).every((h) => h.weather === null)).toBe(true);
  });

  it("reads the interval from the steps' spacing where no step states it", async () => {
    const stated = await rainForecast({ hours: 24, stepHours: 1 });
    const unstated = await rainForecast(
      { hours: 24, stepHours: 1 },
      { unstated: true },
    );
    expect(rainOf(unstated)).toEqual(rainOf(stated));
  });

  it("gives three-hourly rows off the steps' hours each interval once, and says when it ends", async () => {
    // Rows at 19, 22, 01 …: each falls inside one interval and carries it.
    const forecast = await rainForecast({
      from: "2026-09-16T19:00:00Z",
      hours: 24,
      stepHours: 3,
    });
    expect(rainOf(forecast)).toEqual([
      ["19:00", 0.8, 3, "21:00"],
      ["22:00", 0.1, 3, "00:00"],
      ["01:00", 0, 3, "03:00"],
      ["04:00", 2.4, 3, "06:00"],
      ["07:00", 1.3, 3, "09:00"],
      ["10:00", 0.5, 3, "12:00"],
      ["13:00", null, null, null],
      ["16:00", 0.7, 3, "18:00"],
    ]);
    expect(sum(forecast.hours.map((h) => h.weather?.rain_mm))).toBeCloseTo(
      0.8 + 0.1 + 0 + 2.4 + 1.3 + 0.5 + 0.7,
      5,
    );
  });

  it("sums the intervals since the row before on six-hourly rows", async () => {
    const forecast = await rainForecast({ hours: 24, stepHours: 6 });
    expect(rainOf(forecast)).toEqual([
      ["18:00", null, null, null],
      ["00:00", 0.9, 6, null],
      ["06:00", 2.4, 6, null],
      ["12:00", 1.8, 6, null],
    ]);
  });

  it("gives every hour of an interval its total back, for a reader drawing each hour", async () => {
    const forecast = await rainForecast({ hours: 24, stepHours: 1 });
    const rain = rainByHour(forecast.hours);
    const around = (iso: string) => rain.get(at(iso)) ?? null;
    expect(around("2026-09-16T19:00:00Z")).toBe(0.8);
    expect(around("2026-09-16T21:00:00Z")).toBe(0.8);
    expect(around("2026-09-16T22:00:00Z")).toBe(0.1);
    expect(around("2026-09-17T07:00:00Z")).toBe(1.3);
    expect(around("2026-09-17T14:00:00Z")).toBeNull();
    expect(around("2026-09-16T18:00:00Z")).toBeNull();
  });

  it("tells an agent what a row's rain covers", async () => {
    const forecast = await rainForecast({ hours: 3, stepHours: 1 });
    expect(forecast.units.rain).toMatch(/rain_interval_hours/);
    expect(forecast.units.rain).toMatch(/null/);
    expect(forecast.units.weather).toMatch(/weather_step_hours/);
  });
});

describe("hourWind", () => {
  const at = Date.parse("2026-10-14T12:00:00Z");
  const run = (id: string) => ({
    id,
    name: id,
    provider: "test",
    run_time: "2026-10-14T06:00:00Z",
    until: "2026-10-16T18:00:00Z",
    stale: false,
    attribution: "",
    license_url: "",
  });
  /** A model blowing steadily from `hours` steps: u, v and gust in m/s. */
  const line = (
    id: string,
    wind: { u: number; v: number; gust: number | null },
    hours = [0, 1, 2, 3],
  ) => ({
    run: run(id),
    points: hours.map((h) => ({ time: at + h * HOUR, ...wind })),
    gap: 2 * HOUR,
    resolutionKm: null,
  });
  // Four models that agree on a 5 m/s southerly, and HARMONIE's 9 m/s westerly.
  const others = ["icon-eu", "gfs", "arome", "gefs"].map((id) =>
    line(id, { u: 0, v: 5, gust: 7 }, [0, 1, 2, 3, 4, 5, 6]),
  );

  it("is HARMONIE's own forecast where HARMONIE reaches the hour", () => {
    const harmonie = line("harmonie", { u: 9, v: 0, gust: 12 });
    const hour = hourWind([harmonie, ...others], at, true)!;
    expect(hour.lead).toBe("harmonie");
    expect(hour.gust_lead).toBe("harmonie");
    expect(hour.wind_kn).toBeCloseTo(9 * KNOTS, 1);
    expect(hour.gust_kn).toBeCloseTo(12 * KNOTS, 1);
    expect(hour.direction_deg).toBe(270);
    expect(hour.direction).toBe("W");
    // The range, the gusts' top and the agreement are still every model's.
    expect(hour.min_kn).toBeCloseTo(5 * KNOTS, 1);
    expect(hour.max_kn).toBeCloseTo(9 * KNOTS, 1);
    expect(hour.gust_max_kn).toBeCloseTo(12 * KNOTS, 1);
    expect(hour.models).toBe(5);
    expect(hour.agreement).toBe("low");
    expect(Object.keys(hour.by_model!)).toHaveLength(5);
  });

  it("gives no gust where the one model gives none", () => {
    const harmonie = line("harmonie", { u: 9, v: 0, gust: null });
    const hour = hourWind([harmonie, ...others], at, false)!;
    expect(hour.lead).toBe("harmonie");
    expect(hour.gust_lead).toBeNull();
    expect(hour.wind_kn).toBeCloseTo(9 * KNOTS, 1);
    expect(hour.gust_kn).toBeNull();
    expect(hour.gust_max_kn).toBeCloseTo(7 * KNOTS, 1);
  });

  it("hands over to ECMWF alone past HARMONIE's run, and to nobody past both", () => {
    const harmonie = line("harmonie", { u: 9, v: 0, gust: 12 });
    const ecmwf = line("ecmwf", { u: -6, v: 0, gust: 8 }, [0, 1, 2, 3, 4, 5]);
    const later = at + 5 * HOUR;
    const hour = hourWind([harmonie, ecmwf, ...others], later, false)!;
    expect(hour.lead).toBe("ecmwf");
    expect(hour.wind_kn).toBeCloseTo(6 * KNOTS, 1);
    expect(hour.gust_kn).toBeCloseTo(8 * KNOTS, 1);
    expect(hour.direction_deg).toBe(90);
    expect(hour.models).toBe(5);
    // The four others still reach +6 h, but they never stand in for the two.
    expect(hourWind([harmonie, ecmwf, ...others], at + 6 * HOUR, false)).toBeNull();
  });

  it("is low on confidence behind fewer than three models, however closely they agree", () => {
    const harmonie = line("harmonie", { u: 0, v: 5, gust: 7 });
    // Four that agree exactly, and a pair agreeing as closely.
    const four = hourWind([harmonie, ...others.slice(0, 3)], at, false)!;
    expect(four.models).toBe(4);
    expect(four.agreement).toBe("high");
    expect(four.confidence).toBe("high");
    const two = hourWind([harmonie, others[0]], at, false)!;
    expect(two.models).toBe(2);
    expect(two.agreement).toBe("moderate");
    expect(two.confidence).toBe("low");
    expect(hourWind([harmonie], at, false)!.confidence).toBe("low");
  });

  it("takes the models a caller names", () => {
    const harmonie = line("harmonie", { u: 9, v: 0, gust: 12 });
    const hour = hourWind([harmonie, ...others], at, false, {
      model: "gfs",
      then: "ecmwf",
    })!;
    expect(hour.lead).toBe("gfs");
    expect(hour.wind_kn).toBeCloseTo(5 * KNOTS, 1);
    expect(hour.direction_deg).toBe(180);
  });
});

describe("the ensembles' members", () => {
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

  // Both ensembles are retired, so a forecast never carries the spread now;
  // the reduction is kept, and tested on the members a re-enabled one would give.
  it("spreads the members' wind into percentiles", () => {
    const at = Date.parse("2026-09-16T12:00:00Z");
    const members = [3, 5, 6, 8].map((speed) => [
      { time: at, u: 0, v: -speed, gust: null },
      { time: at + 6 * HOUR, u: 0, v: -speed, gust: null },
    ]);
    const run = { name: "GEFS" } as Parameters<typeof hourEnsemble>[0][0]["run"];
    const hour = hourEnsemble([{ run, members, gap: 12 * HOUR }], at)!;
    expect(hour.members).toBe(4);
    expect(hour.models).toEqual(["GEFS"]);
    expect(hour.p50_kn).toBeCloseTo(5.5 * KNOTS, 0);
    expect(hour.p10_kn).toBeLessThan(hour.p50_kn);
    expect(hour.p90_kn).toBeGreaterThan(hour.p50_kn);
    expect(hourEnsemble([{ run, members, gap: 12 * HOUR }], at - HOUR))
      .toBeNull();
  });

  it("ignores a retired ensemble's file, even when one is published", async () => {
    const source = fixtureSource({ "weather/gefs.json": gefs });
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 3, stepHours: 3 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.hours[0].ensemble).toBeUndefined();
    expect(forecast).not.toHaveProperty("ride_chance");
  });
});

describe("confidenceOf", () => {
  it("keeps the agreement from three models on, and is low below", () => {
    expect(confidenceOf("high", 3)).toBe("high");
    expect(confidenceOf("moderate", 4)).toBe("moderate");
    expect(confidenceOf("moderate", 2)).toBe("low");
    expect(confidenceOf(null, 1)).toBe("low");
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
        expect(s.agreement === null).toBe(s.models === 1);
        // The fixtures' live runs are ECMWF and GFS alone: never above low.
        expect(s.models).toBeLessThanOrEqual(2);
        expect(s.confidence).toBe("low");
      }
    }
    const hours = all.spots.map((s) => s.rideable_hours);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));

    const dark = await findSessions(source, spots, window, {
      minKnots: 0,
      maxKnots: 80,
      daylightOnly: true,
      minSessionHours: 2,
      counties: ["Dublin"],
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

describe("findSessions' gust limits", () => {
  const search = async (limits: object) => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 48, stepHours: 1 });
    return findSessions(source, spots, window, {
      minKnots: 0,
      maxKnots: 80,
      daylightOnly: false,
      minSessionHours: 1,
      limit: 30,
      allowOffshore: true,
      now: FIXTURE_NOW,
      ...limits,
    });
  };

  it("leaves hours gusting over max_gust_kn out of the rideable hours", async () => {
    const all = await search({});
    const calm = await search({ maxGustKnots: 25 });
    const total = (r: typeof all) =>
      r.spots.reduce((sum, s) => sum + s.rideable_hours, 0);
    expect(total(calm)).toBeLessThan(total(all));
    expect(calm.spots.length).toBeGreaterThan(0);
    for (const s of calm.spots.flatMap((r) => r.sessions))
      expect(s.gust_kn).toBeLessThanOrEqual(25);
    expect(
      all.spots.flatMap((r) => r.sessions).some((s) => s.gust_kn! > 25),
    ).toBe(true);
  });

  it("leaves out hours gusting more than max_gust_factor times the mean", async () => {
    const steady = await search({ maxGustFactor: 1.6 });
    for (const s of steady.spots.flatMap((r) => r.sessions))
      expect(s.gust_kn!).toBeLessThanOrEqual(1.6 * s.max_kn + 0.1);
    const hours = (r: typeof steady) =>
      r.spots.reduce((sum, s) => sum + s.rideable_hours, 0);
    expect(hours(steady)).toBeGreaterThan(0);
    expect(hours(steady)).toBeLessThan(hours(await search({})));
  });

  it("flags a session whose gusts run 12 kn or more over the mean", async () => {
    const sessions = (await search({})).spots.flatMap((r) => r.sessions);
    // The fixtures' whole two days gust to about 30 kn over a 12 kn mean.
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.gusty).toBe(true);
      expect(s.gust_kn! - s.min_kn).toBeGreaterThanOrEqual(GUSTY_SPREAD_KN);
    }
    // Under a 25 kn limit some sessions stay within 12 kn of every hour's mean.
    const calm = (await search({ maxGustKnots: 25 })).spots.flatMap(
      (r) => r.sessions,
    );
    expect(calm.some((s) => !s.gusty)).toBe(true);
    for (const s of calm.filter((s) => !s.gusty))
      expect(s.gust_kn! - s.max_kn).toBeLessThan(GUSTY_SPREAD_KN);
  });
});

describe("the shore", () => {
  const search = async (allowOffshore?: boolean) => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 48, stepHours: 1 });
    return findSessions(source, spots, window, {
      minKnots: 0,
      maxKnots: 80,
      daylightOnly: false,
      minSessionHours: 1,
      limit: 30,
      allowOffshore,
      now: FIXTURE_NOW,
    });
  };

  it("is the stars' shore angle against the map's facing, or null where that is unknown", () => {
    expect(shoreOf(101, { direction_deg: 101 })).toBe("onshore");
    expect(shoreOf(101, { direction_deg: 281 })).toBe("offshore");
    expect(shoreOf(101, { direction_deg: 191 })).toBe("cross");
    expect(shoreOf(null, { direction_deg: 281 })).toBeNull();
    expect(shoreOf(101, null)).toBeNull();
  });

  it("classifies every hour of a spot forecast the way the web app does", async () => {
    const source = fixtureSource();
    const spot = (await loadSpots(source)).find((s) => s.id === "brandon")!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 24 }),
      { now: FIXTURE_NOW },
    );
    const facing = shoreFacing("brandon")!;
    expect(facing).not.toBeNull();
    expect(forecast.shore_facing_deg).toBe(facing);
    const windy = forecast.hours.filter((h) => h.wind);
    expect(windy.length).toBeGreaterThan(0);
    for (const h of forecast.hours)
      expect(h.shore).toBe(
        h.wind ? shoreAngle(h.wind.direction_deg, facing) : null,
      );
  });

  it("leaves dead offshore hours out of find_wind unless they are allowed", async () => {
    const safe = await search();
    const all = await search(true);
    const brandon = (r: typeof all) =>
      r.spots.find((s) => s.spot.id === "brandon");
    // The fixtures blow from the west, dead offshore on Brandon Bay's east-facing beach.
    expect(brandon(all)!.sessions.some((s) => s.shore === "offshore")).toBe(
      true,
    );
    expect(brandon(all)!.sessions[0].offshore_hours).toBeGreaterThan(0);
    expect(brandon(safe)?.rideable_hours ?? 0).toBeLessThan(
      brandon(all)!.rideable_hours,
    );
    for (const result of safe.spots) {
      expect(result.shore_facing_deg).toBe(shoreFacing(result.spot.id));
      for (const s of result.sessions) {
        expect(s.offshore_hours).toBe(0);
        expect(s.shore).not.toBe("offshore");
        if (result.shore_facing_deg === null) expect(s.shore).toBeNull();
      }
    }
  });
});

describe("near and counties", () => {
  const search = async (filters: object) => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 12, stepHours: 1 });
    const found = await findSessions(source, spots, window, {
      minKnots: 0,
      maxKnots: 80,
      daylightOnly: false,
      minSessionHours: 1,
      limit: 30,
      allowOffshore: true,
      now: FIXTURE_NOW,
      ...filters,
    });
    return { spots, found };
  };

  it("finds where someone is from coordinates, a county or a spot", async () => {
    const spots = await loadSpots(fixtureSource());
    expect(findPlace(spots, { lat: 53.35, lon: -6.26 })).toEqual({
      place: { name: "53.35, -6.26", lat: 53.35, lon: -6.26 },
    });
    expect(findPlace(spots, " 53.35, -6.26 ")).toEqual({
      place: { name: "53.35, -6.26", lat: 53.35, lon: -6.26 },
    });
    const dublin = findPlace(spots, "Co. Dublin");
    expect("place" in dublin && dublin.place.name).toBe("County Dublin");
    if ("place" in dublin) {
      expect(dublin.place.lat).toBeGreaterThan(53);
      expect(dublin.place.lat).toBeLessThan(53.7);
    }
    const dollymount = spots.find((s) => s.id === "dollymount")!;
    expect(findPlace(spots, "dollymount")).toEqual({
      place: {
        name: dollymount.name,
        lat: dollymount.lat,
        lon: dollymount.lon,
      },
    });
    const nowhere = findPlace(spots, "Narnia");
    expect("error" in nowhere && nowhere.error).toMatch(/lat, lon/);
  });

  it("reads a county however it is written", () => {
    for (const words of [
      "Wicklow",
      "wicklow",
      "Co. Wicklow",
      "co wicklow",
      "CO.WICKLOW",
      "County Wicklow",
      " county  wicklow ",
    ])
      expect(countyKey(words)).toBe("wicklow");
    // Only a whole word "Co" or "County" goes: Cork stays Cork.
    expect(countyKey("Cork")).toBe("cork");
    expect(countyKey("Co. Cork")).toBe("cork");
  });

  it("takes one of several spots a name matches when they lie close together", async () => {
    const spots = await loadSpots(fixtureSource());
    const malahide = findPlace(spots, "Malahide");
    expect("place" in malahide && malahide.place).toMatchObject({
      name: "Malahide Estuary",
      note: '"Malahide" matches 4 spots within 5 km of each other; distances are from Malahide Estuary.',
    });
    // Far apart, the agent must still ask which.
    const strand = findPlace(spots, "strand");
    expect("error" in strand && strand.error).toMatch(
      /could be any of: .*Ask which/,
    );
    // A single match carries no note.
    const one = findPlace(spots, "malahide-estuary");
    expect("place" in one && one.place.note).toBeUndefined();
  });

  it("measures kilometres as the crow flies", () => {
    // Dublin to Galway is about 186 km.
    expect(
      distanceKm({ lat: 53.35, lon: -6.26 }, { lat: 53.27, lon: -9.05 }),
    ).toBeCloseTo(186, -1);
  });

  it("searches only spots within max_km of near, nearest first among equals", async () => {
    const near = { lat: 53.35, lon: -6.26 };
    const { spots, found } = await search({ near, maxKm: 40 });
    const within = spots.filter((s) => distanceKm(near, s) <= 40);
    expect(within.length).toBeGreaterThan(0);
    expect(within.length).toBeLessThan(spots.length);
    expect(found.searched).toBe(within.length);
    expect(found.spots.length).toBeGreaterThan(0);
    for (const [i, r] of found.spots.entries()) {
      expect(r.distance_km).toBeLessThanOrEqual(40);
      expect(r.distance_km).toBeCloseTo(distanceKm(near, r.spot), 0);
      const next = found.spots[i + 1];
      if (next && next.rideable_hours === r.rideable_hours)
        expect(next.distance_km!).toBeGreaterThanOrEqual(r.distance_km!);
    }
    // Without near, no distances.
    const all = await search({});
    expect(all.found.spots.every((r) => r.distance_km === undefined)).toBe(
      true,
    );
  });

  it("searches only the counties asked for", async () => {
    const { spots, found } = await search({
      counties: ["Co. Dublin", "county wicklow"],
    });
    expect(found.searched).toBe(
      spots.filter((s) => ["Dublin", "Wicklow"].includes(s.county)).length,
    );
    expect(found.spots.length).toBeGreaterThan(0);
    for (const r of found.spots)
      expect(["Dublin", "Wicklow"]).toContain(r.spot.county);
  });
});

describe("how far the forecast reaches", () => {
  const reach = async (from?: { model: string; then: string }) => {
    const source = fixtureSource();
    const found = await findSessions(
      source,
      await loadSpots(source),
      windowFor(FIXTURE_NOW, { hours: 6 }),
      {
        minKnots: 0,
        maxKnots: 80,
        daylightOnly: false,
        minSessionHours: 1,
        counties: ["Dublin"],
        limit: 1,
        now: FIXTURE_NOW,
        from,
      },
    );
    return found.reach;
  };

  it("is the furthest run of the models the ranking reads", async () => {
    // HARMONIE has ended, so ECMWF; GFS, live but not read, reaches less far anyway.
    expect(await reach()).toEqual({
      time: Date.parse("2026-09-28T00:00:00Z"),
      model: "ECMWF",
    });
    expect(await reach({ model: "gfs", then: "gfs" })).toEqual({
      time: Date.parse("2026-09-17T06:00:00Z"),
      model: "GFS",
    });
    // Neither model published: nothing can be ranked.
    expect(await reach({ model: "harmonie", then: "icon-eu" })).toBeNull();
  });
});

describe("which spot squares are read", () => {
  /** The fixture source, recording every spot square asked for. */
  const counting = () => {
    const inner = fixtureSource();
    const squares: string[] = [];
    return {
      squares,
      source: {
        json(path: string) {
          if (path.includes("/spots/")) squares.push(path);
          return inner.json(path);
        },
      },
    };
  };

  it("reads only the square holding the spot, of each live model", async () => {
    const { source, squares } = counting();
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6, stepHours: 3 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.hours[0].wind?.models).toBe(2);
    expect(squares.length).toBeGreaterThan(0);
    expect(squares.every((path) => path.endsWith("/spots/n52w008.json"))).toBe(
      true,
    );
    // One per model that is still live and publishes a square there.
    expect(new Set(squares).size).toBe(squares.length);
  });

  it("reads a pointer again when the run it named has gone, and the run it names now", async () => {
    // The cached ECMWF pointer names a run directory that has since been
    // superseded and deleted: its squares are not there.
    const inner = fixtureSource();
    const live = (await inner.json("weather/ecmwf.json")) as Record<
      string,
      unknown
    >;
    const stale = { ...live, base: "ecmwf-2026091500-old-v1-0f0f0f0f/" };
    const forgotten: string[] = [];
    const source = {
      json: (path: string) =>
        path === "weather/ecmwf.json" && !forgotten.includes(path)
          ? Promise.resolve(stale)
          : inner.json(path),
      forget: (path: string) => void forgotten.push(path),
    };
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6, stepHours: 3 }),
      { now: FIXTURE_NOW },
    );
    expect(forgotten).toEqual(["weather/ecmwf.json"]);
    expect(forecast.hours[0].wind?.models).toBe(2);
    // A source that cannot forget still answers, without that model.
    const plain = { json: source.json };
    forgotten.length = 0;
    const without = await spotForecast(
      plain,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6, stepHours: 3 }),
      { now: FIXTURE_NOW },
    );
    // Without ECMWF, and HARMONIE ended, neither model the stars come from
    // reaches the hour: GFS alone does not stand in for them.
    expect(without.sources.wind.map((r) => r.id)).toEqual(["gfs"]);
    expect(without.hours[0].wind).toBeNull();
  });

  it("forgets a cached read when asked", async () => {
    let reads = 0;
    const source = cached(async () => ++reads, 60000, () => 0);
    expect(await source.json("weather/ecmwf.json")).toBe(1);
    expect(await source.json("weather/ecmwf.json")).toBe(1);
    source.forget!("weather/ecmwf.json");
    expect(await source.json("weather/ecmwf.json")).toBe(2);
  });

  it("keeps no run's files, drops what has expired, and holds at most its limit", async () => {
    let clock = 0;
    let reads = 0;
    const source = cached(async () => ++reads, 60000, () => clock);
    // Every run has new square paths: kept, they would pile up for ever.
    for (let run = 0; run < 50; run++)
      await source.json(
        `weather/harmonie-20261011${String(run).padStart(2, "0")}-61h-v3-0a0b0c0d/spots/n52w008.json`,
      );
    expect(source.size()).toBe(0);
    // Shared while in flight, all the same.
    const square = "weather/harmonie-2026101106-61h-v3-1a2b3c4d/spots/n52w008.json";
    const [a, b] = await Promise.all([source.json(square), source.json(square)]);
    expect(a).toBe(b);
    await source.json("weather/ecmwf.json");
    await source.json("marine/tides/dublin-2026-10-11.json");
    expect(source.size()).toBe(2);
    // A day's tide station files expire, and the next read sweeps them out.
    clock = 60000;
    await source.json("weather/gfs.json");
    expect(source.size()).toBe(1);
    for (let i = 0; i < SOURCE_CACHE_LIMIT + 10; i++)
      await source.json(`marine/tides/station-${i}.json`);
    expect(source.size()).toBe(SOURCE_CACHE_LIMIT);
  });

  it("reads a county's squares for a county search, and none for the status", async () => {
    const { source, squares } = counting();
    const spots = await loadSpots(source);
    const dublin = spots.filter((s) => s.county === "Dublin");
    await findSessions(source, spots, windowFor(FIXTURE_NOW, { hours: 6 }), {
      minKnots: 0,
      maxKnots: 80,
      daylightOnly: false,
      minSessionHours: 1,
      counties: ["Dublin"],
      limit: 30,
      now: FIXTURE_NOW,
    });
    const wanted = squaresFor(dublin);
    expect(
      squares.every((path) =>
        wanted.some((square) => path.endsWith(`/spots/${square}.json`)),
      ),
    ).toBe(true);
    squares.length = 0;
    const status = await modelStatus(source, FIXTURE_NOW);
    expect(status.wind.length).toBeGreaterThan(0);
    expect(squares).toEqual([]);
  });
});
