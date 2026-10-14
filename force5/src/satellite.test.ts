import { describe, expect, it } from "vitest";
import { approxMetres, parseSatelliteOption } from "./satellite";
import {
  nearestSatelliteStation,
  satelliteLayers,
  satelliteNote,
  validateSatelliteManifest,
  type SatelliteArea,
  type SatelliteManifest,
} from "./satelliteIndex";

const ireland: SatelliteArea = {
  id: "ireland",
  name: "Ireland",
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
};

/** A second run's area, as Great Britain's will be: its own base and stations. */
const britain: SatelliteArea = {
  ...ireland,
  id: "great-britain",
  name: "Great Britain",
  base: "satellite/vfedcba987654/",
  bounds: [-8.7, 49.8, 1.8, 60.9],
  // Scotland's west and England and Wales, not Ireland: two of its rows.
  cover: [
    [-8.5, 56.5, -5.0, 58.8],
    [-5.7, 50.0, 1.8, 55.0],
  ],
  stations: [
    {
      id: "gb-liverpool",
      name: "Liverpool",
      lonLat: [-3.018, 53.45],
      high: 9.1,
      low: 1.2,
    },
  ],
};

const manifest: SatelliteManifest = {
  schemaVersion: 2,
  kind: "satellite",
  areas: [ireland],
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
    const two = { ...manifest, areas: [ireland, britain] };
    expect(validateSatelliteManifest(two)).toBe(two);
    const area = (a: object) => ({
      ...manifest,
      areas: [{ ...ireland, ...a }],
    });
    for (const broken of [
      null,
      { ...manifest, kind: "foildepth" },
      { ...manifest, schemaVersion: 1 },
      { ...manifest, areas: [ireland, ireland] },
      area({ id: "Ireland!" }),
      area({ base: "../satellite/" }),
      area({ bounds: [0, 0, -1, 1] }),
      area({ cover: [[0, 0, 1]] }),
      area({ options: { high: { url: "high.pmtiles" } } }),
      area({ options: { ...ireland.options, low: { url: "../x.pmtiles" } } }),
      area({ stations: [{ ...ireland.stations[0], high: "4.6" }] }),
    ])
      expect(() => validateSatelliteManifest(broken)).toThrow();
  });

  it("draws only the areas whose box meets the view, at the tide chosen", () => {
    const two = { ...manifest, areas: [ireland, britain] };
    const dublin = { west: -6.4, south: 53.2, east: -6.0, north: 53.5 };
    expect(satelliteLayers(two, "high", dublin, 11)).toEqual([
      {
        id: "ireland",
        path: "satellite/v0123456789ab/high.pmtiles",
        bounds: ireland.bounds,
        minzoom: 6,
        maxzoom: 13,
        tileSize: 512,
      },
    ]);
    // The Irish Sea: both.
    const sea = { west: -6.0, south: 53.0, east: -4.0, north: 54.0 };
    expect(satelliteLayers(two, "low", sea, 8).map((l) => l.path)).toEqual([
      "satellite/v0123456789ab/low.pmtiles",
      "satellite/vfedcba987654/low.pmtiles",
    ]);
    // Under an archive's first zoom (half a zoom's rounding apart), nothing.
    expect(satelliteLayers(two, "low", sea, 5)).toEqual([]);
    const france = { west: 2, south: 46, east: 3, north: 47 };
    expect(satelliteLayers(two, "low", france, 10)).toEqual([]);
  });

  it("finds the station nearest the map's centre, of every area's", () => {
    const areas = [ireland, britain];
    expect(nearestSatelliteStation(areas, -6.15, 53.45)?.id).toBe("Howth");
    expect(nearestSatelliteStation(areas, -9.3, 53.1)?.id).toBe("Galway");
    expect(nearestSatelliteStation(areas, -3.2, 53.4)?.id).toBe("gb-liverpool");
    expect(nearestSatelliteStation([], -6, 53)).toBeNull();
  });

  it("writes the key's line", () => {
    const howth = ireland.stations[0];
    expect(satelliteNote("high", howth)).toBe("Satellite: high tide (≈4.6 m)");
    expect(satelliteNote("low", howth)).toBe("Satellite: low tide (≈1.1 m)");
    expect(satelliteNote("low", null)).toBe("Satellite: low tide");
    expect(satelliteNote("off", howth)).toBeNull();
    expect(approxMetres(0.95)).toBe("≈0.9 m"); // toFixed's rounding of a binary 0.95
  });
});
