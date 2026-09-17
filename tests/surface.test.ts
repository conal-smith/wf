// The browser's surface-weather readers against an ICON-EU-shaped sample bundle,
// which is the acceptance data. The contract itself is unit-tested with
// hand-built fixtures in force5/src/variables.test.ts; this is a whole published
// bundle, in the published format, written by scripts/sample-weather.mjs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readBundle } from "./bundles";
import {
  precipIntervalHours,
  presentWeather,
  preferredWeatherSource,
  validateWeatherManifest,
  weatherAtAxis,
  weatherFields,
  weatherHours,
  weatherSeries,
  weatherSeriesHasData,
  type WeatherManifest,
} from "../force5/src/surface";

const manifest = validateWeatherManifest(
  readBundle<WeatherManifest>("icon-eu-weather"),
);
const axis = manifest.frames.map((frame) => frame.validTime);

describe("the sample ICON-EU surface weather bundle", () => {
  it("validates as published", () => {
    expect(manifest.model).toBe("icon-eu-weather");
    // No sample bundle may claim a real source: the provider and the
    // attribution both say what this data is.
    expect(manifest.provider).toBe("Synthetic sample data");
    expect(manifest.attribution).toMatch(/not a forecast/);
    expect(manifest.kind).toBe("weather");
    expect(manifest.stepHours).toBe(3);
    expect(weatherHours(manifest)).toEqual(
      manifest.frames.map((frame) => frame.hour),
    );
    // Hours 0 and 3 only: the sample bundle is an 18 UTC run through +3 h.
    expect(weatherHours(manifest)).toEqual([0, 3]);
    expect(manifest.runTime).toBe("2026-09-16T18:00:00Z");
    expect(manifest.variables.ww.kind).toBe("code");
    expect(manifest.frameVariables).toEqual([
      "t2m",
      "precip",
      "clct",
      "pmsl",
      "ww",
    ]);
  });
  it("names every variable the dock's rows read", () => {
    expect(weatherFields(manifest)).toEqual({
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
  it("reads Brandon Bay as the values the bundle publishes", () => {
    const series = weatherSeries(manifest, "brandon")!;
    expect(series).toHaveLength(2);
    expect(weatherSeriesHasData(series)).toBe(true);
    expect(series[0].values.t2m).toBe(13.5);
    expect(series[0].values.clct).toBe(24);
    expect(series[0].values.pmsl).toBe(1016.9);
    // The accumulation starts at nothing, and the run hour has no interval to
    // difference, so its rain is null rather than zero.
    expect(series[0].values.tp).toBe(0);
    expect(series[0].values.precip).toBeNull();
    expect(precipIntervalHours(series[0])).toBeNull();
    expect(series[1].values.precip).toBe(1.3);
    expect(precipIntervalHours(series[1])).toBe(3);
    expect(series[1].values.t2m).toBe(11.2);
    expect(series[1].values.pmsl).toBe(1014.2);
  });
  it("turns the published codes into the shapes the Weather row draws", () => {
    // A code belongs to the cell containing a location, so which code a place
    // reads is where it stands, not where it sits in the catalogue: Dollymount
    // is in the cell the rota puts "cloudy" then "slight rain" in.
    const series = weatherSeries(manifest, "dollymount")!;
    expect(presentWeather(series[0].values.ww)).toMatchObject({
      code: 3,
      icon: "cloudy",
    });
    expect(presentWeather(series[1].values.ww)).toMatchObject({
      code: 61,
      icon: "rain",
      description: "Slight rain",
    });
  });
  it("labels the skin temperature as the proxy the manifest says it is", () => {
    const series = weatherSeries(manifest, "brandon")!;
    expect(series[0].values.tg).toBe(13.1);
    expect(manifest.seaTemperatureNote).toMatch(/proxy/);
    expect(manifest.presentWeatherNote).toMatch(/never interpolated/);
    expect(manifest.precipitationNote).toMatch(/precipIntervalHours/);
  });
  it("lands its two steps on two dock columns and leaves the rest empty", () => {
    const columns = weatherAtAxis(weatherSeries(manifest, "brandon")!, axis);
    expect(columns.map((step) => step?.hour ?? null)).toEqual([0, 3]);
    // Three hours past the last step is a wind column GFS has and this run does
    // not; nothing is carried forward into it.
    expect(
      weatherAtAxis(weatherSeries(manifest, "brandon")!, [
        "2026-09-17T00:00:00Z",
      ])[0],
    ).toBeNull();
  });
  it("is the source for the spot, with its fields resolved", () => {
    const source = preferredWeatherSource([manifest], "brandon")!;
    expect(source.manifest.model).toBe("icon-eu-weather");
    expect(source.fields.air).toBe("t2m");
    expect(preferredWeatherSource([manifest], "nowhere")).toBeNull();
  });
  it("covers every riding location with a reading, not a gap", () => {
    const places: { id: string }[] = JSON.parse(
      readFileSync("public/riding-locations.json", "utf8"),
    );
    for (const place of places) {
      const series = weatherSeries(manifest, place.id);
      expect(series, place.id).toBeTruthy();
      // Surface weather has no land mask: every spot in the crop reads.
      expect(weatherSeriesHasData(series), place.id).toBe(true);
      for (const step of series!)
        expect(presentWeather(step.values.ww), place.id).not.toBeNull();
    }
    expect(Object.keys(manifest.spotSeries).sort()).toEqual(
      places.map((place) => place.id).sort(),
    );
  });
});
