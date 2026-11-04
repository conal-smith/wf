/**
 * The sums behind the week graph's lower bands (SpotReport.tsx): every
 * model's own wind, how gusty each hour is, the rain in each hour, and the
 * hour an address opens the week at. Each is the chart's dock's reading
 * (src/ForecastDock.tsx), carried to the spot page when the dock gave way to
 * the chart's scrub bar, and kept free of React so it is tested on its own.
 */
import { gustFactor, gustFactorText } from "../../../force5/src/gustFactor";
import {
  gustStars,
  gustsOverLimit,
  windBand,
  windStars,
  type Rider,
} from "../../../force5/src/stars";
import type { ForecastHour } from "../../../mcp/api/forecast";
import { HOUR, type SpotRow } from "../spot";

/**
 * What a gust does to the rider's hour, by the stars' own reading of it
 * (force5/src/stars.ts): nothing ("fine"), a star or more off ("costs": the
 * gust, read 5 kn lighter, rates under the wind), or no stars at all
 * ("over": past the rider's too much). The factor is a figure to read, never
 * the cost itself: the stars judge a gust by its knots.
 */
export type GustKind = "fine" | "costs" | "over";

export interface GustReading {
  /** The gust over the mean wind. */
  factor: number;
  /** "1.4×", cut to a tenth, never rounded up. */
  text: string;
  kind: GustKind;
}

/**
 * An hour's gust factor and what the gust does to the rider's stars; null
 * without a gust, or in a near calm, where the factor says nothing
 * (force5/src/gustFactor.ts).
 */
export function gustReading(
  windKn: number | null | undefined,
  gustKn: number | null | undefined,
  rider: Pick<Rider, "custom">,
): GustReading | null {
  const factor = gustFactor(windKn, gustKn);
  if (factor === null) return null;
  const band = windBand(rider);
  const wind = windStars(windKn!, band);
  const kind: GustKind = gustsOverLimit(gustKn!, rider)
    ? "over"
    : Math.round(Math.min(wind, gustStars(gustKn!, band))) < Math.round(wind)
      ? "costs"
      : "fine";
  return { factor, text: gustFactorText(factor), kind };
}

/** What a gust's kind means, for the factor's title and the legend. */
export const GUST_WORDS: Record<GustKind, string> = {
  fine: "no cost to your stars",
  costs: "strong enough to cost a star",
  over: "past your too much: no stars",
};

/**
 * The rain in each hour, mm/h, by the hour's time: a model's total spread
 * evenly over the interval it covers (an hour, or three or six further
 * out), so a six-hour total of 3 mm reads 0.5 mm/h in each of its hours
 * rather than 3 mm in one. An interval runs up to and including its row's
 * time (or `rain_until`), as mcp/api/forecast.ts `rainByHour` reads it. An
 * hour no total covers is absent: no rain forecast, not a dry one.
 */
export function rainPerHour(
  hours: readonly ForecastHour[],
): Map<number, number> {
  const times = hours.map((hour) => Date.parse(hour.time));
  const rates = new Map<number, number>();
  for (const hour of hours) {
    const weather = hour.weather;
    if (!weather || weather.rain_mm === null || weather.rain_mm === undefined)
      continue;
    const span = weather.rain_interval_hours ?? 1;
    if (!(span > 0)) continue;
    const until = Date.parse(weather.rain_until ?? hour.time);
    const start = until - span * HOUR;
    for (const time of times)
      if (time > start && time <= until)
        rates.set(time, weather.rain_mm / span);
  }
  return rates;
}

/**
 * The rain a row stands for, mm/h: the mean of its hours' (a row three
 * hours long holds three), or null where not one of them has a figure.
 */
export function rowRain(
  rates: ReadonlyMap<number, number>,
  row: Pick<SpotRow, "time" | "step">,
): number | null {
  const values = Array.from({ length: row.step }, (_, i) =>
    rates.get(row.time + i * HOUR),
  ).filter((v): v is number => v !== undefined);
  return values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null;
}

/** One model's own wind across the week, a reading per row it reaches. */
export interface ModelSeries {
  id: string;
  /** Each row it reaches: its own wind, and the way it comes from. */
  points: { time: number; step: number; kn: number; from: number }[];
}

/**
 * Every model's own wind, for the models the rider blends (Settings), in
 * that order, from each hour's per-model readings (`by_model`). A model with
 * fewer than two readings draws no line and is left out.
 */
export function modelSeries(
  rows: readonly Pick<SpotRow, "time" | "step" | "hour">[],
  models: readonly string[],
): ModelSeries[] {
  return models.flatMap((id) => {
    const points = rows.flatMap((row) => {
      const own = row.hour.wind?.by_model?.[id];
      return own
        ? [
            {
              time: row.time,
              step: row.step,
              kn: own.wind_kn,
              from: own.direction_deg,
            },
          ]
        : [];
    });
    return points.length > 1 ? [{ id, points }] : [];
  });
}

/**
 * The hour an address asks the week to open at (`?at=`, force5/src/siteNav.ts
 * `spotHref`), as an instant, or null where it asks none or names no time.
 */
export function atFromSearch(search: string): number | null {
  const at = new URLSearchParams(search).get("at");
  if (!at) return null;
  const time = Date.parse(at);
  return Number.isFinite(time) ? time : null;
}

/**
 * Which row an instant falls in, or null before the first row or past the
 * last one's end: an hour already gone, or past the forecast, is not one the
 * week can open at.
 */
export function rowIndexAt(
  rows: readonly Pick<SpotRow, "time" | "step">[],
  time: number,
): number | null {
  const at = rows.findIndex(
    (row) => time >= row.time && time < row.time + row.step * HOUR,
  );
  return at === -1 ? null : at;
}
