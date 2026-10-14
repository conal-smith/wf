/**
 * The spot page's arithmetic over the app's one forecast. The site's spot
 * page (spot/web/SpotApp.tsx) reads a consensus line through the MCP server;
 * the app reads the same consensus already rated for every screen
 * (`useSpotHours`), so the page, the dock and the chart's light can never
 * disagree about an hour. This module puts those hours into the shape the
 * site's own page arithmetic takes (spot/web/spot.ts: the days, their best
 * windows, the folds of night, the light) and reuses it as it stands.
 */
import { shoreAngle } from "../../../../force5/src/stars";
import { eventsBetween, tideAt, type TideCurve } from "../../../../force5/src/tides";
import { compass } from "../../../../force5/src/weather";
import type { ForecastHour } from "../../../../mcp/api/forecast";
import type { PlaceHour } from "../../../../src/ratings";
import type { StripColumn } from "../../../../src/strip";
import {
  FORECAST_DAYS,
  HOUR,
  HOURLY_AHEAD_HOURS,
  PEN_STARS,
  clock,
  darkRuns,
  dayWindow,
  daySun,
  dublinDate,
  dublinHour,
  dublinMidnight,
  groupDays,
  nextMidnight,
  weekBest,
  type DaySun,
  type DayWindow,
  type SpotDay,
  type SpotRow,
  type WeekBest,
} from "../../../../spot/web/spot";
import type { MoreCells, RainCell, SkyCell, WaveCell } from "../dock/dockLogic";

/** One row of the page: the site's SpotRow, and what the app knows beside it. */
export interface PageRow extends SpotRow {
  /** Its column on the forecast's strip. */
  column: number;
  place: PlaceHour;
  wave: WaveCell | null;
  sky: SkyCell | null;
  air: number | null;
  rain: RainCell | null;
}

/** A rated hour as the site's page reads one (mcp/api/forecast.ts `ForecastHour`). */
export function forecastHour(
  column: Pick<StripColumn, "validTime">,
  place: PlaceHour,
  wave: WaveCell | null,
  air: number | null,
): ForecastHour {
  const wind =
    place.windKn === null
      ? null
      : {
          wind_kn: place.windKn,
          // The consensus the stars rate: one line, so no spread to give.
          min_kn: place.windKn,
          max_kn: place.windKn,
          gust_kn: place.gustKn,
          gust_max_kn: place.gustKn,
          direction_deg: place.from ?? 0,
          direction: place.from === null ? "" : compass(place.from),
          agreement: place.agreement,
          models: 0,
          // A rated hour does not carry which line its wind is (HARMONIE's own
          // or the blend's), and nothing on the app's page reads it.
          lead: null,
          gust_lead: null,
        };
  return {
    time: column.validTime,
    local: "",
    daylight: place.daylight,
    wind,
    waves: wave ? { height_m: wave.height, period_s: wave.period, direction_deg: wave.from } : null,
    weather: air === null ? null : { air_c: air, rain_mm: null, cloud_pct: null, weather_code: null },
  };
}

/**
 * The hours that become rows: from the top of the current hour, every hour
 * for the first three days and every third Irish hour after (spot.ts
 * `rowHours`), each with the rating the forecast already gave it.
 */
export function pageRows(
  strip: readonly StripColumn[],
  hours: readonly PlaceHour[],
  now: number,
  facing: number | null,
  more: MoreCells | null,
  hourlyAhead = HOURLY_AHEAD_HOURS,
): PageRow[] {
  const start = Math.floor(now / HOUR) * HOUR;
  const fine = start + hourlyAhead * HOUR;
  const out: PageRow[] = [];
  strip.forEach((column, i) => {
    const place = hours[i];
    if (!place || column.time < start) return;
    if (column.time >= fine && dublinHour(column.time) % 3 !== 0) return;
    const wave = more?.waves.cells?.[i] ?? null;
    const air = more?.air.cells?.[i] ?? null;
    out.push({
      time: column.time,
      step: column.time < fine ? 1 : 3,
      column: i,
      place,
      hour: forecastHour(column, place, wave, air),
      rating: place.rating,
      shore: facing === null || place.from === null ? null : shoreAngle(place.from, facing),
      wave,
      sky: more?.sky.cells?.[i] ?? null,
      air,
      rain: more?.rain.cells?.[i] ?? null,
    });
  });
  // A row stands for the hours to the next one: a coarse column further out.
  for (let k = 0; k < out.length - 1; k++)
    out[k].step = Math.max(1, Math.round((out[k + 1].time - out[k].time) / HOUR));
  return out;
}

export interface PageDay {
  day: SpotDay & { rows: PageRow[] };
  sun: DaySun;
  window: DayWindow | null;
}

/** The week, a day at a time, with each day's light and best window. */
export function pageDays(rows: readonly PageRow[], lat: number, lon: number): PageDay[] {
  return groupDays(rows)
    .filter((day) => day.hasWind)
    .slice(0, FORECAST_DAYS)
    .map((day) => {
      const sun = daySun(lat, lon, day.date);
      return { day: day as PageDay["day"], sun, window: dayWindow(day.rows, sun) };
    });
}

/** The pen's note for the week, only when its best is worth riding. */
export function penBest(days: readonly PageDay[]): WeekBest | null {
  const top = weekBest(days.map(({ day, window }) => ({ date: day.date, window })));
  return top && top.window.stars >= PEN_STARS ? top : null;
}

/** What a day's list holds: its folds of night, its hours, and its tide. */
export type DayItem =
  | { kind: "fold"; edge: "before" | "after"; text: string; key: string }
  | { kind: "row"; row: PageRow; first: boolean; last: boolean; ringed: boolean; key: string }
  | { kind: "tide"; key: string };

/**
 * A day's items, the night folded either side unless it is shown, the rows
 * of the day's best window marked for the pen when it is worth riding.
 */
export function dayItems(
  entry: PageDay,
  showNight: boolean,
  foldText: (edge: "before" | "after", run: readonly SpotRow[]) => string,
): DayItem[] {
  const { day, window } = entry;
  const { before, light, after } = darkRuns(day.rows);
  const ringed = window && window.stars >= PEN_STARS ? window : null;
  const row = (r: PageRow): DayItem => {
    const index = day.rows.indexOf(r);
    const inWindow = !!ringed && index >= ringed.first && index <= ringed.last;
    return {
      kind: "row",
      row: r,
      ringed: inWindow,
      first: inWindow && index === ringed!.first,
      last: inWindow && index === ringed!.last,
      key: `r${r.time}`,
    };
  };
  const items: DayItem[] = [];
  if (before.length) items.push({ kind: "fold", edge: "before", text: foldText("before", before), key: `fb${day.date}` });
  if (showNight) items.push(...(before as PageRow[]).map(row));
  items.push(...(light as PageRow[]).map(row));
  if (after.length) items.push({ kind: "fold", edge: "after", text: foldText("after", after), key: `fa${day.date}` });
  if (showNight) items.push(...(after as PageRow[]).map(row));
  items.push({ kind: "tide", key: `t${day.date}` });
  return items;
}

/** Where `?t=` lands: the day and the row nearest that time, or null. */
export function rowAt(
  days: readonly PageDay[],
  time: number,
): { date: string; row: PageRow; dark: boolean } | null {
  let best: { date: string; row: PageRow } | null = null;
  let gap = Infinity;
  for (const { day } of days)
    for (const row of day.rows) {
      const g = Math.abs(row.time - time);
      if (g < gap) {
        gap = g;
        best = { date: day.date, row };
      }
    }
  if (!best || gap > 3 * HOUR) return null;
  return { ...best, dark: !best.row.hour.daylight };
}

/** "2026-10-18T13:00:00Z", or a bare "13:00" read on today: the time `?t=` means. */
export function parseTimeParam(value: string | string[] | undefined, now: number): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) return null;
  const at = Date.parse(text);
  if (Number.isFinite(at)) return at;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!hm) return null;
  return dublinMidnight(dublinDate(now)) + (Number(hm[1]) * 60 + Number(hm[2])) * 60000;
}

/* ------------------------------------------------------------------ tide */

export interface TidePoint {
  time: number;
  height: number;
}

/** The tide across an Irish day, every ten minutes, from the station's curve. */
export function dayTideCurve(curve: TideCurve, date: string, stepMinutes = 10): TidePoint[] {
  const start = dublinMidnight(date);
  const end = nextMidnight(date);
  const out: TidePoint[] = [];
  for (let t = start; t <= end; t += stepMinutes * 60000) {
    const h = tideAt(curve, t);
    if (h !== null) out.push({ time: t, height: h });
  }
  return out;
}

export interface TideTurnRow {
  time: number;
  high: boolean;
  height: number;
}

/** The day's high and low waters. */
export function dayTurns(curve: TideCurve, date: string): TideTurnRow[] {
  const start = dublinMidnight(date);
  const end = nextMidnight(date);
  return eventsBetween(curve, start, end - 1).map((event) => ({
    time: Date.parse(event.time),
    high: event.kind === "high",
    height: event.height,
  }));
}

/** The week's highest water and a little: every day drawn on one scale. */
export const tideCeiling = (curve: TideCurve | null) =>
  Math.max(4.5, ...(curve?.curve ?? [])) + 0.3;

/** "High tide 05:12, 3.8 m; low tide 11:30, 0.9 m". */
export function tideWords(turns: readonly TideTurnRow[], note: string | null): string {
  if (!turns.length) return note ?? "No turn this day";
  return turns
    .map((t) => `${t.high ? "high" : "low"} tide ${clock(t.time)}, ${t.height.toFixed(1)} metres`)
    .join("; ");
}

/* ------------------------------------------------------------------ share */

export const spotUrl = (id: string) => `https://wingfoil.ie/spot/${encodeURIComponent(id)}`;

/** What the share sheet carries. */
export function shareContent(name: string, id: string, best: string | null) {
  const url = spotUrl(id);
  return {
    title: `${name} wing foil forecast`,
    message: `${name} wing foil forecast${best ? `: ${best}` : ""} ${url}`,
    url,
  };
}
