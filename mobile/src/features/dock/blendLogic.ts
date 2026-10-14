/**
 * The blend chart's drawing (src/BlendChart.tsx), worked out once per blend:
 * the models' spread as nested bands in the wind's own colours, the gusts
 * over the headline, the headline (`HourStats.median`: HARMONIE's own while it
 * reaches the hour, else the models' median), each model's own line, the arrows, the night
 * and the gridlines. Every path is in strip pixels; each day of the dock draws
 * the same paths through its own window, so nothing is split at midnight.
 */
import type { BlendInput, HourStats } from "../../../../force5/src/blend";
import { modelHue } from "../../../../force5/src/manifests";
import type { NightInterval } from "../../../../force5/src/sun";
import { convert, type Units } from "../../../../force5/src/units";
import {
  axisTicks,
  bandPath,
  candleGroups,
  linePath,
  modelSupport,
  niceMax,
  timeToX,
  valueScale,
  windGradientStops,
  type GradientStop,
} from "../../../../src/chart";

export interface BlendDrawing {
  max: number;
  ticks: { value: number; y: number }[];
  stops: GradientStop[];
  /** y of zero and of the top, for the gradient. */
  y0: number;
  yMax: number;
  bands: { d: string; opacity: number }[];
  gusts: { d: string; opacity: number }[];
  lines: { d: string; color: string }[];
  sparse: string;
  median: string;
  arrows: { x: number; y: number; from: number }[];
  nights: { x: number; w: number }[];
  /** For a screen reader: the spread in words. */
  words: string;
}

/** The blend's values in the reader's units, the only space the chart draws in. */
const shown = (value: number | null | undefined, units: Units) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : convert(value, units);

export function blendDrawing(options: {
  stats: readonly HourStats[];
  lines: readonly BlendInput[];
  directions: readonly (number | null)[];
  columns: readonly { validTime: string }[];
  centres: readonly number[];
  nights: readonly NightInterval[];
  units: Units;
  height: number;
  width: number;
}): BlendDrawing | null {
  const { stats, lines, directions, columns, centres, nights, units, height, width } = options;
  if (!lines.length || !stats.length) return null;
  const peak = stats.reduce((top, h) => Math.max(top, h.max ?? 0, h.gust.max ?? 0), 0);
  const max = niceMax(convert(peak, units));
  const y = valueScale(max, height);
  const series = (pick: (h: HourStats) => number | null) => stats.map((h) => shown(pick(h), units));
  const minimum = series((h) => h.min);
  const maximum = series((h) => h.max);
  const q25 = series((h) => h.q25);
  const q75 = series((h) => h.q75);
  const median = series((h) => h.median);
  const gustMax = series((h) => h.gust.max);
  const gustMedian = series((h) => h.gust.median);
  const core = (side: readonly (number | null)[]) =>
    side.map((v, i) => (v === null || median[i] === null ? null : (v + median[i]!) / 2));
  const support = modelSupport(lines, columns.length);
  const thin = (values: readonly (number | null)[]) =>
    values.map((v, i) => ((support[i] ?? 0) < 3 ? v : null));
  const sparse =
    support.some((count) => count > 0 && count < 3)
      ? `${linePath(centres, thin(maximum), y)} ${linePath(centres, thin(minimum), y)}`.trim()
      : "";
  const arrowAt = new Set(candleGroups(columns.map((c) => c.validTime)).map((group) => group[0]));
  const arrows = directions.flatMap((from, i) =>
    from === null || median[i] === null || !arrowAt.has(i) ? [] : [{ x: centres[i], y: y(median[i]!), from }],
  );
  const first = Date.parse(columns[0].validTime);
  const last = Date.parse(columns[columns.length - 1].validTime);
  const nightRects = nights.flatMap((night) => {
    const from = timeToX(columns, night.from.getTime(), centres);
    const to = timeToX(columns, night.to.getTime(), centres);
    const left = from ?? (night.to.getTime() > first ? 0 : null);
    const right = to ?? (night.from.getTime() < last ? width : null);
    if (left === null || right === null || right <= left) return [];
    return [{ x: left, w: right - left }];
  });
  const low = Math.min(...minimum.filter((v): v is number => v !== null), max);
  const high = Math.max(...maximum.filter((v): v is number => v !== null), 0);
  return {
    max,
    ticks: axisTicks(max).map((value) => ({ value, y: y(value) })),
    stops: windGradientStops(max, units),
    y0: y(0),
    yMax: y(max),
    bands: [
      { d: bandPath(centres, minimum, maximum, y), opacity: 0.5 },
      { d: bandPath(centres, q25, q75, y), opacity: 0.22 },
      { d: bandPath(centres, core(q25), core(q75), y), opacity: 0.2 },
    ],
    gusts: [
      { d: bandPath(centres, median, gustMax, y), opacity: 0.22 },
      { d: bandPath(centres, median, gustMedian, y), opacity: 0.16 },
    ],
    // Each model's own line; an ensemble's fifty members would be a thicket
    // at a phone's width, and the bands already carry their spread.
    lines: lines
      .filter((line) => line.memberIndex === undefined)
      .map((line) => ({ d: linePath(centres, line.speed.map((v) => shown(v, units)), y), color: modelHue(line.model).wind })),
    sparse,
    median: linePath(centres, median, y),
    arrows,
    nights: nightRects,
    words: `The models' blend: wind between ${Math.round(low)} and ${Math.round(high)} ${units} across ${
      new Set(lines.map((l) => l.model)).size
    } models. The table view lists every value.`,
  };
}
