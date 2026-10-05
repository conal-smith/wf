/**
 * Irish time for the companion: which instant a local calendar day starts at,
 * and the words a person reads a window in. Europe/Dublin moves between GMT
 * and IST, so a day is found by asking Intl for the offset, never by assuming.
 */
import { TIME_ZONE, localTime } from "../../mcp/api/forecast.js";

const HOUR = 3600000;

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Minutes Dublin is ahead of UTC at an instant (0 in winter, 60 in summer). */
function offsetMinutes(at: number): number {
  const p = Object.fromEntries(
    parts.formatToParts(new Date(at)).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour % 24,
    +p.minute,
  );
  return Math.round((asUtc - Math.floor(at / 60000) * 60000) / 60000);
}

/** The instant a YYYY-MM-DD day starts in Dublin, or null for anything else. */
export function dublinDayStart(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const utcMidnight = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (!Number.isFinite(utcMidnight)) return null;
  // Midnight in Dublin is midnight UTC less the offset in force at that hour.
  const guess = utcMidnight - offsetMinutes(utcMidnight) * 60000;
  return utcMidnight - offsetMinutes(guess) * 60000;
}

/** "2026-10-04" for the Dublin calendar day an instant falls on. */
export function dublinDate(at: number): string {
  const p = Object.fromEntries(
    parts.formatToParts(new Date(at)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

const weekday = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const clock = new Intl.DateTimeFormat("en-IE", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "Saturday 4 October 2026" */
export const longDay = (at: number) => weekday.format(new Date(at));
/** "14:00" */
export const clockTime = (at: number) => clock.format(new Date(at));

/** "Sat, 4 Oct, 14:00–18:00": the start in full, the end as a time. */
export function windowLabel(from: number, to: number): string {
  const end = to - from > 24 * HOUR ? localTime(to) : clockTime(to);
  return `${localTime(from)}–${end}`;
}
