/**
 * Star-condition alerts on the phone, the pure part: what is kept on the
 * device, how a draft rule is built and checked, what a notification opens,
 * and the short lines the screens show. No React Native here, so the tests
 * run in Node. The matching itself is the site's (alerts/shared/match.ts),
 * the same code the API sends from.
 */
import type { Href } from "expo-router";
import {
  LIMITS,
  RULE_DEFAULTS,
  WEEKDAYS,
  type AlertMatch,
  type AlertRule,
  type PushData,
  type Weekday,
} from "../../../../alerts/shared/protocol";

/** Where the rules and the sync bookkeeping are kept (the device's localStorage). */
export const ALERTS_KEY = "wingfoil.alerts.v1";

export interface LocalAlerts {
  v: 1;
  rules: AlertRule[];
  /** Hold notifications from 22:00 to 07:00 Irish time. */
  quietHours: boolean;
  /** A note when a new version of the app is out. */
  appUpdates: boolean;
  /** Bumped by every change to the rules; `syncedRev` is the last one the API has. */
  rev: number;
  syncedRev: number;
  /** When the API last confirmed everything, ms. */
  syncedAt: number | null;
  /** The device fields last sent (`deviceFingerprint`), so unchanged ones are not sent again. */
  sentDevice: string | null;
}

export const emptyAlerts = (): LocalAlerts => ({
  v: 1,
  rules: [],
  quietHours: true,
  appUpdates: true,
  rev: 0,
  syncedRev: 0,
  syncedAt: null,
  sentDevice: null,
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

/** A stored rule, checked field by field; null when it cannot be used at all. */
export function parseRule(value: unknown): AlertRule | null {
  if (!isObject(value) || typeof value.id !== "string" || !value.id) return null;
  const spots = Array.isArray(value.spots)
    ? [...new Set(value.spots.filter((s): s is string => typeof s === "string"))].slice(0, LIMITS.spotsPerRule)
    : [];
  const days = Array.isArray(value.days)
    ? WEEKDAYS.filter((d) => (value.days as unknown[]).includes(d))
    : [...RULE_DEFAULTS.days];
  const fromHour = int(value.fromHour, 0, 23, RULE_DEFAULTS.fromHour);
  const toHour = int(value.toHour, 1, 24, RULE_DEFAULTS.toHour);
  return {
    id: value.id.slice(0, 40),
    name: typeof value.name === "string" && value.name.trim() ? value.name.slice(0, LIMITS.nameChars) : "Alert",
    spots,
    minStars: int(value.minStars, 1, 5, RULE_DEFAULTS.minStars),
    days,
    fromHour: fromHour < toHour ? fromHour : RULE_DEFAULTS.fromHour,
    toHour: fromHour < toHour ? toHour : RULE_DEFAULTS.toHour,
    minHours: int(value.minHours, LIMITS.minHours.min, LIMITS.minHours.max, RULE_DEFAULTS.minHours),
    leadDays: int(value.leadDays, LIMITS.leadDays.min, LIMITS.leadDays.max, RULE_DEFAULTS.leadDays),
    calledOff: value.calledOff === true,
    enabled: value.enabled !== false,
  };
}

/** What localStorage held, or a fresh start for anything unreadable. */
export function parseLocal(text: string | null): LocalAlerts {
  if (!text) return emptyAlerts();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyAlerts();
  }
  if (!isObject(raw) || raw.v !== 1) return emptyAlerts();
  const base = emptyAlerts();
  const rules = Array.isArray(raw.rules)
    ? raw.rules.map(parseRule).filter((r): r is AlertRule => r !== null).slice(0, LIMITS.rules)
    : [];
  return {
    ...base,
    rules,
    quietHours: raw.quietHours !== false,
    appUpdates: raw.appUpdates !== false,
    rev: int(raw.rev, 0, Number.MAX_SAFE_INTEGER, 0),
    syncedRev: int(raw.syncedRev, 0, Number.MAX_SAFE_INTEGER, 0),
    syncedAt: typeof raw.syncedAt === "number" ? raw.syncedAt : null,
    sentDevice: typeof raw.sentDevice === "string" ? raw.sentDevice : null,
  };
}

/** A rule id: unique enough among one phone's twenty. */
export const newRuleId = (now = Date.now(), random = Math.random) =>
  `r${now.toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;

/** A new rule, for one spot when the editor was opened from it. */
export function draftRule(spot?: { id: string; name: string } | null, id = newRuleId()): AlertRule {
  return {
    id,
    name: spot ? spot.name : "",
    spots: spot ? [spot.id] : [],
    ...RULE_DEFAULTS,
    days: [...RULE_DEFAULTS.days],
  };
}

/** Why a draft cannot be saved yet, in a sentence, or null. */
export function draftProblem(rule: AlertRule): string | null {
  if (!rule.spots.length) return "Pick at least one spot.";
  if (rule.spots.length > LIMITS.spotsPerRule) return `At most ${LIMITS.spotsPerRule} spots an alert.`;
  if (!rule.days.length) return "Pick at least one day.";
  if (rule.fromHour >= rule.toHour) return "The hours must start before they end.";
  if (rule.toHour - rule.fromHour < rule.minHours) return "The hours are shorter than the window asked for.";
  return null;
}

/** The name a rule is saved under: the rider's, else its first spot's. */
export const ruleName = (rule: AlertRule, nameOf: (id: string) => string) =>
  rule.name.trim().slice(0, LIMITS.nameChars) ||
  (rule.spots.length ? `${nameOf(rule.spots[0])}${rule.spots.length > 1 ? ` +${rule.spots.length - 1}` : ""}` : "Alert");

/** The rules with this one saved in its place, or added at the end. */
export function upsertRule(rules: readonly AlertRule[], rule: AlertRule): AlertRule[] {
  const at = rules.findIndex((r) => r.id === rule.id);
  if (at < 0) return [...rules, rule];
  return rules.map((r, i) => (i === at ? rule : r));
}

export const DAY_PRESETS: readonly { label: string; days: readonly Weekday[] }[] = [
  { label: "Weekends", days: ["sat", "sun"] },
  { label: "Weekdays", days: ["mon", "tue", "wed", "thu", "fri"] },
  { label: "Every day", days: WEEKDAYS },
];

/** A weekday chip pressed: on or off, kept in week order. */
export const toggleDay = (days: readonly Weekday[], day: Weekday): Weekday[] =>
  WEEKDAYS.filter((d) => (d === day ? !days.includes(d) : days.includes(d)));

/** "Brandon Bay, Inch Strand +2" */
export function spotsSummary(ids: readonly string[], nameOf: (id: string) => string, shown = 2): string {
  if (!ids.length) return "No spots";
  const names = ids.slice(0, shown).map(nameOf);
  return `${names.join(", ")}${ids.length > shown ? ` +${ids.length - shown}` : ""}`;
}

/** The soonest of a rule's matches, the best of equals. */
export const nextMatch = (matches: readonly AlertMatch[]): AlertMatch | null =>
  [...matches].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || b.stars - a.stars,
  )[0] ?? null;

/**
 * Where a notification opens: the chart at the spot and hour, or About for an
 * app update. Paths the API wrote (`/?spot=…&t=…`) are read back the same way.
 */
export function notificationRoute(data: unknown): Href | null {
  if (!isObject(data)) return null;
  const d = data as Partial<PushData> & Record<string, unknown>;
  if (d.kind === "app-update") return "/settings/about" as Href;
  let spot = typeof d.spot === "string" ? d.spot : null;
  let t = typeof d.t === "string" ? d.t : null;
  if (!spot && typeof d.path === "string") {
    const query = d.path.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    spot = params.get("spot");
    t = params.get("t");
  }
  if (!spot) return null;
  return { pathname: "/", params: t ? { spot, t } : { spot } };
}

/** The device fields the API keeps, as one string: sent again only when it changes. */
export const deviceFingerprint = (fields: Record<string, unknown>) =>
  JSON.stringify(Object.keys(fields).sort().map((k) => [k, fields[k]]));

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

/** The quiet line under the title: whether the API has what the phone has. */
export function syncLine(
  local: Pick<LocalAlerts, "rev" | "syncedRev" | "syncedAt" | "rules">,
  status: SyncStatus,
  clock: (ms: number) => string,
): string {
  if (!local.rules.length) return "";
  if (status === "syncing") return "Saving…";
  const pending = local.rev !== local.syncedRev;
  if (status === "offline") return pending ? "Saved on this phone. Sends when you are online." : "Offline.";
  if (status === "error") return "Saved on this phone. Could not reach wingfoil.ie.";
  if (pending) return "Saved on this phone.";
  return local.syncedAt ? `Up to date, ${clock(local.syncedAt)}.` : "";
}

/** Whether this build can get a push token at all, and if not, why. */
export type PushSupport = "ok" | "no-project" | "simulator";
export const pushSupport = (projectId: string | null | undefined, isDevice: boolean): PushSupport =>
  !projectId ? "no-project" : !isDevice ? "simulator" : "ok";
