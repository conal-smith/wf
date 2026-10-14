import { describe, expect, it } from "vitest";
import {
  announcement,
  appGate,
  appStagedRecord,
  binaryFor,
  buildsNeeded,
  checkBuilt,
  easBranch,
  easPlatform,
  fingerprintDiff,
  latestJson,
  nightlyRecord,
  stagedAppMatches,
  submitProblems,
  unconfiguredRecord,
  updatesByPlatform,
  verifyUpdate,
} from "../scripts/release/mobile.mjs";
import { stagedRecord, verifyStaged } from "../scripts/release/release.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const HASH = (c: string) => c.repeat(64);
const TAG = "v2026.10.13-nightly.42";

// `eas update --json`: one entry per platform, a group per runtime.
const published = [
  { id: "u-ios", group: "g-ios", platform: "ios", runtimeVersion: "rt-ios", branch: TAG, gitCommitHash: A, createdAt: "2026-10-13T02:40:00Z" },
  { id: "u-and", group: "g-and", platform: "android", runtimeVersion: "rt-and", branch: TAG, gitCommitHash: A, createdAt: "2026-10-13T02:40:01Z" },
];

// `eas build:list --json`: GraphQL's own shapes and capitals.
const build = (o: Record<string, unknown>) => ({
  id: "b",
  platform: "IOS",
  status: "FINISHED",
  buildProfile: "production",
  runtime: { version: "rt-ios" },
  appVersion: "1.0.0",
  appBuildVersion: "7",
  completedAt: "2026-10-01T10:00:00Z",
  ...o,
});
const builds = [
  build({ id: "prod-ios-old", completedAt: "2026-09-01T10:00:00Z", appBuildVersion: "5" }),
  build({ id: "prod-ios", completedAt: "2026-10-01T10:00:00Z" }),
  build({ id: "stag-ios-errored", buildProfile: "staging", status: "ERRORED" }),
  build({ id: "prod-and-old-rt", platform: "ANDROID", runtime: { version: "rt-and-old" }, appBuildVersion: "6" }),
  build({ id: "stag-and", platform: "ANDROID", buildProfile: "staging", runtime: { version: "rt-and" } }),
];

const mobile = nightlyRecord({
  tag: TAG,
  version: "2026.10.13-nightly.42",
  commit: A,
  appVersion: "1.0.0",
  published,
  builds,
  at: "2026-10-13T02:41:00Z",
});

describe("the nightly's app update", () => {
  it("lives on a branch named for the nightly", () => {
    expect(easBranch(TAG)).toBe(TAG);
    expect(() => easBranch("v2026.10.13")).toThrow(/Not a nightly tag/);
  });

  it("records one group per platform, and the binaries that can already run it", () => {
    expect(mobile).toMatchObject({
      configured: true,
      branch: TAG,
      commit: A,
      updates: {
        ios: { group: "g-ios", id: "u-ios", runtimeVersion: "rt-ios" },
        android: { group: "g-and", id: "u-and", runtimeVersion: "rt-and" },
      },
      native: {
        staging: { ios: null, android: "stag-and" },
        production: { ios: "prod-ios", android: null },
      },
    });
  });

  it("refuses an update for the wrong commit or branch, a missing platform, or a roll back", () => {
    expect(() => updatesByPlatform([published[0]])).toThrow(/nothing for android/);
    expect(() => updatesByPlatform(published, { commit: B })).toThrow(/built from a{12}/);
    expect(() => updatesByPlatform(published, { branch: "other" })).toThrow(/not other/);
    expect(() => updatesByPlatform([published[0], { ...published[1], isRollBackToEmbedded: true }])).toThrow(/roll back/);
    expect(() => updatesByPlatform([])).toThrow(/nothing/);
  });

  it("says so when the app was not published", () => {
    expect(unconfiguredRecord({ tag: TAG, version: "v", commit: A, reason: "" })).toMatchObject({
      configured: false,
      reason: "not configured",
    });
  });
});

describe("whether a run touches the app", () => {
  const ok = { mobile, expoToken: "t", projectId: "p", commit: A };

  it("runs once EAS is set up and the nightly published an update", () => {
    expect(appGate(ok).run).toBe(true);
  });

  it("skips, with a reason, when it is not set up or there is nothing to stage", () => {
    expect(appGate({ ...ok, expoToken: "" })).toMatchObject({ run: false, reason: expect.stringMatching(/EXPO_TOKEN/) });
    expect(appGate({ ...ok, projectId: undefined }).run).toBe(false);
    expect(appGate({ ...ok, mobile: undefined }).reason).toMatch(/predates/);
    expect(appGate({ ...ok, mobile: unconfiguredRecord({ tag: TAG, version: "v", commit: A, reason: "no token" }) }).reason).toMatch(
      /no token/,
    );
  });

  it("refuses a mobile.json for another commit", () => {
    expect(() => appGate({ ...ok, commit: B })).toThrow(/not b{12}/);
  });

  it("does not promote an app that staging did not stage", () => {
    expect(appGate({ ...ok, staged: { mobile: null } }).reason).toMatch(/staged without the app/);
    expect(appGate({ ...ok, staged: null }).run).toBe(false);
    expect(appGate({ ...ok, staged: { mobile: { branch: TAG } } }).run).toBe(true);
  });
});

describe("the update staging and production get", () => {
  const branchView = {
    name: TAG,
    currentPage: [
      { group: "g-ios", platforms: "ios" },
      { group: "g-and", platforms: "android" },
    ],
  };
  const groupViews = {
    "g-ios": [{ id: "u-ios", platform: "ios", runtimeVersion: "rt-ios", gitCommitHash: A }],
    "g-and": [{ id: "u-and", platform: "android", runtimeVersion: "rt-and", gitCommitHash: A }],
  };

  it("is exactly the groups the nightly published", () => {
    expect(() => verifyUpdate({ mobile, branchView, groupViews })).not.toThrow();
  });

  it("refuses a branch someone has published to since, or that lost a group", () => {
    const extra = { ...branchView, currentPage: [{ group: "g-new" }, ...branchView.currentPage] };
    expect(() => verifyUpdate({ mobile, branchView: extra, groupViews })).toThrow(/holds group g-new/);
    const lost = { ...branchView, currentPage: [branchView.currentPage[0]] };
    expect(() => verifyUpdate({ mobile, branchView: lost, groupViews })).toThrow(/g-and is no longer/);
    expect(() => verifyUpdate({ mobile, branchView: { ...branchView, name: "x" }, groupViews })).toThrow(/branch is x/);
  });

  it("refuses an update that differs from the one recorded", () => {
    const changed = { ...groupViews, "g-ios": [{ ...groupViews["g-ios"][0], id: "u-other" }] };
    expect(() => verifyUpdate({ mobile, branchView, groupViews: changed })).toThrow(/ios update is u-other/);
    const otherCommit = { ...groupViews, "g-and": [{ ...groupViews["g-and"][0], gitCommitHash: B }] };
    expect(() => verifyUpdate({ mobile, branchView, groupViews: otherCommit })).toThrow(/built from b{12}/);
    expect(() => verifyUpdate({ mobile, branchView, groupViews: { "g-ios": groupViews["g-ios"] } })).toThrow(
      /no android update/,
    );
  });
});

describe("store binaries", () => {
  it("finds the newest finished binary of a profile for a runtime", () => {
    expect(binaryFor({ builds, platform: "ios", profile: "production", runtimeVersion: "rt-ios" })?.id).toBe("prod-ios");
    expect(binaryFor({ builds, platform: "ios", profile: "staging", runtimeVersion: "rt-ios" })).toBeNull();
    expect(binaryFor({ builds, platform: "android", profile: "production" })?.id).toBe("prod-and-old-rt");
  });

  it("builds only the platforms with no binary for the update's runtime", () => {
    expect(buildsNeeded({ mobile, builds, profile: "staging" })).toEqual(["ios"]);
    expect(buildsNeeded({ mobile, builds, profile: "production" })).toEqual(["android"]);
    expect(easPlatform(["ios", "android"])).toBe("all");
    expect(easPlatform(["android"])).toBe("android");
    expect(easPlatform([])).toBe("");
  });

  it("refuses a new binary whose fingerprint is not the update's", () => {
    const fresh = build({ id: "new-ios", buildProfile: "staging" });
    expect(() => checkBuilt({ mobile, built: [fresh] })).not.toThrow();
    expect(() => checkBuilt({ mobile, built: [{ ...fresh, runtime: { version: "rt-x" } }] })).toThrow(
      /runtime rt-x, but the update needs rt-ios/,
    );
    expect(() => checkBuilt({ mobile, built: [{ ...fresh, status: "ERRORED" }] })).toThrow(/errored/);
  });

  it("records what staging pointed and which binaries run it", () => {
    const fresh = build({ id: "new-ios", buildProfile: "staging", completedAt: "2026-10-13T12:00:00Z" });
    const staged = appStagedRecord({ mobile, channel: "staging", builds, built: [fresh], at: "t" });
    expect(staged).toMatchObject({
      channel: "staging",
      branch: TAG,
      commit: A,
      groups: { ios: "g-ios", android: "g-and" },
      binaries: { ios: { id: "new-ios", builtNow: true }, android: { id: "stag-and", builtNow: false } },
    });
    expect(stagedAppMatches({ stagedMobile: staged, mobile })).toEqual([]);
    expect(stagedAppMatches({ stagedMobile: { ...staged, groups: { ...staged.groups, ios: "g-x" } }, mobile })[0]).toMatch(
      /ios group/,
    );
  });
});

describe("submitting a new binary", () => {
  it("needs the App Store Connect app id written into eas.json, which eas-cli does not expand", () => {
    const easJson = (ascAppId?: unknown) => ({
      submit: { staging: { ios: ascAppId === undefined ? {} : { ascAppId }, android: { track: "internal" } } },
    });
    expect(submitProblems({ easJson: easJson("6700000001"), profile: "staging", platforms: ["ios", "android"] })).toEqual([]);
    expect(submitProblems({ easJson: easJson(), profile: "staging", platforms: ["ios"] })[0]).toMatch(/ascAppId is null/);
    expect(submitProblems({ easJson: easJson("$ASC_APP_ID_STAGING"), profile: "staging", platforms: ["ios"] })).toHaveLength(1);
    // Only the platforms being built are checked.
    expect(submitProblems({ easJson: easJson(), profile: "staging", platforms: ["android"] })).toEqual([]);
    expect(submitProblems({ easJson: {}, profile: "production", platforms: ["android"] })[0]).toMatch(/Google Play track/);
  });
});

describe("staged.json with the app", () => {
  const images = { version: "x", commit: A, images: { forecast: "f@sha256:1" } };
  const sha256 = { "images.json": HASH("1"), "site.tar.gz": HASH("2"), "mobile.json": HASH("3") };
  const appStaged = appStagedRecord({ mobile, channel: "staging", builds, built: [], at: "t" });
  const record = (o = {}) =>
    stagedRecord({
      tag: "v2026.10.13-rc.57",
      version: "2026.10.13-rc.57",
      nightlyTag: TAG,
      commit: A,
      images,
      sha256,
      runId: 1,
      runAttempt: 1,
      siteDeployed: false,
      siteUrl: "",
      forecastBase: "",
      at: "t",
      mobile: appStaged,
      ...o,
    });
  const files = { tag: "v2026.10.13-rc.57", ref: A, images, sha256, mobile };

  it("records the app staged and the hash of mobile.json", () => {
    expect(record()).toMatchObject({ mobile: { branch: TAG }, sha256: { "mobile.json": HASH("3") } });
    expect(record({ mobile: undefined }).mobile).toBeNull();
    const { "mobile.json": _unused, ...siteOnly } = sha256;
    expect(() => record({ sha256: siteOnly })).toThrow(/mobile.json was not hashed/);
    expect(() => record({ mobile: { ...appStaged, commit: B } })).toThrow(/staged is for b+/);
  });

  it("promotes only the mobile.json staging recorded", () => {
    const staged = record();
    expect(() => verifyStaged({ ...files, staged })).not.toThrow();
    expect(() => verifyStaged({ ...files, staged, sha256: { ...sha256, "mobile.json": HASH("4") } })).toThrow(
      /mobile.json is not the file staging tested/,
    );
    const { "mobile.json": _gone, ...missing } = sha256;
    expect(() => verifyStaged({ ...files, staged, sha256: missing })).toThrow(/mobile.json is missing/);
    const otherGroup = { ...mobile, updates: { ...mobile.updates, ios: { ...mobile.updates.ios, group: "g-x" } } };
    expect(() => verifyStaged({ ...files, staged, mobile: otherGroup })).toThrow(/ios app update/);
  });

  it("still promotes a candidate staged before the app had a train", () => {
    const { "mobile.json": _old, ...siteOnly } = sha256;
    const staged = record({ sha256: siteOnly, mobile: undefined });
    expect(() => verifyStaged({ ...files, staged, sha256: siteOnly, mobile: undefined })).not.toThrow();
  });
});

describe("app/latest.json", () => {
  const now = "2026-10-14T09:00:00.000Z";
  const latest = latestJson({ release: "2026.10.14", mobile, builds, minimumVersion: "", appStoreId: "6700000000", graceHours: "", now });

  it("names production's runtimes, the newest store binary and when to advertise it", () => {
    expect(latest).toMatchObject({
      schemaVersion: 1,
      release: "2026.10.14",
      ios: {
        runtimeVersion: "rt-ios",
        store: { version: "1.0.0", build: "7", runtimeVersion: "rt-ios", availableAt: "2026-10-03T10:00:00.000Z" },
        minimumVersion: null,
        storeUrl: "https://apps.apple.com/app/id6700000000",
      },
      android: {
        runtimeVersion: "rt-and",
        store: { version: "1.0.0", build: "6", runtimeVersion: "rt-and-old" },
        storeUrl: "https://play.google.com/store/apps/details?id=ie.wingfoil.app",
      },
    });
  });

  it("takes a minimum version and a review window, and refuses nonsense", () => {
    const strict = latestJson({ release: "r", mobile, builds, minimumVersion: "1.0", appStoreId: "", graceHours: "0", now });
    expect(strict.ios.minimumVersion).toBe("1.0");
    expect(strict.ios.storeUrl).toBeNull();
    expect(strict.ios.store?.availableAt).toBe("2026-10-01T10:00:00.000Z");
    expect(() => latestJson({ release: "r", mobile, builds, minimumVersion: "one", appStoreId: "", graceHours: "", now })).toThrow(
      /not a version/,
    );
    expect(() => latestJson({ release: "r", mobile, builds, minimumVersion: "", appStoreId: "app", graceHours: "", now })).toThrow(
      /not an App Store id/,
    );
    expect(latestJson({ release: "r", mobile, builds: [], minimumVersion: "", appStoreId: "", graceHours: "", now }).ios.store).toBeNull();
  });
});

describe("telling riders", () => {
  it("says the update installs itself, or that a store version is coming", () => {
    expect(announcement({ version: "2026.10.14", needsStore: [] })).toMatchObject({
      kind: "app-update",
      version: "2026.10.14",
      platforms: ["ios", "android"],
      body: expect.stringMatching(/installs by itself/),
    });
    expect(announcement({ version: "v", needsStore: ["ios"] }).body).toMatch(/the App Store\./);
    expect(announcement({ version: "v", needsStore: ["ios", "android"] }).body).toMatch(/App Store and Google Play/);
  });
});

describe("the advisory native-change check", () => {
  const fp = (hash: string, sources: Record<string, unknown>[]) => ({ hash, sources });
  it("lists what changed in the fingerprint", () => {
    const base = fp("h1", [
      { type: "file", filePath: "eas.json", hash: "1" },
      { type: "dir", filePath: "node_modules/expo-camera", hash: "2" },
      { type: "contents", id: "appMajorVersion", hash: "3" },
    ]);
    const head = fp("h2", [
      { type: "file", filePath: "eas.json", hash: "9" },
      { type: "contents", id: "appMajorVersion", hash: "3" },
      { type: "dir", filePath: "node_modules/expo-maps", hash: "4" },
    ]);
    const diff = fingerprintDiff(base, head);
    expect(diff.changed).toBe(true);
    expect(diff.changes).toEqual([
      { source: "dir:node_modules/expo-camera", change: "removed" },
      { source: "dir:node_modules/expo-maps", change: "added" },
      { source: "file:eas.json", change: "changed" },
    ]);
    expect(fingerprintDiff(base, base)).toMatchObject({ changed: false, changes: [] });
  });
});
