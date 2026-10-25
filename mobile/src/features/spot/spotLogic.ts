/**
 * The spot page's arithmetic over the app's one forecast. The site's spot
 * page (spot/web/SpotApp.tsx) reads a consensus line through the MCP server;
 * the app reads the same consensus already rated for every screen
 * (`useSpotHours`), so the page, the dock and the chart's light can never
 * disagree about an hour. This module puts those hours into the shape the
 * site's own page arithmetic takes (spot/web/spot.ts: the days, the folds of
 * night, the light) and reuses it as it stands.
 */
import { SHORE_LABEL, shoreAngle, type ShoreAngle } from "../../../../force5/src/stars";
import { eventsBetween, tideAt, type TideCurve } from "../../../../force5/src/tides";
import { compass } from "../../../../force5/src/weather";
import type { ForecastHour } from "../../../../mcp/api/forecast";
import type { PlaceHour } from "../../../../src/ratings";
import type { StripColumn } from "../../../../src/strip";
import {
  FORECAST_DAYS,
  HOUR,
  HOURLY_AHEAD_HOURS,
  clock,
  darkRuns,
  daySun,
  dublinDate,
  dublinHour,
  dublinMidnight,
  groupDays,
  nextMidnight,
  shoreHeading,
  type DaySun,
  type SpotDay,
  type SpotRow,
} from "../../../../spot/web/spot";
import { isOnWater } from "../../../../force5/src/shoreFacing";
import type { MoreCells, RainCell, SkyCell, WaveCell } from "../dock/dockLogic";

/**
 * The spot screen's line under its name: the shore as the site's header says
 * it (spot/web/spot.ts `shoreHeading`), the county and the sea, each only
 * where there is one. A spot on the water says nothing of its shore, as on
 * the site, so its line starts at the county.
 */
export function headerLine(
  id: string,
  county: string | null | undefined,
  seaC: number | null,
): string {
  const heading = shoreHeading(id);
  const shore =
    heading?.kind === "facing"
      ? `Faces ${compass(heading.facing)} ${Math.round(heading.facing)}°${
          heading.best.length ? ` · best ${heading.best.join(", ")}` : ""
        }`
      : heading?.kind === "unknown"
        ? heading.text
        : null;
  return [shore, county || null, seaC === null ? null : `Sea ${seaC.toFixed(1)}°`]
    .filter(Boolean)
    .join(" · ");
}

/** An hour's caption of the shore: its angle, "facing unknown", or nothing on the water. */
export function hourShoreCaption(
  id: string,
  shore: ShoreAngle | null,
  facing: number | null,
): string {
  if (shore) return SHORE_LABEL[shore];
  return facing === null && !isOnWater(id) ? "facing unknown" : "";
}

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
          // The one model the wind is (and the stars came from); a wind always
          // has one, the empty name only a guard.
          lead: place.model ?? "",
          gust_lead: place.gustKn === null ? null : place.model,
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
}

/** The week, a day at a time, with each day's light. No day is rated: its hours are. */
export function pageDays(rows: readonly PageRow[], lat: number, lon: number): PageDay[] {
  return groupDays(rows)
    .filter((day) => day.hasWind)
    .slice(0, FORECAST_DAYS)
    .map((day) => ({ day: day as PageDay["day"], sun: daySun(lat, lon, day.date) }));
}

/** What a day's list holds: its folds of night, its hours, and its tide. */
export type DayItem =
  | { kind: "fold"; edge: "before" | "after"; text: string; key: string }
  | { kind: "row"; row: PageRow; key: string }
  | { kind: "tide"; key: string };

/** A day's items, the night folded either side unless it is shown. */
export function dayItems(
  entry: PageDay,
  showNight: boolean,
  foldText: (edge: "before" | "after", run: readonly SpotRow[]) => string,
): DayItem[] {
  const { day } = entry;
  const { before, light, after } = darkRuns(day.rows);
  const row = (r: PageRow): DayItem => ({ kind: "row", row: r, key: `r${r.time}` });
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
export function shareContent(name: string, id: string) {
  const url = spotUrl(id);
  return {
    title: `${name} wing foil forecast`,
    message: `${name} wing foil forecast ${url}`,
    url,
  };
}
