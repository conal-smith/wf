/**
 * The wind ramp's stops, as ui/theme.css names them (`--color-wind-k15`), and
 * which one a speed has reached. Plain data: a section that paints with them
 * writes the class names out in its own recipe, because a class put together
 * as the page runs is one the stylesheet never gets.
 */
export type WindStop =
  | "k00"
  | "k05"
  | "k09"
  | "k10"
  | "k15"
  | "k20"
  | "k25"
  | "k30"
  | "k35"
  | "k40"
  | "k45"
  | "k50"
  | "k60"
  | "k65";

/** Where each stop starts, in knots: the map's ramp, stop for stop. */
export const WIND_STOPS: readonly (readonly [number, WindStop])[] = [
  [0, "k00"],
  [5, "k05"],
  [9, "k09"],
  [10, "k10"],
  [15, "k15"],
  [20, "k20"],
  [25, "k25"],
  [30, "k30"],
  [35, "k35"],
  [40, "k40"],
  [45, "k45"],
  [50, "k50"],
  [60, "k60"],
  [65, "k65"],
];

/** The stop a speed has reached: 19 kn is drawn at 15, and 20 kn at 20. */
export function windStop(knots: number): WindStop {
  let stop = WIND_STOPS[0][1];
  for (const [from, name] of WIND_STOPS) if (knots >= from) stop = name;
  return stop;
}
