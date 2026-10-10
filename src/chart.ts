// Geometry, scales and path builders for the forecast dock's charts. Pure
// functions only: no React and no DOM, so every rule here is unit-tested.
//
// `force5/src/blend.ts` already provides path helpers, but they assume one
// uniform pixels-per-hour scale. The dock's columns are not uniform — ECMWF
// widens to six-hourly after day six, exactly as the table does — so the charts
// position everything from measured column centres instead, and smooth with
// Catmull-Rom, which the data layer does not do.
import { framePosition } from "../force5/src/timeline";
import { KNOTS, convert, type Units } from "../force5/src/units";
import {
  direction,
  windColor,
  type FrameInfo,
  type Wind,
} from "../force5/src/weather";
import {
  bridgeableGapHours,
  interpolateSeries,
  type Agreement,
} from "../force5/src/blend";
import type { SeriesPoint } from "../force5/src/series";

export interface Point2 {
  x: number;
  y: number;
}

/** Metres per second behind a value already converted for display. */
export const displayToMps = (value: number, units: Units) =>
  value / convert(1, units);
/** Knots behind a display value, which is what the wind palette is keyed on. */
export const displayToKnots = (value: number, units: Units) =>
  displayToMps(value, units) * KNOTS;

/**
 * Top of the value axis: the next whole `step` above the data, never less than
 * two steps, so an empty or calm chart still shows a real scale.
 */
export function niceMax(maxDisplay: number, step = 10, minimumSteps = 2) {
  const data = Number.isFinite(maxDisplay) ? Math.max(0, maxDisplay) : 0;
  return Math.max(minimumSteps, Math.ceil(data / step)) * step;
}

/** Breathing room above the highest value and below the baseline, in pixels. */
export const PLOT_PAD_TOP = 7;
export const PLOT_PAD_BOTTOM = 3;

/**
 * Value-to-pixel scale for a plot box, clamped so out-of-domain data cannot
 * escape it. The axis gutter, the blend and the candles all build their scale
 * here, which is what keeps a tick label level with the line it describes.
 */
export function valueScale(
  max: number,
  height: number,
): (value: number) => number {
  const top = PLOT_PAD_TOP;
  const bottom = Math.max(top + 1, height - PLOT_PAD_BOTTOM);
  return (value: number) =>
    bottom - Math.max(0, Math.min(1, value / max)) * (bottom - top);
}

/** Gridline/tick values from zero to `max` inclusive. */
export function axisTicks(max: number, step = 10): number[] {
  if (!(step > 0) || !(max > 0)) return [0];
  const ticks: number[] = [];
  for (let value = 0; value <= max + 1e-9; value += step) ticks.push(value);
  return ticks;
}

/** Hours between two forecast times. */
const gapHours = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 3600000;

/**
 * Relative width of each forecast column. A six-hourly step keeps twice the
 * room a three-hourly one does — the same rule `ForecastHeader` sizes its
 * header cells with, so the chart and the table cannot drift apart.
 *
 * Measured from the column times rather than from a run's elapsed hours: past
 * the seam the columns belong to a second run, whose hour numbers count from a
 * different initialization.
 */
export function columnWeights(
  times: readonly string[],
  baseHours = 3,
): number[] {
  return times.map((time, index) => {
    const interval = times[index + 1]
      ? gapHours(time, times[index + 1])
      : times[index - 1]
        ? gapHours(times[index - 1], time)
        : baseHours;
    return Math.max(1, interval / 3);
  });
}

/**
 * Columns grouped into candles of about three hours, by wall-clock time. A
 * fixed number of columns per candle would draw a three-hour candle beside a
 * twelve-hour one once the axis changes cadence at the seam.
 */
export function candleGroups(times: readonly string[], hours = 3): number[][] {
  if (!(hours > 0)) throw new Error("Candle width must be positive.");
  const span = hours * 3600000;
  const groups: number[][] = [];
  let bucket: number | null = null;
  times.forEach((time, index) => {
    const at = Math.floor(Date.parse(time) / span);
    if (at === bucket) groups[groups.length - 1].push(index);
    else {
      groups.push([index]);
      bucket = at;
    }
  });
  return groups;
}

/**
 * How many distinct models actually put a value on each column. Ensemble
 * members are one model between them: fifty-one lines from one run say no more
 * about agreement than one line does.
 */
export function modelSupport(
  lines: readonly { model: string; speed: readonly (number | null)[] }[],
  length: number,
): number[] {
  return Array.from({ length }, (_, column) => {
    const models = new Set<string>();
    for (const line of lines) {
      const value = line.speed[column];
      if (value !== null && value !== undefined && Number.isFinite(value))
        models.add(line.model);
    }
    return models.size;
  });
}

/** Left edge of every column plus the right edge of the last, in pixels. */
export function columnEdges(
  weights: readonly number[],
  width: number,
): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const edges = [0];
  let running = 0;
  for (const weight of weights) {
    running += weight;
    edges.push(total > 0 ? (running / total) * width : 0);
  }
  return edges;
}

/** Horizontal centre of every column, where a column's value is plotted. */
export function columnCentres(
  weights: readonly number[],
  width: number,
): number[] {
  const edges = columnEdges(weights, width);
  return weights.map((_, index) => (edges[index] + edges[index + 1]) / 2);
}

/**
 * Pixel position of a wall-clock time, interpolated between column centres.
 * Null outside the forecast, so an expired run draws no marker at all.
 */
export function timeToX(
  frames: readonly Pick<FrameInfo, "validTime">[],
  time: number,
  centres: readonly number[],
): number | null {
  const position = framePosition(frames, time);
  if (position === null || !centres.length) return null;
  const index = Math.floor(position);
  const left = centres[index];
  const right = centres[Math.min(index + 1, centres.length - 1)];
  if (left === undefined || right === undefined) return null;
  return left + (right - left) * (position - index);
}

/** Index runs of usable values, so a gap breaks a line instead of bridging it. */
export function valueRuns(values: readonly (number | null)[]): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push(index);
  });
  if (run.length) runs.push(run);
  return runs;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Catmull-Rom through every point, emitted as cubic Béziers. The curve passes
 * through the data rather than near it, which matters when a reader compares a
 * line against a numeric cell in the same column.
 */
export function smoothPath(points: readonly Point2[]): string {
  if (!points.length) return "";
  let d = `M${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

const asLine = (path: string) => (path ? `L${path.slice(1)}` : "");

/** SVG `d` for one smooth line per gap-free run. */
export function linePath(
  xs: readonly number[],
  values: readonly (number | null)[],
  y: (value: number) => number,
): string {
  return valueRuns(values)
    .map((run) => smoothPath(run.map((i) => ({ x: xs[i], y: y(values[i]!) }))))
    .join(" ");
}

/** SVG `d` for a filled band between two series, closed per gap-free run. */
export function bandPath(
  xs: readonly number[],
  lower: readonly (number | null)[],
  upper: readonly (number | null)[],
  y: (value: number) => number,
): string {
  const paired = lower.map((value, i) =>
    value === null || upper[i] === null ? null : value,
  );
  return valueRuns(paired)
    .map((run) => {
      const top = smoothPath(run.map((i) => ({ x: xs[i], y: y(upper[i]!) })));
      const bottom = smoothPath(
        [...run].reverse().map((i) => ({ x: xs[i], y: y(lower[i]!) })),
      );
      return `${top} ${asLine(bottom)} Z`;
    })
    .join(" ");
}

/** A band between a series and a flat baseline — the tide underlay's fill. */
export function areaPath(
  xs: readonly number[],
  values: readonly (number | null)[],
  y: (value: number) => number,
  baseline: number,
): string {
  return valueRuns(values)
    .map((run) => {
      const top = smoothPath(run.map((i) => ({ x: xs[i], y: y(values[i]!) })));
      const first = xs[run[0]];
      const last = xs[run[run.length - 1]];
      return `${top} L${round(last)} ${round(baseline)} L${round(first)} ${round(baseline)} Z`;
    })
    .join(" ");
}

export interface GradientStop {
  /** Fraction of the value axis, 0 at zero and 1 at the top. */
  offset: number;
  colour: string;
}

/**
 * Wind-palette stops keyed to the value axis, so a fill reads blue, green,
 * yellow then red as it rises. The palette is defined in knots; the stops are
 * converted back through the display units so the colours stay on speed.
 */
export function windGradientStops(
  max: number,
  units: Units,
  step = 5,
): GradientStop[] {
  if (!(max > 0) || !(step > 0)) return [];
  const values: number[] = [];
  for (let value = 0; value < max; value += step) values.push(value);
  values.push(max);
  return values.map((value) => ({
    offset: value / max,
    colour: `rgb(${windColor(displayToKnots(value, units)).join(",")})`,
  }));
}

const DUBLIN_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Irish calendar date of an instant, as YYYY-MM-DD. */
export function dublinDate(time: string | number | Date): string {
  return DUBLIN_DATE.format(new Date(time));
}

/**
 * Midday UTC on the Irish calendar day of an instant. Sun times are computed
 * per UTC day, so a 00:30 Irish column must not ask about the previous day.
 */
export function dublinNoonUtc(time: string | number | Date): Date {
  const [year, month, day] = dublinDate(time).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export interface DayGroup {
  /** Irish calendar date, YYYY-MM-DD. */
  date: string;
  label: string;
  /** Index of the first column in the group. */
  start: number;
  count: number;
  /** Midday UTC inside the group's Irish day, for sunrise and sunset. */
  noon: Date;
}

/** Forecast columns grouped by Irish calendar day, for the header's day row. */
export function dayGroups(
  times: readonly string[],
  label: (iso: string) => string,
): DayGroup[] {
  return times.reduce<DayGroup[]>((groups, time, index) => {
    const date = dublinDate(time);
    const last = groups[groups.length - 1];
    if (last?.date === date) last.count++;
    else
      groups.push({
        date,
        label: label(time),
        start: index,
        count: 1,
        noon: dublinNoonUtc(time),
      });
    return groups;
  }, []);
}

/**
 * Wind components interpolated onto the axis. `blend.ts` interpolates speed and
 * gust; the arrows need the vector itself, and it follows the same rules: u/v
 * space, never a wrapped bearing, and never across a gap the model cannot span.
 */
export function axisVectors(
  points: readonly SeriesPoint[],
  axis: readonly string[],
  maxGapHours = bridgeableGapHours(points),
): ({ u: number; v: number } | null)[] {
  return axis.map((iso) => {
    const position = framePosition(points, Date.parse(iso));
    if (position === null) return null;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = points[index];
    if (fraction === 0) return { u: a.u, v: a.v };
    const b = points[index + 1];
    const gapHours =
      (Date.parse(b.validTime) - Date.parse(a.validTime)) / 3600000;
    if (gapHours > maxGapHours + 1e-9) return null;
    return {
      u: a.u + (b.u - a.u) * fraction,
      v: a.v + (b.v - a.v) * fraction,
    };
  });
}

/** One run's reading for one column, and how it got there. */
export interface AxisReading {
  wind: Wind | null;
  /** True when the value sits between two of that run's published steps. */
  interpolated: boolean;
  /** Hours between the two steps it sits between; null on a published one. */
  stepHours: number | null;
}
const NOTHING: AxisReading = {
  wind: null,
  interpolated: false,
  stepHours: null,
};

/**
 * One run's precomputed series on the dock's columns.
 *
 * A column that is one of the run's own published steps gets that step's value,
 * unchanged. A column between two of them gets the same u/v interpolation the
 * blend chart draws — so the table and the chart cannot disagree — and says so,
 * because a coarse run repeating one value across three columns would read as
 * three forecasts. Outside the run, and across a gap wider than its own
 * cadence, there is nothing, never a borrowed neighbour.
 */
export function seriesOnAxis(
  points: readonly SeriesPoint[],
  axis: readonly string[],
  maxGapHours = bridgeableGapHours(points),
): AxisReading[] {
  if (!points.length) return axis.map(() => NOTHING);
  const vectors = axisVectors(points, axis, maxGapHours);
  const values = interpolateSeries(points, axis, { maxGapHours });
  const published = new Set(points.map((point) => Date.parse(point.validTime)));
  return axis.map((iso, index) => {
    const vector = vectors[index];
    if (!vector) return NOTHING;
    const wind: Wind = { u: vector.u, v: vector.v, gust: values.gust[index] };
    const at = Date.parse(iso);
    if (published.has(at))
      return { wind, interpolated: false, stepHours: null };
    const position = framePosition(points, at)!;
    const left = Math.floor(position);
    return {
      wind,
      interpolated: true,
      stepHours: Math.round(
        (Date.parse(points[left + 1].validTime) -
          Date.parse(points[left].validTime)) /
          3600000,
      ),
    };
  });
}

/** Vector mean of wind components, which is the only safe way to average them. */
export function vectorMean(
  points: readonly { u: number; v: number }[],
): { u: number; v: number } | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.u) && Number.isFinite(point.v),
  );
  if (!usable.length) return null;
  return {
    u: usable.reduce((sum, point) => sum + point.u, 0) / usable.length,
    v: usable.reduce((sum, point) => sum + point.v, 0) / usable.length,
  };
}

/** `vectorMean` with each vector counted by its weight. */
function weightedVectorMean(
  points: readonly { u: number; v: number; weight: number }[],
): { u: number; v: number } | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.u) && Number.isFinite(point.v),
  );
  const total = usable.reduce((sum, point) => sum + point.weight, 0);
  if (!usable.length || !(total > 0)) return null;
  return {
    u: usable.reduce((sum, point) => sum + point.u * point.weight, 0) / total,
    v: usable.reduce((sum, point) => sum + point.v * point.weight, 0) / total,
  };
}

/**
 * Mean wind bearing per axis hour across every model that covers it, for the
 * arrows on the median. A single model's arrow on a multi-model chart would be
 * a claim the chart is not making.
 */
export function meanDirections(
  vectorsByModel: readonly ({ u: number; v: number } | null)[][],
  length: number,
  /** Each model's weight at an axis index (`modelWeight`); equal when left out. */
  weightAt?: (model: number, index: number) => number,
): (number | null)[] {
  return Array.from({ length }, (_, index) => {
    const at = vectorsByModel.flatMap((vectors, model) => {
      const vector = vectors[index];
      return vector
        ? [{ ...vector, weight: weightAt ? weightAt(model, index) : 1 }]
        : [];
    });
    const mean = weightAt
      ? weightedVectorMean(at)
      : vectorMean(at.map(({ u, v }) => ({ u, v })));
    return mean === null || Math.hypot(mean.u, mean.v) < 0.1
      ? null
      : direction(mean.u, mean.v);
  });
}

/** Plain words for an agreement label; colour never carries this on its own. */
export function agreementLabel(agreement: Agreement | null): string {
  return agreement === "high"
    ? "models agree"
    : agreement === "moderate"
      ? "some spread"
      : agreement === "low"
        ? "models disagree"
        : "no data";
}
