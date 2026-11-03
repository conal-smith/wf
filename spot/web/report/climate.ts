/**
 * A spot's wind and waves through the year: the small static file
 * scripts/climate/build_climate.py writes for each spot from Copernicus
 * Marine's records of the past, read and checked here, and the words and
 * scales the spot page's charts of it share.
 */

/** Wind bands, in knots: 12-16, 16-22, 22-30, 30 and over. */
export const WIND_EDGES = [12, 16, 22, 30] as const;
/** The wave rose's periods, in seconds: under 6, 6-9, 9-12, 12 and over. */
export const ROSE_PERIODS = ["Under 6 s", "6 to 9 s", "9 to 12 s", "Over 12 s"] as const;
/**
 * The swell charts' periods: the rose's without the shortest. The rose's are
 * the whole sea's peak period; these are the swell's own mean period, the
 * wind's waves left out.
 */
export const SWELL_PERIODS = ["6 to 9 s", "9 to 12 s", "Over 12 s"] as const;
/** The swell chart's sizes, in metres, as the file orders them. */
export const SWELL_SIZES = [
  { value: "all", label: "0.3 m +", words: "0.3 m (1 ft) or more" },
  { value: "small", label: "0.6 to 1.2 m", words: "0.6 to 1.2 m (2 to 4 ft)" },
  { value: "mid", label: "1.2 to 1.8 m", words: "1.2 to 1.8 m (4 to 6 ft)" },
  { value: "big", label: "1.8 m +", words: "1.8 m (6 ft) or more" },
] as const;
export type SwellSize = (typeof SWELL_SIZES)[number]["value"];

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const CLIMATE_CREDIT =
  "Generated using E.U. Copernicus Marine Service Information";

export interface ClimateWind {
  /** The grid cell read, [lat, lon]. */
  at: [number, number];
  years: [number, number];
  /** Per month, the thousandths of all hours in each wind band. */
  months: number[][];
  /** Per sixteenth of the compass from north, thousandths of all hours in each band. */
  rose: number[][];
}

/**
 * A month of one period's swell: days a month, then the size of those days
 * (their 10th, 50th and 90th centile, metres) or nulls when there are too few.
 */
export type Candle = [number, number | null, number | null, number | null];

export interface ClimateWaves {
  /** The wave model's point the waves were read at. */
  at: [number, number];
  /** How far that point is from the spot. */
  km: number;
  years: [number, number];
  /** Per month, the whole sea's height (wind waves and swell): 10th, 50th and 90th centile, metres. */
  height: [number, number, number][];
  /** Per sixteenth of the compass, thousandths of all readings in each rose period (the whole sea). */
  rose: number[][];
  /** [size][period][month]: days a month with that swell, the swell alone, sized by the day's typical reading. */
  swell: number[][][];
  /** [period][month]. */
  candles: Candle[][];
}

export interface Climate {
  id: string;
  credit: string;
  wind: ClimateWind;
  waves?: ClimateWaves;
  /**
   * No waves because the open sea's do not reach the spot: a lake, a lough,
   * a lagoon behind a spit, the inside of a harbour. Any spot without waves
   * is read as one, since that is the only reason the build leaves them out.
   */
  sheltered: boolean;
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const grid = (v: unknown, rows: number, cols: number) =>
  Array.isArray(v) &&
  v.length === rows &&
  v.every((r) => Array.isArray(r) && r.length === cols && r.every(isNum));
const pair = (v: unknown) =>
  Array.isArray(v) && v.length === 2 && v.every(isNum);

/**
 * The file, or null when it is not one: a missing file comes back from the
 * host as a page, not a 404, so everything is checked before it is drawn.
 */
export function parseClimate(json: unknown): Climate | null {
  if (!json || typeof json !== "object") return null;
  const c = json as Record<string, unknown>;
  const w = c.wind as Record<string, unknown> | undefined;
  if (typeof c.id !== "string" || !w) return null;
  if (!pair(w.at) || !pair(w.years) || !grid(w.months, 12, 4) || !grid(w.rose, 16, 4))
    return null;
  const out: Climate = {
    id: c.id,
    credit: typeof c.credit === "string" ? c.credit : CLIMATE_CREDIT,
    wind: w as unknown as ClimateWind,
    sheltered: false,
  };
  const v = c.waves as Record<string, unknown> | undefined;
  if (v) {
    const okCandles =
      Array.isArray(v.candles) &&
      v.candles.length === SWELL_PERIODS.length &&
      v.candles.every(
        (row) =>
          Array.isArray(row) &&
          row.length === 12 &&
          row.every(
            (m) =>
              Array.isArray(m) &&
              m.length === 4 &&
              isNum(m[0]) &&
              m.slice(1).every((x) => x === null || isNum(x)),
          ),
      );
    const okSwell =
      Array.isArray(v.swell) &&
      v.swell.length === SWELL_SIZES.length &&
      v.swell.every((size) => grid(size, SWELL_PERIODS.length, 12));
    if (
      pair(v.at) &&
      pair(v.years) &&
      isNum(v.km) &&
      grid(v.height, 12, 3) &&
      grid(v.rose, 16, 4) &&
      okSwell &&
      okCandles
    )
      out.waves = v as unknown as ClimateWaves;
  }
  out.sheltered = !v;
  return out;
}

export const climatePath = (id: string) => `climate/${encodeURIComponent(id)}.json`;

/** A share of the time, as people say it: "38%", "under 1%", "none". */
export function percent(share: number): string {
  if (share <= 0) return "none";
  if (share < 0.005) return "under 1%";
  return `${Math.round(share * 100)}%`;
}

/** Days a month, as people say it. */
export function daysWords(days: number): string {
  if (days <= 0) return "none";
  if (days < 0.5) {
    const years = Math.round(1 / (days * 12));
    return years <= 1 ? "under a day" : `1 day in ${years} years`;
  }
  if (days < 1.5) return "1 day";
  return `${Math.round(days)} days`;
}

/** The number above a candle: whole days, "1", "<1" or nothing. */
export function daysFigure(days: number): string {
  if (days <= 0) return "";
  if (days < 0.5) return "<1";
  return String(Math.max(1, Math.round(days)));
}

export const feet = (m: number) => Math.round(m / 0.3048);

/** "1.4 m (5 ft)". */
export function metresWords(m: number): string {
  return `${m.toFixed(1)} m (${feet(m)} ft)`;
}

/** Gridlines for a scale from 0: a tidy step and the top it reaches. */
export function niceScale(max: number, ticks = 4): { step: number; top: number } {
  const raw = Math.max(max, 1e-6) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  return { step, top: Math.ceil(max / step - 1e-9) * step || step };
}

/** The sixteen points of the compass, from north. */
export const COMPASS16 = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;
