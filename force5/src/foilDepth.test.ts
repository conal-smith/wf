import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  FOIL_CLEARANCE_METRES,
  areaAt,
  areasAt,
  basinLevel,
  foilClass,
  foilColours,
  foilRamp,
  foilReadout,
  latToMalin,
  levelLine,
  malinToLat,
  nearestArea,
  surveyLine,
  terrariumHeight,
  terrariumRgb,
  tilePixel,
  validateFoilManifest,
  waterLevelAt,
  waterOver,
  type FoilArea,
  type FoilManifest,
} from "./foilDepth";

const colours = {
  deep: "#0000ff",
  shallow: "#ffaa00",
  dry: "#887766",
  unsurveyed: "#cccccc",
};
const CLEAR = "rgba(0, 0, 0, 0)";

/** The ramp's stops as [height, colour] pairs. */
const stopsOf = (ramp: unknown): [number, string][] => {
  const flat = (ramp as unknown[]).slice(3) as (number | string)[];
  const out: [number, string][] = [];
  for (let i = 0; i < flat.length; i += 2)
    out.push([flat[i] as number, flat[i + 1] as string]);
  return out;
};
/** The colour a height takes where both stops round it agree; null on an edge. */
const colourAt = (ramp: unknown, z: number): string | null => {
  const stops = stopsOf(ramp);
  if (z <= stops[0][0]) return stops[0][1];
  if (z >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++)
    if (z <= stops[i][0])
      return stops[i - 1][1] === stops[i][1] || z === stops[i][0]
        ? stops[i][1]
        : null;
  return null;
};

const area = (over: Partial<FoilArea> = {}): FoilArea => ({
  id: "dublin-north",
  name: "Malahide estuary",
  url: "foildepth/dublin-north.pmtiles",
  bounds: [-6.26, 53.32, -6.05, 53.5],
  minzoom: 10,
  maxzoom: 14,
  tileSize: 512,
  station: "Howth",
  dryCeilingMetres: 5,
  sources: [
    {
      name: "INFOMAR",
      role: "channels",
      years: "2018",
      resolution: "5 m",
      licence: "CC BY 4.0",
    },
    {
      name: "EMODnet",
      role: "fallback",
      years: "DTM 2024",
      resolution: "~115 m",
      licence: "CC BY 4.0",
    },
  ],
  ...over,
});
const manifest = (): FoilManifest => ({
  schemaVersion: 1,
  kind: "foildepth",
  generatedAt: "2026-10-10T12:00:00Z",
  datum: "LAT",
  encoding: "terrarium",
  floorMetres: -6,
  landMetres: 50,
  noSurveyMetres: 40,
  areas: [area()],
  attribution: "EMODnet",
});

describe("datums", () => {
  it("raises OD Malin to LAT by the station's offset, and back", () => {
    // Howth: LAT is 2.561 m under OD Malin, so Malin 0 is 2.561 m above LAT.
    expect(malinToLat(0, 2.561)).toBeCloseTo(2.561);
    expect(malinToLat(-1.2, 2.561)).toBeCloseTo(1.361);
    expect(latToMalin(malinToLat(0.73, 2.677), 2.677)).toBeCloseTo(0.73);
  });
});

describe("foilClass", () => {
  it("splits at tide − clearance and at the tide, inclusive below", () => {
    const tide = 3.1;
    expect(foilClass(-2, tide)).toBe("deep");
    expect(foilClass(tide - FOIL_CLEARANCE_METRES, tide)).toBe("deep");
    expect(foilClass(tide - FOIL_CLEARANCE_METRES + 0.01, tide)).toBe(
      "shallow",
    );
    expect(foilClass(tide, tide)).toBe("shallow");
    expect(foilClass(tide + 0.01, tide)).toBe("dry");
  });
  it("follows the clearance asked for", () => {
    expect(foilClass(0.5, 2, 1)).toBe("deep");
    expect(foilClass(0.5, 2, 2)).toBe("shallow");
  });
  it("gives the water over a point", () => {
    expect(waterOver(0.8, 3.1)).toBeCloseTo(2.3);
  });
});

describe("foilRamp", () => {
  const opts = { dryCeiling: 5, floor: -6 };
  it("is an interpolate on elevation with strictly rising stops", () => {
    const ramp = foilRamp(2.4, colours, opts);
    expect(ramp.slice(0, 3)).toEqual([
      "interpolate",
      ["linear"],
      ["elevation"],
    ]);
    const zs = stopsOf(ramp).map(([z]) => z);
    for (let i = 1; i < zs.length; i++)
      expect(zs[i]).toBeGreaterThan(zs[i - 1]);
    expect(zs.every(Number.isFinite)).toBe(true);
  });
  it("colours each class as foilClass does, at low, mid and high water", () => {
    for (const tide of [0.5, 2.4, 4.3]) {
      const ramp = foilRamp(tide, colours, opts);
      for (let z = -8; z <= 6; z += 0.05) {
        const want =
          z > opts.dryCeiling
            ? CLEAR
            : colours[foilClass(z, tide, FOIL_CLEARANCE_METRES)];
        const got = colourAt(ramp, z);
        // Within the two-centimetre blend at an edge either is fair.
        if (got !== null) expect([z, got]).toEqual([z, want]);
      }
    }
  });
  it("moves the edges with the clearance", () => {
    const ramp = foilRamp(3, colours, { ...opts, clearance: 2.5 });
    expect(colourAt(ramp, 0.4)).toBe(colours.deep);
    expect(colourAt(ramp, 0.6)).toBe(colours.shallow);
  });
  it("draws nothing above the dry ceiling, even at a tide over it", () => {
    const ramp = foilRamp(5.4, colours, opts);
    expect(colourAt(ramp, 5.2)).toBe(CLEAR);
    expect(colourAt(ramp, 4.9)).toBe(colours.shallow);
    expect(colourAt(ramp, 3)).toBe(colours.deep);
  });
  it("draws the no-survey height in its own colour at any tide", () => {
    for (const tide of [0.5, 4.3]) {
      const ramp = foilRamp(tide, colours, { ...opts, noSurvey: 40 });
      expect(colourAt(ramp, 40)).toBe(colours.unsurveyed);
      expect(colourAt(ramp, 30)).toBe(CLEAR);
      expect(colourAt(ramp, 50)).toBe(CLEAR);
      expect(colourAt(ramp, -1)).toBe(colours.deep);
    }
  });
  it("is a valid color-relief paint for MapLibre", () => {
    const errors = validateStyleMin({
      version: 8,
      sources: {
        dem: {
          type: "raster-dem",
          tiles: ["https://example.invalid/{z}/{x}/{y}.webp"],
          encoding: "terrarium",
        },
      },
      layers: [
        {
          id: "foil",
          type: "color-relief",
          source: "dem",
          paint: {
            "color-relief-color": foilRamp(1.7, colours, {
              ...opts,
              noSurvey: 40,
            }),
          },
        },
      ],
    });
    expect(errors).toEqual([]);
  });
});

describe("foilColours", () => {
  it("reads the three colours off the theme", () => {
    const root = {
      getPropertyValue: (name: string) =>
        ({
          "--map-foil-deep": " #3b7ea1",
          "--map-foil-shallow": "#e2a648 ",
          "--map-foil-dry": "#9a8c70",
          "--map-foil-unsurveyed": "#c5c8c3",
        })[name] ?? "",
    };
    expect(foilColours(root)).toEqual({
      deep: "#3b7ea1",
      shallow: "#e2a648",
      dry: "#9a8c70",
      unsurveyed: "#c5c8c3",
    });
  });
});

describe("tiles", () => {
  it("round-trips Terrarium to well under a centimetre", () => {
    for (const z of [-6, -1.53125, 0, 0.8, 2.37, 4.99, 50]) {
      const [r, g, b] = terrariumRgb(z);
      expect(Math.abs(terrariumHeight(r, g, b) - z)).toBeLessThan(1 / 256);
    }
  });
  it("finds the tile and pixel under a point", () => {
    // Kilcrea, Malahide estuary.
    const t = tilePixel(-6.1755, 53.4691, 14, 512);
    expect(t).toMatchObject({ z: 14, x: 7910, y: 5301 });
    expect(t.px).toBeGreaterThanOrEqual(0);
    expect(t.px).toBeLessThan(512);
    expect(t.py).toBeGreaterThanOrEqual(0);
    expect(t.py).toBeLessThan(512);
    expect(tilePixel(0, 0, 0, 256)).toEqual({
      z: 0,
      x: 0,
      y: 0,
      px: 128,
      py: 128,
    });
  });
});

describe("areas", () => {
  const brandon = area({
    id: "brandon",
    bounds: [-10.18, 52.22, -9.83, 52.35],
    station: "Fenit",
  });
  it("finds the area under a point, and the nearest one", () => {
    const areas = [area(), brandon];
    expect(areaAt(areas, -6.1755, 53.4691)?.id).toBe("dublin-north");
    expect(areaAt(areas, -8, 53)).toBeNull();
    expect(nearestArea(areas, -6.3, 53.6)?.id).toBe("dublin-north");
    expect(nearestArea(areas, -9.5, 52.1)?.id).toBe("brandon");
  });
  it("validates the index", () => {
    expect(validateFoilManifest(manifest()).areas).toHaveLength(1);
    const bad = manifest();
    bad.areas[0].bounds = [-6, 53.5, -6.2, 53.3];
    expect(() => validateFoilManifest(bad)).toThrow();
    const notLat = { ...manifest(), datum: "MSL" } as unknown as FoilManifest;
    expect(() => validateFoilManifest(notLat)).toThrow();
  });
  it("names the surveys for the caveat", () => {
    expect(surveyLine(area())).toBe("INFOMAR 2018, EMODnet DTM 2024");
  });
});

describe("foilReadout", () => {
  it("says the water over a tapped point at the hour", () => {
    expect(foilReadout(0.8, 3.1, "18:00", "Howth")).toBe(
      "~2.3 m of water at 18:00 (tide 3.1 m at Howth).",
    );
    expect(foilReadout(2.2, 3.1, "18:00", "Howth")).toBe(
      "~0.9 m of water at 18:00 (tide 3.1 m at Howth), too shallow to foil.",
    );
    expect(foilReadout(1.4, 0.6, "06:00", "Howth")).toBe(
      "Dry, 0.8 m above the water at 06:00 (tide 0.6 m at Howth).",
    );
    expect(foilReadout(null, 0.6, "06:00", "Howth")).toMatch(
      /Not in the water/,
    );
    expect(foilReadout("unsurveyed", 0.6, "06:00", "Howth")).toMatch(
      /depth not surveyed/,
    );
  });
});

describe("a basin behind a weir", () => {
  // Malahide's lagoon, as scripts/foildepth/areas.json has it.
  const level = { floorLat: 3.06, rangeFactor: 0.6, lagHours: 1 };
  const lagoon = area({
    id: "malahide-lagoon",
    bounds: [-6.26, 53.445, -6.1537, 53.476],
    level,
  });
  const HOUR = 3_600_000;

  it("stands at the crest while the sea is under it", () => {
    for (const sea of [0, 0.55, 1.5, 3.06])
      expect(basinLevel(level, sea)).toBeCloseTo(3.06, 6);
  });
  it("follows a share of the sea's rise above the crest", () => {
    expect(basinLevel(level, 4.2)).toBeCloseTo(3.06 + 0.6 * 1.14, 6);
    // The owner's 1.8 m at low water and 2.5 m at high: a 0.7 m range on
    // a spring tide.
    expect(basinLevel(level, 4.2) - basinLevel(level, 0.6)).toBeCloseTo(0.7, 1);
    expect(basinLevel({ ...level, rangeFactor: 0 }, 4.5)).toBe(3.06);
    expect(basinLevel({ ...level, rangeFactor: 1 }, 4.5)).toBeCloseTo(4.5, 6);
  });
  it("takes the sea's tide lagHours earlier, and passes open water through", () => {
    // A rising sea: 1 m an hour from 0 at time 0.
    const tideAt = (time: number) =>
      time < 0 || time > 6 * HOUR ? null : time / HOUR;
    expect(waterLevelAt(area(), tideAt, 4 * HOUR)).toBe(4);
    // At 5 h the lagoon sees the sea of 4 h.
    expect(waterLevelAt(lagoon, tideAt, 5 * HOUR)).toBeCloseTo(
      3.06 + 0.6 * (4 - 3.06),
      6,
    );
    expect(waterLevelAt(lagoon, tideAt, 2 * HOUR)).toBeCloseTo(3.06, 6);
    // Before the curve begins, an hour back is off it.
    expect(waterLevelAt(lagoon, tideAt, 0.5 * HOUR)).toBeNull();
  });
  it("is deep at low water where the open sea's tide dried it", () => {
    // A margin 1.5 m above LAT at a 0.6 m low water at Howth.
    const sea = 0.6;
    expect(foilClass(1.5, sea)).toBe("dry");
    expect(foilClass(1.5, basinLevel(level, sea))).toBe("deep");
    // The rim near the shore still dries.
    expect(foilClass(3.4, basinLevel(level, sea))).toBe("dry");
  });
  it("is found before its area, and validated", () => {
    const areas = [lagoon, area({ bounds: [-6.26, 53.287, -5.99, 53.5] })];
    expect(areasAt(areas, -6.17, 53.46).map((a) => a.id)).toEqual([
      "malahide-lagoon",
      "dublin-north",
    ]);
    expect(areasAt(areas, -6.2, 53.33).map((a) => a.id)).toEqual([
      "dublin-north",
    ]);
    expect(validateFoilManifest({ ...manifest(), areas }).areas).toHaveLength(
      2,
    );
    for (const bad of [
      { ...level, rangeFactor: 1.5 },
      { ...level, lagHours: -1 },
      { ...level, floorLat: Number.NaN },
    ])
      expect(() =>
        validateFoilManifest({
          ...manifest(),
          areas: [{ ...lagoon, level: bad }],
        }),
      ).toThrow();
  });
  it("says the basin's level and the sea's tide", () => {
    expect(levelLine(3.1, "Howth")).toBe("tide 3.1 m above LAT at Howth");
    expect(levelLine(3.06, "Howth", 0.6)).toBe(
      "water 3.1 m above LAT behind the weir (tide 0.6 m at Howth)",
    );
    expect(foilReadout("unsurveyed", 3.06, "17:40", "Howth", 1, 0.8)).toBe(
      "Wet at every tide, depth not surveyed at 17:40 (water 3.1 m above LAT behind the weir; tide 0.8 m at Howth).",
    );
    expect(foilReadout(1.2, 3.06, "17:40", "Howth", 1, 0.8)).toMatch(
      /^~1\.9 m of water at 17:40 \(water 3\.1 m/,
    );
  });
});
