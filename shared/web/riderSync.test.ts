import { describe, expect, it } from "vitest";
import {
  PREFS_KEY,
  defaultPrefs,
  loadPrefs,
  savePrefs,
  withCustomStars,
  withStarsOn,
  type Prefs,
} from "../../force5/src/prefs";
import {
  DEFAULT_RIDER,
  standardRating,
  type CustomRating,
} from "../../force5/src/stars";
import type { RiderProfile, RiderProfileInput } from "../../site/shared/rider";
import { reconcile, syncRider, type RiderApi } from "./riderSync";

const OWN: CustomRating = standardRating(DEFAULT_RIDER, "advanced");
const OTHER: CustomRating = {
  ...OWN,
  direction: { ...OWN.direction, offshore: 0 },
};
const T = (hour: number) => new Date(Date.UTC(2026, 9, 18, hour)).toISOString();

const device = (
  custom: CustomRating | null,
  at: number | null,
  account: string | null = null,
): Prefs => {
  const prefs =
    at === null
      ? defaultPrefs()
      : withCustomStars(defaultPrefs(), custom, new Date(T(at)));
  return { ...prefs, starsAccount: account };
};
const kept = (
  custom: CustomRating | null,
  at: number | null,
): RiderProfile => ({
  customStars: custom,
  keptStars: null,
  updatedAt: at === null ? null : T(at),
});

describe("which copy wins", () => {
  it("has nothing to say when neither side has a rating", () => {
    expect(reconcile(device(null, null), kept(null, null), "a").kind).toBe(
      "same",
    );
  });
  it("sends the device's when the account has none, or an older one", () => {
    expect(reconcile(device(OWN, 10), kept(null, null), "a")).toEqual({
      kind: "push",
      input: { customStars: OWN, keptStars: null, updatedAt: T(10) },
    });
    expect(reconcile(device(OWN, 10, "a"), kept(OTHER, 9), "a").kind).toBe(
      "push",
    );
    // A reset on the device is newer news too.
    expect(reconcile(device(null, 11, "a"), kept(OWN, 10), "a")).toEqual({
      kind: "push",
      input: { customStars: null, keptStars: null, updatedAt: T(11) },
    });
  });
  it("takes the account's when it is newer, or the device has none", () => {
    expect(reconcile(device(OWN, 9, "a"), kept(OTHER, 10), "a").kind).toBe(
      "adopt",
    );
    expect(reconcile(device(null, null), kept(OTHER, 10), "a").kind).toBe(
      "adopt",
    );
  });
  it("agrees when both carry the same moment", () => {
    expect(reconcile(device(OWN, 10, "a"), kept(OWN, 10), "a").kind).toBe(
      "same",
    );
  });
  it("never sends one account's rating to another who signs in on the same device", () => {
    expect(reconcile(device(OWN, 12, "a"), kept(null, null), "b").kind).toBe(
      "same",
    );
    expect(reconcile(device(OWN, 12, "a"), kept(OTHER, 10), "b").kind).toBe(
      "adopt",
    );
  });
});

function fakes(prefs: Prefs, profile: RiderProfile) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  savePrefs(prefs, storage);
  let account = profile;
  const sent: RiderProfileInput[] = [];
  const api: RiderApi = {
    get: async () => account,
    put: async (input) => {
      sent.push(input);
      if (account.updatedAt === null || input.updatedAt > account.updatedAt)
        account = { ...input, keptStars: input.keptStars ?? null };
      return account;
    },
  };
  return { storage, api, sent, data, account: () => account };
}

describe("a round of sync", () => {
  it("brings the account's rating to a new device", async () => {
    const f = fakes(device(null, null), kept(OWN, 10));
    expect(await syncRider(f.api, "a", f.storage)).toBe(true);
    const now = loadPrefs(f.storage);
    expect(now.rider.custom).toEqual(OWN);
    expect(now.starsUpdatedAt).toBe(T(10));
    expect(now.starsAccount).toBe("a");
    expect(f.sent).toEqual([]);
  });
  it("sends a newer device rating, and marks it as the account's", async () => {
    const f = fakes(device(OTHER, 11), kept(OWN, 10));
    expect(await syncRider(f.api, "a", f.storage)).toBe(false);
    expect(f.account().customStars).toEqual(OTHER);
    expect(loadPrefs(f.storage).starsAccount).toBe("a");
  });
  it("carries a reset across, as a reset", async () => {
    const f = fakes(device(OWN, 10, "a"), kept(null, 12));
    expect(await syncRider(f.api, "a", f.storage)).toBe(true);
    expect(loadPrefs(f.storage).rider.custom).toBeUndefined();
  });
  it("keeps what the rider changed while the request was out", async () => {
    const f = fakes(device(null, null), kept(OWN, 10));
    const slow: RiderApi = {
      ...f.api,
      get: async () => {
        savePrefs(
          withCustomStars(loadPrefs(f.storage), OTHER, new Date(T(13))),
          f.storage,
        );
        return f.api.get();
      },
    };
    await syncRider(slow, "a", f.storage);
    expect(loadPrefs(f.storage).rider.custom).toEqual(OTHER);
  });
  it("leaves the device alone when the account is unreachable", async () => {
    const f = fakes(device(OWN, 10), kept(null, null));
    const down: RiderApi = {
      get: async () => {
        throw new Error("offline");
      },
      put: async () => {
        throw new Error("offline");
      },
    };
    await expect(syncRider(down, "a", f.storage)).rejects.toThrow();
    expect(JSON.parse(f.data.get(PREFS_KEY)!).rider.custom).toEqual(OWN);
  });
  it("leaves one account's rating alone for another who signs in, until they change it", async () => {
    const f = fakes(device(OWN, 12, "a"), kept(null, null));
    await syncRider(f.api, "b", f.storage);
    expect(f.sent).toEqual([]);
    expect(loadPrefs(f.storage).starsAccount).toBe("a");
    // Their own change on this device is theirs, and goes to their account.
    savePrefs(
      withCustomStars(loadPrefs(f.storage), OTHER, new Date(T(13))),
      f.storage,
    );
    expect(loadPrefs(f.storage).starsAccount).toBeNull();
    await syncRider(f.api, "b", f.storage);
    expect(f.account().customStars).toEqual(OTHER);
    expect(loadPrefs(f.storage).starsAccount).toBe("b");
  });
  it("carries a rating kept while a level rates, and back on again", async () => {
    // Off on this device: the account keeps it aside, not rating.
    const off = withStarsOn(device(OWN, 10, "a"), "beginner", new Date(T(11)));
    const f = fakes(off, kept(OWN, 10));
    await syncRider(f.api, "a", f.storage);
    expect(f.sent).toEqual([
      { customStars: null, keptStars: OWN, updatedAt: T(11) },
    ]);
    // Another device takes it as kept, on its own level.
    const g = fakes(device(null, null), f.account());
    expect(await syncRider(g.api, "a", g.storage)).toBe(true);
    expect(loadPrefs(g.storage).rider).toEqual({
      ...DEFAULT_RIDER,
      keptCustom: OWN,
    });
    // On again there, and so on the account.
    savePrefs(
      withStarsOn(loadPrefs(g.storage), "custom", new Date(T(12))),
      g.storage,
    );
    await syncRider(g.api, "a", g.storage);
    expect(g.account()).toMatchObject({ customStars: OWN, keptStars: null });
  });
  it("reads an account written before kept ratings as saved and in use", async () => {
    const before = { customStars: OWN, updatedAt: T(10) } as RiderProfile;
    const f = fakes(device(null, null), before);
    await syncRider(f.api, "a", f.storage);
    expect(loadPrefs(f.storage).rider).toEqual({
      ...DEFAULT_RIDER,
      custom: OWN,
    });
    // And agrees with it afterwards, with nothing to send.
    expect(reconcile(loadPrefs(f.storage), before, "a").kind).toBe("same");
  });
});
