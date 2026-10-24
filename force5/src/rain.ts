// Rain: ICON-EU's hourly precipitation, as force5/ingest/fetch_icon_weather.py
// publishes it (weather/icon-eu-weather.json, one `precip` frame an hour), and
// what the chart's Rain layer and the dock's rain row make of it.
//
// A step's rain is the amount in the interval that ends at it, so it belongs
// to that interval and to no other hour. Both readers say it per hour: the
// dock's coarser columns and the map at such a column's hour average the
// steps inside the column, and a single step's own hour is its own amount.
//
// Nothing here fetches: src/rainData.ts reads the pointer and the frames, and
// only once a rider turns the layer on.
import { parseColour } from "./foilDepth";
import { forecastUrl } from "./urls";
import { runPath } from "./spotData";
import type { BundleFrame } from "./variables";
import type { Grid } from "./weather";

/** The weather run whose frames carry the rain. */
export const RAIN_MODEL = "icon-eu-weather";
export const RAIN_URL = "weather/icon-eu-weather.json";
/** The variable the frames carry. */
export const RAIN_VARIABLE = "precip";
/** Less than this in an hour is dry: ICON rounds to 0.1 mm, so this is none. */
export const DRY_MM_PER_HOUR = 0.05;
/** Where the map's drizzle starts to fade in, between a dry cell and a wet one. */
const FADE_FROM_MM = 0.02;
/** How far an interval's end may sit from a column's time and still be on it. */
const SLACK_MS = 60000;
const HOUR_MS = 3600000;

/**
 * The colours of the layer by intensity, in mm/h: barely there in drizzle,
 * a strong blue in heavy rain. Their values are the theme's (`--map-rain-*`,
 * ui/theme.css); between two stops the colour follows the logarithm of the
 * rate, so 0.2 and 0.4 mm/h differ as much as 2 and 4 do.
 */
export const RAIN_STOPS = [
  { mmPerHour: 0.1, token: "--map-rain-drizzle" },
  { mmPerHour: 0.5, token: "--map-rain-light" },
  { mmPerHour: 2, token: "--map-rain-moderate" },
  { mmPerHour: 8, token: "--map-rain-heavy" },
] as const;
/** The amounts the key shows a swatch for. */
export const RAIN_KEY_MM = [0.1, 0.5, 1, 2, 4, 8] as const;

/** One stop's colour, [r, g, b, a] with a from 0 to 1. */
export type RainRgba = readonly [number, number, number, number];

export interface RainFrame {
  model: string;
  run: string;
  hour: number;
  validTime: string;
  grid: Grid;
  precipIntervalHours: [number, number] | null;
  /** Millimetres in the interval, per cell, rows north to south; null where none. */
  precip: (number | null)[];
}

/** What the map draws: the mm/h of every cell over some hours, on one grid. */
export interface RainView {
  /** Changes whenever the picture would: the run and the hours averaged. */
  key: string;
  grid: Grid;
  /** mm/h per cell, rows north to south; NaN where nothing is known. */
  rates: Float32Array;
  /** The hours the rates are the mean of: [start, end] in UTC milliseconds. */
  from: number;
  to: number;
}

/** A step's interval, from its end and its declared span (or the step before). */
export interface RainInterval {
  start: number;
  end: number;
}

/**
 * Each step's interval: from its declared `precipIntervalHours`, else from the
 * step before it, else (a series of one step) an hour. Initialization has an
 * interval of none (start = end), so it is never inside a column's span.
 */
export function rainIntervals(
  steps: readonly {
    validTime: string;
    precipIntervalHours?: readonly [number, number] | null;
  }[],
): RainInterval[] {
  const ends = steps.map((step) => Date.parse(step.validTime));
  return steps.map((step, k) => {
    const span = step.precipIntervalHours;
    const end = ends[k];
    if (Array.isArray(span) && span[1] > span[0])
      return { start: end - (span[1] - span[0]) * HOUR_MS, end };
    if (span === null) return { start: end, end };
    if (k > 0) return { start: ends[k - 1], end };
    return {
      start: end - (ends.length > 1 ? ends[1] - ends[0] : HOUR_MS),
      end,
    };
  });
}

/**
 * The steps whose intervals lie inside (from, to]: their ends in it and their
 * starts not before `from`, in order. Empty when none does, as when the span
 * sits inside one longer interval (an hourly column in a three-hour step).
 */
export function stepsWithin(
  intervals: readonly RainInterval[],
  from: number,
  to: number,
): number[] {
  const out: number[] = [];
  intervals.forEach(({ start, end }, k) => {
    if (end <= start) return;
    if (
      end > from + SLACK_MS &&
      end <= to + SLACK_MS &&
      start >= from - SLACK_MS
    )
      out.push(k);
  });
  return out;
}

/**
 * The step whose interval holds `time`, for a time inside a longer interval:
 * the first ending at or after it whose interval starts before it.
 */
export function stepCovering(
  intervals: readonly RainInterval[],
  time: number,
): number | null {
  const k = intervals.findIndex(({ end }) => end >= time - SLACK_MS);
  if (k < 0) return null;
  const { start, end } = intervals[k];
  if (Math.abs(time - end) <= SLACK_MS) return end > start ? k : null;
  return time > start + SLACK_MS ? k : null;
}

/** Hours between two instants, to the nearest hour. */
export const hoursBetween = (start: number, end: number) =>
  Math.max(1, Math.round((end - start) / HOUR_MS));

/**
 * A dock cell's tint, 0 to 1: the square root of the rate against 4 mm/h,
 * so a wet hour of 0.2 mm shows and a downpour does not need a scale of its
 * own. Hourly amounts are a few tenths in most Irish rain and 4 mm is heavy.
 */
export const RAIN_FULL_MM_PER_HOUR = 4;
export const rainTint = (mmPerHour: number) =>
  mmPerHour < DRY_MM_PER_HOUR
    ? 0
    : Math.min(1, Math.sqrt(mmPerHour / RAIN_FULL_MM_PER_HOUR));

/** "0", "0.4" or "<0.1": an amount per hour as a cell prints it. */
export function rainFigure(mmPerHour: number, total: number): string {
  if (total < DRY_MM_PER_HOUR) return "0";
  if (mmPerHour < DRY_MM_PER_HOUR) return "<0.1";
  return mmPerHour.toFixed(1);
}

/** The frame whose interval ends at `time`, or holds it; null past the run. */
export function rainFrameAt(
  frames: readonly BundleFrame[],
  time: number,
): BundleFrame | null {
  const k = stepCovering(rainIntervals(frames), time);
  return k === null ? null : frames[k];
}

/**
 * The frames the map averages for a column at `to` whose span starts at
 * `from`: those inside the span, or else the one holding `to`. Empty when
 * the run does not reach the hour or has no rain for it (initialization).
 */
export function rainFramesFor(
  frames: readonly BundleFrame[],
  from: number,
  to: number,
): BundleFrame[] {
  const intervals = rainIntervals(frames);
  const inside = stepsWithin(intervals, from, to);
  if (inside.length) return inside.map((k) => frames[k]);
  const k = stepCovering(intervals, to);
  return k === null ? [] : [frames[k]];
}

/** A frame's URL, beside its pointer. */
export const rainFrameUrl = (base: string, frame: BundleFrame) =>
  forecastUrl(runPath(RAIN_URL, base, frame.url));

/** A frame as published, or an error: the right run, hour and size, amounts in range. */
export function validateRainFrame(
  frame: RainFrame,
  manifest: { run: string; grid?: Grid },
  info: BundleFrame,
): RainFrame {
  const grid = manifest.grid;
  const count = grid ? grid.width * grid.height : -1;
  const usable = (value: unknown) =>
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 500);
  if (
    !frame ||
    frame.run !== manifest.run ||
    frame.hour !== info.hour ||
    !Array.isArray(frame.precip) ||
    frame.precip.length !== count ||
    !frame.precip.every(usable)
  )
    throw new Error("Invalid rain frame. Refresh the weather forecast.");
  return frame;
}

/**
 * The mean rate over some frames, cell by cell, in mm/h: their amounts added
 * and divided by the hours they cover. A cell any of them does not know is
 * NaN, so it is left undrawn rather than drawn too dry.
 */
export function rainRates(
  frames: readonly Pick<
    RainFrame,
    "precip" | "precipIntervalHours" | "validTime"
  >[],
): Float32Array {
  const count = frames[0]?.precip.length ?? 0;
  const rates = new Float32Array(count);
  const intervals = rainIntervals(frames);
  const hours = intervals.reduce(
    (sum, { start, end }) => sum + Math.max(0, end - start) / HOUR_MS,
    0,
  );
  for (let i = 0; i < count; i++) {
    let total = 0;
    let known = hours > 0;
    for (const frame of frames) {
      const value = frame.precip[i];
      if (typeof value !== "number") {
        known = false;
        break;
      }
      total += value;
    }
    rates[i] = known ? total / hours : NaN;
  }
  return rates;
}

/** The ramp's colours, read from the theme (or given, in a test). */
export function rainRamp(
  read: (token: string) => string,
): { mmPerHour: number; rgba: RainRgba }[] {
  return RAIN_STOPS.map(({ mmPerHour, token }) => ({
    mmPerHour,
    rgba: parseColour(read(token)) ?? [0, 0, 0, 0],
  }));
}

/**
 * The colour of a rate: nothing where it is dry or unknown, the first stop's
 * faint blue at drizzle (fading in just under it), the last stop's at heavy
 * rain and above, and in between the colour along the logarithm of the rate.
 */
export function rainColour(
  ramp: readonly { mmPerHour: number; rgba: RainRgba }[],
  mmPerHour: number,
): RainRgba | null {
  if (!(mmPerHour >= FADE_FROM_MM) || !ramp.length) return null;
  if (mmPerHour <= ramp[0].mmPerHour) {
    // Between a dry cell and a wet one the drizzle fades in rather than
    // stepping in a cell's square: the model's tenths of a millimetre would
    // otherwise draw the edge of every shower as a staircase.
    const [r, g, b, a] = ramp[0].rgba;
    const t = Math.min(
      1,
      (mmPerHour - FADE_FROM_MM) / (ramp[0].mmPerHour - FADE_FROM_MM),
    );
    return [r, g, b, a * t];
  }
  const last = ramp[ramp.length - 1];
  if (mmPerHour >= last.mmPerHour) return last.rgba;
  const at = ramp.findIndex((stop) => stop.mmPerHour >= mmPerHour);
  const a = ramp[at - 1];
  const b = ramp[at];
  const t =
    (Math.log(mmPerHour) - Math.log(a.mmPerHour)) /
    (Math.log(b.mmPerHour) - Math.log(a.mmPerHour));
  return a.rgba.map((v, i) => v + (b.rgba[i] - v) * t) as unknown as RainRgba;
}

/** Mercator y of a latitude, in radians of the projection. */
const mercator = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latitude = (y: number) =>
  (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);

/** The table's span: from where the drizzle fades in to well past heavy. */
const TABLE_SIZE = 256;
const TABLE_LOW = Math.log(FADE_FROM_MM);
const TABLE_HIGH = Math.log(16);

/** A rate's place in the table, or -1 where nothing is drawn. */
function tableIndex(mmPerHour: number) {
  if (!(mmPerHour >= FADE_FROM_MM)) return -1;
  const t = (Math.log(mmPerHour) - TABLE_LOW) / (TABLE_HIGH - TABLE_LOW);
  return Math.min(TABLE_SIZE - 1, Math.round(t * (TABLE_SIZE - 1)));
}

/** `rainColour` at each of the table's rates, as RGBA bytes. */
function rainTable(ramp: readonly { mmPerHour: number; rgba: RainRgba }[]) {
  const table = new Uint8ClampedArray(TABLE_SIZE * 4);
  for (let k = 0; k < TABLE_SIZE; k++) {
    const rate = Math.exp(
      TABLE_LOW + ((TABLE_HIGH - TABLE_LOW) * k) / (TABLE_SIZE - 1),
    );
    const colour = rainColour(ramp, rate);
    if (!colour) continue;
    table.set(
      [colour[0], colour[1], colour[2], Math.round(colour[3] * 255)],
      k * 4,
    );
  }
  return table;
}

export interface RainImage {
  width: number;
  height: number;
  /** RGBA, row by row from the north, as an ImageData takes it. */
  data: Uint8ClampedArray;
  /** The image's corners for a MapLibre image source: NW, NE, SE, SW. */
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
}

/**
 * The layer's picture: the grid's rates coloured, on rows evenly spaced in
 * Mercator (the map's own projection, which a latitude grid is not), `scale`
 * pixels to a cell each way and sampled bilinearly between cells. Its edge
 * fades over a few cells rather than stopping in a straight line, and a cell
 * that is dry or unknown is transparent, so the chart shows through.
 */
export function rainImage(
  grid: Grid,
  rates: Float32Array,
  ramp: readonly { mmPerHour: number; rgba: RainRgba }[],
  scale = 2,
): RainImage {
  const width = Math.max(2, Math.round(grid.width * scale));
  const yN = mercator(grid.north);
  const yS = mercator(grid.south);
  // As many rows as the finest cell (the southern, in Mercator) needs.
  const finest = mercator(grid.south + grid.dy) - yS;
  const height = Math.max(2, Math.ceil(((yN - yS) / finest + 1) * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  const feather = 4;
  // The ramp read once into a table along the logarithm of the rate, so a
  // picture of a quarter of a million pixels costs no logarithm each.
  const lut = rainTable(ramp);
  const w = grid.width;
  for (let row = 0; row < height; row++) {
    const lat = latitude(yN + ((yS - yN) * (row + 0.5)) / height);
    const fy = Math.min(
      grid.height - 1,
      Math.max(0, (grid.north - lat) / grid.dy),
    );
    const y0 = Math.floor(fy);
    const y1 = Math.min(grid.height - 1, y0 + 1);
    const ty = fy - y0;
    const edgeY = Math.min(fy, grid.height - 1 - fy) / feather;
    for (let col = 0; col < width; col++) {
      const fx = ((col + 0.5) / width) * (w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      // Bilinear; an unknown corner (NaN) is left out and the rest reweighted.
      const a = rates[y0 * w + x0];
      const b = rates[y0 * w + x1];
      const c = rates[y1 * w + x0];
      const d = rates[y1 * w + x1];
      const ka = a === a ? (1 - tx) * (1 - ty) : 0;
      const kb = b === b ? tx * (1 - ty) : 0;
      const kc = c === c ? (1 - tx) * ty : 0;
      const kd = d === d ? tx * ty : 0;
      const weight = ka + kb + kc + kd;
      if (!weight) continue;
      const sum =
        (ka && a * ka) + (kb && b * kb) + (kc && c * kc) + (kd && d * kd);
      const at = tableIndex(sum / weight);
      if (at < 0) continue;
      const edge = Math.min(1, edgeY, Math.min(fx, w - 1 - fx) / feather);
      const i = (row * width + col) * 4;
      data[i] = lut[at * 4];
      data[i + 1] = lut[at * 4 + 1];
      data[i + 2] = lut[at * 4 + 2];
      data[i + 3] = Math.round(lut[at * 4 + 3] * Math.max(0, edge));
    }
  }
  const { west, east, north, south } = grid;
  return {
    width,
    height,
    data,
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}
