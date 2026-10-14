/**
 * Which windows an alert rule matches, from rated hours: the one piece of
 * alert logic, run by the API to decide what to send and by the app to
 * preview it, so the two cannot disagree.
 *
 * The input is what the dock already has for a place: a column per axis time
 * with the blend's wind and the hour's rating for this rider
 * (src/ratings.ts PlaceHour fits it as it is). A column stands for the time
 * until the next one (hourly near, three-hourly further out), never more than
 * three hours, and only one hour when the next is not rated: an unrated column
 * is dark or has no forecast, and a window never runs on into it. Each column
 * is cut into Irish clock hours so a rule's hours, days and DST changes are
 * read hour by hour.
 *
 * A window is a run of consecutive qualifying hours on one Irish day: rated,
 * solid stars at or over the rule's, on one of its weekdays, within its hours,
 * no further ahead than its lead. It is given its weakest hour's stars (what it
 * can be relied on for, as `bestWindow` in force5/src/stars.ts rates one) and
 * its best hour's as the peak. Per spot and day the best window is the one
 * given (most stars, then longest, then earliest), with the count of the rest.
 */
import type { AlertMatch, AlertRule } from "./protocol.js";
import { addDays, HOUR_MS, irishTime, type IrishTime } from "./time.js";

/** One axis column at one place, as the blend rates it (src/ratings.ts PlaceHour). */
export interface RatedColumn {
  windKn: number | null;
  gustKn: number | null;
  from: number | null;
  rating: {
    stars: number;
    wing: { recommended: number; own: number | null };
  } | null;
}

/** A place's columns on the axis, or nothing when the forecast does not know it. */
export type HoursOf = (spotId: string) => readonly (RatedColumn | null | undefined)[] | null | undefined;

/** The longest one column may stand for, in hours. */
export const MAX_COLUMN_HOURS = 3;
/** "Materially changed": a window that moved more than this, or changed its stars. */
export const MATERIAL_SHIFT_MS = 2 * HOUR_MS;

const local = new Map<number, IrishTime>();
/** Irish time of an instant, kept: the axes repeat the same few hundred hours. */
function irish(ms: number): IrishTime {
  let hit = local.get(ms);
  if (!hit) {
    if (local.size > 20_000) local.clear();
    hit = irishTime(ms);
    local.set(ms, hit);
  }
  return hit;
}

const parsed = new WeakMap<readonly string[], number[]>();
function times(axis: readonly string[]): number[] {
  let out = parsed.get(axis);
  if (!out) {
    out = axis.map((iso) => Date.parse(iso));
    parsed.set(axis, out);
  }
  return out;
}

interface Slot {
  start: number;
  end: number;
  column: number;
  local: IrishTime;
}

function circularMean(bearings: readonly number[]): number | null {
  if (!bearings.length) return null;
  let x = 0;
  let y = 0;
  for (const b of bearings) {
    x += Math.cos((b * Math.PI) / 180);
    y += Math.sin((b * Math.PI) / 180);
  }
  if (Math.hypot(x, y) < 1e-6 * bearings.length) return null;
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) % 360;
}

/** The most common value, the larger of equals. */
function mode(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let most = 0;
  for (const [v, n] of counts)
    if (n > most || (n === most && best !== null && v > best)) {
      best = v;
      most = n;
    }
  return best;
}

/** Whether `a` is a better window to give than `b`. */
const better = (a: AlertMatch, b: AlertMatch) =>
  a.stars !== b.stars
    ? a.stars > b.stars
    : a.hours !== b.hours
      ? a.hours > b.hours
      : Date.parse(a.start) < Date.parse(b.start);

/** One spot's windows for a rule, the best per Irish day. */
function spotMatches(
  rule: AlertRule,
  spotId: string,
  axis: readonly string[],
  hours: readonly (RatedColumn | null | undefined)[],
  now: number,
): AlertMatch[] {
  const at = times(axis);
  const today = irish(now).date;
  const lastDay = addDays(today, rule.leadDays);
  const days = new Set(rule.days);
  const rated = (i: number) => !!hours[i]?.rating && Number.isFinite(at[i]);

  const slots: Slot[] = [];
  for (let i = 0; i < at.length; i++) {
    const column = hours[i];
    if (!column?.rating || !rated(i) || column.rating.stars < rule.minStars) continue;
    const next = at[i + 1];
    const span =
      next !== undefined && rated(i + 1)
        ? Math.min(next - at[i], MAX_COLUMN_HOURS * HOUR_MS)
        : HOUR_MS;
    for (let t = at[i]; t < at[i] + span; t += HOUR_MS) {
      const end = Math.min(t + HOUR_MS, at[i] + span);
      if (end <= now) continue;
      const when = irish(t);
      if (when.date > lastDay || when.date < today) continue;
      if (!days.has(when.weekday)) continue;
      if (when.hour < rule.fromHour || when.hour >= rule.toHour) continue;
      slots.push({ start: t, end, column: i, local: when });
    }
  }

  const runs: Slot[][] = [];
  for (const slot of slots) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (last && last.end === slot.start && last.local.date === slot.local.date) run.push(slot);
    else runs.push([slot]);
  }

  const byDay = new Map<string, AlertMatch>();
  for (const run of runs) {
    const start = run[0].start;
    const end = run[run.length - 1].end;
    const length = (end - start) / HOUR_MS;
    if (length < rule.minHours) continue;
    const columns = [...new Set(run.map((s) => s.column))].map((i) => hours[i]!);
    const stars = columns.map((c) => c.rating!.stars);
    const winds = columns.flatMap((c) => (c.windKn === null ? [] : [c.windKn]));
    const gusts = columns.flatMap((c) => (c.gustKn === null ? [] : [c.gustKn]));
    const wings = columns.map((c) => c.rating!.wing.own ?? c.rating!.wing.recommended);
    const match: AlertMatch = {
      ruleId: rule.id,
      spotId,
      day: run[0].local.date,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      hours: Math.round(length * 10) / 10,
      stars: Math.min(...stars),
      peakStars: Math.max(...stars),
      windKn: winds.length
        ? [Math.round(Math.min(...winds)), Math.round(Math.max(...winds))]
        : [0, 0],
      gustKn: gusts.length ? Math.round(Math.max(...gusts)) : null,
      from: circularMean(columns.flatMap((c) => (c.from === null ? [] : [c.from]))),
      wing: mode(wings),
      ownWing: columns.some((c) => c.rating!.wing.own !== null),
      windows: 1,
    };
    const held = byDay.get(match.day);
    if (!held) byDay.set(match.day, match);
    else {
      const best = better(match, held) ? match : held;
      byDay.set(match.day, { ...best, windows: held.windows + 1 });
    }
  }
  return [...byDay.values()];
}

/**
 * Every window `rule` matches from `now` on, earliest first. A rule that is
 * off matches nothing; a spot the forecast does not know is left out.
 */
export function matchRule(
  rule: AlertRule,
  axis: readonly string[],
  hoursOf: HoursOf,
  now: number,
): AlertMatch[] {
  if (!rule.enabled || rule.fromHour >= rule.toHour || !rule.days.length) return [];
  const out: AlertMatch[] = [];
  for (const spotId of new Set(rule.spots)) {
    const hours = hoursOf(spotId);
    if (hours) out.push(...spotMatches(rule, spotId, axis, hours, now));
  }
  return out.sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || a.spotId.localeCompare(b.spotId),
  );
}

/** What a rider was told about a window, enough to compare a new forecast with. */
export interface Told {
  start: string;
  end: string;
  stars: number;
}

/** One notification per rule, spot and Irish day. */
export const noticeKey = (m: Pick<AlertMatch, "ruleId" | "spotId" | "day">) =>
  `${m.ruleId}|${m.spotId}|${m.day}`;

/** Whether a window has changed enough to tell the rider again. */
export function materiallyChanged(told: Told, now: Told): boolean {
  return (
    told.stars !== now.stars ||
    Math.abs(Date.parse(told.start) - Date.parse(now.start)) > MATERIAL_SHIFT_MS ||
    Math.abs(Date.parse(told.end) - Date.parse(now.end)) > MATERIAL_SHIFT_MS
  );
}

/**
 * What a rule asks for, apart from its name, spots and switches: a window
 * told under one signature and gone under another was not called off, the
 * rider asked a different question.
 */
export function ruleSignature(rule: AlertRule): string {
  return JSON.stringify([
    rule.minStars,
    [...rule.days].sort(),
    rule.fromHour,
    rule.toHour,
    rule.minHours,
    rule.leadDays,
  ]);
}
