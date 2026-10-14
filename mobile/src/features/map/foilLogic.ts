/**
 * Foilable depth at the selected hour's tide, and the intertidal heights
 * over it, as the site's map works them out (src/App.tsx, "foilable depth at
 * the selected tide"): only the areas over the view, each a Terrarium
 * archive drawn as a `color-relief` layer whose ramp follows its station's
 * tide. Pure; the hooks in useFoil.ts fetch the indexes and the curves.
 */
import type { ExpressionSpecification } from "maplibre-gl";
import {
  areasInView,
  foilRamp,
  waterLevelAt,
  type FoilArea,
  type FoilColours,
  type FoilManifest,
} from "../../../../force5/src/foilDepth";
import type { IntertidalArea, IntertidalManifest } from "../../../../force5/src/intertidal";
import { tideAt, type TideCurve, type TideStation } from "../../../../force5/src/tides";

/**
 * The zoom the intertidal heights are drawn from (src/useIntertidal.ts): a
 * 10 m pixel is a few points there, and a bay's flats fill the view.
 */
export const INTERTIDAL_FROM_ZOOM = 10;
/** Where the intertidal index is served from, beside the site (src/useIntertidal.ts). */
export const INTERTIDAL_INDEX_PATH = "intertidal/index.json";

export interface ChartView {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

export type Tides = Record<string, { station: TideStation; curve: TideCurve }>;

/** One area's layer: a region or a pilot, or the intertidal heights over them. */
export interface FoilLayer {
  /** The layer's and the source's id. */
  id: string;
  /** The archive, as a `pmtiles://` URL. */
  url: string;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  color: ExpressionSpecification;
  attribution: string;
  over: boolean;
}

/** Each area's water level at the hour, and the station's tide it came from. */
export function foilLevels(
  areas: readonly FoilArea[],
  tides: Tides,
  time: number | null,
): Record<string, { water: number; sea: number } | null> {
  const out: Record<string, { water: number; sea: number } | null> = {};
  for (const area of areas) {
    const tide = tides[area.station];
    if (!tide || time === null) {
      out[area.id] = null;
      continue;
    }
    const at = (t: number) => tideAt(tide.curve, t);
    const sea = at(time);
    const water = waterLevelAt(area, at, time);
    out[area.id] = sea === null || water === null ? null : { water, sea };
  }
  return out;
}

export interface FoilInputs {
  on: boolean;
  manifest: FoilManifest | null;
  tides: Tides;
  levels: Record<string, { water: number; sea: number } | null>;
  view: ChartView | null;
  palette: FoilColours;
  time: number | null;
  intertidal: IntertidalManifest | null;
  /** An area's archive, as an absolute https URL. */
  foilUrl: (manifest: FoilManifest, area: FoilArea) => string;
  intertidalUrl: (area: IntertidalArea) => string;
}

/** The foil areas over a view. */
export const foilInView = (manifest: FoilManifest | null, view: ChartView | null) =>
  manifest && view ? areasInView(manifest.areas, view, view.zoom) : [];

/** The intertidal areas over a view, once it is zoomed in to the shore. */
export const intertidalInView = (manifest: IntertidalManifest | null, view: ChartView | null) =>
  manifest && view && view.zoom >= INTERTIDAL_FROM_ZOOM ? areasInView(manifest.areas, view, view.zoom) : [];

/**
 * The layers to draw: each foil area over the view at its water level, and
 * over them the intertidal heights at the same tide, every reserved value
 * left clear so the foil archive under them shows (src/App.tsx `foilViews`).
 */
export function foilLayers(input: FoilInputs): FoilLayer[] {
  const { manifest: m, palette, time } = input;
  if (!input.on || !m) return [];
  const below = foilInView(m, input.view).flatMap((area): FoilLayer[] => {
    const level = input.levels[area.id];
    if (!level) return [];
    return [
      {
        id: `foil-${area.id}`,
        url: `pmtiles://${input.foilUrl(m, area)}`,
        minzoom: area.minzoom,
        maxzoom: area.maxzoom,
        tileSize: area.tileSize,
        color: foilRamp(level.water, palette, {
          dryCeiling: area.dryCeilingMetres,
          floor: m.floorMetres,
          noSurvey: m.noSurveyMetres,
          deep: m.deepMetres,
        }),
        attribution: m.attribution,
        over: false,
      },
    ];
  });
  const heights = input.intertidal;
  const over = intertidalInView(heights, input.view).flatMap((area): FoilLayer[] => {
    const curve = input.tides[area.station]?.curve;
    const tide = curve && time !== null ? tideAt(curve, time) : null;
    if (!heights || tide === null) return [];
    return [
      {
        id: `intertidal-${area.id}`,
        url: `pmtiles://${input.intertidalUrl(area)}`,
        minzoom: Math.max(area.minzoom, INTERTIDAL_FROM_ZOOM),
        maxzoom: area.maxzoom,
        tileSize: area.tileSize,
        color: foilRamp(tide, palette, {
          dryCeiling: area.highestSeenMetres,
          floor: area.lowestSeenMetres - 1,
          deep: heights.deepMetres,
          fade: 0,
        }),
        attribution: heights.attribution,
        over: true,
      },
    ];
  });
  return [...below, ...over];
}

/** The tide stations whose curves are wanted: the areas' in view, and the key's area's. */
export function stationsWanted(
  areas: readonly ({ station: string } | null | undefined)[],
): string[] {
  return [...new Set(areas.flatMap((a) => (a ? [a.station] : [])))].sort();
}
