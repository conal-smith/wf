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
  findSessions,
  findSpot,
  hourEnsemble,
  hourWind,
  loadSpots,
  modelStatus,
  spotForecast,
  windowFor,
  type RidingSpot,
} from "./forecast";
import { FIXTURE_NOW, fixtureSource } from "./testing";
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

  it("gives the weighted median, range and agreement of the models in knots where HARMONIE has ended", async () => {
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
          speed: Math.hypot(row.u, row.v) * KNOTS,
          weight: modelWeight(model, lead),
          lead,
        };
      }),
    );
    const speeds = rows.map((r) => r.speed).sort((a, b) => a - b);
    const wind = first.wind!;
    expect(wind.models).toBe(2);
    expect(wind.wind_kn).toBeCloseTo(
      weightedMedian(
        rows.map((r) => r.speed),
        rows.map((r) => r.weight),
      ),
      1,
    );
    expect(wind.lead).toBeNull();
    expect(wind.gust_lead).toBeNull();
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
    // The weighted median the four would have outvoted it with.
    const blend = hourWind(others, at, false)!;
    expect(blend.lead).toBeNull();
    expect(blend.wind_kn).toBeCloseTo(5 * KNOTS, 1);
    expect(blend.direction_deg).toBe(180);
  });

  it("keeps the blend's gust where HARMONIE gives none, and says so", () => {
    const harmonie = line("harmonie", { u: 9, v: 0, gust: null });
    const hour = hourWind([harmonie, ...others], at, false)!;
    expect(hour.lead).toBe("harmonie");
    expect(hour.gust_lead).toBeNull();
    expect(hour.wind_kn).toBeCloseTo(9 * KNOTS, 1);
    expect(hour.gust_kn).toBeCloseTo(7 * KNOTS, 1);
  });

  it("falls back to the blend past HARMONIE's run", () => {
    const harmonie = line("harmonie", { u: 9, v: 0, gust: 12 });
    const later = at + 5 * HOUR;
    const hour = hourWind([harmonie, ...others], later, false)!;
    expect(hour).toEqual(hourWind(others, later, false));
    expect(hour.lead).toBeNull();
    expect(hour.wind_kn).toBeCloseTo(5 * KNOTS, 1);
    expect(hour.models).toBe(4);
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
    expect(without.hours[0].wind?.models).toBe(1);
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
      county: "Dublin",
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
