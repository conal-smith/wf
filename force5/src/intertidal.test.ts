import { describe, expect, it } from "vitest";
import { areasAt, areasInView, foilRamp } from "./foilDepth";
import {
  isIntertidalHeight,
  validateIntertidalManifest,
  type IntertidalArea,
  type IntertidalManifest,
} from "./intertidal";

const howth: IntertidalArea = {
  id: "tide-howth",
  set: "ireland",
  kind: "region",
  base: "intertidal/v0123456789ab/",
  url: "tide-howth.pmtiles",
  bounds: [-6.3, 53.3, -6.0, 53.6],
  minzoom: 6,
  maxzoom: 13,
  tileSize: 512,
  station: "Howth",
  stationLonLat: [-6.068, 53.391],
  lowestSeenMetres: 0.1,
  highestSeenMetres: 4.6,
};
const dublin: IntertidalArea = {
  ...howth,
  id: "tide-dublin-port",
  url: "tide-dublin-port.pmtiles",
  bounds: [-6.35, 53.2, -6.0, 53.42],
  station: "Dublin_Port",
  stationLonLat: [-6.221, 53.346],
};

const manifest: IntertidalManifest = {
  schemaVersion: 1,
  kind: "intertidal",
  datum: "LAT",
  encoding: "terrarium",
  deepMetres: -20,
  landMetres: 50,
  noSurveyMetres: 40,
  belowSeenMetres: 30,
  areas: [howth, dublin],
  attribution: "Contains modified Copernicus Sentinel data 2017–2026",
};

const colours = {
  deep: "rgb(0, 0, 255)",
  shallow: "rgb(0, 255, 0)",
  dry: "rgb(255, 0, 0)",
  unsurveyed: "rgb(128, 128, 128)",
};

/** The colour a ramp gives a height: the last stop at or under it. */
function colourAt(ramp: unknown[], z: number) {
  const stops = ramp.slice(3) as (number | string)[];
  let colour = stops[1] as string;
  for (let i = 0; i < stops.length; i += 2)
    if ((stops[i] as number) <= z) colour = stops[i + 1] as string;
  return colour;
}

describe("intertidal heights", () => {
  it("takes a well-formed index and refuses a broken one", () => {
    expect(validateIntertidalManifest(manifest)).toBe(manifest);
    const area = (a: object) => ({ ...manifest, areas: [{ ...howth, ...a }] });
    for (const broken of [
      null,
      { ...manifest, kind: "foildepth" },
      { ...manifest, datum: "OD" },
      { ...manifest, areas: [howth, howth] },
      { ...manifest, belowSeenMetres: 4 },
      area({ base: "../intertidal/" }),
      area({ url: "../tide-howth.pmtiles" }),
      area({ kind: "pilot" }),
      area({ bounds: [0, 0, -1, 1] }),
      area({ stationLonLat: [-6] }),
      area({ lowestSeenMetres: 5 }),
    ])
      expect(() => validateIntertidalManifest(broken)).toThrow();
  });

  it("reads only the regions in view, and a point on its nearest station's", () => {
    const view = { west: -6.25, south: 53.43, east: -6.1, north: 53.5 };
    expect(areasInView(manifest.areas, view, 11).map((a) => a.id)).toEqual([
      "tide-howth",
    ]);
    // Both boxes hold Sutton; Howth's station is nearer.
    expect(areasAt(manifest.areas, -6.11, 53.39).map((a) => a.id)).toEqual([
      "tide-howth",
    ]);
    expect(areasAt(manifest.areas, -6.22, 53.34).map((a) => a.id)).toEqual([
      "tide-dublin-port",
    ]);
  });

  it("is a height only where the archive measured one", () => {
    expect(isIntertidalHeight(manifest, 1.25)).toBe(true);
    expect(isIntertidalHeight(manifest, -0.2)).toBe(true);
    for (const reserved of [30, "unsurveyed", "deep", "none", null])
      expect(isIntertidalHeight(manifest, reserved)).toBe(false);
  });

  it("colours a height as the foil layer does, and leaves every reserved value clear", () => {
    const ramp = foilRamp(2.5, colours, {
      dryCeiling: howth.highestSeenMetres,
      floor: howth.lowestSeenMetres - 1,
      deep: manifest.deepMetres,
      fade: 0,
    }) as unknown[];
    expect(colourAt(ramp, 0.5)).toBe(colours.deep);
    expect(colourAt(ramp, 2.0)).toBe(colours.shallow);
    expect(colourAt(ramp, 3.0)).toBe(colours.dry);
    for (const reserved of [
      manifest.deepMetres,
      manifest.belowSeenMetres,
      manifest.noSurveyMetres,
      manifest.landMetres,
    ])
      expect(colourAt(ramp, reserved)).toBe("rgba(0, 0, 0, 0)");
  });
});
