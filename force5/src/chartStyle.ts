/**
 * The map drawn as an Admiralty chart: paper land, the sea in depth tints
 * from EMODnet (BATHY_PATH, on the data host), contours and soundings in the
 * chart's italic, the coast in ink, land relief, and the places in ink on
 * paper. Ported from the signed-off mockup's kit (design/chart/chart-kit.js,
 * `chartStyle`), with every colour read from ui/theme.css.
 *
 * The coast, the water and the places are OpenStreetMap's, through
 * OpenFreeMap's planet tiles; the glyphs (Noto Sans) are theirs too. The
 * chart's own faces (Fraunces, Plex Mono) are for the HTML over the map.
 */
import * as maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { archiveUrl, pmtilesTile } from "./archives";
import { basemapColours } from "./basemap";
import { windBand, type Rider } from "./stars";

export const OPENFREEMAP = "https://tiles.openfreemap.org";
export const TILES_URL = `${OPENFREEMAP}/planet`;
export const GLYPHS_URL = `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`;
/**
 * The depth tiles: an immutable, versioned file on the data host (forecastUrl;
 * the dev server and the e2e site serve the copy in public-data/), read by
 * range (archives.ts). Written by scripts/foildepth/publish.py --bathy.
 */
export const BATHY_PATH = "bathy/v7a4f9286f579/ireland.pmtiles";

const FONT = ["Noto Sans Italic"];
const FONT_UP = ["Noto Sans Regular"];

/** The depths a band or contour can carry, shallow to deep. */
export const DEPTHS = [0, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200] as const;

export interface ChartColours {
  paper: string;
  land: string;
  ink: string;
  depth: string;
  relief: string;
  sand: string;
  wetland: string;
  halo: string;
  /** One tint per entry of DEPTHS. */
  tints: string[];
}

/**
 * The chart's colours off the theme. ui/theme.css is `@theme static`, so the
 * values are on :root whether or not a class asks for them; a host without
 * the theme gets the chart in the mockup's own values.
 */
export function chartColours(
  root: Pick<CSSStyleDeclaration, "getPropertyValue">,
): ChartColours {
  const read = (name: string) => root.getPropertyValue(name).trim();
  return {
    paper: read("--color-ground"),
    land: basemapColours(root).land,
    ink: read("--color-ink"),
    depth: read("--color-depth"),
    relief: read("--color-relief"),
    sand: read("--map-sand"),
    wetland: read("--map-wetland"),
    halo: read("--map-halo"),
    tints: DEPTHS.map((d) => read(`--map-d${d}`)),
  };
}

let registered = false;
/**
 * MapLibre reads `pmtiles://` URLs through the pmtiles package, once a page,
 * over the archives archives.ts opens (whether or not the host serves ranges).
 */
export function registerPmtiles() {
  if (registered) return;
  maplibregl.addProtocol("pmtiles", pmtilesTile);
  registered = true;
}

const zoomed = (...stops: number[]): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;

/**
 * How strongly the depths show at each zoom. No tint at country zoom, where
 * the survey's edge would show as a pale box out at sea; faint lines from
 * zoom 6, the tints coming up from about 9 and full by 11.
 */
export const DEPTH_BY_ZOOM: Record<string, [string, ExpressionSpecification]> =
  {
    bands: ["fill-opacity", zoomed(7, 0, 9, 0.4, 11, 1)],
    contours: ["line-opacity", zoomed(6, 0.14, 9, 0.22, 11, 0.8)],
    "contours-dashed": ["line-opacity", zoomed(6, 0.1, 9, 0.18, 11, 0.75)],
    "contour-labels": ["text-opacity", zoomed(9, 0, 11, 1)],
    soundings: ["text-opacity", zoomed(9, 0, 11, 0.62)],
    relief: ["line-opacity", zoomed(6.5, 0.1, 9, 0.2, 11, 0.45)],
  };

/** The layers each switch in the layers panel turns on and off. */
export const CHART_LAYERS = {
  tints: ["bands"],
  soundings: ["contours", "contours-dashed", "contour-labels", "soundings"],
  relief: ["relief"],
} as const;

/** Place names: the filter the chart draws, and the one near a focused spot. */
export const PLACE_CLASSES: ExpressionSpecification = [
  "in",
  ["get", "class"],
  ["literal", ["city", "town", "village"]],
];

export function chartStyle(
  c: ChartColours,
  bathyUrl: string,
): StyleSpecification {
  const tint = [
    "match",
    ["get", "depth"],
    ...DEPTHS.flatMap((d, i) => [d, c.tints[i]]),
    c.tints[c.tints.length - 1],
  ] as unknown as ExpressionSpecification;
  const shallow: ExpressionSpecification = [
    "in",
    ["get", "depth"],
    ["literal", [1, 2, 3]],
  ];
  const lineWidth = [
    "match",
    ["get", "depth"],
    0,
    1.1,
    5,
    0.9,
    10,
    0.9,
    2,
    0.6,
    1,
    0.5,
    3,
    0.5,
    0.6,
  ] as ExpressionSpecification;
  const bathy = { source: "bathy" };
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      omt: { type: "vector", url: TILES_URL },
      bathy: {
        type: "vector",
        url: archiveUrl(bathyUrl),
        minzoom: 5,
        maxzoom: 12,
        attribution: "EMODnet Bathymetry",
      },
    },
    layers: [
      {
        id: "land",
        type: "background",
        paint: { "background-color": c.land },
      },
      // The sea from OpenStreetMap's coast, as deep water: paper, nearly. The
      // survey's shallows are laid over it, darkest nearest the shore.
      {
        id: "water",
        type: "fill",
        source: "omt",
        "source-layer": "water",
        paint: { "fill-color": c.tints[c.tints.length - 1] },
      },
      {
        id: "bands",
        type: "fill",
        ...bathy,
        "source-layer": "bands",
        paint: { "fill-color": tint, "fill-opacity": DEPTH_BY_ZOOM.bands[1] },
      },
      {
        id: "sand",
        type: "fill",
        source: "omt",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "sand"],
        paint: { "fill-color": c.sand, "fill-opacity": 0.8 },
      },
      {
        id: "wetland",
        type: "fill",
        source: "omt",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "wetland"],
        paint: { "fill-color": c.wetland, "fill-opacity": 0.6 },
      },
      {
        id: "relief",
        type: "line",
        ...bathy,
        "source-layer": "relief",
        minzoom: 6.5,
        paint: {
          "line-color": c.relief,
          "line-opacity": DEPTH_BY_ZOOM.relief[1],
          "line-width": 0.6,
        },
      },
      // The shallow contours dashed, as a chart draws a line it is less sure of.
      ...[false, true].map(
        (dashed) =>
          ({
            id: dashed ? "contours-dashed" : "contours",
            type: "line",
            ...bathy,
            "source-layer": "contours",
            filter: (dashed ? shallow : ["!", shallow]) as FilterSpecification,
            paint: {
              "line-color": c.depth,
              "line-width": lineWidth,
              "line-opacity": DEPTH_BY_ZOOM[
                dashed ? "contours-dashed" : "contours"
              ][1],
              ...(dashed ? { "line-dasharray": [3, 2] } : {}),
            },
          }) as LayerSpecification,
      ),
      {
        id: "rivers",
        type: "line",
        source: "omt",
        "source-layer": "waterway",
        minzoom: 8,
        paint: { "line-color": c.depth, "line-width": 0.6, "line-opacity": 0.6 },
      },
      {
        id: "roads",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 9,
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["motorway", "trunk", "primary", "secondary"]],
        ],
        paint: {
          "line-color": c.ink,
          "line-opacity": 0.18,
          "line-width": zoomed(9, 0.4, 14, 1.4),
        },
      },
      {
        id: "buildings",
        type: "fill",
        source: "omt",
        "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": c.ink, "fill-opacity": 0.12 },
      },
      // The coast in ink: the outline of OpenStreetMap's sea.
      {
        id: "coast",
        type: "line",
        source: "omt",
        "source-layer": "water",
        paint: {
          "line-color": c.ink,
          "line-opacity": 0.85,
          "line-width": zoomed(5, 0.5, 10, 1, 14, 1.6),
        },
      },
      {
        id: "contour-labels",
        type: "symbol",
        ...bathy,
        "source-layer": "contours",
        minzoom: 7.5,
        filter: [
          "in",
          ["get", "depth"],
          ["literal", [2, 5, 10, 20, 30, 50, 100, 200]],
        ],
        layout: {
          "symbol-placement": "line",
          "text-field": ["to-string", ["get", "depth"]],
          "text-font": FONT,
          "text-size": 10,
          "symbol-spacing": 320,
        },
        paint: {
          "text-color": c.depth,
          "text-halo-color": c.paper,
          "text-halo-width": 2,
          "text-opacity": DEPTH_BY_ZOOM["contour-labels"][1],
        },
      },
      {
        id: "soundings",
        type: "symbol",
        ...bathy,
        "source-layer": "soundings",
        minzoom: 7.2,
        layout: {
          "text-field": ["get", "label"],
          "text-font": FONT,
          "text-size": 10,
          "symbol-sort-key": ["get", "rank"],
          "text-padding": 6,
        },
        paint: {
          "text-color": c.ink,
          "text-opacity": DEPTH_BY_ZOOM.soundings[1],
        },
      },
      {
        id: "water-names",
        type: "symbol",
        source: "omt",
        "source-layer": "water_name",
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": FONT,
          "text-transform": "uppercase",
          "text-letter-spacing": 0.25,
          "text-size": zoomed(5, 10, 10, 13),
        },
        paint: {
          "text-color": c.depth,
          "text-halo-color": c.paper,
          "text-halo-width": 1,
        },
      },
      ...[false, true].map(
        (near) =>
          ({
            id: near ? "places-near" : "places",
            type: "symbol",
            source: "omt",
            "source-layer": "place",
            filter: PLACE_CLASSES,
            layout: {
              "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
              "text-font": FONT_UP,
              "text-size": [
                "match",
                ["get", "class"],
                "city",
                13,
                "town",
                11.5,
                10,
              ],
              "text-letter-spacing": 0.08,
              ...(near ? { visibility: "none" } : {}),
            },
            paint: {
              "text-color": c.ink,
              "text-opacity": 0.8,
              "text-halo-color": c.land,
              "text-halo-width": 1.5,
            },
          }) as LayerSpecification,
      ),
    ],
  };
}

/* ---- the wind as a rider reads it ---------------------------------------- */

export type Rgb = [number, number, number];

/** One stop of the rider's wind scale: knots, and the colour there. */
export interface RideStop {
  kn: number;
  rgb: Rgb;
  /** The theme token the colour came from, for the key's swatches. */
  token: string;
}

const hex = (value: string): Rgb | null => {
  const m = /^#?([0-9a-f]{6})/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * The wind scale for this rider: blue below their floor, greens deepening
 * from the floor into the middle of the sweet spot, yellow at its top, orange
 * to red past what they can hold, and the storm colour beyond. The knots come
 * from `windBand`, so the colours follow the rider's level and weight.
 */
export function rideStops(
  rider: Rider,
  root: Pick<CSSStyleDeclaration, "getPropertyValue">,
): RideStop[] {
  const b = windBand(rider);
  const stops: [number, string][] = [
    [0, "calm"],
    [Math.max(1, b.min - 3), "light"],
    [b.min, "floor"],
    [b.sweetLow, "good"],
    [(b.sweetLow + b.sweetHigh) / 2, "best"],
    [b.sweetHigh, "top"],
    [(b.sweetHigh + b.max) / 2, "much"],
    [b.max, "over"],
    [b.max + 10, "storm"],
  ];
  return stops.map(([kn, name]) => ({
    kn,
    token: `--ride-${name}`,
    rgb: hex(root.getPropertyValue(`--ride-${name}`)) ?? [128, 128, 128],
  }));
}

/** The colour at a speed on the rider's scale, interpolated between stops. */
export function rideColour(stops: readonly RideStop[], kn: number): Rgb {
  if (kn <= stops[0].kn) return stops[0].rgb;
  for (let i = 1; i < stops.length; i++) {
    if (kn <= stops[i].kn) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (kn - a.kn) / (b.kn - a.kn || 1);
      return [0, 1, 2].map((k) =>
        Math.round(a.rgb[k] + (b.rgb[k] - a.rgb[k]) * t),
      ) as Rgb;
    }
  }
  return stops[stops.length - 1].rgb;
}
