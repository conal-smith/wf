import { describe, expect, it } from "vitest";
import type { FoilArea, FoilManifest } from "../../../../force5/src/foilDepth";
import type { TideCurve } from "../../../../force5/src/tides";
import { foilInView, foilLayers, foilLevels, stationsWanted, type Tides } from "./foilLogic";
import { appFoilColours } from "./mapStyle";
import { LIGHT_BOX, loopShape, RING_DASHED, sdfPixels, shapeDistance, STAR, STRIKE, chartIcons } from "./sdfIcons";

const area = (id: string, station: string, bounds: [number, number, number, number], extra: Partial<FoilArea> = {}): FoilArea => ({
  id,
  kind: "region",
  name: id,
  url: `${id}.pmtiles`,
  bounds,
  minzoom: 8,
  maxzoom: 14,
  tileSize: 512,
  station,
  stationLonLat: [bounds[0], bounds[1]],
  dryCeilingMetres: 6,
  sources: [{ name: "INFOMAR", role: "survey", years: "2018", resolution: "5 m", licence: "CC BY" }],
  ...extra,
});

const manifest: FoilManifest = {
  schemaVersion: 2,
  kind: "foildepth",
  generatedAt: "2026-10-01T00:00:00Z",
  datum: "LAT",
  encoding: "terrarium",
  base: "foildepth/v0123/",
  floorMetres: -5,
  deepMetres: -100,
  landMetres: 100,
  noSurveyMetres: -200,
  areas: [
    area("tide-howth", "howth", [-6.3, 53.2, -6.0, 53.5]),
    area("tide-fenit", "fenit", [-10.2, 52.1, -9.6, 52.4]),
    area("malahide", "howth", [-6.2, 53.4, -6.1, 53.5], {
      kind: "pilot",
      level: { floorLat: 3.06, rangeFactor: 0.6, lagHours: 1 },
    }),
  ],
  attribution: "Foilable depth: INFOMAR.",
};

const t0 = Date.parse("2026-10-14T00:00:00Z");
const curve = (heights: number[]): TideCurve => ({
  stepMinutes: 60,
  from: new Date(t0).toISOString(),
  to: new Date(t0 + (heights.length - 1) * 3600000).toISOString(),
  datum: "LAT",
  curve: heights,
  events: [],
});
const tides: Tides = {
  howth: { station: { id: "howth", name: "Howth", lat: 53.39, lon: -6.07 }, curve: curve([1, 2, 3, 4, 3, 2]) },
};
const view = { west: -6.4, south: 53.1, east: -5.9, north: 53.6, zoom: 10 };

describe("foilable depth at the tide", () => {
  it("gives each area its water level, a basin its own", () => {
    const levels = foilLevels(manifest.areas, tides, t0 + 2 * 3600000);
    expect(levels["tide-howth"]).toEqual({ water: 3, sea: 3 });
    // An hour behind the sea (2 m), and never below the weir's crest.
    expect(levels.malahide).toEqual({ water: 3.06, sea: 3 });
    expect(levels["tide-fenit"]).toBeNull();
    expect(foilLevels(manifest.areas, tides, null)["tide-howth"]).toBeNull();
  });

  it("draws only the areas over the view, each with its tide's ramp", () => {
    expect(foilInView(manifest, view).map((a) => a.id)).toEqual(["tide-howth", "malahide"]);
    expect(foilInView(manifest, { ...view, zoom: 7 })).toEqual([]);
    const levels = foilLevels(manifest.areas, tides, t0 + 2 * 3600000);
    const layers = foilLayers({
      on: true,
      manifest,
      levels,
      view,
      palette: appFoilColours(),
      foilUrl: (m, a) => `https://data.example/${m.base}${a.url}`,
    });
    expect(layers.map((l) => l.id)).toEqual(["foil-tide-howth", "foil-malahide"]);
    expect(layers[0]).toMatchObject({
      url: "pmtiles://https://data.example/foildepth/v0123/tide-howth.pmtiles",
      tileSize: 512,
    });
    expect(layers[0].color[0]).toBe("interpolate");
    expect(JSON.stringify(layers[0].color)).not.toBe(JSON.stringify(layers[1].color));
    expect(foilLayers({ on: false, manifest, levels, view, palette: appFoilColours(), foilUrl: () => "" })).toEqual([]);
  });

  it("asks for each station's curve once", () => {
    expect(stationsWanted([manifest.areas[0], manifest.areas[2], null, manifest.areas[1]])).toEqual(["fenit", "howth"]);
  });
});

describe("the chart's marks", () => {
  it("measures inside as negative and outside as positive", () => {
    expect(shapeDistance(STRIKE[0], 0, 0)).toBeLessThan(0);
    expect(shapeDistance(STRIKE[0], 5, 5)).toBeGreaterThan(0);
    expect(shapeDistance(STAR[0], 0, 0)).toBeLessThan(0);
    expect(shapeDistance(STAR[0], 0, -8)).toBeCloseTo(3, 5);
    // A dash on the ring, a gap beside it.
    expect(shapeDistance(RING_DASHED[0], 7.6, 0)).toBeLessThan(0);
    expect(shapeDistance(RING_DASHED[0], 0, 0)).toBeGreaterThan(5);
  });

  it("writes an SDF: white, opaque on the stroke, clear well away from it", () => {
    const px = sdfPixels(STRIKE, 16, 3);
    expect(px).toHaveLength(48 * 48 * 4);
    const at = (i: number, j: number) => px[(j * 48 + i) * 4 + 3];
    expect(px[0]).toBe(255);
    expect(at(24, 24)).toBeGreaterThan(191);
    expect(at(1, 1)).toBe(0);
  });

  it("makes every mark the layers name, once", () => {
    const icons = chartIcons();
    expect(Object.keys(icons).sort()).toEqual(
      ["lt-arrow", "lt-dash", "lt-dot", "lt-star", "lt-strike", "pen-loop", "pick-mark", "wind-arrow"].sort(),
    );
    expect(icons["lt-arrow"].source.uri).toMatch(/^data:image\/png;base64,/);
    expect(icons["lt-arrow"].sdf).toBe(true);
    expect(chartIcons()).toBe(icons);
    expect(LIGHT_BOX).toBeGreaterThan(42);
    expect(loopShape()[0].kind).toBe("stroke");
  });
});
