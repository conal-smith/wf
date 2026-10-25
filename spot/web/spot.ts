/**
 * The spot page's arithmetic, apart from React so it can be tested on its own:
 * which hours become rows, how they group into Irish days and the wind each
 * day has, what the shore wants from the wind, and the tide and daylight a day's
 * chart draws. Everything here is pure; times are UTC milliseconds and every
 * label is Irish local time, as everywhere on the site.
 */
import { handovers, modelName, type StarsFrom } from "../../force5/src/lead";
import {
  rateHour,
  windBand,
  shoreAngle,
  type HourRating,
  type Rider,
  type ShoreAngle,
} from "../../force5/src/stars";
import { sunTimes } from "../../force5/src/sun";
import {
  arcText,
  goodWindArcs,
  windArcs,
  type WindArc,
} from "../../force5/src/windArcs";
import {
  KNOTS,
  beaufort,
  convert,
  unitLabel,
  type Units,
} from "../../force5/src/units";
import type { ForecastHour, SpotForecast } from "../../mcp/api/forecast";

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

// The winds a shore wants are force5's, which the forecast server reads too.
export { goodWindArcs, windArcs, type WindArc };

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

/** A speed in knots, in the reader's units, rounded as the dock rounds it; the force in Force. */
export function windIn(knots: number, units: Units): number {
  if (units === "kn") return Math.round(knots);
  if (units === "bft") return beaufort(knots);
  const value = convert(knots / KNOTS, units);
  return units === "m/s" ? Math.round(value * 10) / 10 : Math.round(value);
}

/**
 * The gust a row writes beside the wind, or null: in Force a gust in the
 * wind's own force says nothing, so it is left out.
 */
export const gustShown = (
  knots: number,
  gust: number | null,
  units: Units,
): number | null =>
  gust === null || (units === "bft" && beaufort(gust) <= beaufort(knots))
    ? null
    : gust;

/** A speed in knots as a line of text writes it: "14", or "F4" in Force. */
export const windSay = (knots: number, units: Units): string =>
  units === "bft" ? `F${beaufort(knots)}` : String(windIn(knots, units));

/** A speed in knots said in full: "14 kn", or "Force 4". */
export const windWords = (knots: number, units: Units): string =>
  units === "bft"
    ? `Force ${beaufort(knots)}`
    : `${windIn(knots, units)} ${unitLabel(units)}`;

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
}

/** Rate one forecast hour for a rider at a shore, from the one model's own wind. */
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
  }));
}

export interface SpotDay {
  date: string;
  rows: SpotRow[];
  /** Daylight wind: lowest mean, highest mean, highest gust, in knots. */
  windMin: number | null;
  windMax: number | null;
  gustMax: number | null;
  /** The day's prevailing wind, from the daylight rows. */
  direction: number | null;
  /** Whether any row of the day has a wind reading at all. */
  hasWind: boolean;
}

/**
 * Rows grouped by Irish calendar day, each with its wind. A day is not rated:
 * the hours carry the stars, and a rider picks the hours.
 */
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
  return {
    date,
    rows,
    windMin: winds.length ? Math.min(...winds.map((w) => w.wind_kn)) : null,
    windMax: winds.length ? Math.max(...winds.map((w) => w.wind_kn)) : null,
    gustMax: gusts.length ? Math.max(...gusts) : null,
    direction: meanBearing(
      winds.map((w) => ({ deg: w.direction_deg, weight: w.wind_kn })),
    ),
    hasWind: rows.some((row) => row.hour.wind),
  };
}

// ---- which model rates the hours ---------------------------------------------

/** Where the model the stars come from changes, down the page's rows. */
export interface LeadChange {
  /** The first row the new model rates. */
  time: number;
  from: string;
  to: string;
}

/**
 * Each change of model down the rows: where the chosen model's run ends and
 * the one that takes over begins. A row with no wind neither starts nor ends
 * a run.
 */
export function leadChanges(rows: readonly SpotRow[]): LeadChange[] {
  return handovers(rows.map((row) => row.hour.wind?.lead ?? null)).map(
    ({ at, from, to }) => ({ time: rows[at].time, from, to }),
  );
}

/**
 * The handover row's words: "ECMWF from Wed 22:00", and why. `from` is the
 * rider's model and ECMWF after it.
 */
export function handoverWords(
  change: LeadChange,
  from: StarsFrom,
): { kicker: string; text: string } {
  const to = modelName(change.to);
  const was = modelName(change.from);
  const kicker = `${to} from ${weekdayShort.format(change.time)} ${clock(change.time)}`;
  if (change.to === from.model)
    return {
      kicker,
      text: `${to} reaches this far again, so the stars are its own once more.`,
    };
  return {
    kicker,
    text:
      change.to === from.then
        ? `${was}'s run ends here. From here the wind and the stars are ${to}'s, which runs fifteen days.`
        : `${was}'s run ends here. From here the wind and the stars are ${to}'s.`,
  };
}

/**
 * The models that rate a day's daylight hours, in the order they do, for the
 * day's header: empty when there are none, or when it is only the model the
 * rider chose, which needs no saying.
 */
export function dayLeads(rows: readonly SpotRow[], from: StarsFrom): string[] {
  const leads: string[] = [];
  for (const row of rows) {
    const lead = row.hour.daylight ? row.hour.wind?.lead : undefined;
    if (lead && leads.at(-1) !== lead) leads.push(lead);
  }
  return leads.every((lead) => lead === from.model) ? [] : leads;
}

/** "HARMONIE, then ECMWF": whose forecast a day is, said in its header. */
export const dayLeadText = (leads: readonly string[]) =>
  leads.map(modelName).join(", then ");

/**
 * Where each change goes among the rows a day draws: before the first drawn
 * row at or after it, or after the last when the rows it falls among are
 * folded away. Keyed by that row's time; `end` holds the ones after the last.
 */
export function placeChanges(
  drawn: readonly SpotRow[],
  changes: readonly LeadChange[],
): { before: Map<number, LeadChange[]>; end: LeadChange[] } {
  const before = new Map<number, LeadChange[]>();
  const end: LeadChange[] = [];
  for (const change of changes) {
    const row = drawn.find((r) => r.time >= change.time);
    if (row) before.set(row.time, [...(before.get(row.time) ?? []), change]);
    else if (drawn.length) end.push(change);
  }
  return { before, end };
}

/**
 * The night a day's table folds away: the dark rows before the first light
 * row and after the last, each run kept together so it can be shown in place.
 * "Light" here is the forecast's own `daylight`, sunrise to sunset, which is
 * what the stars are rated over.
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

/** The row from which the sky model no longer reaches the day's end. */
export function skyEnd(rows: readonly SpotRow[]): number {
  let end = rows.length;
  while (end > 0 && !rows[end - 1].hour.weather) end--;
  return end;
}

/**
 * The day the sky model stops on: the first whose daylight runs past its last
 * hour, where the Sky column first says "not yet", or null where it reaches
 * every day. Said once there, under the day, the days after keep their own
 * "not yet" without it.
 */
export function skyStopsOn(days: readonly SpotDay[]): string | null {
  for (const day of days) {
    const end = skyEnd(day.rows);
    if (darkRuns(day.rows).light.some((row) => day.rows.indexOf(row) >= end))
      return day.date;
  }
  return null;
}

/**
 * What a folded run of night says, from the sun rather than from the rows.
 * A row is rated when its hour starts between sunrise and sunset, so the fold
 * names those: the light table under the day lists the same two times, and a
 * three-hourly day no longer claims it is dark till 09:00 when the sun is up
 * at 07:58. Late in today, when every row left is after sunset, it says so
 * rather than "dark till midnight".
 */
export function foldText(
  edge: "before" | "after",
  run: readonly SpotRow[],
  sun: DaySun,
  hasLight: boolean,
): string {
  const { sunrise, sunset } = sun;
  if (!hasLight && sunset !== null && run[0].time >= sunset)
    return "Dark for the rest of the day";
  if (edge === "before" && sunrise !== null && sunrise > run[0].time)
    return `Before sunrise ${clock(sunrise)}`;
  if (edge === "after" && sunset !== null && sunset <= run[0].time)
    return `After sunset ${clock(sunset)}`;
  // No sun to go by (or one the rows disagree with): the rows' own edges.
  const last = run.at(-1)!;
  return edge === "before"
    ? `Dark till ${clock(last.time + last.step * HOUR)}`
    : `Dark from ${clock(run[0].time)}`;
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
