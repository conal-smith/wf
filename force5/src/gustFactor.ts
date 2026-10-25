/**
 * The gust factor: an hour's gust over its mean wind, how gusty it will be.
 * 1.3× is an ordinary riding day (the models' gust is the hour's strongest);
 * the stars call an hour gusty from 1.5× and very gusty from 1.8×
 * (force5/src/stars.ts, `gustiness`).
 *
 * In a near calm the ratio says nothing: a 2 kn mean gusting 5 is "2.5×" and
 * no rider would call it gusty. Under `GUST_FACTOR_MIN_WIND_KN` of mean wind
 * there is no factor at all.
 */

/**
 * The least mean wind, in knots, a gust factor is given for. Under 5 kn a knot
 * of gust moves the factor by a fifth or more, and nobody rides it anyway.
 */
export const GUST_FACTOR_MIN_WIND_KN = 5;

/**
 * Gust ÷ mean wind, in any one unit; null where either is missing or not a
 * number, or the mean is under `GUST_FACTOR_MIN_WIND_KN` (give both in knots
 * for that to hold). A gust under the mean, which a model's hourly maximum
 * should never be, is read as no gust over it: 1.
 */
export function gustFactor(
  windKn: number | null | undefined,
  gustKn: number | null | undefined,
): number | null {
  if (
    typeof windKn !== "number" ||
    typeof gustKn !== "number" ||
    !Number.isFinite(windKn) ||
    !Number.isFinite(gustKn) ||
    windKn < GUST_FACTOR_MIN_WIND_KN
  )
    return null;
  return Math.max(1, gustKn / windKn);
}

/**
 * "1.9×": the factor to a tenth, cut rather than rounded, so a figure that
 * reads 1.5× is never one the stars still call steady (1.49 reads "1.4×").
 */
export const gustFactorText = (factor: number) =>
  `${(Math.floor(factor * 10 + 1e-9) / 10).toFixed(1)}×`;
