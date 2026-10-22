import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLidar, validateLidarIndex, type LidarIndex } from "./lidar";

const index: LidarIndex = {
  schemaVersion: 1,
  kind: "lidar",
  datum: "LAT",
  base: "lidar/v0123456789ab/",
  url: "lidar.pmtiles",
  coverage: "coverage.json",
  bounds: [-10.2, 52.1, -5.4, 55.3],
  minzoom: 9,
  maxzoom: 14,
  tileSize: 512,
  ramp: [
    [-20, "#48739a"],
    [0, "#b4d8d0"],
    [4, "#ebc88c"],
  ],
  sources: [
    {
      id: "infomar-foyle-2008",
      name: "Lough Foyle",
      kind: "bathymetric",
      flown: "2008",
      resolution: "5 m",
      by: "INFOMAR",
      licence: "CC BY 4.0",
      bounds: [-7.3, 55.0, -6.9, 55.2],
    },
  ],
  areaKm2: 812.4,
  attribution: "LiDAR: …",
};

describe("validateLidarIndex", () => {
  it("takes the index the build writes", () => {
    expect(validateLidarIndex(structuredClone(index))).toEqual(index);
  });

  it.each([
    ["another kind", { kind: "satellite" }],
    ["another datum", { datum: "OD Malin" }],
    ["a base off the lidar prefix", { base: "satellite/v0123/" }],
    ["an archive with a path", { url: "../x.pmtiles" }],
    ["an outline with a path", { coverage: "a/coverage.json" }],
    ["an upside-down box", { bounds: [-6, 54, -7, 53] }],
    [
      "a ramp out of order",
      {
        ramp: [
          [4, "#ebc88c"],
          [0, "#b4d8d0"],
        ],
      },
    ],
    [
      "a ramp colour that is not one",
      {
        ramp: [
          [0, "red"],
          [4, "#ebc88c"],
        ],
      },
    ],
    ["a single stop", { ramp: [[0, "#b4d8d0"]] }],
    [
      "a source without a box",
      { sources: [{ ...index.sources[0], bounds: null }] },
    ],
  ])("refuses %s", (_, change) => {
    expect(() => validateLidarIndex({ ...index, ...change })).toThrow(
      "The LiDAR data's index is not valid.",
    );
  });
});

describe("loadLidar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the archive and the outline from under the set's base on the data host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(index))),
    );
    const { view } = await loadLidar(
      "/lidar/index.json",
      (path) => `https://data.example/${path}`,
    );
    expect(view).toMatchObject({
      url: "https://data.example/lidar/v0123456789ab/lidar.pmtiles",
      coverageUrl: "https://data.example/lidar/v0123456789ab/coverage.json",
      minzoom: 9,
      maxzoom: 14,
      tileSize: 512,
    });
  });

  it("says when the index is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await expect(loadLidar("/lidar/index.json", (p) => p)).rejects.toThrow(
      "The LiDAR data is missing.",
    );
  });
});
