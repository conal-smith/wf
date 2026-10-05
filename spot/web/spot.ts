/**
 * The spot page's arithmetic, apart from React so it can be tested on its own:
 * which hours become rows, how they group into Irish days, what each day comes
 * to, what the shore wants from the wind, and the tide and daylight a day's
 * chart draws. Everything here is pure; times are UTC milliseconds and every
 * label is Irish local time, as everywhere on the site.
 */
import {
  bestWindow,
  rateHour,
  windBand,
  shoreAngle,
  type HourRating,
  type Rider,
  type ShoreAngle,
  type StarWindow,
} from "../../force5/src/stars";
import { sunTimes } from "../../force5/src/sun";
import { KNOTS, convert, type Units } from "../../force5/src/units";
import {
  rideChance,
  type ForecastHour,
  type SpotForecast,
} from "../../mcp/api/forecast";

export const HOUR = 3600000;
export const TIME_ZONE = "Europe/Dublin";
/** Rows are hourly this far ahead, where the finer models are; three-hourly after. */
export const HOURLY_AHEAD_HOURS = 72;
/** Days the page forecasts, today included. */
export const FORECAST_DAYS = 7;
/**
 * How far before today's midnight the forecast is asked for. Nothing that early
 * becomes a row: it is there so the first tide of the day has the turn before
 * it to be interpolated from.
 */
export const LEAD_HOURS = 12;

// ---- Irish time -------------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-11": the Irish calendar day an instant falls on. */
export const dublinDate = (time: number) => dateFormat.format(new Date(time));

/** "07:40", Irish time. */
export const clock = (time: number) => hourFormat.format(new Date(time));

/** The Irish hour of the day, 0–23. */
export const dublinHour = (time: number) =>
  Number(hourFormat.format(new Date(time)).slice(0, 2));

/** Minutes since Irish midnight, for laying a day out on a 24-hour axis. */
export function dublinMinutes(time: number): number {
  const [h, m] = hourFormat.format(new Date(time)).split(":").map(Number);
  return h * 60 + m;
}

/**
 * The instant an Irish calendar day starts. Found by walking the hours around
 * UTC midnight rather than by assuming an offset, so the two days a year the
 * clocks change come out right too.
 */
export function dublinMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  for (let t = utc - 3 * HOUR; t <= utc + 3 * HOUR; t += HOUR / 4)
    if (dublinDate(t) === date && dublinMinutes(t) === 0) return t;
  return utc;
}

/** The next Irish day's midnight: 23, 24 or 25 hours on. */
export const nextMidnight = (date: string) =>
  dublinMidnight(dublinDate(dublinMidnight(date) + 26 * HOUR));

const dayFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IE", { timeZone: TIME_ZONE, ...options });
const weekdayShort = dayFormat({ weekday: "short" });
const weekdayLong = dayFormat({ weekday: "long" });
const dayMonth = dayFormat({ day: "numeric", month: "short" });
const dayMonthLong = dayFormat({ day: "numeric", month: "long" });

export interface DayNames {
  /** "Sat" */
  short: string;
  /** "Saturday" */
  long: string;
  /** "11 Oct" */
  date: string;
  /** "Saturday 11 October" */
  full: string;
  /** "Today", "Tomorrow" or the weekday. */
  relative: string;
}

export function dayNames(date: string, now: number): DayNames {
  const noon = dublinMidnight(date) + 12 * HOUR;
  const today = dublinDate(now);
  const tomorrow = dublinDate(dublinMidnight(today) + 36 * HOUR);
  const long = weekdayLong.format(noon);
  return {
    short: weekdayShort.format(noon),
    long,
    date: dayMonth.format(noon),
    full: `${long} ${dayMonthLong.format(noon)}`,
    relative: date === today ? "Today" : date === tomorrow ? "Tomorrow" : long,
  };
}

// ---- compass ----------------------------------------------------------------

const COMPASS = [
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
];
export const compass = (degrees: number) =>
  COMPASS[((Math.round(degrees / 22.5) % 16) + 16) % 16];

export interface WindArc {
  /** Compass points at either end, inclusive, clockwise. */
  from: string;
  to: string;
  /** Bearings of the same ends, for the dial. */
  fromDeg: number;
  toDeg: number;
}

/**
 * The runs of compass points, clockwise, whose wind meets the shore at one of
 * `angles`: the arcs the dial paints and the words the header says.
 */
export function windArcs(
  facing: number,
  angles: readonly ShoreAngle[],
): WindArc[] {
  const good = COMPASS.map((_, i) =>
    angles.includes(shoreAngle(i * 22.5, facing)),
  );
  if (good.every(Boolean))
    return [{ from: "N", to: "NNW", fromDeg: 0, toDeg: 337.5 }];
  // Start just after a point that is out, so no arc is cut in two at north.
  const start = good.findIndex((ok) => !ok);
  const arcs: WindArc[] = [];
  let open: number | null = null;
  for (let step = 1; step <= 16; step++) {
    const i = (start + step) % 16;
    if (good[i] && open === null) open = i;
    if ((!good[i] || step === 16) && open !== null) {
      const last = good[i] ? i : (i + 15) % 16;
      arcs.push({
        from: COMPASS[open],
        to: COMPASS[last],
        fromDeg: open * 22.5,
        toDeg: last * 22.5,
      });
      open = null;
    }
  }
  return arcs;
}

/** What the wind wants to be at this shore: cross and cross-on. */
export const goodWindArcs = (facing: number) =>
  windArcs(facing, ["cross-on", "cross"]);

const arcText = (arc: WindArc) =>
  arc.from === arc.to ? arc.from : `${arc.from}–${arc.to}`;

/**
 * "Faces WNW · best in SSW–WSW or NNW–NE winds": the shore in one line, from
 * the same angles the stars rate it on. Null where the facing is not known.
 */
export function shoreSummary(facing: number | null): string | null {
  if (facing === null) return null;
  const arcs = goodWindArcs(facing);
  const best = arcs.length
    ? ` · best in ${arcs.map(arcText).join(" or ")} winds`
    : "";
  return `Faces ${compass(facing)}${best}`;
}

// ---- wind -------------------------------------------------------------------

/** A speed in knots, in the reader's units, rounded as the dock rounds it. */
export function windIn(knots: number, units: Units): number {
  if (units === "kn") return Math.round(knots);
  const value = convert(knots / KNOTS, units);
  return units === "m/s" ? Math.round(value * 10) / 10 : Math.round(value);
}

/** Vector mean of bearings, weighted by speed, so SW and W make WSW, not E. */
export function meanBearing(
  readings: readonly { deg: number; weight: number }[],
): number | null {
  let x = 0;
  let y = 0;
  for (const { deg, weight } of readings) {
    x += weight * Math.sin((deg * Math.PI) / 180);
    y += weight * Math.cos((deg * Math.PI) / 180);
  }
  if (Math.hypot(x, y) < 1e-9) return null;
  return ((((Math.atan2(x, y) * 180) / Math.PI) % 360) + 360) % 360;
}

// ---- rows and days ----------------------------------------------------------

export interface SpotRow {
  time: number;
  /** Hours this row stands for: 1 near, 3 further out. */
  step: number;
  hour: ForecastHour;
  /** Null in the dark, or with no wind reading. */
  rating: HourRating | null;
  /** How the wind meets the shore, rated or not; null where unknown. */
  shore: ShoreAngle | null;
  /**
   * The chance it rides, 0–100: the share of ensemble members whose rideable
   * wind reaches this rider's floor. Null where no ensemble reaches the hour.
   */
  chance: number | null;
}

/**
 * The chance for this rider: re-rated from the members when the forecast kept
 * them, as the page asks it to, or the reduction's own figure (rated for the
 * 80 kg intermediate) when it did not.
 */
export function hourChance(hour: ForecastHour, rider: Rider): number | null {
  const ensemble = hour.ensemble;
  if (!ensemble) return null;
  return ensemble.samples
    ? rideChance(ensemble.samples, rider)
    : ensemble.chance_pct;
}

/** Rate one forecast hour for a rider at a shore, from the consensus line. */
export function rateForecastHour(
  hour: ForecastHour,
  facing: number | null,
  rider: Rider,
): HourRating | null {
  const wind = hour.wind;
  return rateHour(
    {
      windKn: wind?.wind_kn ?? null,
      gustKn: wind?.gust_kn ?? null,
      from: wind?.direction_deg ?? null,
      agreement: wind?.agreement ?? null,
      daylight: hour.daylight,
    },
    { facing },
    rider,
  );
}

/**
 * The hours that become rows: from the top of the current hour, every hour for
 * the first three days and every third Irish hour after that, where the models
 * themselves step three-hourly and an hourly row would only be interpolation.
 */
export function rowHours(
  hours: readonly ForecastHour[],
  now: number,
  hourlyAhead = HOURLY_AHEAD_HOURS,
): { hour: ForecastHour; time: number; step: number }[] {
  const start = Math.floor(now / HOUR) * HOUR;
  const fine = start + hourlyAhead * HOUR;
  return hours.flatMap((hour) => {
    const time = Date.parse(hour.time);
    if (time < start) return [];
    if (time < fine) return [{ hour, time, step: 1 }];
    return dublinHour(time) % 3 === 0 ? [{ hour, time, step: 3 }] : [];
  });
}

export function spotRows(
  hours: readonly ForecastHour[],
  now: number,
  facing: number | null,
  rider: Rider,
): SpotRow[] {
  return rowHours(hours, now).map(({ hour, time, step }) => ({
    time,
    step,
    hour,
    rating: rateForecastHour(hour, facing, rider),
    shore:
      facing === null || !hour.wind
        ? null
        : shoreAngle(hour.wind.direction_deg, facing),
    chance: hourChance(hour, rider),
  }));
}

export interface WindowSummary {
  stars: number;
  /** First row of the window, and the instant it ends (exclusive). */
  from: number;
  to: number;
  /** The wing the window's first hour assumes: the rider's own, or the pick. */
  wing: number;
  own: boolean;
  rating: HourRating;
}

/** The best stretch in some rows, rated on its weakest, as the dock rates it. */
export function bestIn(rows: readonly SpotRow[]): WindowSummary | null {
  const window: StarWindow | null = bestWindow(rows.map((row) => row.rating));
  if (!window) return null;
  const first = rows[window.from];
  const last = rows[window.to];
  const rating = first.rating!;
  return {
    stars: window.stars,
    from: first.time,
    to: last.time + last.step * HOUR,
    wing: rating.wing.own ?? rating.wing.recommended,
    own: rating.wing.own !== null,
    rating,
  };
}

export interface SpotDay {
  date: string;
  rows: SpotRow[];
  /** The best solid stars of any daylight row, and the most the wind offered. */
  stars: number;
  potential: number;
  /** Daylight wind: lowest mean, highest mean, highest gust, in knots. */
  windMin: number | null;
  windMax: number | null;
  gustMax: number | null;
  /** The day's prevailing wind, from the daylight rows. */
  direction: number | null;
  best: WindowSummary | null;
  /** Whether any row of the day has a wind reading at all. */
  hasWind: boolean;
}

/** Rows grouped by Irish calendar day, each with what the day comes to. */
export function groupDays(rows: readonly SpotRow[]): SpotDay[] {
  const byDate = new Map<string, SpotRow[]>();
  for (const row of rows) {
    const date = dublinDate(row.time);
    byDate.set(date, [...(byDate.get(date) ?? []), row]);
  }
  return [...byDate].map(([date, dayRows]) => summariseDay(date, dayRows));
}

export function summariseDay(date: string, rows: SpotRow[]): SpotDay {
  const light = rows.filter((row) => row.hour.daylight && row.hour.wind);
  const winds = light.map((row) => row.hour.wind!);
  const gusts = winds.flatMap((w) => (w.gust_kn === null ? [] : [w.gust_kn]));
  const rated = rows.flatMap((row) => (row.rating ? [row.rating] : []));
  return {
    date,
    rows,
    stars: Math.max(0, ...rated.map((r) => r.stars)),
    potential: Math.max(0, ...rated.map((r) => r.potential)),
    windMin: winds.length ? Math.min(...winds.map((w) => w.wind_kn)) : null,
    windMax: winds.length ? Math.max(...winds.map((w) => w.wind_kn)) : null,
    gustMax: gusts.length ? Math.max(...gusts) : null,
    direction: meanBearing(
      winds.map((w) => ({ deg: w.direction_deg, weight: w.wind_kn })),
    ),
    best: bestIn(rows),
    hasWind: rows.some((row) => row.hour.wind),
  };
}

/**
 * The night a day's table folds away: the dark rows before the first light
 * row and after the last, each run kept together so it can be shown in place.
 */
export function darkRuns(rows: readonly SpotRow[]): {
  before: SpotRow[];
  light: SpotRow[];
  after: SpotRow[];
} {
  const first = rows.findIndex((row) => row.hour.daylight);
  if (first === -1) return { before: [...rows], light: [], after: [] };
  let last = rows.length - 1;
  while (!rows[last].hour.daylight) last--;
  return {
    before: rows.slice(0, first),
    light: rows.slice(first, last + 1),
    after: rows.slice(last + 1),
  };
}

// ---- tide -------------------------------------------------------------------

export interface TideTurn {
  time: number;
  tide: "high" | "low";
  height: number;
}

/** The published high and low waters, as instants. */
export function tideTurns(forecast: SpotForecast): TideTurn[] {
  const tides = forecast.tides;
  if (!tides || !("events" in tides)) return [];
  return tides.events.map((event) => ({
    time: Date.parse(event.time),
    tide: event.tide,
    height: event.height_m,
  }));
}

/**
 * The tide between two turns, by cosine interpolation: half a cosine wave
 * from one turn to the next, flat at high and low water and steepest at
 * mid-tide — the smooth form of the rule of twelfths. Null outside the
 * published turns: a curve is not extrapolated past the last prediction.
 */
export function tideHeightAt(
  turns: readonly TideTurn[],
  time: number,
): number | null {
  for (let i = 1; i < turns.length; i++) {
    const a = turns[i - 1];
    const b = turns[i];
    if (time < a.time || time > b.time) continue;
    const f = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
    return a.height + ((b.height - a.height) * (1 - Math.cos(Math.PI * f))) / 2;
  }
  return null;
}

/** Whether the tide is coming in or going out at a time, from the next turn. */
export function tideTrend(
  turns: readonly TideTurn[],
  time: number,
): "rising" | "falling" | null {
  const next = turns.find((turn) => turn.time > time);
  if (!next || !turns.some((turn) => turn.time <= time)) return null;
  return next.tide === "high" ? "rising" : "falling";
}

/** The curve across [from, to], every `stepMinutes`, as far as turns reach. */
export function tideCurve(
  turns: readonly TideTurn[],
  from: number,
  to: number,
  stepMinutes = 10,
): { time: number; height: number }[] {
  const points: { time: number; height: number }[] = [];
  for (let t = from; t <= to; t += stepMinutes * 60000) {
    const height = tideHeightAt(turns, t);
    if (height !== null) points.push({ time: t, height });
  }
  return points;
}

// ---- daylight ---------------------------------------------------------------

export interface DaySun {
  firstLight: number | null;
  sunrise: number | null;
  sunset: number | null;
  lastLight: number | null;
}

/** First light (civil dawn), sunrise, sunset and last light for an Irish day. */
export function daySun(lat: number, lon: number, date: string): DaySun {
  const sun = sunTimes(lat, lon, new Date(dublinMidnight(date) + 12 * HOUR));
  const ms = (value: Date | null) => (value ? value.getTime() : null);
  return {
    firstLight: ms(sun.civilDawn),
    sunrise: ms(sun.sunrise),
    sunset: ms(sun.sunset),
    lastLight: ms(sun.civilDusk),
  };
}

export interface ShadeBand {
  kind: "night" | "twilight";
  from: number;
  to: number;
}

/** The dark and the twilight across one Irish day, for the chart to shade. */
export function shadeBands(
  sun: DaySun,
  start: number,
  end: number,
): ShadeBand[] {
  const { firstLight, sunrise, sunset, lastLight } = sun;
  if (sunrise === null || sunset === null)
    return [{ kind: "night", from: start, to: end }];
  const dawn = firstLight ?? sunrise;
  const dusk = lastLight ?? sunset;
  const bands: ShadeBand[] = [
    { kind: "night", from: start, to: dawn },
    { kind: "twilight", from: dawn, to: sunrise },
    { kind: "twilight", from: sunset, to: dusk },
    { kind: "night", from: dusk, to: end },
  ];
  return bands
    .map((band) => ({
      ...band,
      from: Math.max(start, band.from),
      to: Math.min(end, band.to),
    }))
    .filter((band) => band.to > band.from);
}

// ---- the day's window ------------------------------------------------------------

export interface DayWindow {
  /** Indexes into the day's rows, inclusive. */
  first: number;
  last: number;
  /** The highest solid stars of the day, which every row of the window has. */
  stars: number;
  potential: number;
  from: number;
  /** The instant the window ends: the end of its last row. */
  to: number;
  /** The wing the first row of it asks for: the rider's own, or the pick. */
  wing: number;
  /** Whether it runs to the last daylight row: "till dark". */
  tillDark: boolean;
}

/**
 * The day's best window, as the chart loops it: the longest run of rows at the
 * day's highest solid stars, the earliest of equals. One row will do; null
 * when no row of the day earns a star.
 */
export function dayWindow(rows: readonly SpotRow[]): DayWindow | null {
  const top = Math.max(0, ...rows.map((row) => row.rating?.stars ?? 0));
  if (top === 0) return null;
  let best: [number, number] | null = null;
  let start = -1;
  for (let i = 0; i <= rows.length; i++) {
    const on = i < rows.length && rows[i].rating?.stars === top;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (!best || i - 1 - start > best[1] - best[0]) best = [start, i - 1];
      start = -1;
    }
  }
  const [first, last] = best!;
  const rating = rows[first].rating!;
  let lastLight = rows.length - 1;
  while (lastLight > 0 && !rows[lastLight].rating) lastLight--;
  return {
    first,
    last,
    stars: top,
    potential: Math.max(
      ...rows.slice(first, last + 1).map((row) => row.rating!.potential),
    ),
    from: rows[first].time,
    to: rows[last].time + rows[last].step * HOUR,
    wing: rating.wing.own ?? rating.wing.recommended,
    tillDark: last === lastLight && last > first,
  };
}

/** "18–19": the window's hours, as the day's header gives them. */
export function windowHours(window: DayWindow): string {
  const first = clock(window.from).slice(0, 2);
  const lastRow = clock(window.to - HOUR).slice(0, 2);
  return first === lastRow ? first : `${first}–${lastRow}`;
}

export interface WeekBest {
  date: string;
  window: DayWindow;
}

/** The best window of the week: most stars, then the longest, then the soonest. */
export function weekBest(
  days: readonly { date: string; window: DayWindow | null }[],
): WeekBest | null {
  let best: WeekBest | null = null;
  for (const { date, window } of days) {
    if (!window) continue;
    const length = window.last - window.first;
    if (
      !best ||
      window.stars > best.window.stars ||
      (window.stars === best.window.stars &&
        length > best.window.last - best.window.first)
    )
      best = { date, window };
  }
  return best;
}

/**
 * Whether a gust jumps far enough over the mean to be the figure to watch:
 * ten knots or more, or sixty per cent.
 */
export const gustJumps = (wind: number, gust: number | null) =>
  gust !== null && (gust - wind >= 10 || gust >= wind * 1.6);

/** The rider's band in knots, rounded, for the range bar and the tip. */
export function bandKnots(rider: Rider) {
  const band = windBand(rider);
  return {
    min: Math.round(band.min),
    sweetLow: Math.round(band.sweetLow),
    sweetHigh: Math.round(band.sweetHigh),
    max: Math.round(band.max),
  };
}
