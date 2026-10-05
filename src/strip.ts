/**
 * The dock's week: the forecast's own columns for the next seven Irish days,
 * 07:00 to 20:00, as one strip of hours under a fixed cursor. Night columns
 * are left out, as the chart's dock leaves them out: nobody rides them, and a
 * strip of dark hours between every two days is a lot of swiping for nothing.
 *
 * The columns keep their model's cadence: hourly where the fine runs reach,
 * three- and six-hourly further out. Everything here is pure; times are UTC
 * milliseconds and every label is Irish local time.
 */
import type { DockColumn } from "../force5/src/timeline";

export const TIME_ZONE = "Europe/Dublin";
export const STRIP_DAYS = 7;
export const FIRST_HOUR = 7;
export const LAST_HOUR = 20;

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
const weekday = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  weekday: "short",
});
const weekdayLong = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  weekday: "long",
});

/** "2026-10-05": the Irish calendar day an instant falls on. */
export const irishDate = (time: number) => dateFormat.format(new Date(time));
/** "13:25", Irish time. */
export const clock = (time: number) => hourFormat.format(new Date(time));
/** The Irish hour of the day, 0–23. */
export const irishHour = (time: number) =>
  Number(hourFormat.format(new Date(time)).slice(0, 2));
/** "Mon". */
export const dayShort = (time: number) => weekday.format(new Date(time));
/** "Monday". */
export const dayLong = (time: number) => weekdayLong.format(new Date(time));
/** "13". */
export const hourLabel = (time: number) => clock(time).slice(0, 2);

export interface StripColumn extends DockColumn {
  time: number;
  /** Irish calendar day. */
  date: string;
  /** Irish hour, 7–20. */
  hour: number;
  /** Which of the strip's days it falls in. */
  day: number;
}

export interface StripDay {
  date: string;
  /** Noon of the day, for its labels. */
  noon: number;
  /** First column, and how many. */
  start: number;
  count: number;
}

/** The next seven Irish days of the dock's columns, 07:00–20:00. */
export function stripColumns(
  columns: readonly DockColumn[],
  now: number,
  days = STRIP_DAYS,
): StripColumn[] {
  const dates: string[] = [];
  for (let d = 0; dates.length < days && d < days + 2; d++) {
    const date = irishDate(now + d * 86400000);
    if (!dates.includes(date)) dates.push(date);
  }
  const out: StripColumn[] = [];
  for (const column of columns) {
    const time = Date.parse(column.validTime);
    const date = irishDate(time);
    const day = dates.indexOf(date);
    if (day < 0) continue;
    const hour = irishHour(time);
    if (hour < FIRST_HOUR || hour > LAST_HOUR) continue;
    out.push({ ...column, time, date, hour, day });
  }
  return out;
}

/** The strip's days, each with its run of columns. */
export function stripDays(columns: readonly StripColumn[]): StripDay[] {
  const out: StripDay[] = [];
  columns.forEach((column, at) => {
    const last = out[out.length - 1];
    if (last && last.date === column.date) last.count++;
    else
      out.push({
        date: column.date,
        noon: Date.parse(`${column.date}T12:00:00Z`),
        start: at,
        count: 1,
      });
  });
  return out;
}

/** The column for a time: the nearest one, in either direction. */
export function nearestColumn(
  columns: readonly { time: number }[],
  time: number,
): number {
  let best = 0;
  let gap = Infinity;
  columns.forEach((column, at) => {
    const g = Math.abs(column.time - time);
    if (g < gap) {
      gap = g;
      best = at;
    }
  });
  return best;
}

/**
 * The column a page opens on: the hour now if it is in the strip, else the
 * next one that is (first light tomorrow, at night), else the last.
 */
export function openingColumn(
  columns: readonly { time: number }[],
  now: number,
): number {
  if (!columns.length) return 0;
  const at = nearestColumn(columns, now);
  if (Math.abs(columns[at].time - now) <= 90 * 60000) return at;
  const next = columns.findIndex((column) => column.time >= now);
  return next < 0 ? columns.length - 1 : next;
}

/** A day's best stretch: the longest run of its best-rated hours. */
export interface DayBest {
  /** Columns, inclusive. */
  from: number;
  to: number;
  stars: number;
}

/**
 * The best stretch of one day: the longest run of the hours that carry its
 * highest rating, as the chart's dock and its pen loop read it. A day whose
 * best is no stars has a best of zero and no stretch worth a loop; a day with
 * nothing rated (all dark, or not reached) has none. `after` drops the hours
 * already gone, so "best today" never sells this morning.
 */
export function dayBest(
  ratings: readonly ({ stars: number } | null)[],
  day: StripDay,
  after = -Infinity,
  times?: readonly number[],
): DayBest | null {
  let top = -1;
  for (let i = day.start; i < day.start + day.count; i++) {
    const r = ratings[i];
    if (!r || (times && times[i] + 3600000 <= after)) continue;
    top = Math.max(top, r.stars);
  }
  if (top < 0) return null;
  let best: DayBest | null = null;
  let run: DayBest | null = null;
  for (let i = day.start; i < day.start + day.count; i++) {
    const r = ratings[i];
    const ok = !!r && r.stars === top && !(times && times[i] + 3600000 <= after);
    if (!ok) {
      run = null;
      continue;
    }
    if (run && run.to === i - 1) run.to = i;
    else run = { from: i, to: i, stars: top };
    if (!best || run.to - run.from > best.to - best.from) best = { ...run };
  }
  return best;
}
