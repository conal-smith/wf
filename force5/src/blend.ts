// Probability blend: put every selected model and ensemble member on one hourly
// axis, then reduce them to per-hour statistics that both the ribbon and the
// candle view draw from. All speeds stay in metres per second.
import { framePosition } from "./timeline";
import { KNOTS } from "./units";
import { modelSeries, type SeriesPoint } from "./series";
import type { Manifest } from "./weather";

export type Agreement = "high" | "moderate" | "low";
/** Spread thresholds in knots: how far apart the lines may sit and still agree. */
export const AGREEMENT_HIGH_KN = 4;
export const AGREEMENT_MODERATE_KN = 8;
/** Guard against an accidental multi-year axis. */
export const MAX_AXIS_POINTS = 2000;

const HOUR = 3600000;
const time = (value: string | number | Date) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

export interface AxisOptions {
  from?: string | number | Date;
  to?: string | number | Date;
  stepHours?: number;
  /** `union` spans every model, `intersection` only the hours all of them cover. */
  coverage?: "union" | "intersection";
}

/** First and last time a manifest covers, from frames or from its spot series. */
export function manifestRange(
  manifest: Manifest,
): { from: number; to: number } | null {
  const ends: number[] = [];
  const frames = manifest.frames ?? [];
  if (frames.length)
    ends.push(
      Date.parse(frames[0].validTime),
      Date.parse(frames[frames.length - 1].validTime),
    );
  for (const group of [manifest.spotForecasts, manifest.spotMembers])
    for (const series of Object.values(group ?? {}))
      if (series.length)
        ends.push(
          Date.parse(series[0].validTime),
          Date.parse(series[series.length - 1].validTime),
        );
  const valid = ends.filter(Number.isFinite);
  if (!valid.length) return null;
  return { from: Math.min(...valid), to: Math.max(...valid) };
}

/** Shared hourly axis for the selected models, as ISO timestamps. */
export function commonAxis(
  manifests: readonly Manifest[],
  options: AxisOptions = {},
): string[] {
  const stepMs = (options.stepHours ?? 1) * HOUR;
  if (!(stepMs > 0)) throw new Error("Axis step must be positive.");
  const ranges = manifests
    .map(manifestRange)
    .filter((range): range is { from: number; to: number } => range !== null);
  if (!ranges.length) return [];
  const intersect = options.coverage === "intersection";
  let from = intersect
    ? Math.max(...ranges.map((r) => r.from))
    : Math.min(...ranges.map((r) => r.from));
  let to = intersect
    ? Math.min(...ranges.map((r) => r.to))
    : Math.max(...ranges.map((r) => r.to));
  if (options.from !== undefined) from = Math.max(from, time(options.from));
  if (options.to !== undefined) to = Math.min(to, time(options.to));
  const axis: string[] = [];
  for (
    let t = Math.ceil(from / stepMs) * stepMs;
    t <= to && axis.length < MAX_AXIS_POINTS;
    t += stepMs
  )
    axis.push(new Date(t).toISOString());
  return axis;
}

function medianStepHours(
  series: readonly Pick<SeriesPoint, "validTime">[],
): number {
  const steps: number[] = [];
  for (let i = 1; i < series.length; i++)
    steps.push(
      (Date.parse(series[i].validTime) - Date.parse(series[i - 1].validTime)) /
        HOUR,
    );
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return steps[Math.floor((steps.length - 1) / 2)];
}

/**
 * How long a gap interpolation may bridge: twice the model's median cadence,
 * which covers ECMWF's 3 → 6 hour tail but never a genuinely missing block.
 */
export const bridgeableGapHours = (
  series: readonly Pick<SeriesPoint, "validTime">[],
) => 2 * medianStepHours(series);

export interface SeriesValues {
  speed: (number | null)[];
  gust: (number | null)[];
}

/**
 * Put one series on the axis. Wind is interpolated in u/v space, never between
 * speeds or wrapped bearings, so a veering wind keeps its vector average.
 * Times outside the series, and gaps wider than the model's cadence, are null.
 */
export function interpolateSeries(
  series: readonly SeriesPoint[],
  axisTimes: readonly string[],
  options: { maxGapHours?: number } = {},
): SeriesValues {
  const maxGap = options.maxGapHours ?? bridgeableGapHours(series);
  const speed: (number | null)[] = [];
  const gust: (number | null)[] = [];
  for (const iso of axisTimes) {
    const position = framePosition(series, Date.parse(iso));
    if (position === null) {
      speed.push(null);
      gust.push(null);
      continue;
    }
    const index = Math.floor(position);
    const fraction = position - index;
    const a = series[index];
    if (fraction === 0) {
      speed.push(Math.hypot(a.u, a.v));
      gust.push(a.gust);
      continue;
    }
    const b = series[index + 1];
    const gapHours = (Date.parse(b.validTime) - Date.parse(a.validTime)) / HOUR;
    if (gapHours > maxGap + 1e-9) {
      speed.push(null);
      gust.push(null);
      continue;
    }
    const u = a.u + (b.u - a.u) * fraction;
    const v = a.v + (b.v - a.v) * fraction;
    speed.push(Math.hypot(u, v));
    gust.push(
      a.gust === null || b.gust === null
        ? null
        : a.gust + (b.gust - a.gust) * fraction,
    );
  }
  return { speed, gust };
}

export interface BlendInput {
  model: string;
  /** Present for one ensemble member; absent for a deterministic model. */
  memberIndex?: number;
  speed: (number | null)[];
  gust: (number | null)[];
}

/** One input line per deterministic model and per ensemble member. */
export function blendInputs(
  manifests: readonly Manifest[],
  spotId: string,
  selectedModelIds: readonly string[],
  axis: readonly string[],
  options: { maxGapHours?: number } = {},
): BlendInput[] {
  const inputs: BlendInput[] = [];
  for (const id of selectedModelIds) {
    const manifest = manifests.find((m) => m.model === id);
    if (!manifest) continue;
    for (const line of modelSeries(manifest, spotId)) {
      const values = interpolateSeries(line.points, axis, options);
      inputs.push({
        model: id,
        ...(line.memberIndex === undefined
          ? {}
          : { memberIndex: line.memberIndex }),
        speed: values.speed,
        gust: values.gust,
      });
    }
  }
  return inputs;
}

/** Linear-interpolated order statistic (the numpy/Excel default definition). */
export function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function agreementFor(spreadMps: number): Agreement {
  const knots = spreadMps * KNOTS;
  if (knots < AGREEMENT_HIGH_KN) return "high";
  if (knots < AGREEMENT_MODERATE_KN) return "moderate";
  return "low";
}

export interface GustStats {
  n: number;
  min: number | null;
  max: number | null;
  median: number | null;
}
export interface HourStats {
  time: string;
  n: number;
  min: number | null;
  max: number | null;
  q25: number | null;
  median: number | null;
  q75: number | null;
  mean: number | null;
  /** Full range, max − min, in m/s; the agreement label reads it in knots. */
  spread: number | null;
  agreement: Agreement | null;
  gust: GustStats;
}

const EMPTY_GUST: GustStats = { n: 0, min: null, max: null, median: null };

/** Per-hour distribution across every input line; hours with no data keep n 0. */
export function blendStats(
  inputs: readonly BlendInput[],
  axis: readonly string[],
): HourStats[] {
  return axis.map((iso, i) => {
    const speeds = inputs
      .map((input) => input.speed[i])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    const gusts = inputs
      .map((input) => input.gust[i])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    const gust: GustStats = gusts.length
      ? {
          n: gusts.length,
          min: gusts[0],
          max: gusts[gusts.length - 1],
          median: quantile(gusts, 0.5),
        }
      : EMPTY_GUST;
    if (!speeds.length)
      return {
        time: iso,
        n: 0,
        min: null,
        max: null,
        q25: null,
        median: null,
        q75: null,
        mean: null,
        spread: null,
        agreement: null,
        gust,
      };
    const min = speeds[0];
    const max = speeds[speeds.length - 1];
    const spread = max - min;
    return {
      time: iso,
      n: speeds.length,
      min,
      max,
      q25: quantile(speeds, 0.25),
      median: quantile(speeds, 0.5),
      q75: quantile(speeds, 0.75),
      mean: speeds.reduce((sum, v) => sum + v, 0) / speeds.length,
      spread,
      agreement: agreementFor(spread),
      gust,
    };
  });
}

export interface Candle {
  time: string;
  /** Number of axis columns the candle covers. */
  hours: number;
  /** Which axis columns they are, so a chart can measure the candle's width. */
  columns: readonly number[];
  lo: number;
  hi: number;
  q25: number;
  q75: number;
  median: number;
  gust: { lo: number; hi: number } | null;
}

/** Group an hourly statistics array into fixed-width candle columns. */
export function candles(stats: readonly HourStats[], stepHours = 3): Candle[] {
  if (!Number.isInteger(stepHours) || stepHours < 1)
    throw new Error("Candle width must be a whole number of hours.");
  const groups: number[][] = [];
  for (let start = 0; start < stats.length; start += stepHours)
    groups.push(
      Array.from(
        { length: Math.min(stepHours, stats.length - start) },
        (_, offset) => start + offset,
      ),
    );
  return candlesOver(stats, groups);
}

/**
 * The same reduction over explicit column groups. The dock's axis changes
 * cadence at the seam between two runs, so the number of columns a three-hour
 * candle covers is not the same all the way along it.
 */
export function candlesOver(
  stats: readonly HourStats[],
  groups: readonly (readonly number[])[],
): Candle[] {
  const out: Candle[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    const start = group[0];
    const window = group
      .map((index) => stats[index])
      .filter((hour) => hour !== undefined && hour.n > 0);
    if (!window.length) continue;
    const medians = window
      .map((hour) => hour.median as number)
      .sort((a, b) => a - b);
    const gusts = window.filter((hour) => hour.gust.n > 0);
    out.push({
      time: stats[start].time,
      hours: group.length,
      columns: group,
      lo: Math.min(...window.map((hour) => hour.min as number)),
      hi: Math.max(...window.map((hour) => hour.max as number)),
      q25: Math.min(...window.map((hour) => hour.q25 as number)),
      q75: Math.max(...window.map((hour) => hour.q75 as number)),
      median: quantile(medians, 0.5),
      gust: gusts.length
        ? {
            lo: Math.min(...gusts.map((hour) => hour.gust.min as number)),
            hi: Math.max(...gusts.map((hour) => hour.gust.max as number)),
          }
        : null,
    });
  }
  return out;
}

export interface PlotScale {
  pxPerHour: number;
  /** Value in m/s to a y coordinate; build one with `linearScale`. */
  y: (value: number) => number;
  /** Left edge of the first axis hour, default 0. */
  x0?: number;
  /** Axis spacing, default 1 hour. */
  stepHours?: number;
}
export interface PlotPoint {
  x: number;
  y: number;
  index: number;
}

/** Value scale, clamped so out-of-domain data cannot escape the plot box. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number) => {
    const t = span === 0 ? 0 : (value - d0) / span;
    return r0 + (r1 - r0) * Math.max(0, Math.min(1, t));
  };
}

export const plotX = (index: number, scale: PlotScale) =>
  (scale.x0 ?? 0) + index * (scale.stepHours ?? 1) * scale.pxPerHour;

/** Contiguous runs of defined values, so gaps break the line instead of jumping. */
export function pathPoints(
  values: readonly (number | null)[],
  scale: PlotScale,
): PlotPoint[][] {
  const segments: PlotPoint[][] = [];
  let current: PlotPoint[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: plotX(index, scale), y: scale.y(value), index });
  });
  if (current.length) segments.push(current);
  return segments;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** SVG `d` for a line, one subpath per gap-free run. */
export function pathData(
  values: readonly (number | null)[],
  scale: PlotScale,
): string {
  return pathPoints(values, scale)
    .map((segment) =>
      segment
        .map(
          (point, i) =>
            `${i === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`,
        )
        .join(" "),
    )
    .join(" ");
}

/** SVG `d` for a filled band between two series, closed per gap-free run. */
export function bandPath(
  lower: readonly (number | null)[],
  upper: readonly (number | null)[],
  scale: PlotScale,
): string {
  const paired = lower.map((value, i) =>
    value === null || upper[i] === null ? null : value,
  );
  return pathPoints(paired, scale)
    .map((segment) => {
      const top = segment.map(
        (point) => `${round(point.x)} ${round(scale.y(upper[point.index]!))}`,
      );
      const bottom = [...segment]
        .reverse()
        .map((point) => `${round(point.x)} ${round(point.y)}`);
      return `M${[...top, ...bottom].join(" L")} Z`;
    })
    .join(" ");
}
