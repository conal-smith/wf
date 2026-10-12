import { describe, expect, it } from "vitest";
import {
  approxMetres,
  nearestSatelliteStation,
  parseSatelliteOption,
  satelliteNote,
  validateSatelliteManifest,
  type SatelliteManifest,
} from "./satellite";

const manifest: SatelliteManifest = {
  schemaVersion: 1,
  kind: "satellite",
  base: "satellite/v0123456789ab/",
  bounds: [-10.8, 51.3, -5.3, 55.5],
  minzoom: 6,
  maxzoom: 13,
  tileSize: 512,
  options: { high: { url: "high.pmtiles" }, low: { url: "low.pmtiles" } },
  stations: [
    {
      id: "Howth",
      name: "Howth",
      lonLat: [-6.068, 53.391],
      high: 4.62,
      low: 1.14,
    },
    {
      id: "Galway",
      name: "Galway",
      lonLat: [-9.048, 53.269],
      high: 4.31,
      low: 0.92,
    },
  ],
  attribution: "Contains modified Copernicus Sentinel data 2017–2026",
};

describe("satellite", () => {
  it("reads only the three choices from the store", () => {
    expect(parseSatelliteOption("high")).toBe("high");
    expect(parseSatelliteOption("low")).toBe("low");
    expect(parseSatelliteOption(undefined)).toBe("off");
    expect(parseSatelliteOption(true)).toBe("off");
    expect(parseSatelliteOption("HIGH")).toBe("off");
  });

  it("takes a well-formed index and refuses a broken one", () => {
    expect(validateSatelliteManifest(manifest)).toBe(manifest);
    for (const broken of [
      null,
      { ...manifest, kind: "foildepth" },
      { ...manifest, base: "../satellite/" },
      { ...manifest, bounds: [0, 0, -1, 1] },
      { ...manifest, options: { high: { url: "high.pmtiles" } } },
      {
        ...manifest,
        options: { ...manifest.options, low: { url: "../x.pmtiles" } },
      },
      { ...manifest, stations: [{ ...manifest.stations[0], high: "4.6" }] },
    ])
      expect(() => validateSatelliteManifest(broken)).toThrow();
  });

  it("finds the station nearest the map's centre", () => {
    expect(nearestSatelliteStation(manifest.stations, -6.15, 53.45)?.id).toBe(
      "Howth",
    );
    expect(nearestSatelliteStation(manifest.stations, -9.3, 53.1)?.id).toBe(
      "Galway",
    );
    expect(nearestSatelliteStation([], -6, 53)).toBeNull();
  });

  it("writes the key's line", () => {
    const howth = manifest.stations[0];
    expect(satelliteNote("high", howth)).toBe("Satellite: high tide (≈4.6 m)");
    expect(satelliteNote("low", howth)).toBe("Satellite: low tide (≈1.1 m)");
    expect(satelliteNote("low", null)).toBe("Satellite: low tide");
    expect(satelliteNote("off", howth)).toBeNull();
    expect(approxMetres(0.95)).toBe("≈0.9 m"); // toFixed's rounding of a binary 0.95
  });
});
