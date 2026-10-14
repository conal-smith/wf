#!/usr/bin/env node
/**
 * The release train's decisions for the app (mobile/), beside release.mjs's
 * for the site and images. .github/workflows/release.yml calls it; docs/MOBILE.md
 * tells the story.
 *
 *   record-unconfigured OUT REASON   mobile.json for a nightly that published no app update
 *   record-nightly OUT               mobile.json: the update the nightly published, once
 *   gate [STAGED_JSON]               should this run touch the app? (run=true|false, branch)
 *   verify-update                    the nightly's branch holds exactly its update groups
 *   needs-build PROFILE              which platforms have no PROFILE binary for the runtime
 *                                    (CHECK_SUBMIT=true: and refuse if eas.json cannot submit them)
 *   check-built FILE                 new binaries run the update's runtime
 *   record-app-staged OUT            app-staged.json: what staging pointed and built
 *   latest-json OUT                  app/latest.json for the site: store versions, runtimes
 *   announce                         tell riders (POST /api/alerts/announce); never fails
 *   fingerprint-diff BASE HEAD       what changed in the native fingerprint (CI, advisory)
 *
 * The idea, as for the site: build once, promote the same thing. A nightly
 * publishes the JavaScript bundle ONCE as an EAS update group per platform on
 * a branch named for the nightly (its tag), with no channel pointing at it.
 * A release points the `staging` channel at that branch; a promote points
 * `production` at the same branch. An update group is immutable and the
 * branch is the nightly's own, so checking that the branch still holds exactly
 * the recorded groups (verify-update) is checking that production gets byte for
 * byte what staging ran.
 *
 * Over the air only reaches binaries whose runtime (the native fingerprint,
 * mobile/fingerprint.config.js) is the update's. When no store binary has that
 * runtime yet, staging and promote build one with EAS and submit it
 * (TestFlight and Play internal for staging; App Store review and Play for
 * production).
 *
 * Everything that decides is a pure function exported for
 * tests/release-mobile.test.ts; the commands only read files and the
 * environment.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { NIGHTLY_TAG } from "./release.mjs";

export const PLATFORMS = ["ios", "android"];
export const PROFILES = ["staging", "production"];
/** The production app's identifier on both stores (mobile/app.config.ts). */
export const PRODUCTION_ID = "ie.wingfoil.app";
/** A store binary is advertised in latest.json this long after it was built: review, rollout. */
export const DEFAULT_GRACE_HOURS = 48;

const lower = (value) => String(value ?? "").toLowerCase();
const short = (id) => String(id ?? "").slice(0, 12);

/** The EAS branch a nightly's update lives on: the nightly's own tag. */
export function easBranch(tag) {
  if (!NIGHTLY_TAG.test(tag ?? "")) throw new Error(`Not a nightly tag: ${tag}`);
  return tag;
}

/**
 * `eas update --json` lists one update per platform; with a fingerprint
 * runtime the two platforms usually differ, so they are two groups.
 */
export function updatesByPlatform(published, { branch, commit } = {}) {
  if (!Array.isArray(published) || !published.length) throw new Error("eas update published nothing");
  const out = {};
  for (const platform of PLATFORMS) {
    const update = published.find((u) => lower(u.platform) === platform);
    if (!update) throw new Error(`eas update published nothing for ${platform}`);
    if (update.isRollBackToEmbedded) throw new Error(`eas update published a roll back for ${platform}`);
    if (!update.group || !update.id || !update.runtimeVersion)
      throw new Error(`eas update's ${platform} entry has no group, id or runtime`);
    if (branch && update.branch && update.branch !== branch)
      throw new Error(`the ${platform} update is on branch ${update.branch}, not ${branch}`);
    if (commit && update.gitCommitHash && update.gitCommitHash !== commit)
      throw new Error(`the ${platform} update was built from ${short(update.gitCommitHash)}, not ${short(commit)}`);
    out[platform] = {
      group: update.group,
      id: update.id,
      runtimeVersion: update.runtimeVersion,
      createdAt: update.createdAt ?? null,
    };
  }
  return out;
}

/** A build as `eas build:list --json` reports it, in the few words the train needs. */
export function normaliseBuild(build) {
  return {
    id: build.id,
    platform: lower(build.platform),
    status: lower(build.status),
    profile: build.buildProfile ?? null,
    runtimeVersion: build.runtime?.version ?? build.runtimeVersion ?? null,
    version: build.appVersion ?? null,
    build: build.appBuildVersion != null ? String(build.appBuildVersion) : null,
    completedAt: build.completedAt ?? null,
    appIdentifier: build.appIdentifier ?? null,
  };
}

const newestFirst = (a, b) => String(b.completedAt ?? "").localeCompare(String(a.completedAt ?? ""));

/** The newest finished binary of a profile for a platform (and a runtime, when given). */
export function binaryFor({ builds, platform, profile, runtimeVersion }) {
  const matching = (builds ?? [])
    .map(normaliseBuild)
    .filter(
      (b) =>
        b.platform === platform &&
        b.status === "finished" &&
        b.profile === profile &&
        (runtimeVersion === undefined || b.runtimeVersion === runtimeVersion),
    )
    .sort(newestFirst);
  return matching[0] ?? null;
}

/** For each profile and platform, the binary that can run this update, or null. */
export function nativeFor({ builds, updates }) {
  return Object.fromEntries(
    PROFILES.map((profile) => [
      profile,
      Object.fromEntries(
        PLATFORMS.map((platform) => [
          platform,
          binaryFor({ builds, platform, profile, runtimeVersion: updates[platform].runtimeVersion })?.id ?? null,
        ]),
      ),
    ]),
  );
}

/** mobile.json for a nightly that published its update. */
export function nightlyRecord({ tag, version, commit, appVersion, published, builds, at }) {
  const branch = easBranch(tag);
  const updates = updatesByPlatform(published, { branch, commit });
  return {
    schemaVersion: 1,
    configured: true,
    tag,
    version,
    commit,
    appVersion,
    branch,
    updates,
    native: nativeFor({ builds, updates }),
    publishedAt: at,
  };
}

/** mobile.json for a nightly that did not touch the app, and why. */
export function unconfiguredRecord({ tag, version, commit, reason }) {
  return { schemaVersion: 1, configured: false, tag, version, commit, reason: reason || "not configured" };
}

/**
 * Should this run touch the app? Every reason not to is a notice, not a
 * failure, so the site's train runs untouched until EAS is set up.
 */
export function appGate({ mobile, staged, expoToken, projectId, commit }) {
  if (!expoToken || !projectId)
    return {
      run: false,
      reason: "EXPO_TOKEN (secret) or EAS_PROJECT_ID (variable) is not set, so the app was left alone. docs/MOBILE.md says how to set them up.",
    };
  if (!mobile) return { run: false, reason: "this build has no mobile.json: it predates the app's release train." };
  if (!mobile.configured)
    return { run: false, reason: `its nightly published no app update (${mobile.reason ?? "not configured"}).` };
  if (mobile.commit !== commit)
    throw new Error(`mobile.json is for commit ${short(mobile.commit)}, not ${short(commit)}`);
  if (staged !== undefined && !staged?.mobile)
    return {
      run: false,
      reason: "the candidate was staged without the app (EAS was not set up then), so there is nothing staged to promote. Stage it again.",
    };
  return { run: true, reason: `the app update on branch ${mobile.branch}` };
}

/**
 * The nightly's branch holds exactly the groups the nightly recorded, each the
 * same update (id, platform, runtime, commit). An update group is immutable,
 * so this is the byte-for-byte check: a channel pointed at this branch serves
 * what was published at nightly and nothing else.
 *
 * branchView is `eas branch:view BRANCH --json`; groupViews maps each recorded
 * group to its `eas update:view GROUP --json`.
 */
export function verifyUpdate({ mobile, branchView, groupViews }) {
  const problems = [];
  if (branchView?.name !== mobile.branch) problems.push(`the branch is ${branchView?.name}, not ${mobile.branch}`);
  const recorded = new Set(PLATFORMS.map((p) => mobile.updates[p].group));
  const onBranch = new Set((branchView?.currentPage ?? []).map((g) => g.group));
  for (const group of recorded) if (!onBranch.has(group)) problems.push(`group ${group} is no longer on ${mobile.branch}`);
  for (const group of onBranch)
    if (!recorded.has(group)) problems.push(`${mobile.branch} holds group ${group}, which its nightly did not publish`);
  for (const platform of PLATFORMS) {
    const want = mobile.updates[platform];
    const view = (groupViews?.[want.group] ?? []).find((u) => lower(u.platform) === platform);
    if (!view) {
      problems.push(`group ${want.group} has no ${platform} update`);
      continue;
    }
    if (view.id !== want.id) problems.push(`the ${platform} update is ${view.id}, not ${want.id}`);
    if (view.runtimeVersion !== want.runtimeVersion)
      problems.push(`the ${platform} update's runtime is ${view.runtimeVersion}, not ${want.runtimeVersion}`);
    if (view.gitCommitHash && view.gitCommitHash !== mobile.commit)
      problems.push(`the ${platform} update was built from ${short(view.gitCommitHash)}, not ${short(mobile.commit)}`);
    if (view.isRollBackToEmbedded) problems.push(`the ${platform} update is a roll back`);
  }
  if (problems.length) throw new Error(`Refusing the app update of ${mobile.tag}: ${problems.join("; ")}.`);
}

/** Platforms with no finished PROFILE binary for the update's runtime: they need a build. */
export function buildsNeeded({ mobile, builds, profile }) {
  return PLATFORMS.filter(
    (platform) => !binaryFor({ builds, platform, profile, runtimeVersion: mobile.updates[platform].runtimeVersion }),
  );
}

/**
 * What would stop `eas build --auto-submit --non-interactive` submitting.
 * eas-cli reads the App Store Connect app id from eas.json as written: unlike
 * the API key fields, `ascAppId` is not expanded from the environment
 * (eas-json's IosSubmitProfileFieldsToEvaluate), so it has to be the number
 * itself. Refused before a 30-minute build rather than after it.
 */
export function submitProblems({ easJson, profile, platforms }) {
  const problems = [];
  if (platforms.includes("ios")) {
    const id = easJson?.submit?.[profile]?.ios?.ascAppId;
    if (!/^\d+$/.test(String(id ?? "")))
      problems.push(
        `mobile/eas.json has no App Store Connect app id for ${profile} (submit.${profile}.ios.ascAppId is ` +
          `${JSON.stringify(id ?? null)}): add the app's Apple ID there (docs/MOBILE.md, "One-time setup")`,
      );
  }
  if (platforms.includes("android") && !easJson?.submit?.[profile]?.android?.track)
    problems.push(`mobile/eas.json has no Google Play track for ${profile} (submit.${profile}.android.track)`);
  return problems;
}

/** `eas build --platform` for a set of platforms. */
export const easPlatform = (platforms) => (platforms.length === 2 ? "all" : (platforms[0] ?? ""));

/**
 * A binary built for the update must run the update: the fingerprint EAS
 * computed on its build machine must be the one the nightly published for. If
 * not, something native differs between the runner and EAS (an environment
 * variable that reaches app.config.ts, a different lockfile) and the update
 * would never reach that binary.
 */
export function checkBuilt({ mobile, built }) {
  const problems = [];
  for (const build of (built ?? []).map(normaliseBuild)) {
    const want = mobile.updates[build.platform]?.runtimeVersion;
    if (build.status && build.status !== "finished") problems.push(`the ${build.platform} build ${build.id} is ${build.status}`);
    if (want && build.runtimeVersion !== want)
      problems.push(
        `the ${build.platform} build ${build.id} has runtime ${build.runtimeVersion}, but the update needs ${want}`,
      );
  }
  if (problems.length) throw new Error(`The new binaries cannot run ${mobile.tag}'s update: ${problems.join("; ")}.`);
}

/** app-staged.json: what staging pointed at the update and which binaries run it. */
export function appStagedRecord({ mobile, channel, builds, built, at }) {
  const fresh = new Set((built ?? []).map((b) => b.id));
  const binaries = Object.fromEntries(
    PLATFORMS.map((platform) => {
      const b = binaryFor({ builds: [...(builds ?? []), ...(built ?? [])], platform, profile: channel, runtimeVersion: mobile.updates[platform].runtimeVersion });
      return [platform, b ? { id: b.id, version: b.version, build: b.build, builtNow: fresh.has(b.id) } : null];
    }),
  );
  return {
    channel,
    branch: mobile.branch,
    commit: mobile.commit,
    groups: Object.fromEntries(PLATFORMS.map((p) => [p, mobile.updates[p].group])),
    runtimes: Object.fromEntries(PLATFORMS.map((p) => [p, mobile.updates[p].runtimeVersion])),
    binaries,
    at,
  };
}

/** What a staged candidate's app part must agree with in its mobile.json. */
export function stagedAppMatches({ stagedMobile, mobile }) {
  const problems = [];
  if (stagedMobile.branch !== mobile.branch) problems.push(`staged branch ${stagedMobile.branch}, mobile.json ${mobile.branch}`);
  if (stagedMobile.commit !== mobile.commit) problems.push(`staged commit ${short(stagedMobile.commit)}, mobile.json ${short(mobile.commit)}`);
  for (const p of PLATFORMS)
    if (stagedMobile.groups?.[p] !== mobile.updates?.[p]?.group)
      problems.push(`the ${p} group staged is ${stagedMobile.groups?.[p]}, mobile.json has ${mobile.updates?.[p]?.group}`);
  return problems;
}

const VERSION = /^\d+(\.\d+){0,2}$/;

/**
 * app/latest.json, published with the site at each promote: per platform, the
 * runtime production's update needs, the newest production binary (with when
 * it may be advertised: built plus a review and rollout window), the oldest
 * version still supported and the store page. An older binary reads it and
 * shows "Update" (mobile/src/features/updates).
 */
export function latestJson({ release, mobile, builds, minimumVersion, appStoreId, graceHours, now }) {
  const minimum = (minimumVersion ?? "").trim();
  if (minimum && !VERSION.test(minimum)) throw new Error(`MOBILE_MINIMUM_VERSION is not a version: ${minimum}`);
  const appId = String(appStoreId ?? "").trim();
  if (appId && !/^\d+$/.test(appId)) throw new Error(`ASC_APP_ID is not an App Store id: ${appId}`);
  const grace = Number.isFinite(Number(graceHours)) && String(graceHours ?? "").trim() !== "" ? Number(graceHours) : DEFAULT_GRACE_HOURS;
  const entry = (platform) => {
    const store = binaryFor({ builds, platform, profile: "production" });
    const availableAt =
      store?.completedAt && !Number.isNaN(Date.parse(store.completedAt))
        ? new Date(Date.parse(store.completedAt) + grace * 3_600_000).toISOString()
        : null;
    return {
      runtimeVersion: mobile.updates[platform].runtimeVersion,
      store: store?.version
        ? { version: store.version, build: store.build, runtimeVersion: store.runtimeVersion, availableAt }
        : null,
      minimumVersion: minimum || null,
      storeUrl:
        platform === "ios"
          ? appId
            ? `https://apps.apple.com/app/id${appId}`
            : null
          : `https://play.google.com/store/apps/details?id=${PRODUCTION_ID}`,
    };
  };
  return {
    schemaVersion: 1,
    release,
    commit: mobile.commit,
    branch: mobile.branch,
    publishedAt: now,
    ios: entry("ios"),
    android: entry("android"),
  };
}

/** What riders are told (the alerts API decides who and how). */
export function announcement({ version, needsStore }) {
  const store = (needsStore ?? []).filter((p) => PLATFORMS.includes(p));
  const body = store.length
    ? `A new version of Wingfoil is on its way to ${store.map((p) => (p === "ios" ? "the App Store" : "Google Play")).join(" and ")}. ` +
      "Until it arrives, everything else updates by itself."
    : "Wingfoil has been updated. The new version installs by itself the next time you leave the app.";
  return { kind: "app-update", version, platforms: [...PLATFORMS], title: "Wingfoil has been updated", body };
}

/**
 * Which native sources differ between two `expo-updates fingerprint:generate`
 * outputs, for the advisory pull-request check.
 */
export function fingerprintDiff(base, head) {
  const key = (s) => `${s.type}:${s.filePath ?? s.id ?? ""}`;
  const index = (fp) => new Map((fp?.sources ?? []).map((s) => [key(s), s.hash ?? null]));
  const a = index(base);
  const b = index(head);
  const changes = [];
  for (const [k, hash] of b) {
    if (!a.has(k)) changes.push({ source: k, change: "added" });
    else if (a.get(k) !== hash) changes.push({ source: k, change: "changed" });
  }
  for (const k of a.keys()) if (!b.has(k)) changes.push({ source: k, change: "removed" });
  changes.sort((x, y) => x.source.localeCompare(y.source));
  return { changed: base?.hash !== head?.hash, base: base?.hash ?? null, head: head?.hash ?? null, changes };
}

// --- files and the environment ---------------------------------------------------

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const readJsonIf = (file) => (file && existsSync(file) ? readJson(file) : undefined);
const writeJson = (file, value) => {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(JSON.stringify(value, null, 2));
};

function output(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function summary(lines) {
  const text = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else console.log(text);
}

/** Lists from `eas build:list --json`, one file per call, merged. */
function readBuilds(files) {
  return files.filter((f) => f && existsSync(f)).flatMap((f) => [].concat(readJson(f) ?? []));
}

const mobileJsonPath = () => process.env.MOBILE_JSON || "mobile.json";

function recordNightly(out) {
  const env = process.env;
  const appVersion = readJson(join(env.MOBILE_DIR || "mobile", "package.json")).version;
  writeJson(
    out,
    nightlyRecord({
      tag: env.TAG,
      version: env.VERSION,
      commit: env.REF,
      appVersion,
      published: readJson(env.UPDATE_JSON || "update.json"),
      builds: readBuilds((env.BUILDS_JSON || "builds.json").split(",")),
      at: new Date().toISOString(),
    }),
  );
}

function recordUnconfigured(out, reason) {
  const env = process.env;
  writeJson(out, unconfiguredRecord({ tag: env.TAG, version: env.VERSION, commit: env.REF, reason }));
}

function gate(stagedFile) {
  const env = process.env;
  const decision = appGate({
    mobile: readJsonIf(mobileJsonPath()),
    staged: stagedFile ? (readJsonIf(stagedFile) ?? null) : undefined,
    expoToken: env.EXPO_TOKEN,
    projectId: env.EAS_PROJECT_ID,
    commit: env.REF,
  });
  if (!decision.run) console.log(`::notice title=App::${decision.reason}`);
  else console.error(`App: ${decision.reason}.`);
  const mobile = decision.run ? readJson(mobileJsonPath()) : null;
  output({
    run: decision.run,
    branch: mobile?.branch ?? "",
    ios_runtime: mobile?.updates.ios.runtimeVersion ?? "",
    android_runtime: mobile?.updates.android.runtimeVersion ?? "",
    groups: mobile ? [...new Set(PLATFORMS.map((p) => mobile.updates[p].group))].join(" ") : "",
  });
}

/** Beside branch.json (eas branch:view) and group-<id>.json files (eas update:view). */
function verifyUpdateFiles(dir = ".") {
  const mobile = readJson(mobileJsonPath());
  const groupViews = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => /^group-.+\.json$/.test(f))
      .map((f) => [f.slice("group-".length, -".json".length), readJson(join(dir, f))]),
  );
  verifyUpdate({ mobile, branchView: readJson(join(dir, "branch.json")), groupViews });
  console.log(`${mobile.branch}: exactly the update groups ${mobile.tag} published (${PLATFORMS.map((p) => `${p} ${mobile.updates[p].group}`).join(", ")}).`);
}

/** mobile/eas.json, from the repository root or from mobile/. */
function readEasJson() {
  const file = [process.env.EAS_JSON, "eas.json", "mobile/eas.json"].find((f) => f && existsSync(f));
  return file ? readJson(file) : null;
}

function needsBuild(profile) {
  if (!PROFILES.includes(profile)) throw new Error(`Not a build profile: ${profile}`);
  const mobile = readJson(mobileJsonPath());
  const needed = buildsNeeded({ mobile, builds: readBuilds((process.env.BUILDS_JSON || "builds.json").split(",")), profile });
  output({ platforms: needed.join(","), eas_platform: easPlatform(needed) });
  if (process.env.CHECK_SUBMIT === "true") {
    const problems = submitProblems({ easJson: readEasJson(), profile, platforms: needed });
    if (problems.length) throw new Error(`Cannot build and submit the ${profile} app: ${problems.join("; ")}.`);
  }
}

function checkBuiltFile(file) {
  const mobile = readJson(mobileJsonPath());
  checkBuilt({ mobile, built: readBuilds([file]) });
  console.log("The new binaries run the update's runtime.");
}

function recordAppStaged(out) {
  const env = process.env;
  writeJson(
    out,
    appStagedRecord({
      mobile: readJson(mobileJsonPath()),
      channel: env.CHANNEL || "staging",
      builds: readBuilds((env.BUILDS_JSON || "builds.json").split(",")),
      built: readBuilds([env.BUILT_JSON || "built.json"]),
      at: new Date().toISOString(),
    }),
  );
}

function latestJsonFile(out) {
  const env = process.env;
  writeJson(
    out,
    latestJson({
      release: env.VERSION,
      mobile: readJson(mobileJsonPath()),
      builds: readBuilds((env.BUILDS_JSON || "production-builds.json").split(",")),
      minimumVersion: env.MOBILE_MINIMUM_VERSION,
      appStoreId: env.ASC_APP_ID || readEasJson()?.submit?.production?.ios?.ascAppId,
      graceHours: env.MOBILE_STORE_GRACE_HOURS,
      now: new Date().toISOString(),
    }),
  );
}

/** Never fails the promote: a rider not told is better than a release half done. */
async function announce() {
  const { ALERTS_API_URL: base, ALERTS_ADMIN_TOKEN: token, VERSION: version, NEEDS_STORE: needs } = process.env;
  if (!base || !token) {
    console.log("::notice title=App::ALERTS_API_URL or ALERTS_ADMIN_TOKEN is not set, so riders were not told about the update.");
    return;
  }
  const body = announcement({ version, needsStore: (needs ?? "").split(",").filter(Boolean) });
  try {
    const url = new URL("api/alerts/announce", base.replace(/\/?$/, "/"));
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.log(`::warning title=App::The announcement was refused: ${response.status} ${await response.text().catch(() => "")}`.slice(0, 500));
    else console.log(`Announced: ${body.title} (${body.version}).`);
  } catch (error) {
    console.log(`::warning title=App::Could not announce the update: ${error.message}`);
  }
}

function fingerprintDiffFiles(baseFile, headFile) {
  const diff = fingerprintDiff(readJsonIf(baseFile) ?? null, readJson(headFile));
  output({ changed: diff.changed });
  return diff;
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "record-nightly") return recordNightly(args[0] ?? "mobile.json");
  if (command === "record-unconfigured") return recordUnconfigured(args[0] ?? "mobile.json", args.slice(1).join(" "));
  if (command === "gate") return gate(args[0]);
  if (command === "verify-update") return verifyUpdateFiles(args[0]);
  if (command === "needs-build") return needsBuild(args[0]);
  if (command === "check-built") return checkBuiltFile(args[0] ?? "built.json");
  if (command === "record-app-staged") return recordAppStaged(args[0] ?? "app-staged.json");
  if (command === "latest-json") return latestJsonFile(args[0] ?? "latest.json");
  if (command === "announce") return announce();
  if (command === "fingerprint-diff") {
    const platform = args[2] ?? "";
    const diff = fingerprintDiffFiles(args[0], args[1]);
    const title = platform ? `${platform}: ` : "";
    if (!diff.base) return summary([`- ${title}no fingerprint for the base (it may predate the app).`]);
    if (!diff.changed) return summary([`- ${title}no native change (\`${short(diff.base)}\`): ships over the air.`]);
    return summary([
      `- ${title}**native change** \`${short(diff.base)}\` → \`${short(diff.head)}\`: the next release builds a new binary for the stores.`,
      ...diff.changes.slice(0, 30).map((c) => `  - ${c.change}: \`${c.source}\``),
      ...(diff.changes.length > 30 ? [`  - and ${diff.changes.length - 30} more`] : []),
    ]);
  }
  throw new Error(
    "Usage: mobile.mjs record-nightly OUT | record-unconfigured OUT REASON | gate [STAGED_JSON] | verify-update [DIR] | " +
      "needs-build PROFILE | check-built FILE | record-app-staged OUT | latest-json OUT | announce | fingerprint-diff BASE HEAD [PLATFORM]",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
