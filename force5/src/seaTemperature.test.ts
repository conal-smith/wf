import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEA_TEMPERATURE_URL,
  loadSeaTemperature,
  observationAge,
  seaTemperatureLabel,
  seaTemperatureText,
  sparklinePoints,
  seaTemperatureForSpot,
  seaTemperatureNote,
  seaTemperatureStation,
  seaTemperatureStations,
  skinNow,
  validateSeaTemperatureManifest,
  waterText,
  type SeaTemperatureManifest,
} from "./seaTemperature";

const series = (from: string, values: number[]) =>
  values.map((value, index) => ({
    time: new Date(Date.parse(from) + index * 3 * 3600000).toISOString(),
    value,
  }));

const manifest = (): SeaTemperatureManifest => ({
  schemaVersion: 1,
  kind: "observation",
  model: "sea-temperature",
  run: "2026091623",
  generatedAt: "2026-09-17T00:17:49Z",
  variable: { name: "seaTemperature", units: "°C", label: "Sea temperature" },
  stepMinutes: 180,
  maxDistanceKm: 60,
  maxObservationAgeHours: 48,
  stations: {
    MI_Lehanagh_Pool: {
      id: "MI_Lehanagh_Pool",
      name: "Lehanagh Pool",
      lat: 53.4001,
      lon: -9.8207,
      network: "sentinel",
      depth: 0,
      latest: { time: "2026-09-16T22:00:00Z", value: 16.29 },
    },
    IWB_M2: {
      id: "IWB_M2",
      name: "M2",
      lat: 53.4836,
      lon: -5.4302,
      network: "buoy",
      // The offshore weather buoys publish no sensor depth, and none is invented.
      depth: null,
      latest: { time: "2026-09-16T23:00:00Z", value: 15.47 },
    },
  },
  spots: {
    rusheen: {
      station: "MI_Lehanagh_Pool",
      distanceKm: 49.3,
      latest: { time: "2026-09-16T22:00:00Z", value: 16.29 },
      series: series("2026-09-16T13:00:00Z", [16.5, 16.42, 16.35, 16.29]),
    },
    dollymount: {
      station: "IWB_M2",
      distanceKm: 48.5,
      latest: { time: "2026-09-16T23:00:00Z", value: 15.47 },
      series: series("2026-09-16T14:00:00Z", [15.6, 15.55, 15.5, 15.47]),
    },
    ballyholme: {
      station: null,
      distanceKm: 132.7,
      reason:
        "The nearest reporting station (M2) is 133 km away, beyond the 60 km limit.",
    },
  },
  attribution: "Sea temperature © Marine Institute, CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
afterEach(() => vi.unstubAllGlobals());

describe("sea temperature manifest", () => {
  it("validates stations, networks and spot links", () => {
    const m = validateSeaTemperatureManifest(manifest());
    expect(seaTemperatureStations(m)).toHaveLength(2);
    expect(seaTemperatureStation(m, "IWB_M2")?.network).toBe("buoy");
    expect(seaTemperatureStation(m, "IWB_M9")).toBeUndefined();
    // A null depth is "unknown", and must survive validation as itself.
    expect(seaTemperatureStation(m, "IWB_M2")?.depth).toBeNull();
    expect(seaTemperatureStation(m, "MI_Lehanagh_Pool")?.depth).toBe(0);
  });

  it("refuses anything that is not an observation bundle", () => {
    const m = manifest();
    for (const change of [
      { schemaVersion: 2 },
      { kind: "tide" as SeaTemperatureManifest["kind"] },
      { stations: {} },
    ])
      expect(() => validateSeaTemperatureManifest({ ...m, ...change })).toThrow(
        /Invalid sea temperature data/,
      );
  });

  it("refuses an unknown network, position or depth", () => {
    const m = manifest();
    for (const change of [
      { network: "satellite" },
      { lat: 120 },
      { lon: Number.NaN },
      { name: "" },
      { depth: -5 },
    ])
      expect(() =>
        validateSeaTemperatureManifest({
          ...m,
          stations: {
            ...m.stations,
            IWB_M2: { ...m.stations.IWB_M2, ...change } as never,
          },
        }),
      ).toThrow(/Invalid sea temperature data/);
  });

  it("refuses an implausible or unreadable reading", () => {
    const m = manifest();
    for (const latest of [
      { time: "2026-09-16T23:00:00Z", value: 91 },
      { time: "2026-09-16T23:00:00Z", value: -40 },
      { time: "whenever", value: 15.4 },
      { time: "2026-09-16T23:00:00Z", value: Number.NaN },
    ])
      expect(() =>
        validateSeaTemperatureManifest({
          ...m,
          spots: {
            ...m.spots,
            dollymount: { ...m.spots.dollymount, latest: latest as never },
          },
        }),
      ).toThrow(/Invalid sea temperature data/);
  });

  it("requires a series in increasing time order with usable values", () => {
    const m = manifest();
    const good = m.spots.rusheen.series!;
    for (const bad of [
      [...good].reverse(),
      [good[0], good[0]],
      [{ time: good[0].time, value: 99 }],
    ])
      expect(() =>
        validateSeaTemperatureManifest({
          ...m,
          spots: { ...m.spots, rusheen: { ...m.spots.rusheen, series: bad } },
        }),
      ).toThrow(/Invalid sea temperature data/);
    // A spot may omit the series entirely and still be a valid latest reading.
    expect(
      validateSeaTemperatureManifest({
        ...m,
        spots: {
          ...m.spots,
          rusheen: { ...m.spots.rusheen, series: undefined },
        },
      }).spots.rusheen.series,
    ).toBeUndefined();
  });

  it("requires an unmapped spot to say why, and a mapped one to name a station", () => {
    const m = manifest();
    for (const spot of [
      { station: null, distanceKm: 132.7 },
      { station: null, distanceKm: 132.7, reason: "  " },
      { station: "IWB_M9", distanceKm: 4 },
      { station: "IWB_M2", distanceKm: -1 },
      { station: "IWB_M2", distanceKm: 4 }, // No latest reading.
    ])
      expect(() =>
        validateSeaTemperatureManifest({
          ...m,
          spots: { ...m.spots, ballyholme: spot as never },
        }),
      ).toThrow(/Invalid sea temperature data/);
  });
});

describe("loadSeaTemperature", () => {
  it("fetches, validates and returns the one published file", async () => {
    let requested = "";
    vi.stubGlobal("fetch", async (url: string | URL) => {
      requested = String(url);
      return ok(manifest());
    });
    const m = await loadSeaTemperature();
    expect(m.kind).toBe("observation");
    expect(requested).toContain(SEA_TEMPERATURE_URL);
  });

  it("reports an unavailable manifest and rejects a corrupt one", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    await expect(loadSeaTemperature()).rejects.toThrow(/unavailable/);
    vi.stubGlobal("fetch", async () => ok({ ...manifest(), kind: "wind" }));
    await expect(loadSeaTemperature()).rejects.toThrow(
      /Invalid sea temperature data/,
    );
  });
});

describe("seaTemperatureForSpot", () => {
  const now = Date.parse("2026-09-17T00:00:00Z");

  it("gives the station, distance, latest reading, series and age", () => {
    const m = validateSeaTemperatureManifest(manifest());
    const reading = seaTemperatureForSpot(m, "rusheen", now)!;
    expect(reading.station.name).toBe("Lehanagh Pool");
    expect(reading.distanceKm).toBe(49.3);
    expect(reading.latest.value).toBe(16.29);
    expect(reading.series).toHaveLength(4);
    expect(reading.ageHours).toBe(2);
    expect(seaTemperatureForSpot(m, "dollymount", now)!.ageHours).toBe(1);
  });

  it("returns nothing for a spot with no station, and says why", () => {
    const m = validateSeaTemperatureManifest(manifest());
    expect(seaTemperatureForSpot(m, "ballyholme", now)).toBeNull();
    expect(seaTemperatureNote(m, "ballyholme")).toMatch(/beyond the 60 km/);
    expect(seaTemperatureForSpot(m, "brandon", now)).toBeNull();
    expect(seaTemperatureNote(m, "brandon")).toMatch(
      /not in the sea temperature/,
    );
    expect(seaTemperatureNote(m, "rusheen")).toBeNull();
  });

  it("returns nothing when a spot names a station the manifest dropped", () => {
    const m = manifest();
    delete m.stations.IWB_M2;
    expect(seaTemperatureForSpot(m, "dollymount", now)).toBeNull();
    expect(seaTemperatureNote(m, "dollymount")).toMatch(/missing from the/);
  });

  it("defaults the age to the current clock", () => {
    const m = validateSeaTemperatureManifest(manifest());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T04:00:00Z"));
    expect(seaTemperatureForSpot(m, "rusheen")!.ageHours).toBe(6);
    vi.useRealTimers();
  });
});

describe("observationAge", () => {
  it("says how old a reading is in the units a reader thinks in", () => {
    expect(observationAge(0)).toBe("just now");
    expect(observationAge(-0.5)).toBe("just now"); // A clock skew, not the future.
    expect(observationAge(0.5)).toBe("30 min ago");
    expect(observationAge(1.4)).toBe("84 min ago");
    expect(observationAge(2)).toBe("2 h ago");
    expect(observationAge(24)).toBe("24 h ago");
    expect(observationAge(40)).toBe("2 days ago");
    expect(observationAge(26 * 24)).toBe("26 days ago");
    expect(observationAge(Number.NaN)).toBe("age unknown");
  });
});

describe("seaTemperatureText", () => {
  const reading = () =>
    seaTemperatureForSpot(
      validateSeaTemperatureManifest(manifest()),
      "dollymount",
      Date.parse("2026-09-17T01:00:00Z"),
    )!;

  it("reads as the measurement, then where and when it was taken", () => {
    const text = seaTemperatureText(reading());
    expect(text.value).toBe("15.5 °C");
    expect(text.detail).toBe("M2 buoy, 49 km, 2 h ago");
    expect(seaTemperatureLabel(reading())).toBe(
      "15.5 °C · M2 buoy, 49 km, 2 h ago",
    );
  });

  it("takes an age against a later clock, so an open tab stays honest", () => {
    expect(seaTemperatureText(reading(), 9).detail).toMatch(/9 h ago$/);
  });

  it("keeps a decimal for a station close enough for one to matter", () => {
    const close = { ...reading(), distanceKm: 4.32 };
    expect(seaTemperatureText(close).detail).toContain("4.3 km");
  });
});

describe("waterText", () => {
  const reading = () =>
    seaTemperatureForSpot(
      validateSeaTemperatureManifest(manifest()),
      "dollymount",
      Date.parse("2026-09-17T01:00:00Z"),
    )!;

  it("says a station's measurement once, with where, how far and how old", () => {
    expect(waterText(reading(), 12.6)).toEqual({
      measured: true,
      value: "15.5 °C",
      detail: "M2 buoy, 49 km, 2 h ago",
      short: "49 km",
      label: "Water 15.5 °C, measured at the M2 buoy 49 km away, 2 h ago",
    });
  });

  it("falls back to the model's skin temperature, marked as the model's", () => {
    expect(waterText(null, 13.6)).toEqual({
      measured: false,
      value: "~14 °C",
      detail: "model, not measured",
      short: "model",
      label: "Water about 14 °C, the model's skin temperature, not measured",
    });
  });

  it("says nothing with neither", () => {
    expect(waterText(null, null)).toBeNull();
    expect(waterText(null, Number.NaN)).toBeNull();
  });
});

describe("skinNow", () => {
  const hour = 3600000;
  const now = Date.parse("2026-09-17T10:20:00Z");
  const at = (h: number) => Date.parse("2026-09-17T10:00:00Z") + h * hour;

  it("takes the first column from the current hour on that has a value", () => {
    expect(
      skinNow([11, 12, null, 14], [at(-2), at(-1), at(0), at(1)], now),
    ).toBe(14);
    expect(skinNow([11, 13], [at(-1), at(0)], now)).toBe(13);
  });

  it("falls back to the latest before it, then to nothing", () => {
    expect(skinNow([11, 12, null], [at(-2), at(-1), at(0)], now)).toBe(12);
    expect(skinNow([null, undefined], [at(0), at(1)], now)).toBeNull();
  });
});

describe("sparklinePoints", () => {
  const readings = (values: number[]) => series("2026-09-16T00:00:00Z", values);

  it("scales a series to its own range and spaces it by real time", () => {
    const points = sparklinePoints(readings([15, 16, 17]), 40, 10)
      .split(" ")
      .map((pair) => pair.split(",").map(Number));
    expect(points).toHaveLength(3);
    // Left to right across the full width, evenly for evenly spaced readings.
    expect(points.map(([x]) => x)).toEqual([0, 20, 40]);
    // The coldest reading sits at the bottom and the warmest at the top.
    expect(points[0][1]).toBeGreaterThan(points[2][1]);
    expect(points[2][1]).toBeCloseTo(0.5, 5);
    expect(points[0][1]).toBeCloseTo(9.5, 5);
  });

  it("puts a gap in the readings where the gap actually is", () => {
    const sparse = [
      { time: "2026-09-16T00:00:00Z", value: 15 },
      { time: "2026-09-16T01:00:00Z", value: 16 },
      { time: "2026-09-16T05:00:00Z", value: 17 },
    ];
    expect(
      sparklinePoints(sparse, 100, 10)
        .split(" ")
        .map((pair) => Number(pair.split(",")[0])),
    ).toEqual([0, 20, 100]);
  });

  it("draws a flat series down the middle rather than dividing by zero", () => {
    for (const pair of sparklinePoints(readings([15, 15]), 10, 10).split(" "))
      expect(Number(pair.split(",")[1])).toBeCloseTo(5, 5);
  });

  it("draws nothing it cannot draw a line through", () => {
    expect(sparklinePoints(readings([15]), 40, 10)).toBe("");
    expect(sparklinePoints([], 40, 10)).toBe("");
    expect(sparklinePoints(readings([15, 16]), 0, 10)).toBe("");
  });
});
