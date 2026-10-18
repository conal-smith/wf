/**
 * A signed-in rider's own star rating, kept on the device (force5.prefs.v1)
 * and with their account (GET and PUT /api/me/rider), so it follows them
 * from device to device. Each copy carries the moment it was set or reset;
 * when the two differ the newer wins, whichever side it is on, and the
 * account itself never takes a write older than what it keeps.
 *
 * No React and no identity provider here: `shared/web/useRiderSync.tsx` runs it
 * for whoever is signed in, and the pages hear of an adopted rating through
 * PREFS_EVENT, which every page that rates already listens for.
 */
import {
  PREFS_KEY,
  loadPrefs,
  savePrefs,
  type Prefs,
  type PrefsStorage,
} from "../../force5/src/prefs";
import { parseCustomRating, sameCustomRating } from "../../force5/src/stars";
import type { RiderProfile, RiderProfileInput } from "../../site/shared/rider";
import { request, type ApiSettings } from "./http";

/**
 * Said on window whenever the stored preferences change outside a page's own
 * state: an account's rating adopted, or the dialog saved elsewhere. `detail`
 * says who changed them, so the sync does not answer its own news.
 */
export const PREFS_EVENT = "wingfoil:prefs";
export type PrefsChange = "device" | "account";

export function announcePrefs(change: PrefsChange): void {
  globalThis.dispatchEvent?.(
    new CustomEvent<PrefsChange>(PREFS_EVENT, { detail: change }),
  );
}

/**
 * Calls `listener` when the stored preferences change under the page: in this
 * tab, from the account or another part of the page, or in another tab. Gives
 * back the way to stop.
 */
export function onPrefsChange(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFS_KEY) listener();
  };
  window.addEventListener(PREFS_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PREFS_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether a device has signed in before: then the map loads the sync, else it never pays for it. */
export const SIGNED_IN_KEY = "wingfoil:signed-in";

export function signedInHint(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSignedInHint(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(SIGNED_IN_KEY, "1");
    else globalThis.localStorage?.removeItem(SIGNED_IN_KEY);
  } catch {
    // Storage blocked: the map simply does not sync.
  }
}

export type Reconciled =
  /** The account's copy is newer, or this device's belongs to someone else: take it. */
  | { kind: "adopt"; profile: RiderProfile }
  /** This device's copy is newer, or the account has none: send it. */
  | { kind: "push"; input: RiderProfileInput }
  /** The two agree, or there is nothing to say. */
  | { kind: "same" };

const time = (iso: string | null) => (iso === null ? null : Date.parse(iso));

/**
 * Which way a device's copy and its account's go. `account` is who is signed
 * in now: a copy last matched with another account on this device is not
 * theirs to send, so it only ever gives way to the account's own.
 */
export function reconcile(
  prefs: Prefs,
  profile: RiderProfile,
  account: string,
): Reconciled {
  const local = time(prefs.starsUpdatedAt);
  const remote = time(profile.updatedAt);
  const ours = prefs.starsAccount === null || prefs.starsAccount === account;
  if (remote !== null && (local === null || remote > local || !ours))
    return sameCustomRating(profile.customStars, prefs.rider.custom) &&
      remote === local &&
      ours
      ? { kind: "same" }
      : { kind: "adopt", profile };
  if (local !== null && ours && (remote === null || local > remote))
    return {
      kind: "push",
      input: {
        customStars: prefs.rider.custom ?? null,
        updatedAt: prefs.starsUpdatedAt!,
      },
    };
  return { kind: "same" };
}

/** The account's copy, taken as this device's, and matched with that account. */
export function adopt(
  prefs: Prefs,
  profile: RiderProfile,
  account: string,
): Prefs {
  const { custom: _was, ...rider } = prefs.rider;
  const custom = parseCustomRating(profile.customStars);
  return {
    ...prefs,
    rider: custom ? { ...rider, custom } : rider,
    starsUpdatedAt: profile.updatedAt,
    starsAccount: account,
  };
}

export interface RiderApi {
  get(): Promise<RiderProfile>;
  put(input: RiderProfileInput): Promise<RiderProfile>;
}

export function riderApi(getToken: () => Promise<string | null>): RiderApi {
  const api: ApiSettings = {
    prefix: "/api",
    subject: "Your account",
    getToken,
  };
  return {
    get: () => request<RiderProfile>(api, "GET", "/me/rider"),
    put: (input) => request<RiderProfile>(api, "PUT", "/me/rider", input),
  };
}

/**
 * One round: read the account's copy, then take it or send this device's,
 * and keep whatever the account answers, which may be newer still. True when
 * the device's preferences changed, and were announced.
 */
export async function syncRider(
  api: RiderApi,
  account: string,
  storage?: PrefsStorage,
): Promise<boolean> {
  const before = loadPrefs(storage);
  const profile = await api.get();
  const plan = reconcile(before, profile, account);
  if (plan.kind === "same") {
    // Agreed, but not yet marked as this account's. A copy that only stands
    // because it is another account's is left as it is.
    if (
      before.starsAccount !== account &&
      profile.updatedAt !== null &&
      profile.updatedAt === before.starsUpdatedAt
    ) {
      savePrefs({ ...loadPrefs(storage), starsAccount: account }, storage);
      announcePrefs("account");
    }
    return false;
  }
  const kept = plan.kind === "adopt" ? plan.profile : await api.put(plan.input);
  // Read again: the rider may have changed something while the request ran.
  const now = loadPrefs(storage);
  if (now.starsUpdatedAt !== before.starsUpdatedAt) return false;
  const next = adopt(now, kept, account);
  const changed = !sameCustomRating(next.rider.custom, now.rider.custom);
  savePrefs(next, storage);
  // Said even when the rating is the same: a page holding the preferences
  // in its state must not write back the stamps this round replaced.
  announcePrefs("account");
  return changed;
}
