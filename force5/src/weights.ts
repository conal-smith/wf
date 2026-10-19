// How much each model counts in the dock's blend chart, and how far the models
// agree about an hour. Dependency-free, so the forecast server (mcp/api,
// compiled on its own) reads the same weights as the site's dock
// (force5/src/blend.ts re-exports them). Neither moves a star: the stars come
// from one model, the rider's choice (force5/src/lead.ts, the ruling of 19
// October 2026).
//
// The numbers come from a backtest of every model against 31 Irish stations,
// 10 July to 9 October 2026: fitted on the first 60 days, judged on the last
// 32 (docs/VERIFICATION.md, "Blend weights"). The verification job keeps
// scoring the blend that uses them, so they can be refitted on our own record.

/** Grid spacings, in km, at which a model's line starts to count for more. */
export const FINE_GRID_KM = 3;
export const REGIONAL_GRID_KM = 8;

/**
 * The fallback for a model the backtest has not judged (a new adapter, the
 * HARMONIE ensemble): by the grid it is published on. A fine grid sees the
 * headlands, bays and sea breezes a 25 km global grid averages away, so 3 km or
 * finer counts three times, up to 8 km twice, anything coarser or unstated once.
 */
export function blendWeight(resolutionKm: number | null | undefined): number {
  if (typeof resolutionKm !== "number" || !Number.isFinite(resolutionKm))
    return 1;
  if (resolutionKm <= FINE_GRID_KM) return 3;
  if (resolutionKm <= REGIONAL_GRID_KM) return 2;
  return 1;
}

/** Which day of its run an hour falls on: 0 for the first 24 hours, 3 for day 3 on. */
export type LeadDay = 0 | 1 | 2 | 3;

export function leadDay(leadHours: number): LeadDay {
  if (!(leadHours >= 24)) return 0;
  if (leadHours < 48) return 1;
  if (leadHours < 72) return 2;
  return 3;
}

/** Hours from a run's start to a valid time. */
export const leadHours = (runTime: string | number, validTime: number) =>
  (validTime - (typeof runTime === "number" ? runTime : Date.parse(runTime))) /
  3600000;

/**
 * Each judged model's weight on day 0, 1, 2 and 3 on of its run. What the
 * backtest found: HARMONIE is the best model for as long as it runs; AROME
 * runs about 1.5 kn high and ARPEGE is the weakest everywhere; the ensemble
 * means and AIFS are the best guides from day 2, where the deterministic IFS
 * adds least. Giving each family one vote, or dropping the ensemble means,
 * made the blend worse past day 1, so neither is done. A model publishes
 * nothing past its own horizon, so a weight there is never read.
 */
export const MODEL_WEIGHTS: Readonly<
  Record<string, readonly [number, number, number, number]>
> = {
  harmonie: [4, 4, 4, 4],
  arome: [2, 1, 1, 1],
  "icon-eu": [2, 1, 1, 1],
  gfs: [2, 2, 1, 1],
  gefs: [1, 1, 1, 1],
  "ecmwf-ens": [1, 1, 1.5, 1.5],
  aifs: [0.5, 1, 1.5, 1.5],
  ecmwf: [0.5, 0.5, 0.5, 0.5],
  arpege: [0.5, 0.5, 0.5, 0.5],
};

/**
 * How much one model's line counts at an hour `leadHours` into its run: the
 * backtest's weight for a judged model, the grid rule for any other.
 */
export function modelWeight(
  model: string,
  leadHours: number,
  resolutionKm?: number | null,
): number {
  const row = MODEL_WEIGHTS[model];
  return row ? row[leadDay(leadHours)] : blendWeight(resolutionKm);
}

/**
 * The value at half the total weight. A point that lands exactly between two
 * values takes their midpoint, so equal weights give the ordinary median.
 */
export function weightedMedian(
  values: readonly number[],
  weights: readonly number[],
): number {
  const order = values
    .map((value, i) => ({ value, weight: weights[i] ?? 1 }))
    .sort((a, b) => a.value - b.value);
  const half = order.reduce((sum, o) => sum + o.weight, 0) / 2;
  let below = 0;
  for (let i = 0; i < order.length; i++) {
    below += order[i].weight;
    if (Math.abs(below - half) < 1e-9 && i + 1 < order.length)
      return (order[i].value + order[i + 1].value) / 2;
    if (below > half) return order[i].value;
  }
  return order[order.length - 1].value;
}

export type Agreement = "high" | "moderate" | "low";

/**
 * The models' spread, as a standard deviation in knots, below which an hour is
 * "high" and at or above which it is "low", on lead day 0, 1, 2 and 3 on.
 *
 * The old label read the models' full range against fixed 4 and 8 kn. The
 * backtest found it said "high" more often at day 3–5 than at day 0, because a
 * range shrinks as the fine grids drop out, and a day-5 "high" was a worse
 * forecast than a day-0 "moderate". Fitted against the error itself, the
 * expected error is 1.31 kn + 0.49 × the spread + 0.08 / 0.25 / 0.44 kn on day
 * 1 / 2 / 3 on; "high" is an expected error under 2.15 kn and "low" one of
 * 2.81 kn or more. These are those lines, solved for the spread, so a "high"
 * hour means a typical error of about 2 kn whichever day it is on. Wind speed
 * is left out on purpose: errors grow with the wind, but a 3 kn miss on a
 * 25 kn day changes nothing a rider decides.
 */
export const AGREEMENT_SPREAD_KN: readonly (readonly [number, number])[] = [
  [1.7, 3.05],
  [1.55, 2.9],
  [1.2, 2.55],
  [0.8, 2.15],
];

/** Below this many models, agreement is at best "moderate": two can agree by chance. */
export const AGREEMENT_MIN_MODELS = 3;

/** Population standard deviation, in the values' own unit. */
export function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
  );
}

/**
 * How far to trust an hour, from each model's speed in knots (an ensemble as
 * its member mean) and how far ahead the freshest of those runs is looking.
 * Null with no models.
 */
export function agreementFrom(
  speedsKn: readonly number[],
  leadHours: number,
): Agreement | null {
  if (!speedsKn.length) return null;
  const [high, low] = AGREEMENT_SPREAD_KN[leadDay(leadHours)];
  const sd = standardDeviation(speedsKn);
  const label: Agreement = sd < high ? "high" : sd < low ? "moderate" : "low";
  return label === "high" && speedsKn.length < AGREEMENT_MIN_MODELS
    ? "moderate"
    : label;
}
