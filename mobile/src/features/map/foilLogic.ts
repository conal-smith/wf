/**
 * Foilable depth at the selected hour's tide, as the site's map works it out
 * (src/App.tsx, "foilable depth at the selected tide"): only the areas over
 * the view, each a Terrarium archive drawn as a `color-relief` layer whose
 * ramp follows its station's tide. The Sentinel-2 intertidal heights are in
 * the archives themselves (scripts/foildepth). Pure; the hooks in
 * useChartLayers.ts fetch the index and the curves.
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
import { tideAt, type TideCurve, type TideStation } from "../../../../force5/src/tides";

export interface ChartView {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

export type Tides = Record<string, { station: TideStation; curve: TideCurve }>;

/** One area's layer: a region or a pilot. */
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
  levels: Record<string, { water: number; sea: number } | null>;
  view: ChartView | null;
  palette: FoilColours;
  /** An area's archive, as an absolute https URL. */
  foilUrl: (manifest: FoilManifest, area: FoilArea) => string;
}

/** The foil areas over a view. */
export const foilInView = (manifest: FoilManifest | null, view: ChartView | null) =>
  manifest && view ? areasInView(manifest.areas, view, view.zoom) : [];

/** The layers to draw: each foil area over the view at its water level (src/App.tsx `foilViews`). */
export function foilLayers(input: FoilInputs): FoilLayer[] {
  const { manifest: m, palette } = input;
  if (!input.on || !m) return [];
  return foilInView(m, input.view).flatMap((area): FoilLayer[] => {
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
          // A set that estimates the beds no survey reached writes no
          // no-survey value, and its padded land crosses it.
          noSurvey: m.estimateBlue === undefined ? m.noSurveyMetres : undefined,
          deep: m.deepMetres,
        }),
        attribution: m.attribution,
      },
    ];
  });
}

/** The tide stations whose curves are wanted: the areas' in view, and the key's area's. */
export function stationsWanted(
  areas: readonly ({ station: string } | null | undefined)[],
): string[] {
  return [...new Set(areas.flatMap((a) => (a ? [a.station] : [])))].sort();
}
