/**
 * The chart's style for the native map: the site's own (force5/src/chartStyle.ts),
 * every colour read from the app's tokens through the same `getPropertyValue`
 * the site reads its stylesheet with, and the depths read by MapLibre Native
 * straight from the archive on the data host (`pmtiles://`).
 */
import type { StyleSpecification } from "maplibre-gl";
import {
  BATHY_PATH,
  chartColours,
  chartStyle,
  type ChartColours,
} from "../../../../force5/src/chartStyle";
import { foilColours, type FoilColours } from "../../../../force5/src/foilDepth";
import { forecastUrl } from "../../../../force5/src/urls";
import { cssVariables } from "../../theme/tokens";

export const appChartColours = (): ChartColours => chartColours(cssVariables);

export const appFoilColours = (): FoilColours => foilColours(cssVariables);

/** The depth archive as MapLibre Native reads it. */
export const bathySource = () => `pmtiles://${forecastUrl(BATHY_PATH)}`;

let built: StyleSpecification | null = null;

/** Built once: the theme cannot move under a map that is already up. */
export function appChartStyle(): StyleSpecification {
  return (built ??= chartStyle(appChartColours(), bathySource()));
}
