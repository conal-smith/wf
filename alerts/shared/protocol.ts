/**
 * Star-condition alerts: what the app and the alerts API (alerts/api) say to
 * each other. Types and limits only, no dependencies, so the app imports it
 * as it is; the API checks every body against the zod schemas beside it
 * (schema.ts), which are held to these types.
 *
 * A device registers with no sign-in and gets back a secret; its rules are a
 * whole list it replaces. Times on the wire are ISO instants; every day and
 * hour a rider sets is Irish local time (Europe/Dublin), whatever the phone's
 * own zone, because the forecast and its stars are Irish.
 */
import type { Rider } from "../../force5/src/stars.js";

export type { Rider };

/** Where the API is mounted, from the API's root. */
export const ALERTS_API = "api/alerts";
/** `Authorization: Device <deviceId>.<secret>` */
export const DEVICE_SCHEME = "Device";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const LIMITS = {
  rules: 20,
  spotsPerRule: 20,
  nameChars: 60,
  minStars: { min: 1, max: 5 },
  /** Consecutive rated hours at or over the stars, before a window counts. */
  minHours: { min: 1, max: 12 },
  /** How many days after today a window may be and still be announced. */
  leadDays: { min: 1, max: 7 },
} as const;

export interface AlertRule {
  /** Made by the app; unique among one device's rules. */
  id: string;
  name: string;
  /** Riding place ids, as the map and the published blend name them. */
  spots: string[];
  /** 1–5: every hour of a window holds at least this many solid stars. */
  minStars: number;
  /** Irish weekdays a window may fall on. */
  days: Weekday[];
  /** Irish hours, `fromHour` inclusive, `toHour` exclusive: 0 and 24 are the whole day. */
  fromHour: number;
  toHour: number;
  /** A window is this many hours or more of consecutive qualifying hours. */
  minHours: number;
  /** 1 = today and tomorrow; 3 = up to three days after today. */
  leadDays: number;
  /** Also say so when a window already announced is no longer forecast. */
  calledOff: boolean;
  enabled: boolean;
}

export const RULE_DEFAULTS: Omit<AlertRule, "id" | "name" | "spots"> = {
  minStars: 4,
  days: [...WEEKDAYS],
  fromHour: 9,
  toHour: 18,
  minHours: 2,
  leadDays: 3,
  calledOff: false,
  enabled: true,
};

export type Platform = "ios" | "android";
export type AppVariant = "development" | "staging" | "production";

/** POST /devices */
export interface DeviceRegistration {
  /** The app's own id for this install, kept in the keychain / keystore. */
  installationId: string;
  /** `ExponentPushToken[…]`, or null until notifications are allowed. */
  expoPushToken: string | null;
  platform: Platform;
  appVariant: AppVariant;
  appVersion: string;
  /** The phone's zone, for support only: rules are always Irish time. */
  timezone: string;
  rider: Rider;
  /** Hold notifications from 22:00 to 07:00 Irish time. */
  quietHours: boolean;
  /** A note when a new version of the app is out. */
  appUpdates: boolean;
}

/** PUT /devices/me: any of these. */
export type DeviceUpdate = Partial<
  Omit<DeviceRegistration, "installationId" | "platform">
>;

/** What the API shows of a device: never its secret or its token. */
export interface DeviceView {
  id: string;
  platform: Platform;
  appVariant: AppVariant;
  appVersion: string;
  timezone: string;
  hasPushToken: boolean;
  rider: Rider;
  quietHours: boolean;
  appUpdates: boolean;
  createdAt: string;
  rulesUpdatedAt: string;
}

/** POST /devices answers this once: the secret is not kept in the clear. */
export interface Registered {
  device: DeviceView;
  /** For `Authorization: Device <device.id>.<secret>`. */
  secret: string;
}

/** GET and PUT /devices/me/rules */
export interface RulesPayload {
  rules: AlertRule[];
}

/** One window a rule matches: one spot, one Irish day. */
export interface AlertMatch {
  ruleId: string;
  spotId: string;
  /** The Irish day, YYYY-MM-DD. */
  day: string;
  /** ISO instants; `end` is exclusive. */
  start: string;
  end: string;
  hours: number;
  /** The weakest hour's solid stars: what the window can be relied on for. */
  stars: number;
  /** The best hour's. */
  peakStars: number;
  /** Mean wind across the window's hours, lowest and highest, whole knots. */
  windKn: [number, number];
  /** Highest gust, whole knots, where the models publish one. */
  gustKn: number | null;
  /** Mean bearing the wind blows from, degrees. */
  from: number | null;
  /** The wing for most of the window, m²: the rider's own when they listed a quiver. */
  wing: number | null;
  ownWing: boolean;
  /** Qualifying windows that day; the best is the one given. */
  windows: number;
}

/** GET /devices/me/preview: the next matches, as the server sees them. */
export interface PreviewPayload {
  /** The blend run evaluated, or null when there is none to trust. */
  run: string | null;
  generatedAt: string | null;
  rules: { ruleId: string; matches: AlertMatch[] }[];
  /** Spot ids the published forecast does not know. */
  unknownSpots: string[];
}

/** POST /announce, from the release pipeline. */
export interface Announcement {
  kind: "app-update";
  version: string;
  platforms?: Platform[];
  title?: string;
  body?: string;
}

export type NoticeKind = "new" | "update" | "called-off" | "digest" | "app-update";

/** What a notification carries for the app to open. */
export interface PushData {
  kind: NoticeKind;
  /** An in-app path: `/?spot=brandon&t=2026-10-17T13:00:00Z` or `/settings/about`. */
  path: string;
  spot?: string;
  t?: string;
  alertId?: string;
  version?: string;
}

/** The Android channels the app creates and the API posts to. */
export const CHANNELS = { alerts: "alerts", updates: "updates" } as const;

/** The error body every refusal has, as the rest of the API. */
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, string>;
  retryAfter?: number;
}
