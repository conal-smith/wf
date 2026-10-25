/**
 * Met Éireann's warnings on the map's table of hours (src/useRatings.ts), apart
 * from src/ratings.ts, which the blend job bundles without the warnings' area
 * table (force5/Dockerfile copies no data/).
 */
import {
  applyWarnings,
  warningsDuring,
  type PlaceWarning,
} from "../force5/src/warnings";
import type { PlaceHour } from "./ratings";

const HOUR = 3600000;

/**
 * A place's columns with Met Éireann's warnings applied, by the rule the spot
 * page and the MCP share (force5/src/warnings.ts `applyWarnings`): under
 * orange or red a column has no rating, under yellow it keeps it, and either
 * way it names the warning. A column covers the time to the next one.
 */
export function warnHours(
  rows: PlaceHour[],
  axis: readonly string[],
  warnings: readonly PlaceWarning[],
): PlaceHour[] {
  if (!warnings.length) return rows;
  return rows.map((row, i) => {
    const from = Date.parse(axis[i]);
    const next = i + 1 < axis.length ? Date.parse(axis[i + 1]) : NaN;
    const to = next > from ? next : from + HOUR;
    const covering = warningsDuring(warnings, from, to);
    if (!covering.length) return row;
    const { rating, level, withheld } = applyWarnings(row.rating, covering);
    return {
      ...row,
      rating,
      warning: { level: level!, replacesRating: withheld },
    };
  });
}
