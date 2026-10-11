// The shared variables-bundle reader. The wave-shaped half of this contract is
// covered by waves.test.ts against wave fixtures; what is checked here is that
// the reader is genuinely shared — one validator, parameterised by kind — and
// the two things that differ by kind: the value bound and code-table variables.
import { describe, expect, it } from "vitest";
import {
  ICON_WEATHER_VARIABLES,
  pointerOf,
  waveManifest,
  weatherManifest,
} from "./testing";
import {
  validateWaveManifest,
  validateWaveSpots,
  type WaveManifest,
} from "./waves";
import {
  MAX_VARIABLE_CODE,
  VARIABLE_MATCH_HOURS,
  VARIABLE_VALUE_LIMITS,
  pickVariable,
  validateVariablesManifest,
  variableAtAxis,
  variableSeries,
  variableSeriesHasData,
  variableValue,
  variablesHours,
  type VariableStep,
  type VariablesManifest,
} from "./variables";
import {
  validateWeatherManifest,
  validateWeatherSpots,
  weatherHours,
  type WeatherManifest,
} from "./surface";

/**
 * A wave run as the site reads it: the pointer validated as published, without
 * its spot data, and the series as they arrive from the squares.
 */
const checkWave = (m: WaveManifest): WaveManifest => {
  validateWaveManifest(pointerOf(m));
  return validateWaveSpots(m);
};

/** The same for a weather run. */
const checkWeather = (m: WeatherManifest): WeatherManifest => {
  validateWeatherManifest(pointerOf(m));
  return validateWeatherSpots(m);
};

/** A weather fixture with one manifest-level field replaced. */
const broken = (extra: Partial<WeatherManifest>) =>
  weatherManifest({ extra }) as WeatherManifest;
/** The same fixture with one spot value replaced at the last hour. */
function withValue(name: string, value: number | null): WeatherManifest {
  const manifest = weatherManifest();
  const series = manifest.spotSeries!.brandon;
  series[series.length - 1].values[name] = value;
  return manifest;
}

describe("the shared variables reader", () => {
  it("is one validator, told which kind it is holding", () => {
    // The wave door and a hand-built wave validator are the same function
    // applied to the same rules, so nothing can drift between them.
    const wave = waveManifest();
    expect(checkWave(wave)).toBe(wave);
    const pointer = pointerOf(wave);
    expect(validateVariablesManifest<WaveManifest>("wave")(pointer)).toBe(
      pointer,
    );
    const weather = weatherManifest();
    expect(checkWeather(weather)).toBe(weather);
  });
  it("names the kind it refused in the message it throws", () => {
    expect(() => checkWeather(broken({ provider: "" }))).toThrow(
      /Invalid weather forecast manifest\. Refresh the weather forecast\./,
    );
    expect(() => checkWave(waveManifest({ extra: { provider: "" } }))).toThrow(
      /Invalid wave forecast manifest/,
    );
  });
  it("holds a weather bundle to the wider value bound", () => {
    expect(VARIABLE_VALUE_LIMITS).toEqual({ wave: 1000, weather: 100_000 });
    // 1016.8 hPa is an ordinary reading and would break the wave bound.
    expect(
      checkWeather(weatherManifest()).spotSeries!.brandon[0].values.pmsl,
    ).toBe(1016.8);
    expect(() => checkWeather(withValue("cape", 99_999))).not.toThrow();
    expect(() => checkWeather(withValue("cape", 100_001))).toThrow(
      /Invalid weather forecast manifest/,
    );
  });
  it("checks a code variable for being a small whole number, not a range", () => {
    expect(MAX_VARIABLE_CODE).toBe(1000);
    for (const code of [0, 3, 61, 95, 999])
      expect(() => checkWeather(withValue("ww", code))).not.toThrow();
    for (const code of [-1, 1000, 61.5])
      expect(() => checkWeather(withValue("ww", code))).toThrow(
        /Invalid weather forecast manifest/,
      );
    // A code is still allowed to be absent, which is what a dash renders from.
    expect(() => checkWeather(withValue("ww", null))).not.toThrow();
  });
  it("refuses a variable declaring a kind it does not know", () => {
    expect(() =>
      checkWeather(
        weatherManifest({
          variables: {
            ...ICON_WEATHER_VARIABLES,
            ww: {
              units: "WMO code",
              label: "Present weather",
              description: "d",
              kind: "enum" as unknown as "code",
            },
          },
        }),
      ),
    ).toThrow(/Invalid weather forecast manifest/);
  });
  it("refuses a bundle whose kind is not the one asked for", () => {
    expect(() =>
      checkWeather(waveManifest() as unknown as WeatherManifest),
    ).toThrow(/Invalid weather forecast manifest/);
    expect(() =>
      checkWave(weatherManifest() as unknown as WaveManifest),
    ).toThrow(/Invalid wave forecast manifest/);
  });
  it("demands every declared variable at every step", () => {
    const manifest = weatherManifest();
    delete manifest.spotSeries!.brandon[1].values.clch;
    expect(() => checkWeather(manifest)).toThrow(
      /Invalid weather forecast manifest/,
    );
  });
  it("reads the hours from a frame count or a declared horizon", () => {
    expect(weatherHours(weatherManifest())).toEqual([0, 3, 6]);
    expect(
      weatherHours(weatherManifest({ withFrames: true, hours: [0, 3, 6, 9] })),
    ).toEqual([0, 3, 6, 9]);
    // A fixture that has not said which kind it is reads as a wave bundle, so
    // the error a caller sees still names something.
    expect(() =>
      variablesHours({
        stepHours: 4,
        frames: [],
      } as unknown as VariablesManifest),
    ).toThrow(/Invalid wave forecast manifest/);
  });
  it("accepts a frame subset narrower than the variable map", () => {
    const manifest = checkWeather(weatherManifest({ withFrames: true }));
    expect(manifest.frameVariables).toEqual([
      "t2m",
      "precip",
      "clct",
      "pmsl",
      "ww",
    ]);
    expect(Object.keys(manifest.variables).length).toBeGreaterThan(
      manifest.frameVariables!.length,
    );
    expect(() =>
      checkWeather(
        weatherManifest({
          withFrames: true,
          extra: { frameVariables: ["t2m", "nope"] },
        }),
      ),
    ).toThrow(/Invalid weather forecast manifest/);
  });
  it("reads a spot series, its emptiness and one value at a time", () => {
    const manifest = weatherManifest();
    const series = variableSeries(manifest, "brandon")!;
    expect(series).toHaveLength(3);
    expect(variableSeries(manifest, "nowhere")).toBeNull();
    expect(variableSeries(manifest, undefined)).toBeNull();
    expect(variableSeriesHasData(series, "t2m")).toBe(true);
    // precip is null at the run hour and a number afterwards.
    expect(variableSeriesHasData(series, "precip")).toBe(true);
    expect(variableValue(series[0], "precip")).toBeNull();
    expect(variableValue(series[1], "precip")).toBe(0.3);
    expect(variableValue(series[0], null)).toBeNull();
    expect(variableValue(null, "t2m")).toBeNull();
    const allNull = weatherManifest({ values: () => null });
    expect(
      variableSeriesHasData(variableSeries(allNull, "brandon"), "t2m"),
    ).toBe(false);
  });
  it("matches the nearest native step and never invents one between", () => {
    expect(VARIABLE_MATCH_HOURS).toBe(1.5);
    const series = variableSeries(weatherManifest(), "brandon")!;
    const axis = [
      "2026-09-16T18:00:00Z",
      "2026-09-16T21:00:00Z",
      "2026-09-17T00:00:00Z",
    ];
    expect(
      variableAtAxis(series, axis).map((step) => step?.hour ?? null),
    ).toEqual([0, 3, 6]);
    // An hour inside the tolerance takes the step it is nearest to, unchanged.
    const [near] = variableAtAxis(series, ["2026-09-16T19:00:00Z"]);
    expect(near!.hour).toBe(0);
    expect(near!.values.t2m).toBe(15);
    // Past the end of the run, and a time that is not one.
    expect(variableAtAxis(series, ["2026-09-17T05:00:00Z"])[0]).toBeNull();
    expect(variableAtAxis(series, ["not a time"])[0]).toBeNull();
  });
  it("picks the first variable a manifest actually declares", () => {
    const variables = weatherManifest().variables;
    expect(pickVariable(variables, ["t_2m", "t2m"])).toBe("t2m");
    expect(pickVariable(variables, ["nope"])).toBeNull();
    expect(pickVariable(undefined, ["t2m"])).toBeNull();
  });
  it("refuses a series step that is misordered or off its valid time", () => {
    const shifted = weatherManifest();
    (shifted.spotSeries!.brandon[1] as VariableStep).validTime =
      "2026-09-16T22:00:00Z";
    expect(() => checkWeather(shifted)).toThrow(
      /Invalid weather forecast manifest/,
    );
    const short = weatherManifest();
    short.spotSeries!.brandon.pop();
    expect(() => checkWeather(short)).toThrow(
      /Invalid weather forecast manifest/,
    );
  });
});
