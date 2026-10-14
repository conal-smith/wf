/**
 * Irish local time for alerts: the day, hour and weekday an instant falls on
 * in Europe/Dublin, and the instant an Irish day and hour begin. Pure, and
 * built on `Intl.DateTimeFormat#format` alone (as src/strip.ts is), which
 * Node and Hermes both have, so the clocks change in March and October
 * without a table of our own.
 */
import { WEEKDAYS, type Weekday } from "./protocol.js";

export const TIME_ZONE = "Europe/Dublin";
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Quiet hours: nothing is delivered from 22:00 until 07:00, Irish time. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_TO_HOUR = 7;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface IrishTime {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
  weekday: Weekday;
}

/** Monday 0 … Sunday 6 of a YYYY-MM-DD calendar date. */
function weekdayOfDate(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  const sundayZero = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAYS[(sundayZero + 6) % 7];
}

export function irishTime(ms: number): IrishTime {
  const at = new Date(ms);
  const date = dateFormat.format(at);
  const clock = clockFormat.format(at);
  return {
    date,
    hour: Number(clock.slice(0, 2)),
    minute: Number(clock.slice(3, 5)),
    weekday: weekdayOfDate(date),
  };
}

/** The calendar date `days` after a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole calendar days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The instant an Irish date's `hour` begins (0–24; 24 is the next day's
 * midnight). Ireland is UTC+0 in winter and UTC+1 in summer, so it is one of
 * two instants; an hour the spring change skips (01:00 on its Sunday) is
 * read as the instant the clocks jump to, and the autumn's repeated hour as
 * its first time round.
 */
export function irishInstant(date: string, hour: number): number {
  if (hour >= 24) return irishInstant(addDays(date, 1), hour - 24);
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  for (const offset of [HOUR_MS, 0]) {
    const t = wall - offset;
    const local = irishTime(t);
    if (local.date === date && local.hour === hour) return t;
  }
  // The skipped hour: this is the instant the clocks jump from it to hour + 1.
  return wall;
}

/** Whether an instant is inside quiet hours (22:00–07:00 Irish time). */
export function inQuietHours(ms: number): boolean {
  const { hour } = irishTime(ms);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR;
}

/** When something due at `ms` may be delivered: now, or 07:00 once quiet hours end. */
export function afterQuietHours(ms: number): number {
  if (!inQuietHours(ms)) return ms;
  const { date, hour } = irishTime(ms);
  return irishInstant(hour >= QUIET_FROM_HOUR ? addDays(date, 1) : date, QUIET_TO_HOUR);
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "14:00", Irish time. */
export const clockLabel = (ms: number) => {
  const { hour, minute } = irishTime(ms);
  return `${pad(hour)}:${pad(minute)}`;
};
/** "14:00" for an hour of the day, "24:00" for the end of it. */
export const hourLabel = (hour: number) => `${pad(hour)}:00`;

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** "Sat 14:00–17:00": an Irish window, by its first day. */
export function windowLabel(start: number, end: number): string {
  const first = irishTime(start);
  const last = irishTime(end);
  // A window that runs to midnight ends at 24:00 on its own day.
  const close =
    last.date !== first.date && last.hour === 0 && last.minute === 0
      ? "24:00"
      : clockLabel(end);
  return `${WEEKDAY_SHORT[first.weekday]} ${clockLabel(start)}–${close}`;
}
