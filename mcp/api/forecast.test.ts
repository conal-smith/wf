import { readFileSync } from "node:fs";
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
  NEARBY_KM,
  daySun,
  dublinDate,
  nearbySpots,
  hourWind,
  irishZone,
  loadSpots,
  localSpan,
  localStamp,
  modelStatus,
  rainByHour,
  spotForecast,
  windowFor,
  type HourWind,
  type RidingSpot,
} from "./forecast";
import { FIXTURE_NOW, fixtureSource } from "./testing";
import {
  DEFAULT_RIDER,
  bestWindow,
  parseCustomRating,
  rateHour,
  type HourRating,
  type Rider,
} from "../../force5/src/stars";
import { arcText, goodWindArcs } from "../../force5/src/windArcs";
import { rateForecastHour } from "../../spot/web/spot";
import {
  hourStars,
  rateWind,
  riderOf,
  riderUsed,
  type RiderChoice,
} from "./rating";

/** A rider who made the stars their own: a lighter sweet spot, and gusts past 25 kn too much. */
const OWN_STARS: Rider = {
  ...riderOf(),
  custom: parseCustomRating({
    version: 3,
    wind: { min: 8, sweetLow: 10, sweetHigh: 16, max: 25 },
    direction: { onshore: 0, crossOn: 1, cross: 0, crossOff: 2 },
  }),
};

/** Every hour the site rates counts, none or more stars, for the site's default rider. */
const EVERY_HOUR = { rider: DEFAULT_RIDER, minStars: 0 };
import { shoreFacing } from "../../force5/src/shoreFacing";
import { shoreAngle } from "../../force5/src/stars";
import { presentWeather, skyOf } from "../../force5/src/presentWeather";
import { feelsLikeC } from "../../force5/src/feelsLike";
import { thunderRisk } from "../../force5/src/thunder";
import { SOURCE_CACHE_LIMIT, cached } from "./httpSource";
import { WAVE_SOURCE_PREFERENCE } from "../../force5/src/waves";
import {
  squaresFor,
  withSpotSquares,
  type RunPointer,
} from "../../force5/src/spotData";

const HOUR = 3600000;
const pick = (kind: string) =>
  MODEL_CATALOG.filter((m) => m.kind === kind && !m.planned && !m.retired).map(
    (m) => ({
      id: m.id,
      manifestUrl: m.manifestUrl,
    }),
  );
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

describe("Irish time", () => {
  // Irish clocks go back at 01:00Z on Sunday 25 October 2026.
  const at = (iso: string) => Date.parse(iso);

  it("names the zone, so the two 01:00s the night the clocks go back differ", () => {
    expect(localStamp(at("2026-10-25T00:00:00Z"))).toBe(
      "Sun, 25 Oct, 01:00 IST",
    );
    expect(localStamp(at("2026-10-25T01:00:00Z"))).toBe(
      "Sun, 25 Oct, 01:00 GMT",
    );
    expect(irishZone(at("2026-03-29T00:59:00Z"))).toBe("GMT");
    expect(irishZone(at("2026-03-29T01:00:00Z"))).toBe("IST");
  });

  it("says a span's zone at both ends where the clocks change inside it, and the end's day where it is another", () => {
    expect(
      localSpan(at("2026-10-25T08:00:00Z"), at("2026-10-25T17:41:00Z")),
    ).toBe("Sun, 25 Oct, 08:00 – 17:41 GMT");
    expect(
      localSpan(at("2026-10-24T23:00:00Z"), at("2026-10-25T02:00:00Z")),
    ).toBe("Sun, 25 Oct, 00:00 IST – 02:00 GMT");
    expect(
      localSpan(at("2026-10-24T21:00:00Z"), at("2026-10-24T23:00:00Z")),
    ).toBe("Sat, 24 Oct, 22:00 – 00:00 IST");
    expect(
      localSpan(at("2026-10-24T21:00:00Z"), at("2026-10-25T03:00:00Z")),
    ).toBe("Sat, 24 Oct, 22:00 IST – Sun, 25 Oct, 03:00 GMT");
  });

  it("labels a forecast's rows across the change each with its own zone", async () => {
    const source = fixtureSource();
    const spot = findSpot(await loadSpots(source), "kilcrea").spot!;
    const now = at("2026-10-24T22:00:00Z");
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(now, { hours: 5, stepHours: 1 }),
      { now },
    );
    expect(forecast.hours.map((h) => [h.time.slice(11, 16), h.local])).toEqual([
      ["22:00", "Sat, 24 Oct, 23:00 IST"],
      ["23:00", "Sun, 25 Oct, 00:00 IST"],
      ["00:00", "Sun, 25 Oct, 01:00 IST"],
      ["01:00", "Sun, 25 Oct, 01:00 GMT"],
      ["02:00", "Sun, 25 Oct, 02:00 GMT"],
    ]);
    expect(new Set(forecast.hours.map((h) => h.local)).size).toBe(5);
    expect(forecast.units.time).toMatch(/IST.*GMT/);
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
    // ECMWF's run is 90 h old, past its 40 h limit; GFS's 12 h old, inside
    // its 13 h (catalog.ts's staleAfterHours, the monitor's limit too).
    const ecmwf = forecast.sources.wind.find((r) => r.id === "ecmwf");
    expect(ecmwf?.age_hours).toBe(90);
    expect(ecmwf?.stale).toBe(true);
    const gfs = forecast.sources.wind.find((r) => r.id === "gfs");
    expect(gfs?.age_hours).toBe(12);
    expect(gfs?.stale).toBe(false);
  });

  it("gives ECMWF's own wind where HARMONIE has ended, with every model's range and agreement", async () => {
    const forecast = await dollymount();
    const first = forecast.hours[0];
    expect(first.time).toBe("2026-09-16T18:00:00.000Z");
    expect(first.local).toBe("Wed, 16 Sept, 19:00 IST");

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
    expect(Object.keys(wind.by_model!).sort()).toEqual(["ecmwf", "gfs"]);
  });

  it("adds waves, weather, daylight and sunrise beside the wind", async () => {
    const forecast = await dollymount();
    expect(forecast.sources.waves?.id).toBe("gfs-wave");
    expect(forecast.hours[0].waves?.height_m).toEqual(expect.any(Number));
    expect(forecast.hours[0].weather?.air_c).toEqual(expect.any(Number));
    // 19:00 Irish time in mid-September is before sunset; 22:00 is after.
    // Six hours at three-hourly steps is two rows: the end is exclusive.
    expect(forecast.hours.map((h) => h.daylight)).toEqual([true, false]);
    expect(forecast.sun[0].sunset).toMatch(/^Wed, 16 Sept, 19:\d\d IST$/);
    // No tide or sea-temperature bundle in the fixtures: said, not invented.
    expect(forecast.tides).toBeNull();
    expect(forecast.sea_temperature).toBeNull();
  });

  it("says how cold the air feels in the hour's mean wind", async () => {
    const forecast = await dollymount();
    const rows = forecast.hours.filter((h) => h.weather && h.wind);
    expect(rows.length).toBeGreaterThan(0);
    for (const h of rows) {
      expect(h.weather!.feels_like_c).toBe(
        feelsLikeC(h.weather!.air_c, h.wind!.wind_kn),
      );
      expect(h.weather!.feels_like_c!).toBeLessThanOrEqual(h.weather!.air_c!);
    }
    expect(forecast.units.feels_like).toMatch(/JAG\/TI/);
    expect(forecast.units.feels_like).toMatch(/mean wind_kn at 10 m/);
  });

  it("reads the CAPE and code each published weather square carries", async () => {
    const forecast = await dollymount();
    const weather = forecast.hours[0].weather!;
    expect(weather.cape_j_kg).toEqual(expect.any(Number));
    expect(weather.weather_code).toEqual(expect.any(Number));
    expect(weather.thunder_risk).toEqual(expect.any(String));
  });

  it("says where the water was read, how far off and when", async () => {
    const withSea = fixtureSource({
      "marine/sea-temperature.json": {
        schemaVersion: 1,
        kind: "observation",
        stations: {
          M2: { id: "M2", name: "M2", lat: 53.48, lon: -5.43, network: "buoy" },
        },
        spots: {
          dollymount: {
            station: "M2",
            distanceKm: 48.64,
            latest: { time: "2026-09-16T15:00:00Z", value: 14.46 },
          },
        },
        attribution: "Marine Institute",
      },
    });
    const spot = findSpot(await loadSpots(withSea), "dollymount").spot!;
    const forecast = await spotForecast(
      withSea,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.sea_temperature).toEqual({
      celsius: 14.5,
      measured: "Wed, 16 Sept, 16:00 IST",
      time: "2026-09-16T15:00:00.000Z",
      station: "M2",
      network: "buoy",
      distance_km: 48.6,
      attribution: "Marine Institute",
    });
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
          local: "Wed, 16 Sept, 21:12 IST",
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
            attribution:
              "Tidal predictions by wingfoil.ie from Environment Agency tide gauge data",
            url: "marine/tides-Bangor.json",
          },
        },
        spots: { dollymount: { station: "Bangor", distanceKm: 3.1 } },
        attribution:
          "Tidal predictions © Marine Institute, CC BY 4.0; Northern Ireland: wingfoil.ie",
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
    expect(
      forecast.tides &&
        "attribution" in forecast.tides &&
        forecast.tides.attribution,
    ).toBe(
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
          dollymount: {
            station: null,
            distanceKm: 30,
            noTide: true,
            reason: "No tide: a freshwater lake.",
          },
        },
      },
    });
    const spot = findSpot(await loadSpots(withTides), "dollymount").spot!;
    const forecast = await spotForecast(
      withTides,
      spot,
      windowFor(FIXTURE_NOW, { hours: 6 }),
      {
        now: FIXTURE_NOW,
      },
    );
    expect(forecast.tides).toEqual({ note: "No tide: a freshwater lake." });
  });
});

describe("rain", () => {
  // ICON-EU's shape when it was fetched three-hourly: a step every three
  // hours from the run, each step's precip the total over the three hours
  // ending at it, none at initialization. The step at 15:00 on the 17th has
  // lost its rain. (It is hourly now; a three-hour total is what GFS's
  // weather past +120 h still is, and the harder case for the rows.)
  const RUN = Date.parse("2026-09-16T18:00:00Z");
  const TOTALS = [null, 0.8, 0.1, 0, 2.4, 1.3, 0.5, null, 0.7];
  const BASE = `weather/${
    JSON.parse(
      readFileSync(
        new URL(
          "../../tests/fixtures/weather/icon-eu-weather.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).base
  }`;
  const SQUARE = `${BASE}spots/n52w008.json`;
  /** The fixture's pointer, three-hourly and frameless, as these steps are. */
  const threeHourly = (pointer: Record<string, unknown>, hours: number) => {
    const { frameVariables: _, stepRanges: __, ...rest } = pointer;
    return { ...rest, stepHours: 3, frames: [], horizonHours: hours };
  };
  const at = (iso: string) => Date.parse(iso);

  async function rainForecast(
    window: { from?: string; hours: number; stepHours: number },
    options: {
      totals?: (number | null)[];
      /** Leave the first steps out, so the run starts after the window. */
      skip?: number;
      /** Drop the stated intervals, so the gaps between steps say them. */
      unstated?: boolean;
      /** Each step's present-weather code (default 61, slight rain). */
      codes?: number[];
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
        values: {
          t2m: 10 + k,
          precip,
          clct: 40 + k,
          ww: options.codes?.[k] ?? 61,
        },
      }))
      .slice(options.skip ?? 0);
    const source = fixtureSource({
      "weather/icon-eu-weather.json": threeHourly(
        pointer,
        3 * (totals.length - 1),
      ),
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

  /**
   * ICON-EU's weather as it publishes now: a step every hour, each step's
   * precip the rain in the hour ending at it, and its own temperature, cloud
   * and code.
   */
  async function hourlyForecast(window: { hours: number; stepHours: number }) {
    const inner = fixtureSource();
    const pointer = (await inner.json(
      "weather/icon-eu-weather.json",
    )) as Record<string, unknown>;
    const square = (await inner.json(SQUARE)) as {
      spotSeries: Record<string, unknown>;
    };
    const steps = 25;
    const series = Array.from({ length: steps }, (_, k) => ({
      hour: k,
      validTime: new Date(RUN + k * HOUR).toISOString(),
      precipIntervalHours: k ? [k - 1, k] : null,
      values: {
        t2m: 10 + (k % 5),
        precip: k ? (k % 4) / 10 : null,
        clct: 50 + k,
        ww: k % 2 ? 61 : 3,
        cape: 50 * k,
      },
    }));
    const { frameVariables: _, stepRanges: __, ...rest } = pointer;
    const source = fixtureSource({
      "weather/icon-eu-weather.json": {
        ...rest,
        stepHours: 1,
        frames: [],
        horizonHours: steps - 1,
      },
      [SQUARE]: {
        ...square,
        spotSeries: { ...square.spotSeries, dollymount: series },
      },
    });
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, window),
      { now: FIXTURE_NOW },
    );
    return { forecast, series };
  }

  it("reads hourly weather an hour at a time: each hour its own rain, air and sky", async () => {
    const { forecast, series } = await hourlyForecast({
      hours: 24,
      stepHours: 1,
    });
    expect(forecast.window.weather_step_hours).toBe(1);
    forecast.hours.forEach((hour, k) => {
      const step = series[k].values;
      expect(hour.weather).toMatchObject({
        air_c: step.t2m,
        cloud_pct: step.clct,
        weather_code: step.ww,
        // Each hour's own rain, the hour ending at it; none at the run's start.
        rain_mm: step.precip,
      });
      if (k) expect(hour.weather!.rain_interval_hours).toBe(1);
      expect(hour.weather!.rain_until).toBeUndefined();
    });
    // A rain code no longer sits beside a null rain: the hour has its own.
    expect(
      forecast.hours.filter(
        (h) => h.weather!.weather_code === 61 && h.weather!.rain_mm === null,
      ),
    ).toEqual([]);
    // Nothing tells an agent the weather is three-hourly.
    expect(forecast.units.rain).not.toMatch(/\b3 for ICON-EU/);
    expect(forecast.units.weather).toMatch(/more than an hour/);
  });

  it("flags thunder from the published code and CAPE, hour by hour", async () => {
    const { forecast, series } = await hourlyForecast({
      hours: 24,
      stepHours: 1,
    });
    forecast.hours.forEach((hour, k) => {
      const { ww, cape } = series[k].values;
      const expected = thunderRisk(ww, cape);
      expect(hour.weather).toMatchObject({
        cape_j_kg: cape,
        thunder_risk: expected!.risk,
      });
      expect(hour.weather!.thunder_why).toBe(expected!.why ?? undefined);
    });
    const risks = forecast.hours.map((h) => h.weather!.thunder_risk);
    // Rain with 300 J/kg from 07:00 UTC; 1000 J/kg under any sky from 14:00.
    expect(risks.slice(0, 6)).toEqual(Array(6).fill("low"));
    expect(risks[7]).toBe("possible");
    expect(risks[8]).toBe("low");
    expect(risks[20]).toBe("possible");
    expect(forecast.units.thunder).toMatch(/91–99/);
    expect(forecast.units.thunder).toMatch(/300 J\/kg/);
  });

  it("says thunder is high where the model's code is a thunderstorm", async () => {
    const forecast = await rainForecast(
      { hours: 24, stepHours: 1 },
      { codes: [3, 3, 3, 3, 3, 45, 95, 3, 0] },
    );
    const at = (hhmm: string) =>
      forecast.hours.find((h) => h.time.slice(11, 16) === hhmm)!.weather!;
    expect(at("12:00")).toMatchObject({
      thunder_risk: "high",
      thunder_why: expect.stringMatching(/thunderstorm/i),
    });
    // These steps publish no CAPE: a quiet code is low, not unknown.
    expect(at("09:00")).toMatchObject({ cape_j_kg: null, thunder_risk: "low" });
  });

  it("adds hourly rain up into three-hourly rows", async () => {
    const { forecast, series } = await hourlyForecast({
      hours: 24,
      stepHours: 3,
    });
    expect(forecast.window.weather_step_hours).toBe(1);
    // Each row from the second on sums the three hours since the row before.
    forecast.hours.slice(1).forEach((hour, i) => {
      const k = 3 * (i + 1);
      const total = series
        .slice(k - 2, k + 1)
        .reduce((sum, s) => sum + (s.values.precip ?? 0), 0);
      expect(hour.weather!.rain_mm).toBeCloseTo(total, 5);
      expect(hour.weather!.rain_interval_hours).toBe(3);
    });
  });

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

  it("goes on in GFS's weather past the end of ICON-EU's, rain and all", async () => {
    // ICON-EU's run ends at 12:00 on the 17th; GFS's goes on, and the hours
    // after it read GFS's steps rather than none.
    const inner = fixtureSource();
    const pointer = (await inner.json(
      "weather/icon-eu-weather.json",
    )) as Record<string, unknown>;
    const square = (await inner.json(SQUARE)) as {
      spotSeries: Record<string, unknown>;
    };
    const steps = (totals: (number | null)[], air: number, from = 0) =>
      totals
        .map((precip, k) => ({
          hour: 3 * k,
          validTime: new Date(RUN + 3 * k * HOUR).toISOString(),
          precipIntervalHours: k ? [3 * k - 3, 3 * k] : null,
          values: { t2m: air, precip, clct: 50, ww: 61 },
        }))
        .slice(from);
    const GFS = "gfs-weather-2026091618-24h-v1-0a1b2c3d/";
    const source = fixtureSource({
      "weather/icon-eu-weather.json": threeHourly(pointer, 18),
      [SQUARE]: {
        ...square,
        spotSeries: {
          ...square.spotSeries,
          dollymount: steps(TOTALS.slice(0, 7), 10),
        },
      },
      "weather/gfs-weather.json": {
        ...threeHourly(pointer, 24),
        model: "gfs-weather",
        modelName: "GFS weather",
        base: GFS,
      },
      [`weather/${GFS}spots/n52w008.json`]: {
        ...square,
        model: "gfs-weather",
        spotSeries: {
          dollymount: steps([...TOTALS.slice(0, 7), 0.4, 0.9], 20),
        },
      },
    });
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 24, stepHours: 1 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.sources.weather?.id).toBe("icon-eu-weather");
    expect(forecast.sources.weather_after?.map((run) => run.id)).toEqual([
      "gfs-weather",
    ]);
    const hour = (iso: string) =>
      forecast.hours.find((h) => h.time === iso)?.weather;
    expect(hour("2026-09-17T12:00:00.000Z")?.air_c).toBe(10);
    expect(hour("2026-09-17T15:00:00.000Z")?.air_c).toBe(20);
    // GFS's own totals, on their own intervals, once ICON-EU's have ended.
    expect(hour("2026-09-17T12:00:00.000Z")?.rain_mm).toBe(0.5);
    expect(hour("2026-09-17T15:00:00.000Z")?.rain_mm).toBe(0.4);
    expect(hour("2026-09-17T17:00:00.000Z")?.rain_mm).toBe(0.9);
    expect(forecast.method).toMatch(/weather_after/);
  });

  it("says what each hour's weather code means, and the sky the site draws for it", async () => {
    // Overcast steps, one of them over 2.4 mm of rain; fog; then a thunderstorm.
    const forecast = await rainForecast(
      { hours: 24, stepHours: 1 },
      { codes: [3, 3, 3, 3, 3, 45, 95, 3, 0] },
    );
    const rain = rainByHour(forecast.hours);
    for (const hour of forecast.hours) {
      const w = hour.weather!;
      expect(w.description).toBe(
        presentWeather(w.weather_code)?.description ?? null,
      );
      expect(w.sky).toBe(
        skyOf({ ...w, rain_mm: rain.get(Date.parse(hour.time)) ?? null }),
      );
    }
    const at = (hhmm: string) =>
      forecast.hours.find((h) => h.time.slice(11, 16) === hhmm)!.weather!;
    // Overcast by its code, but rain by the rain in its interval.
    expect(at("21:00")).toMatchObject({
      weather_code: 3,
      description: "Cloudy or overcast, clouds developing",
      sky: "rain",
    });
    expect(at("03:00")).toMatchObject({ weather_code: 3, sky: "cloudy" });
    expect(at("05:00")).toMatchObject({ weather_code: 3, sky: "rain" });
    expect(at("09:00")).toMatchObject({ weather_code: 45, sky: "fog" });
    expect(at("12:00")).toMatchObject({
      weather_code: 95,
      description: "Thunderstorm, slight or moderate",
      sky: "thunder",
    });
    expect(forecast.units.weather_code).toMatch(/WMO.*4677/);
    expect(forecast.units.weather_code).toMatch(/`ww`/);
  });

  /**
   * ICON-EU hourly to 12:00 on the 17th and GFS hourly a little past it, each
   * with its own chance of rain, visibility and code at every hour: what
   * `chance(k)`, `vis(k)` and `code(k)` say for the k-th hour of the run.
   */
  async function twoModelForecast(
    window: { hours: number; stepHours: number },
    icon: {
      chance: (k: number) => number | null;
      vis?: (k: number) => number | null;
      code?: (k: number) => number;
    },
    gfs: { chance: (k: number) => number | null },
    options: { rider?: Rider } = {},
  ) {
    const inner = fixtureSource();
    const pointer = (await inner.json(
      "weather/icon-eu-weather.json",
    )) as Record<string, unknown>;
    const square = (await inner.json(SQUARE)) as {
      spotSeries: Record<string, unknown>;
    };
    const hourly = (
      count: number,
      values: (k: number) => Record<string, number | null>,
    ) =>
      Array.from({ length: count }, (_, k) => ({
        hour: k,
        validTime: new Date(RUN + k * HOUR).toISOString(),
        precipIntervalHours: k ? [k - 1, k] : null,
        values: { t2m: 10, precip: k ? 0 : null, clct: 50, ...values(k) },
      }));
    const { frameVariables: _, stepRanges: __, ...rest } = pointer;
    const frameless = (hours: number) => ({
      ...rest,
      stepHours: 1,
      frames: [],
      horizonHours: hours,
    });
    const GFS = "gfs-weather-2026091618-24h-v1-0a1b2c3d/";
    const source = fixtureSource({
      "weather/icon-eu-weather.json": frameless(18),
      [SQUARE]: {
        ...square,
        spotSeries: {
          ...square.spotSeries,
          dollymount: hourly(19, (k) => ({
            pop: k ? icon.chance(k) : null,
            ww: icon.code?.(k) ?? 3,
            ...(icon.vis && { vis: icon.vis(k) }),
          })),
        },
      },
      "weather/gfs-weather.json": {
        ...frameless(24),
        model: "gfs-weather",
        modelName: "GFS weather",
        base: GFS,
      },
      [`weather/${GFS}spots/n52w008.json`]: {
        ...square,
        model: "gfs-weather",
        spotSeries: {
          dollymount: hourly(25, (k) => ({
            pop: k ? gfs.chance(k) : null,
            ww: 3,
            vis: 30,
          })),
        },
      },
    });
    const spot = findSpot(await loadSpots(source), "dollymount").spot!;
    return spotForecast(source, spot, windowFor(FIXTURE_NOW, window), {
      now: FIXTURE_NOW,
      ...options,
    });
  }
  const hourAt = (
    forecast: Awaited<ReturnType<typeof spotForecast>>,
    iso: string,
  ) => forecast.hours.find((h) => h.time === iso)?.weather;

  it("gives each row the chance of rain over its interval, the mean of the models that reach it", async () => {
    const forecast = await twoModelForecast(
      { hours: 24, stepHours: 1 },
      { chance: (k) => (k === 3 ? 60 : 10) },
      { chance: (k) => (k === 3 ? 20 : k > 18 ? 70 : 0) },
    );
    // Both models while ICON-EU reaches: (60 + 20) / 2, and (10 + 0) / 2.
    expect(hourAt(forecast, "2026-09-16T21:00:00.000Z")).toMatchObject({
      rain_mm: 0,
      rain_interval_hours: 1,
      rain_chance_pct: 40,
    });
    expect(hourAt(forecast, "2026-09-16T22:00:00.000Z")?.rain_chance_pct).toBe(
      5,
    );
    // Past ICON-EU's last step, GFS's own.
    expect(hourAt(forecast, "2026-09-17T13:00:00.000Z")?.rain_chance_pct).toBe(
      70,
    );
    expect(forecast.units.rain_chance).toMatch(/25 km/);
    expect(forecast.units.rain_chance).toMatch(/0\.1 mm/);
  });

  it("gives a row that sums several intervals the highest of their chances", async () => {
    const forecast = await twoModelForecast(
      { hours: 12, stepHours: 3 },
      { chance: (k) => (k === 2 ? 80 : 20) },
      { chance: (k) => (k === 2 ? 40 : 20) },
    );
    // 21:00 sums the hours ending at 19:00, 20:00 and 21:00: 20, 60 and 20.
    expect(hourAt(forecast, "2026-09-16T21:00:00.000Z")).toMatchObject({
      rain_interval_hours: 3,
      rain_chance_pct: 60,
    });
  });

  it("leaves the chance out where no model publishes one", async () => {
    const forecast = await rainForecast({ hours: 6, stepHours: 1 });
    for (const hour of forecast.hours)
      expect(hour.weather).not.toHaveProperty("rain_chance_pct");
  });

  it("gives each hour its visibility, in km and in a rider's words", async () => {
    const vis = [null, 0.4, 0.92, 1, 2.46, 4, 9.94, 10, 24.4, 61];
    const forecast = await twoModelForecast(
      { hours: 10, stepHours: 1 },
      { chance: () => 0, vis: (k) => (k < vis.length ? vis[k] : 30) },
      { chance: () => 0 },
    );
    expect(
      forecast.hours.map((h) => [
        h.weather?.visibility_km,
        h.weather?.visibility,
      ]),
    ).toEqual([
      [null, undefined],
      [0.4, "fog"],
      [0.9, "fog"],
      [1, "poor"],
      [2.5, "poor"],
      [4, "moderate"],
      [9.9, "moderate"],
      [10, "good"],
      [24, "good"],
      [61, "good"],
    ]);
    expect(forecast.units.visibility).toMatch(/fog under 1 km/);
  });

  it("says fog from a fog code where the model has no visibility for the hour, and nothing from a dry code", async () => {
    const forecast = await twoModelForecast(
      { hours: 4, stepHours: 1 },
      { chance: () => 0, code: (k) => (k === 2 ? 45 : 3) },
      { chance: () => 0 },
    );
    const at = (hhmm: string) =>
      forecast.hours.find((h) => h.time.slice(11, 16) === hhmm)!.weather!;
    expect(at("20:00").visibility).toBe("fog");
    expect(at("20:00").visibility_km).toBeNull();
    expect(at("19:00")).not.toHaveProperty("visibility");
  });

  it("gives each best window its highest chance of rain and its worst visibility", async () => {
    const forecast = await twoModelForecast(
      { hours: 24, stepHours: 1 },
      { chance: (k) => k * 2, vis: (k) => (k === 14 ? 3 : 20) },
      { chance: (k) => k * 2 },
      { rider: EVERY_HOUR.rider },
    );
    const windows = forecast.best_windows!.flatMap((d) =>
      d.window ? [d.window] : [],
    );
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some((w) => w.rain_chance_pct !== undefined)).toBe(true);
    for (const window of windows) {
      const from = Date.parse(window.from);
      const to = Date.parse(window.to);
      const run = forecast.hours.filter((h) => {
        const t = Date.parse(h.time);
        return t > from && t <= to && h.weather?.rain_chance_pct != null;
      });
      if (!run.length) continue;
      expect(window.rain_chance_pct).toBe(
        Math.max(...run.map((h) => h.weather!.rain_chance_pct!)),
      );
      expect(window.visibility).toBeDefined();
    }
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
    age_hours: 6,
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
    // No gust of the one model's, so no factor either.
    expect(hour.gust_factor).toBeNull();
  });

  it("gives the gust factor of the one model's own gust and wind", () => {
    const harmonie = line("harmonie", { u: 8, v: 0, gust: 20 });
    const hour = hourWind([harmonie, ...others], at, false)!;
    expect(hour.gust_factor).toBe(
      Math.round((hour.gust_kn! / hour.wind_kn) * 100) / 100,
    );
    expect(hour.gust_factor).toBeCloseTo(2.5, 1);
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
    expect(
      hourWind([harmonie, ecmwf, ...others], at + 6 * HOUR, false),
    ).toBeNull();
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
    const run = { name: "GEFS" } as Parameters<
      typeof hourEnsemble
    >[0][0]["run"];
    const hour = hourEnsemble([{ run, members, gap: 12 * HOUR }], at)!;
    expect(hour.members).toBe(4);
    expect(hour.models).toEqual(["GEFS"]);
    expect(hour.p50_kn).toBeCloseTo(5.5 * KNOTS, 0);
    expect(hour.p10_kn).toBeLessThan(hour.p50_kn);
    expect(hour.p90_kn).toBeGreaterThan(hour.p50_kn);
    expect(
      hourEnsemble([{ run, members, gap: 12 * HOUR }], at - HOUR),
    ).toBeNull();
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

describe("the stars", () => {
  const source = fixtureSource();
  const forecastFor = async (
    id: string,
    rider = riderOf(),
    stepHours = 1,
    hours = 48,
  ) => {
    const spot = (await loadSpots(source)).find((s) => s.id === id)!;
    return spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours, stepHours }),
      { now: FIXTURE_NOW, rider },
    );
  };

  it("rates every hour with the site's own rateHour, as the spot page does", async () => {
    for (const [id, rider] of [
      ["brandon", riderOf()],
      ["dollymount", OWN_STARS],
      ["kilcrea", riderOf({ weight_kg: 60 })],
      ["malahide-estuary", riderOf({ wings_m2: [4, 6] })],
    ] as const) {
      const forecast = await forecastFor(id, rider);
      const facing = shoreFacing(id);
      let rated = 0;
      for (const hour of forecast.hours) {
        // The spot page's own call, on the same hour.
        const site = rateForecastHour(hour, facing, rider);
        const direct = hour.wind
          ? rateHour(
              {
                windKn: hour.wind.wind_kn,
                gustKn: hour.wind.gust_kn,
                from: hour.wind.direction_deg,
                daylight: hour.daylight,
              },
              { facing },
              rider,
            )
          : null;
        expect(site).toEqual(direct);
        if (!site) {
          expect(hour.rating).toBeNull();
          expect(hour.why_not_rated).toMatch(/^not rated/);
          continue;
        }
        rated++;
        expect(hour.rating).toMatchObject({
          stars: site.stars,
          potential: site.potential,
          reasons: site.reasons,
          session: site.session,
          wing_m2: site.wing.recommended,
        });
        expect(hour.rating!.why_no_stars === null).toBe(site.stars > 0);
      }
      expect(rated, id).toBeGreaterThan(0);
    }
  });

  it("rates three-hourly rows the same as the hours they stand on", async () => {
    const hourly = await forecastFor("brandon", riderOf(), 1);
    const coarse = await forecastFor("brandon", riderOf(), 3);
    for (const row of coarse.hours) {
      const same = hourly.hours.find((h) => h.time === row.time)!;
      expect(row.rating).toEqual(same.rating);
    }
    expect(coarse.best_windows).toEqual(hourly.best_windows);
  });

  it("takes every star off an hour gusting over the rider's limit, and says so", () => {
    // Kilcrea, Sat 24 Oct 2026 at 17:00 (#177): 20.5 kn gusting 49.6.
    const wind = {
      wind_kn: 20.5,
      gust_kn: 49.6,
      direction_deg: 250,
    } as HourWind;
    const rider = riderOf();
    const rating = rateWind(wind, true, shoreFacing("kilcrea"), rider)!;
    const stars = hourStars(rating);
    expect(stars).toMatchObject({
      stars: 0,
      potential: 0,
      why_no_stars: "gusts over your limit",
    });
    expect(stars).not.toHaveProperty("gustiness");
    expect(rateWind(wind, false, 163, rider)).toBeNull();
  });

  it("says who the stars are for, as the spot page does", async () => {
    const forecast = await forecastFor("kilcrea");
    expect(forecast.rider).toEqual({
      label: "Ours · ~80 kg",
      rating: "ours",
      weight_kg: 80,
      weight_assumed: true,
      wings_m2: [],
      gust_limit_kn: 35,
      wind_band_kn: { min: 11, sweet_low: 15, sweet_high: 22, max: 35 },
    });
    // The weight is the rider's, and moves no number the stars come from.
    expect(riderUsed(riderOf({ weight_kg: 95 }))).toMatchObject({
      label: "Ours · 95 kg",
      weight_assumed: false,
      wind_band_kn: forecast.rider!.wind_band_kn,
    });
    expect(riderUsed(OWN_STARS)).toMatchObject({
      label: "Your own stars · ~80 kg",
      rating: "own",
      gust_limit_kn: 25,
      wind_band_kn: { min: 8, sweet_low: 10, sweet_high: 16, max: 25 },
    });
  });

  it("takes an old agent's level and gust setting, and rates on ours all the same", async () => {
    // Before 25 October 2026 an agent could pass a level and a gust setting.
    const old = { level: "advanced", gusty: "little" } as RiderChoice;
    expect(riderOf(old)).toEqual(riderOf());
    expect(riderOf({ ...old, weight_kg: 95 })).toEqual(
      riderOf({ weight_kg: 95 }),
    );
    expect((await forecastFor("kilcrea", riderOf(old))).hours).toEqual(
      (await forecastFor("kilcrea")).hours,
    );
  });

  it("gives the winds the beach wants, as the spot page's header says them", async () => {
    // wingfoil.ie/spot/kilcrea: "best ENE–ESE, SSW–W".
    expect((await forecastFor("kilcrea")).best_directions).toEqual([
      "ENE–ESE",
      "SSW–W",
    ]);
    expect((await forecastFor("brandon")).best_directions!.join(", ")).toBe(
      goodWindArcs(shoreFacing("brandon")!).map(arcText).join(", "),
    );
  });

  it("picks each Irish day's best window from the hours' stars, ended by last light", async () => {
    const forecast = await forecastFor("dollymount", OWN_STARS, 1, 72);
    const days = forecast.best_windows!;
    expect(days.map((d) => d.date)).toEqual(forecast.sun.map((d) => d.date));
    const withWindow = days.filter((d) => d.window);
    expect(withWindow.length).toBeGreaterThan(0);
    for (const day of days) {
      const hours = forecast.hours.filter(
        (h) => dublinDate(Date.parse(h.time)) === day.date,
      );
      const best = bestWindow(
        hours.map((h) =>
          h.rating ? ({ stars: h.rating.stars } as HourRating) : null,
        ),
      );
      if (!best) {
        expect(day.window).toBeNull();
        expect(day.why_none).toEqual(expect.any(String));
        continue;
      }
      const w = day.window!;
      expect(w.from).toBe(hours[best.from].time);
      expect(w.stars).toBe(best.stars);
      expect(w.hours).toBe(best.to - best.from + 1);
      const sun = forecast.sun.find((d) => d.date === day.date)!;
      expect(Date.parse(w.to)).toBeLessThanOrEqual(
        daySun(forecast.spot, day.date).lastLight!,
      );
      expect(sun.last_light).not.toBeNull();
    }
  });
});

describe("findSessions", () => {
  it("ranks spots by hours in the range and groups them into sessions", async () => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 12, stepHours: 1 });
    const all = await findSessions(source, spots, window, {
      ...EVERY_HOUR,
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
      ...EVERY_HOUR,
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

describe("light", () => {
  it("says how light each row is, and each Irish day's first and last light", async () => {
    const source = fixtureSource();
    const spot = findSpot(await loadSpots(source), "kilcrea").spot!;
    const now = Date.parse("2026-10-24T22:00:00Z");
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(now, { hours: 30, stepHours: 1 }),
      { now },
    );
    // Keyed by Irish day, each in Irish time with its zone.
    expect(forecast.sun.map((d) => d.date)).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
    const sunday = forecast.sun[1];
    expect(sunday.first_light).toMatch(/^Sun, 25 Oct, 0[67]:\d\d GMT$/);
    expect(sunday.sunset).toMatch(/^Sun, 25 Oct, 17:0\d GMT$/);
    expect(sunday.last_light).toMatch(/^Sun, 25 Oct, 17:[34]\d GMT$/);
    const day = daySun(spot, "2026-10-25");
    expect(day.firstLight!).toBeLessThan(day.sunrise!);
    expect(day.lastLight! - day.sunset!).toBeGreaterThan(30 * 60000);
    for (const hour of forecast.hours) {
      const t = Date.parse(hour.time);
      const { firstLight, sunrise, sunset, lastLight } = daySun(
        spot,
        dublinDate(t),
      );
      const expected =
        t >= sunrise! && t <= sunset!
          ? "day"
          : t >= firstLight! && t <= lastLight!
            ? "twilight"
            : "dark";
      expect(hour.light, hour.local).toBe(expected);
      expect(hour.daylight).toBe(expected === "day");
    }
    // 17:00 GMT on Sunday starts before sunset; 18:00 is dark already.
    const at = (local: string) =>
      forecast.hours.find((h) => h.local === local)!;
    expect(at("Sun, 25 Oct, 17:00 GMT").light).toBe("day");
    expect(at("Sun, 25 Oct, 18:00 GMT").light).toBe("dark");
    expect(at("Sun, 25 Oct, 07:00 GMT").light).toBe("twilight");
    expect(forecast.units.light).toMatch(/last light/);
  });

  const sessions = async (daylightOnly: boolean) => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    // Late September, when the sun sets just after an hour starts.
    const now = Date.parse("2026-09-24T00:00:00Z");
    const found = await findSessions(
      source,
      spots,
      windowFor(now, { hours: 72, stepHours: 1 }),
      {
        ...EVERY_HOUR,
        allowOffshore: true,
        daylightOnly,
        minSessionHours: 1,
        counties: ["Dublin"],
        limit: 30,
        now,
      },
    );
    return found.spots.flatMap((r) =>
      r.sessions.map((s) => ({ spot: r.spot, ...s })),
    );
  };

  it("ends find_wind's sessions by last light", async () => {
    const all = await sessions(true);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      const end = Date.parse(s.to);
      const { lastLight } = daySun(s.spot, s.to.slice(0, 10));
      expect(end).toBeLessThanOrEqual(lastLight!);
      expect(s.dark_hours).toBeUndefined();
    }
    const clipped = all.filter((s) => s.ends_at_last_light);
    expect(clipped.length).toBeGreaterThan(0);
    for (const s of clipped) {
      expect(Date.parse(s.to)).toBe(
        daySun(s.spot, s.to.slice(0, 10)).lastLight,
      );
      expect(s.local.endsWith(localStamp(Date.parse(s.to)).slice(-9))).toBe(
        true,
      );
    }
  });

  it("lets find_wind run past last light when asked, and counts the dark hours", async () => {
    const all = await sessions(false);
    expect(all.some((s) => (s.dark_hours ?? 0) > 0)).toBe(true);
    expect(all.some((s) => s.ends_at_last_light)).toBe(false);
  });
});

describe("findSessions' gust limits", () => {
  const search = async (limits: object) => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 48, stepHours: 1 });
    return findSessions(source, spots, window, {
      ...EVERY_HOUR,
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

  it("gives each session its highest gust factor, as context", async () => {
    const found = await search({});
    const sessions = found.spots.flatMap((r) => r.sessions);
    // The fixtures' whole two days gust to about 30 kn over a 12 kn mean.
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.gust_factor!).toBeGreaterThanOrEqual(
        s.gust_kn! / s.max_kn - 0.01,
      );
      // No gust setting, and no star penalty by gust factor, since 25 October 2026.
      expect(s).not.toHaveProperty("gustiness");
      expect(s).not.toHaveProperty("gusty");
    }
  });

  it("never counts an hour gusting over the rider's limit, however it is asked", async () => {
    // A rider whose own too much is under the fixtures' 30 kn gusts.
    const rider = OWN_STARS;
    const limit = riderUsed(rider).gust_limit_kn;
    expect(limit).toBeLessThan(30);
    const all = await search({ rider, minStars: 1 });
    const sessions = all.spots.flatMap((r) => r.sessions);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.gust_kn!).toBeLessThanOrEqual(limit);
      expect(s.stars!).toBeGreaterThanOrEqual(1);
    }
    // The same search for the hours alone, stars or none, finds the gusty ones.
    const every = await search({ rider, minStars: 0 });
    expect(
      every.spots.flatMap((r) => r.sessions).some((s) => s.gust_kn! > limit),
    ).toBe(true);
  });
});

describe("the shore", () => {
  const search = async (allowOffshore?: boolean) => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 48, stepHours: 1 });
    return findSessions(source, spots, window, {
      ...EVERY_HOUR,
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
        if (result.shore_type === "on-water") expect(s.shore).toBe("on-water");
        else if (result.shore_facing_deg === null) expect(s.shore).toBeNull();
      }
    }
  });
});

describe("spots on the water", () => {
  const source = fixtureSource();

  it("says Malahide Estuary is on the water, every hour, and what that means", async () => {
    const spot = (await loadSpots(source)).find(
      (s) => s.id === "malahide-estuary",
    )!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 24 }),
      { now: FIXTURE_NOW, rider: riderOf() },
    );
    expect(forecast.shore_type).toBe("on-water");
    expect(forecast.shore_facing_deg).toBeNull();
    expect(forecast.best_directions).toBeNull();
    expect(forecast.hours.every((h) => h.shore === "on-water")).toBe(true);
    expect(forecast.shore_note).toMatch(/on the water/);
    expect(forecast.shore_note).toMatch(/offshore filter doesn't apply/);
    expect(forecast.shore_note).not.toMatch(/no shore|unknown|missing/i);
    expect(forecast.units.shore).toMatch(/on-water/);
    // The stars rate it on the wind alone, as the site does a spot with no facing.
    for (const hour of forecast.hours.filter((h) => h.rating))
      expect(hour.rating!.reasons.some((r) => /shore|offshore/i.test(r))).toBe(
        false,
      );
  });

  it("tells a beach whose facing is unknown apart from a spot on the water", async () => {
    const spot = (await loadSpots(source)).find((s) => s.id === "bertra")!;
    const forecast = await spotForecast(
      source,
      spot,
      windowFor(FIXTURE_NOW, { hours: 3 }),
      { now: FIXTURE_NOW },
    );
    expect(forecast.shore_type).toBe("unknown");
    expect(forecast.hours.every((h) => h.shore === null)).toBe(true);
    expect(forecast.shore_note).toMatch(/can't be ruled out/);
    const kilcrea = (await loadSpots(source)).find((s) => s.id === "kilcrea")!;
    const beach = await spotForecast(
      source,
      kilcrea,
      windowFor(FIXTURE_NOW, { hours: 3 }),
      { now: FIXTURE_NOW },
    );
    expect(beach.shore_type).toBe("beach");
    expect(beach.shore_note).toBeUndefined();
  });

  it("keeps a spot on the water in find_wind, the offshore filter not applying, with its neighbours", async () => {
    const spots = await loadSpots(source);
    const found = await findSessions(
      source,
      spots,
      windowFor(FIXTURE_NOW, { hours: 48, stepHours: 1 }),
      {
        ...EVERY_HOUR,
        daylightOnly: false,
        minSessionHours: 1,
        counties: ["Dublin"],
        limit: 30,
        now: FIXTURE_NOW,
      },
    );
    const malahide = found.spots.find((r) => r.spot.id === "malahide-estuary")!;
    expect(malahide.shore_type).toBe("on-water");
    for (const s of malahide.sessions) {
      expect(s.shore).toBe("on-water");
      expect(s.offshore_hours).toBe(0);
    }
    expect(malahide.nearby!.map((n) => n.id)).toEqual(
      expect.arrayContaining(["kilcrea", "malahide-estuary-south-park"]),
    );
    expect(malahide.nearby![0]).toMatchObject({
      id: "kilcrea",
      distance_km: 0.7,
    });
  });

  it("names the spots close by", async () => {
    const spots = await loadSpots(source);
    const of = (id: string) =>
      nearbySpots(
        spots,
        spots.find((s) => s.id === id)!,
      ).map((n) => n.id);
    expect(of("kilcrea")).toEqual([
      "malahide-estuary",
      "malahide-estuary-south-park",
    ]);
    expect(of("brandon")).toEqual([]);
    for (const n of nearbySpots(
      spots,
      spots.find((s) => s.id === "keel")!,
    ))
      expect(n.distance_km).toBeLessThanOrEqual(NEARBY_KM);
  });
});

describe("near and counties", () => {
  const search = async (filters: object) => {
    const source = fixtureSource();
    const spots = await loadSpots(source);
    const window = windowFor(FIXTURE_NOW, { hours: 12, stepHours: 1 });
    const found = await findSessions(source, spots, window, {
      ...EVERY_HOUR,
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
      if (
        next &&
        next.rideable_hours === r.rideable_hours &&
        next.best_window?.stars === r.best_window?.stars
      )
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
        ...EVERY_HOUR,
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
    const source = cached(
      async () => ++reads,
      60000,
      () => 0,
    );
    expect(await source.json("weather/ecmwf.json")).toBe(1);
    expect(await source.json("weather/ecmwf.json")).toBe(1);
    source.forget!("weather/ecmwf.json");
    expect(await source.json("weather/ecmwf.json")).toBe(2);
  });

  it("keeps no run's files, drops what has expired, and holds at most its limit", async () => {
    let clock = 0;
    let reads = 0;
    const source = cached(
      async () => ++reads,
      60000,
      () => clock,
    );
    // Every run has new square paths: kept, they would pile up for ever.
    for (let run = 0; run < 50; run++)
      await source.json(
        `weather/harmonie-20261011${String(run).padStart(2, "0")}-61h-v3-0a0b0c0d/spots/n52w008.json`,
      );
    expect(source.size()).toBe(0);
    // Shared while in flight, all the same.
    const square =
      "weather/harmonie-2026101106-61h-v3-1a2b3c4d/spots/n52w008.json";
    const [a, b] = await Promise.all([
      source.json(square),
      source.json(square),
    ]);
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
      ...EVERY_HOUR,
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
