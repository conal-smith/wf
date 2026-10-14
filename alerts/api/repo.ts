/**
 * What the alerts service keeps, behind one seam with two backends: memory
 * (development and tests) and Postgres (migrations/0001_init.sql).
 *
 *   devices   one row per install: its hashed secret, push token, rider, the
 *             two preferences and its rules (a whole list, replaced at once)
 *   notices   what each device has been told about each window (rule, spot,
 *             Irish day), so a window is announced once and again only when
 *             it materially changes
 *   outbox    notifications waiting to be sent: now, or at 07:00 after quiet
 *             hours; one per device and key, so a later word replaces an
 *             earlier one that has not gone yet
 *   tickets   Expo's receipts still to check, to drop tokens that are dead
 *   state     the last run evaluated and the announcements already made
 */
import type { AlertMatch, AlertRule, AppVariant, NoticeKind, Platform, Rider } from "../shared/protocol.js";

export interface DeviceRow {
  id: string;
  installationId: string;
  secretHash: string;
  expoPushToken: string | null;
  platform: Platform;
  appVariant: AppVariant;
  appVersion: string;
  timezone: string;
  rider: Rider;
  quietHours: boolean;
  appUpdates: boolean;
  rules: AlertRule[];
  createdAt: Date;
  updatedAt: Date;
  rulesUpdatedAt: Date;
  lastSeenAt: Date;
}

export type NewDevice = Omit<DeviceRow, "createdAt" | "updatedAt" | "rulesUpdatedAt" | "lastSeenAt" | "rules">;

export type DevicePatch = Partial<
  Pick<DeviceRow, "expoPushToken" | "appVariant" | "appVersion" | "timezone" | "rider" | "quietHours" | "appUpdates">
>;

export interface Notice {
  ruleId: string;
  spotId: string;
  /** Irish day, YYYY-MM-DD. */
  day: string;
  /** The rule's signature when it was told (match.ts ruleSignature). */
  ruleSig: string;
  start: string;
  end: string;
  stars: number;
  /** "told": the rider knows of the window; "off": they were told it is off. */
  state: "told" | "off";
  /** Notifications sent for this key: the cap on how often one window may speak. */
  count: number;
}

export interface OutboxMessage {
  deviceId: string;
  /** One per device and key: `<rule>|<spot>|<day>` or `app-update|<version>`. */
  key: string;
  kind: NoticeKind;
  deliverAfter: Date;
  /** Not worth sending after this: the window is over. */
  expiresAt: Date;
  title: string;
  body: string;
  data: Record<string, string>;
  channelId: string;
  /** A new window's own words, so several due at once can be folded into one. */
  fold?: { spotName: string; match: AlertMatch };
}

export interface OutboxRow extends OutboxMessage {
  id: string;
  attempts: number;
}

export interface Ticket {
  id: string;
  deviceId: string;
  token: string;
  createdAt: Date;
}

/** What one evaluation decided for one device. */
export interface DevicePlan {
  deviceId: string;
  notices: { put: Notice[]; drop: Pick<Notice, "ruleId" | "spotId" | "day">[] };
  outbox: { put: OutboxMessage[]; drop: string[] };
}

export interface AlertsRepo {
  createDevice(device: NewDevice, now: Date): Promise<DeviceRow>;
  getDevice(id: string): Promise<DeviceRow | null>;
  /** Null when the device is gone. A token taken here is cleared from any other device. */
  updateDevice(id: string, patch: DevicePatch, now: Date): Promise<DeviceRow | null>;
  /** Marks the device seen; a stale install is forgotten after DEVICE_TTL_DAYS. */
  touchDevice(id: string, now: Date): Promise<void>;
  /** The device, its rules, notices, queued notifications and tickets, all gone. */
  deleteDevice(id: string): Promise<boolean>;
  putRules(id: string, rules: AlertRule[], now: Date): Promise<DeviceRow | null>;

  /**
   * Devices with a push token and an enabled rule or a notice to settle,
   * every one, or those changed (device or rules) since `since`.
   */
  devicesToEvaluate(since: Date | null): Promise<DeviceRow[]>;
  notices(deviceId: string): Promise<Notice[]>;
  queued(deviceId: string): Promise<OutboxRow[]>;
  applyPlan(plan: DevicePlan): Promise<void>;

  /** Devices that asked for app-update notes, with a token, on these platforms and variants. */
  updateSubscribers(platforms: readonly Platform[], variants: readonly AppVariant[]): Promise<DeviceRow[]>;
  enqueue(messages: OutboxMessage[]): Promise<void>;
  /** Takes up to `limit` due messages off the outbox, so no other instance sends them; drops the expired. */
  claimDue(now: Date, limit: number): Promise<OutboxRow[]>;
  /** Puts claimed messages back after a failed send. */
  requeue(rows: OutboxRow[], at: Date): Promise<void>;

  addTickets(tickets: Ticket[]): Promise<void>;
  ticketsBefore(before: Date, limit: number): Promise<Ticket[]>;
  dropTickets(ids: string[]): Promise<void>;
  /** Clears a dead token, if the device still holds that one. */
  clearToken(deviceId: string, token: string): Promise<void>;

  getState(key: string): Promise<unknown | null>;
  setState(key: string, value: unknown): Promise<void>;
  /** Sets the key if it is not set yet; false when it already was. */
  claimState(key: string, value: unknown): Promise<boolean>;

  /** Forgets stale devices, past notices and old tickets. */
  prune(now: Date): Promise<void>;
  close(): Promise<void>;
}

/** An install not heard from for this long is forgotten, rules and all. */
export const DEVICE_TTL_DAYS = 180;
/** Receipts Expo has not answered for a day are let go. */
export const TICKET_TTL_MS = 24 * 3_600_000;
