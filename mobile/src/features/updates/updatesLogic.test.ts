import { describe, expect, it } from "vitest";
import {
  OFFER_AFTER_FOREGROUND_MS,
  RECHECK_AFTER_BACKGROUND_MS,
  STORE_CHECK_EVERY_MS,
  checkBusy,
  checkLabel,
  compareBinaries,
  compareVersions,
  formatPublished,
  offerAt,
  parseLatest,
  shortId,
  shouldApplyOnBackground,
  shouldApplyRollbackNow,
  shouldCheckOnForeground,
  shouldOfferRestart,
  shouldReadLatest,
  storeDecision,
  storeDismissKey,
  storeUrl,
  type Latest,
  type PendingUpdate,
} from "./updatesLogic";

const MIN = 60_000;
const T0 = Date.parse("2026-10-14T09:00:00Z");
const update: PendingUpdate = { updateId: "u-1", isRollback: false };
const rollback: PendingUpdate = { isRollback: true };

describe("looking for an over-the-air update", () => {
  it("looks again only after a real absence", () => {
    const back = (away: number, lastCheckAt: number | null = null) =>
      shouldCheckOnForeground({ backgroundedAt: T0, now: T0 + away, lastCheckAt });
    expect(back(30_000)).toBe(false);
    expect(back(RECHECK_AFTER_BACKGROUND_MS - 1)).toBe(false);
    expect(back(RECHECK_AFTER_BACKGROUND_MS)).toBe(true);
    expect(back(2 * RECHECK_AFTER_BACKGROUND_MS, T0 + RECHECK_AFTER_BACKGROUND_MS * 1.5)).toBe(false);
    expect(shouldCheckOnForeground({ backgroundedAt: null, now: T0, lastCheckAt: null })).toBe(false);
  });
});

describe("putting an update in place", () => {
  it("applies a downloaded update when the rider leaves the app", () => {
    expect(shouldApplyOnBackground({ pending: update, restarting: false })).toBe(true);
    expect(shouldApplyOnBackground({ pending: null, restarting: false })).toBe(false);
    expect(shouldApplyOnBackground({ pending: update, restarting: true })).toBe(false);
  });

  it("applies a roll back at once, but never under the rider's finger or while away", () => {
    const now = (o: Partial<Parameters<typeof shouldApplyRollbackNow>[0]>) =>
      shouldApplyRollbackNow({ pending: rollback, held: false, active: true, restarting: false, ...o });
    expect(now({})).toBe(true);
    expect(now({ held: true })).toBe(false);
    expect(now({ active: false })).toBe(false);
    expect(now({ restarting: true })).toBe(false);
    expect(now({ pending: update })).toBe(false);
  });
});

describe("offering a restart", () => {
  const base = { pending: update, readyAt: T0, activeSince: T0, held: false, dismissedUpdateId: null };

  it("waits half an hour of use with the update ready", () => {
    expect(shouldOfferRestart({ ...base, now: T0 + OFFER_AFTER_FOREGROUND_MS - 1 })).toBe(false);
    expect(shouldOfferRestart({ ...base, now: T0 + OFFER_AFTER_FOREGROUND_MS })).toBe(true);
  });

  it("starts the clock again when the rider comes back to the app", () => {
    const activeSince = T0 + 2 * OFFER_AFTER_FOREGROUND_MS;
    expect(offerAt({ pending: update, readyAt: T0, activeSince })).toBe(activeSince + OFFER_AFTER_FOREGROUND_MS);
    expect(shouldOfferRestart({ ...base, activeSince, now: activeSince + 5 * MIN })).toBe(false);
  });

  it("stays out of the way while held, once dismissed, and for a roll back", () => {
    const now = T0 + OFFER_AFTER_FOREGROUND_MS + MIN;
    expect(shouldOfferRestart({ ...base, now, held: true })).toBe(false);
    expect(shouldOfferRestart({ ...base, now, dismissedUpdateId: "u-1" })).toBe(false);
    expect(shouldOfferRestart({ ...base, now, dismissedUpdateId: "u-0" })).toBe(true);
    expect(shouldOfferRestart({ ...base, now, pending: rollback })).toBe(false);
    expect(shouldOfferRestart({ ...base, now, pending: null })).toBe(false);
    expect(shouldOfferRestart({ ...base, now, readyAt: null })).toBe(false);
  });
});

describe("the manual check", () => {
  it("says what it is doing, and cannot be pressed while busy", () => {
    expect(checkLabel("idle")).toBe("Check for updates");
    expect(checkLabel("checking")).toBe("Checking…");
    expect(checkLabel("downloading")).toBe("Downloading…");
    expect(checkLabel("restarting")).toBe("Restarting…");
    expect(checkLabel("upToDate")).toBe("Up to date");
    expect(checkBusy("checking")).toBe(true);
    expect(checkBusy("off")).toBe(true);
    expect(checkBusy("upToDate")).toBe(false);
    expect(checkBusy("failed")).toBe(false);
  });
});

describe("versions", () => {
  it("compares dotted versions as numbers", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBe(0);
    expect(compareVersions("0.9", "1")).toBe(-1);
  });

  it("breaks a tie on the build number", () => {
    expect(compareBinaries({ version: "1.2.0", build: "41" }, { version: "1.2.0", build: "42" })).toBe(-1);
    expect(compareBinaries({ version: "1.3.0", build: "1" }, { version: "1.2.0", build: "42" })).toBe(1);
    expect(compareBinaries({ version: "1.2.0", build: null }, { version: "1.2.0", build: "42" })).toBe(0);
  });
});

describe("app/latest.json and the store", () => {
  const raw = {
    schemaVersion: 1,
    release: "2026.10.14",
    ios: {
      runtimeVersion: "rt-new",
      store: { version: "1.2.0", build: "42", runtimeVersion: "rt-new", availableAt: "2026-10-13T00:00:00Z" },
      minimumVersion: null,
      storeUrl: "https://apps.apple.com/app/id123",
    },
    android: {
      runtimeVersion: "rt-new-a",
      store: { version: "1.2.0", build: 43, runtimeVersion: "rt-new-a", availableAt: null },
      minimumVersion: "1.1.0",
      storeUrl: null,
    },
  };
  const latest = parseLatest(raw) as Latest;
  const decide = (o: Partial<Parameters<typeof storeDecision>[0]> = {}) =>
    storeDecision({
      latest,
      platform: "ios",
      variant: "production",
      installed: { version: "1.1.0", build: "30", runtimeVersion: "rt-old" },
      applicationId: "ie.wingfoil.app",
      now: T0,
      dismissedVersion: null,
      ...o,
    });

  it("reads the file, and refuses what it does not understand", () => {
    expect(latest.ios?.store).toMatchObject({ version: "1.2.0", build: "42" });
    expect(latest.android?.store?.build).toBe("43");
    expect(parseLatest({ ...raw, schemaVersion: 2 })).toBeNull();
    expect(parseLatest("nope")).toBeNull();
    expect(parseLatest({ schemaVersion: 1, ios: { store: { version: "" } } })?.ios?.store).toBeNull();
  });

  it("offers the store to an older binary on an older runtime", () => {
    expect(decide()).toEqual({ kind: "available", version: "1.2.0", url: "https://apps.apple.com/app/id123" });
  });

  it("does not nag a binary that already gets production's update over the air", () => {
    expect(decide({ installed: { version: "1.1.0", build: "30", runtimeVersion: "rt-new" } })).toEqual({ kind: "none" });
  });

  it("is quiet for the newest binary, before the review window ends, once dismissed, and off production", () => {
    expect(decide({ installed: { version: "1.2.0", build: "42", runtimeVersion: "rt-old" } }).kind).toBe("none");
    expect(decide({ now: Date.parse("2026-10-12T00:00:00Z") }).kind).toBe("none");
    expect(decide({ dismissedVersion: storeDismissKey({ version: "1.2.0", build: "42" }) }).kind).toBe("none");
    expect(decide({ variant: "staging" }).kind).toBe("none");
    expect(decide({ latest: null }).kind).toBe("none");
  });

  it("requires the store below the minimum, dismissed or not", () => {
    const required = decide({
      platform: "android",
      installed: { version: "1.0.4", build: "9", runtimeVersion: "rt-new-a" },
      applicationId: "ie.wingfoil.app",
      dismissedVersion: "1.2.0+43",
    });
    expect(required).toEqual({
      kind: "required",
      version: "1.2.0",
      url: "https://play.google.com/store/apps/details?id=ie.wingfoil.app",
    });
  });

  it("makes a store link from the identifier when latest.json has none", () => {
    expect(storeUrl("android", "ie.wingfoil.app", null)).toContain("id=ie.wingfoil.app");
    expect(storeUrl("ios", "ie.wingfoil.app", null)).toMatch(/^https:\/\/apps\.apple\.com\//);
    expect(storeUrl("ios", "x", "itms-apps://apps.apple.com/app/id1")).toBe("itms-apps://apps.apple.com/app/id1");
  });

  it("reads latest.json at most every few hours", () => {
    expect(shouldReadLatest(null, T0)).toBe(true);
    expect(shouldReadLatest(T0, T0 + STORE_CHECK_EVERY_MS - 1)).toBe(false);
    expect(shouldReadLatest(T0, T0 + STORE_CHECK_EVERY_MS)).toBe(true);
  });
});

describe("what About shows", () => {
  it("shortens ids and dates", () => {
    expect(shortId("0193a6b2-7c1d-7e00-9a2b-3c4d5e6f7a8b")).toBe("0193a6b2");
    expect(shortId(null)).toBe("—");
    expect(formatPublished(new Date(2026, 9, 14, 9, 5))).toBe("14 Oct 2026, 09:05");
    expect(formatPublished(null)).toBe("—");
  });
});
