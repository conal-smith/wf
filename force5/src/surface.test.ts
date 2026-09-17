// Surface weather: which variables carry which reading, which source the dock
// prefers, and the WMO present-weather mapping. The manifest contract itself is
// covered in variables.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearManifestCache, loadWeatherManifest } from "./manifests";
import {
  precipIntervalHours,
  presentWeather,
  preferredWeatherSource,
  weatherAtAxis,
  weatherFields,
  weatherSeries,
  weatherSeriesHasData,
  type WeatherIcon,
} from "./surface";
import { weatherManifest, windManifest } from "./testing";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => clearManifestCache());
afterEach(() => vi.unstubAllGlobals());

describe("surface weather fields", () => {
  it("maps every reading the dock shows onto a declared variable", () => {
    expect(weatherFields(weatherManifest())).toEqual({
      air: "t2m",
      dewPoint: "td2m",
      humidity: "rh2m",
      rain: "precip",
      rainSinceRun: "tp",
      cloud: "clct",
      cloudLow: "clcl",
      cloudMid: "clcm",
      cloudHigh: "clch",
      pressure: "pmsl",
      present: "ww",
      skin: "tg",
      visibility: "vis",
      cape: "cape",
    });
  });
  it("reports a reading this source does not publish as null, not a guess", () => {
    const fields = weatherFields(
      weatherManifest({
        variables: {
          t2m: { units: "°C", label: "Air", description: "air" },
        },
        values: () => ({ t2m: 15 }),
      }),
    );
    expect(fields.air).toBe("t2m");
    for (const key of ["rain", "cloud", "pressure", "present", "skin"] as const)
      expect(fields[key]).toBeNull();
  });
  it("states the interval a rain amount covers, and its absence at hour zero", () => {
    const series = weatherSeries(weatherManifest(), "brandon")!;
    expect(precipIntervalHours(series[0])).toBeNull();
    expect(precipIntervalHours(series[1])).toBe(3);
    expect(precipIntervalHours(null)).toBeNull();
    expect(
      precipIntervalHours({
        ...series[1],
        precipIntervalHours: [3, 3],
      }),
    ).toBeNull();
  });
  it("lands its steps on the dock's columns without interpolating", () => {
    const series = weatherSeries(weatherManifest(), "brandon")!;
    const columns = weatherAtAxis(series, [
      "2026-09-16T18:00:00Z",
      "2026-09-16T21:00:00Z",
    ]);
    expect(columns.map((step) => step?.values.ww ?? null)).toEqual([3, 61]);
  });
});

describe("the preferred weather source", () => {
  it("is the first listed model that can see the spot", () => {
    const icon = weatherManifest();
    const other = weatherManifest({ model: "other-weather" });
    const source = preferredWeatherSource([other, icon], "brandon")!;
    expect(source.manifest.model).toBe("icon-eu-weather");
    expect(source.series).toHaveLength(3);
    expect(source.fields.air).toBe("t2m");
  });
  it("passes over a model whose series for the spot says nothing", () => {
    const blank = weatherManifest({ values: () => null });
    const other = weatherManifest({ model: "other-weather" });
    expect(weatherSeriesHasData(weatherSeries(blank, "brandon"))).toBe(false);
    expect(preferredWeatherSource([blank], "brandon")).toBeNull();
    expect(
      preferredWeatherSource([blank, other], "brandon")!.manifest.model,
    ).toBe("other-weather");
    expect(preferredWeatherSource([other], "nowhere")).toBeNull();
  });
  it("loads a weather manifest through the shared cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(weatherManifest())),
    );
    const manifest = await loadWeatherManifest("icon-eu-weather");
    expect(manifest.kind).toBe("weather");
    expect(manifest.provider).toBe("DWD");
  });
  it("refuses to hand a wind model out through the weather door", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(windManifest({ model: "gfs" }))),
    );
    await expect(loadWeatherManifest("gfs")).rejects.toThrow(
      /GFS is a wind model, not a weather model/,
    );
  });
});

describe("the WMO present-weather mapping", () => {
  /** One representative code per group the manifest's own description names. */
  const GROUPS: [code: number, icon: WeatherIcon][] = [
    [0, "clear"],
    [1, "partly"],
    [2, "partly"],
    [3, "cloudy"],
    [5, "fog"],
    [10, "fog"],
    [45, "fog"],
    [48, "fog"],
    [51, "drizzle"],
    [53, "drizzle"],
    [57, "drizzle"],
    [61, "rain"],
    [63, "rain"],
    [67, "rain"],
    [71, "snow"],
    [75, "snow"],
    [77, "snow"],
    [80, "showers"],
    [81, "showers"],
    [82, "showers"],
    [85, "snow"],
    [86, "snow"],
    [95, "thunder"],
    [96, "thunder"],
    [99, "thunder"],
  ];
  it("puts every group on the shape a rider acts on", () => {
    for (const [code, icon] of GROUPS)
      expect(presentWeather(code)).toMatchObject({ code, icon });
  });
  it("gives every code from 0 to 99 a shape and a description", () => {
    for (let code = 0; code <= 99; code++) {
      const reading = presentWeather(code);
      expect(reading, `code ${code}`).not.toBeNull();
      expect(reading!.description.trim().length).toBeGreaterThan(0);
      // A description is a phrase, not a sentence: it goes in a tooltip beside
      // the code number the dock also prints.
      expect(reading!.description).not.toMatch(/\.$/);
    }
  });
  it("uses the code table's own words, including its intensities", () => {
    expect(presentWeather(0)!.description).toBe("Clear sky");
    expect(presentWeather(3)!.description).toMatch(/overcast/i);
    expect(presentWeather(45)!.description).toBe("Fog");
    expect(presentWeather(51)!.description).toBe("Slight drizzle");
    expect(presentWeather(53)!.description).toBe("Moderate drizzle");
    expect(presentWeather(55)!.description).toBe("Heavy drizzle");
    expect(presentWeather(61)!.description).toBe("Slight rain");
    expect(presentWeather(65)!.description).toBe("Heavy rain");
    expect(presentWeather(71)!.description).toBe("Slight snow");
    expect(presentWeather(75)!.description).toBe("Heavy snow");
    expect(presentWeather(81)!.description).toMatch(/rain showers/i);
    expect(presentWeather(96)!.description).toMatch(/hail/i);
  });
  it("says nothing rather than guessing when there is no code", () => {
    for (const code of [null, undefined, 61.5, 100, 1000, -1, NaN])
      expect(presentWeather(code as number | null | undefined)).toBeNull();
  });
});
