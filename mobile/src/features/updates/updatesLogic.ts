/**
 * When the app looks for, applies and offers an update. Pure: no React, no
 * Expo, so the timing and every decision are tested in Node
 * (updatesLogic.test.ts). docs/MOBILE.md, "How riders get an update", is the
 * story; this is the arithmetic.
 *
 * Two kinds of update reach a rider:
 *  - an over-the-air update (the JavaScript bundle the release train promoted,
 *    served by EAS Update to binaries of the same runtime): looked for at launch
 *    and when the app comes back after a while, downloaded quietly, and put in
 *    place the next time the rider leaves the app. Only if they stay in the app
 *    a long time with one waiting does a small banner offer a restart.
 *  - a store update (a new binary, when the native code changed): the site's
 *    app/latest.json says which store version is current and the oldest still
 *    supported; an older binary shows a banner pointing at the store.
 *
 * The pattern is t3code's (apps/mobile/src/features/updates there), with a
 * banner in place of a system alert and the rider's gestures respected.
 */

export type Platform = "ios" | "android";
export type Variant = "development" | "staging" | "production";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Back after this long away: look again (t3code: 15 minutes). */
export const RECHECK_AFTER_BACKGROUND_MS = 15 * MINUTE;
/** An update waiting this long while the rider stays in the app: offer it. */
export const OFFER_AFTER_FOREGROUND_MS = 30 * MINUTE;
/** app/latest.json is read at most this often. */
export const STORE_CHECK_EVERY_MS = 6 * HOUR;

// --- over-the-air -----------------------------------------------------------

/**
 * Coming back to the app: check again only after a real absence, so flicking
 * to Messages and back is not a network call, and never twice in a row.
 */
export function shouldCheckOnForeground({
  backgroundedAt,
  now,
  lastCheckAt,
}: {
  backgroundedAt: number | null;
  now: number;
  lastCheckAt: number | null;
}): boolean {
  if (backgroundedAt === null) return false;
  if (now - backgroundedAt < RECHECK_AFTER_BACKGROUND_MS) return false;
  return lastCheckAt === null || now - lastCheckAt >= RECHECK_AFTER_BACKGROUND_MS;
}

export interface PendingUpdate {
  /** The downloaded update's id; undefined for a roll back to the embedded bundle. */
  updateId?: string;
  /** EAS Update can tell the app to go back to what shipped in the binary. */
  isRollback: boolean;
}

/**
 * The app going to the background with an update downloaded: put it in place
 * now, while nobody is looking. Never while it is already restarting.
 */
export function shouldApplyOnBackground({
  pending,
  restarting,
}: {
  pending: PendingUpdate | null;
  restarting: boolean;
}): boolean {
  return pending !== null && !restarting;
}

/**
 * A roll back is applied at once (the update it replaces was withdrawn for a
 * reason), but never under the rider's finger: not while a sheet is being
 * dragged or the timeline scrubbed (hold.ts), and not while the rider is away
 * (going to the background applies it anyway).
 */
export function shouldApplyRollbackNow({
  pending,
  held,
  active,
  restarting,
}: {
  pending: PendingUpdate | null;
  held: boolean;
  active: boolean;
  restarting: boolean;
}): boolean {
  return !!pending?.isRollback && !held && active && !restarting;
}

/**
 * When the "Update ready" banner may show, as a time (ms since epoch), or null
 * for never. The clock starts when the update was ready or the rider last came
 * back to the app, whichever is later: half an hour of use with an update
 * waiting, not half an hour since a download they never saw.
 */
export function offerAt({
  pending,
  readyAt,
  activeSince,
}: {
  pending: PendingUpdate | null;
  readyAt: number | null;
  activeSince: number | null;
}): number | null {
  if (!pending || pending.isRollback || readyAt === null || activeSince === null) return null;
  return Math.max(readyAt, activeSince) + OFFER_AFTER_FOREGROUND_MS;
}

/** Whether the "Update ready" banner shows now. */
export function shouldOfferRestart({
  pending,
  readyAt,
  activeSince,
  now,
  held,
  dismissedUpdateId,
}: {
  pending: PendingUpdate | null;
  readyAt: number | null;
  activeSince: number | null;
  now: number;
  held: boolean;
  dismissedUpdateId: string | null;
}): boolean {
  const at = offerAt({ pending, readyAt, activeSince });
  if (at === null || now < at || held) return false;
  return !pending?.updateId || pending.updateId !== dismissedUpdateId;
}

// --- the manual check (About) -------------------------------------------------

/** What "Check for updates" says, as t3code's hidden check does. */
export type CheckState =
  | "idle"
  | "checking"
  | "downloading"
  | "restarting"
  | "upToDate"
  | "failed"
  | "off";

export function checkLabel(state: CheckState): string {
  switch (state) {
    case "checking":
      return "Checking…";
    case "downloading":
      return "Downloading…";
    case "restarting":
      return "Restarting…";
    case "upToDate":
      return "Up to date";
    case "failed":
      return "Could not check · Try again";
    case "off":
      return "Updates are off in this build";
    default:
      return "Check for updates";
  }
}

/** A button that is doing something, or has nothing to do, cannot be pressed. */
export function checkBusy(state: CheckState): boolean {
  return state === "checking" || state === "downloading" || state === "restarting" || state === "off";
}

// --- versions and the store ---------------------------------------------------

/**
 * Compare two dotted versions numerically ("1.10.0" > "1.9.2"); a missing part
 * counts as 0 and anything after a "-" or "+" is ignored.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    String(v)
      .trim()
      .split(/[-+]/)[0]
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** A binary, as the store numbers it: the marketing version, then the build. */
export interface Binary {
  version: string;
  build?: string | null;
}

/** Version first, then build number (EAS increments it per store build). */
export function compareBinaries(a: Binary, b: Binary): number {
  const byVersion = compareVersions(a.version, b.version);
  if (byVersion !== 0) return byVersion;
  if (!a.build || !b.build) return 0;
  return compareVersions(a.build, b.build);
}

/** One platform's entry in app/latest.json (scripts/release/mobile.mjs latest-json). */
export interface LatestPlatform {
  /** The runtime production's over-the-air update is published for. */
  runtimeVersion: string | null;
  /** The newest production binary in the store, or null before the first. */
  store: (Binary & { runtimeVersion: string | null; availableAt: string | null }) | null;
  /** The oldest version still served; below it the store update is required. */
  minimumVersion: string | null;
  /** The store page, when the release knows it (the App Store needs its numeric id). */
  storeUrl: string | null;
}

export interface Latest {
  schemaVersion: 1;
  release: string;
  ios: LatestPlatform | null;
  android: LatestPlatform | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** app/latest.json as read off the network: anything malformed is null, not a crash. */
export function parseLatest(json: unknown): Latest | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return null;
  const platform = (value: unknown): LatestPlatform | null => {
    if (!value || typeof value !== "object") return null;
    const p = value as Record<string, unknown>;
    const s = p.store && typeof p.store === "object" ? (p.store as Record<string, unknown>) : null;
    const version = s ? str(s.version) : null;
    return {
      runtimeVersion: str(p.runtimeVersion),
      store: s && version
        ? {
            version,
            build: str(s.build) ?? (typeof s.build === "number" ? String(s.build) : null),
            runtimeVersion: str(s.runtimeVersion),
            availableAt: str(s.availableAt),
          }
        : null,
      minimumVersion: str(p.minimumVersion),
      storeUrl: str(p.storeUrl),
    };
  };
  return {
    schemaVersion: 1,
    release: str(raw.release) ?? "",
    ios: platform(raw.ios),
    android: platform(raw.android),
  };
}

/** The store page for this app: latest.json's, else one made from the identifier. */
export function storeUrl(platform: Platform, applicationId: string, fromLatest: string | null): string {
  if (fromLatest) return fromLatest;
  if (platform === "android") return `https://play.google.com/store/apps/details?id=${encodeURIComponent(applicationId)}`;
  // The App Store links by numeric id only; without one, its search finds the app.
  return "https://apps.apple.com/ie/search?term=Wingfoil";
}

export type StoreDecision =
  | { kind: "none" }
  | { kind: "available"; version: string; url: string }
  | { kind: "required"; version: string; url: string };

/**
 * Whether this binary should send the rider to the store.
 *
 * Required: it is older than latest.json's minimum. Offered: the store has a
 * newer binary that is past its review window (availableAt), and this one
 * cannot get production's over-the-air update because its runtime differs; a
 * binary on the current runtime already runs the newest code. Dismissed once
 * per store version. Only the production app: staging comes from TestFlight
 * and Play's internal track, development from a laptop.
 */
export function storeDecision({
  latest,
  platform,
  variant,
  installed,
  applicationId,
  now,
  dismissedVersion,
}: {
  latest: Latest | null;
  platform: Platform;
  variant: Variant;
  installed: Binary & { runtimeVersion: string | null };
  applicationId: string;
  now: number;
  dismissedVersion: string | null;
}): StoreDecision {
  if (variant !== "production" || !latest || !installed.version) return { kind: "none" };
  const entry = latest[platform];
  if (!entry) return { kind: "none" };
  const url = storeUrl(platform, applicationId, entry.storeUrl);
  const target = entry.store?.version ?? entry.minimumVersion;
  if (entry.minimumVersion && compareVersions(installed.version, entry.minimumVersion) < 0)
    return { kind: "required", version: target ?? entry.minimumVersion, url };
  const store = entry.store;
  if (!store) return { kind: "none" };
  if (store.availableAt && Date.parse(store.availableAt) > now) return { kind: "none" };
  if (compareBinaries(installed, store) >= 0) return { kind: "none" };
  if (installed.runtimeVersion && entry.runtimeVersion && installed.runtimeVersion === entry.runtimeVersion)
    return { kind: "none" };
  const key = storeDismissKey(store);
  if (dismissedVersion === key) return { kind: "none" };
  return { kind: "available", version: store.version, url };
}

/** What "Not now" on the store banner remembers: this store binary. */
export const storeDismissKey = (store: Binary) => `${store.version}+${store.build ?? ""}`;

/** Whether latest.json is due another read. */
export function shouldReadLatest(lastReadAt: number | null, now: number): boolean {
  return lastReadAt === null || now - lastReadAt >= STORE_CHECK_EVERY_MS;
}

// --- what About shows -----------------------------------------------------------

/** A runtime or update id, short enough to read aloud; the whole one on request. */
export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return "—";
  return id.replace(/-/g, "").slice(0, length);
}

/** "14 Oct 2026, 09:05" in the rider's own time zone, from a Date the runtime gave us. */
export function formatPublished(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Tapping the version this many times shows the full ids (t3code hides its check the same way). */
export const DETAIL_TAPS = 5;
