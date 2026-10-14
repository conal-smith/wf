/**
 * The words of an alert, in the site's voice: figures first, terse, no
 * exclamation marks. Used by the API for the notifications and by the app for
 * its previews and summaries, so the two read the same.
 *
 *   Brandon Bay ★★★★ Sat 14:00–17:00
 *   WSW 18–22 kn, gusts 26. Your 5.0 m wing.
 */
import { compass } from "../../mcp/api/forecast.js";
import { WEEKDAYS, type AlertMatch, type AlertRule, type Weekday } from "./protocol.js";
import { hourLabel, WEEKDAY_SHORT, windowLabel } from "./time.js";

export const stars = (n: number) => "★".repeat(Math.max(0, Math.min(5, Math.round(n))));

const range = ([low, high]: readonly [number, number]) =>
  low === high ? `${low}` : `${low}–${high}`;

/** "Sat 14:00–17:00" */
export const matchWindow = (m: Pick<AlertMatch, "start" | "end">) =>
  windowLabel(Date.parse(m.start), Date.parse(m.end));

/** "WSW 18–22 kn, gusts 26. Your 5.0 m wing." */
export function matchFigures(m: AlertMatch): string {
  const wind = `${m.from === null ? "" : `${compass(m.from)} `}${range(m.windKn)} kn`;
  const gust = m.gustKn !== null && m.gustKn > m.windKn[1] ? `, gusts ${m.gustKn}` : "";
  const wing =
    m.wing === null ? "" : ` ${m.ownWing ? "Your" : "About a"} ${m.wing.toFixed(1)} m wing.`;
  return `${wind}${gust}.${wing}`;
}

export interface Copy {
  title: string;
  body: string;
}

/** A window found. */
export function newCopy(m: AlertMatch, spotName: string): Copy {
  return {
    title: `${spotName} ${stars(m.stars)} ${matchWindow(m)}`,
    body: matchFigures(m),
  };
}

/** A window told before that has moved or changed its stars. */
export function updateCopy(
  m: AlertMatch,
  spotName: string,
  told: { start: string; end: string; stars: number },
): Copy {
  const was =
    told.stars !== m.stars
      ? `Was ${stars(told.stars)}.`
      : `Was ${matchWindow(told)}.`;
  return {
    title: `${spotName} ${stars(m.stars)} ${matchWindow(m)}`,
    body: `Update. ${was} ${matchFigures(m)}`,
  };
}

/** A window told before that is no longer forecast. */
export function calledOffCopy(
  told: { start: string; end: string; stars: number },
  spotName: string,
  rule: Pick<AlertRule, "minStars">,
): Copy {
  return {
    title: `Off: ${spotName} ${matchWindow(told)}`,
    body: `No longer ${stars(rule.minStars)} or better. The forecast moved on.`,
  };
}

/** Several windows at once, for one device: one notification, not a stack. */
export function digestCopy(lines: readonly { spotName: string; match: AlertMatch }[]): Copy {
  const least = Math.min(...lines.map((l) => l.match.stars));
  const shown = lines.slice(0, 4).map((l) => `${l.spotName} ${matchWindow(l.match)}`);
  const more = lines.length > shown.length ? ` and ${lines.length - shown.length} more` : "";
  return {
    title: `${stars(least)} at ${lines.length} spots`,
    body: `${shown.join(" · ")}${more}.`,
  };
}

/** The note the release pipeline asks for. */
export function appUpdateCopy(
  version: string,
  platform: "ios" | "android",
  over: { title?: string; body?: string } = {},
): Copy {
  return {
    title: over.title ?? `Wingfoil ${version}`,
    body:
      over.body ??
      `A new version is out. Update from ${platform === "ios" ? "the App Store" : "Google Play"}.`,
  };
}

/* ---- the app's summaries ---- */

const WEEKENDS: readonly Weekday[] = ["sat", "sun"];
const WEEKDAYS_ONLY: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
const same = (a: readonly Weekday[], b: readonly Weekday[]) =>
  a.length === b.length && b.every((d) => a.includes(d));

/** "Every day", "Weekends", "Weekdays" or "Mon, Wed, Sat". */
export function daysSummary(days: readonly Weekday[]): string {
  if (same(days, WEEKDAYS)) return "Every day";
  if (same(days, WEEKENDS)) return "Weekends";
  if (same(days, WEEKDAYS_ONLY)) return "Weekdays";
  if (!days.length) return "No days";
  return WEEKDAYS.filter((d) => days.includes(d))
    .map((d) => WEEKDAY_SHORT[d])
    .join(", ");
}

/** "09:00–18:00", or "Daylight" for the whole day (night is never rated). */
export const hoursSummary = (fromHour: number, toHour: number) =>
  fromHour <= 0 && toHour >= 24 ? "Daylight" : `${hourLabel(fromHour)}–${hourLabel(toHour)}`;

/** "Weekends · 09:00–18:00 · 2 h or more" */
export const ruleSummary = (rule: Pick<AlertRule, "days" | "fromHour" | "toHour" | "minHours">) =>
  `${daysSummary(rule.days)} · ${hoursSummary(rule.fromHour, rule.toHour)} · ${rule.minHours} h or more`;
