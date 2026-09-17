import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEA_TEMPERATURE_URL,
  loadSeaTemperature,
  seaTemperatureForSpot,
  seaTemperatureNote,
  seaTemperatureStation,
  seaTemperatureStations,
  validateSeaTemperatureManifest,
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
