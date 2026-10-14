#!/usr/bin/env node
/**
 * The release train's decisions, for .github/workflows/release.yml.
 *
 *   resolve                    channel, version, tag and commit for the run
 *   notes OUT                  release notes: the commits since the last of its kind
 *   configure-site DIR URL     point a built site at an environment's forecast data
 *   prune-nightlies [KEEP]     delete all but the newest KEEP nightly releases
 *   record-staged OUT          staged.json: what staging tested, for a later promote
 *   verify-staged              the downloaded staged build is exactly what staging tested
 *
 * The app's part of the train (an EAS update and store binaries) is
 * scripts/release/mobile.mjs; staged.json carries what staging did with it.
 *
 * Main feeds a nightly; a release stages what a nightly already built, and a
 * promote puts what staging tested into production. All three are tags on this
 * repository:
 *
 *   v2026.10.10-nightly.42     a nightly of main's head, built and accepted
 *   v2026.10.11-rc.57          a nightly that passed staging (the workflow run's
 *                              number): its commit, digests and site, waiting for
 *                              someone to look at staging and promote it
 *   v2026.10.11                a release: the same commit, image digests and site
 *                              build as the staged candidate it promoted
 *
 * Versions are dates (UTC), not semver: the forecast is a service, not a library,
 * and its commits are not Conventional Commits. A second release on one day is
 * v2026.10.10.2. Everything that decides is a pure function exported for
 * tests/release.test.ts; the commands below only read git and the environment.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const NIGHTLY_TAG = /^v(\d{4})\.(\d{2})\.(\d{2})-nightly\.(\d+)$/;
export const STAGED_TAG = /^v(\d{4})\.(\d{2})\.(\d{2})-rc\.(\d+)$/;
export const RELEASE_TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;
export const FORECAST_BASE_META = "wingfoil:forecast-base";
/** The job in release.yml that stages a build; promote asks GitHub how it ended. */
export const STAGING_JOB = "Staging";
/** The files a staged candidate carries, and the release after it. */
export const STAGED_FILES = ["images.json", "site.tar.gz"];
/**
 * Carried when the nightly had them: mobile.json (the app's update, from
 * scripts/release/mobile.mjs). A candidate staged before they existed is still
 * promotable; one that recorded them must still have them, unchanged.
 */
export const OPTIONAL_STAGED_FILES = ["mobile.json"];

/** 2026.10.10, in UTC: the date a run starts is the date it is named for. */
export function dateStamp(now) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}`;
}

export function nightlyVersion(now, runNumber) {
  if (!/^\d+$/.test(String(runNumber))) throw new Error(`Not a run number: ${runNumber}`);
  return `${dateStamp(now)}-nightly.${runNumber}`;
}

/**
 * A staged candidate is named for the day and the workflow run that staged it.
 * The run number, not a daily counter: a staging that fails leaves no tag, and a
 * counter would hand its number -- and its image tag -- to the next attempt.
 */
export function stagedVersion(now, runNumber) {
  if (!/^\d+$/.test(String(runNumber))) throw new Error(`Not a run number: ${runNumber}`);
  return `${dateStamp(now)}-rc.${runNumber}`;
}

/** Today's date, or today's date and the next free counter if today already shipped. */
export function releaseVersion(now, tags) {
  const day = dateStamp(now);
  const taken = new Set(tags);
  if (!taken.has(`v${day}`)) return day;
  for (let n = 2; ; n += 1) if (!taken.has(`v${day}.${n}`)) return `${day}.${n}`;
}

const runKey = (pattern) => (tag) => {
  const [, y, m, d, run] = tag.match(pattern);
  return [Number(`${y}${m}${d}`), Number(run)];
};
const nightlyKey = runKey(NIGHTLY_TAG);
const stagedKey = runKey(STAGED_TAG);

function releaseKey(tag) {
  const [, y, m, d, n] = tag.match(RELEASE_TAG);
  return [Number(`${y}${m}${d}`), Number(n ?? 1)];
}

function newest(tags, pattern, key) {
  const matching = tags.filter((tag) => pattern.test(tag));
  matching.sort((a, b) => {
    const [a1, a2] = key(a);
    const [b1, b2] = key(b);
    return b1 - a1 || b2 - a2;
  });
  return matching;
}

/** Nightly tags, newest first. */
export const nightliesNewestFirst = (tags) => newest(tags, NIGHTLY_TAG, nightlyKey);
/** Staged candidates, newest first. */
export const stagedNewestFirst = (tags) => newest(tags, STAGED_TAG, stagedKey);
/** Release tags, newest first. */
export const releasesNewestFirst = (tags) => newest(tags, RELEASE_TAG, releaseKey);

/**
 * Should a scheduled nightly build main's head?
 *
 * Nothing new since the last nightly: no. Main moved on from it: yes. Main no
 * longer contains it at all -- history rewritten under the train -- is refused,
 * loudly, rather than quietly building a commit that skips over what shipped.
 */
export function nightlyGate({ head, last, lastIsAncestor }) {
  if (!last) return { build: true, reason: "No nightly yet: building main's head." };
  if (last.commit === head)
    return { build: false, reason: `${last.tag} already built ${head.slice(0, 12)}; main has nothing new.` };
  if (!lastIsAncestor)
    throw new Error(
      `${last.tag} built ${last.commit.slice(0, 12)}, which main (${head.slice(0, 12)}) no longer contains. ` +
        "Main was rewritten under the nightly train; dispatch a nightly by hand once that is intended.",
    );
  return { build: true, reason: `Main has moved on from ${last.tag}.` };
}

/** A release promotes a nightly once: a commit already released is refused. */
export function promotionCheck({ nightly, releasedAt }) {
  if (!nightly) throw new Error("There is no nightly to promote: run a nightly first.");
  if (releasedAt)
    throw new Error(`${nightly.tag}'s commit ${nightly.commit.slice(0, 12)} is already released as ${releasedAt}.`);
}

/**
 * Production only moves forward: what it runs must be part of what replaces it.
 *
 * The rule is ancestry, not dates. Production's commit must be an ancestor of
 * the candidate's, so every change production has is still in the candidate.
 * A date test would let through an older nightly staged after a newer one
 * shipped, or a nightly of a main rewritten since, and both take changes back
 * out of production. Rolling back is a revert through the train (or re-tagging
 * an earlier digest by hand), never a promote. No release yet: anything goes.
 */
export function aheadOfProduction({ candidate, production, containsProduction }) {
  if (!production) return;
  if (!containsProduction)
    throw new Error(
      `${candidate.tag} (${candidate.commit.slice(0, 12)}) does not contain ${production.tag} ` +
        `(${production.commit.slice(0, 12)}), which production runs: it is older, or from history ` +
        "rewritten since. Production only moves forward; ship a revert through the train to go back.",
    );
}

/** How the job that staged a candidate ended, as GitHub's jobs API reports it. */
export function stagingPassed(job) {
  return Boolean(job && job.status === "completed" && job.conclusion === "success");
}

/**
 * Whether a staged candidate may go to production. Refused: nothing staged; a
 * record that does not match its tag; a staging job that did not pass (or has
 * not finished); a commit already released; a candidate that does not contain
 * what production runs; and a site that would be deployed to production
 * without ever having been deployed to staging.
 */
export function promoteCheck({ candidate, staged, stagingJob, releasedAt, production, containsProduction, pagesProject }) {
  if (!candidate) throw new Error("Nothing has been staged: dispatch a release first.");
  if (!staged || staged.tag !== candidate.tag || staged.commit !== candidate.commit)
    throw new Error(
      `${candidate.tag}'s staged.json does not describe it (tag ${staged?.tag}, commit ${staged?.commit}); ` +
        `the tag is on ${candidate.commit.slice(0, 12)}.`,
    );
  if (!stagingJob)
    throw new Error(`${candidate.tag}: run ${staged.staging?.runId} has no ${STAGING_JOB} job to vouch for it.`);
  if (!stagingPassed(stagingJob))
    throw new Error(
      `${candidate.tag} did not pass staging: its ${STAGING_JOB} job in run ${staged.staging?.runId} is ` +
        `${stagingJob.status}${stagingJob.conclusion ? ` (${stagingJob.conclusion})` : ""}.`,
    );
  if (releasedAt)
    throw new Error(`${candidate.tag}'s commit ${candidate.commit.slice(0, 12)} is already released as ${releasedAt}.`);
  aheadOfProduction({ candidate, production, containsProduction });
  if (pagesProject && !staged.staging?.siteDeployed)
    throw new Error(
      `${candidate.tag} was staged without a site deployment, so nobody has looked at its site on staging. ` +
        "Stage it again now that Cloudflare Pages is set up.",
    );
}

/** staged.json: everything promote needs to put exactly this build in production. */
export function stagedRecord({ tag, version, nightlyTag, commit, images, sha256, runId, runAttempt, siteDeployed, siteUrl, forecastBase, at, mobile }) {
  if (!STAGED_TAG.test(tag)) throw new Error(`Not a staged tag: ${tag}`);
  if (images?.commit !== commit) throw new Error(`images.json is for ${images?.commit}, not ${commit}`);
  for (const file of STAGED_FILES)
    if (!/^[0-9a-f]{64}$/.test(sha256?.[file] ?? "")) throw new Error(`No sha256 for ${file}`);
  for (const file of OPTIONAL_STAGED_FILES)
    if (file in (sha256 ?? {}) && !/^[0-9a-f]{64}$/.test(sha256[file] ?? "")) throw new Error(`No sha256 for ${file}`);
  if (mobile && !("mobile.json" in sha256)) throw new Error("The app was staged but mobile.json was not hashed");
  if (mobile && mobile.commit !== commit) throw new Error(`The app staged is for ${mobile.commit}, not ${commit}`);
  return {
    schemaVersion: 1,
    tag,
    version,
    nightly: nightlyTag,
    commit,
    images: images.images,
    sha256,
    staging: {
      job: STAGING_JOB,
      runId: String(runId),
      runAttempt: Number(runAttempt || 1),
      siteDeployed: Boolean(siteDeployed),
      siteUrl: siteDeployed ? siteUrl || "" : "",
      forecastBase: siteDeployed ? forecastBase || "" : "",
    },
    // What staging did with the app (mobile.mjs record-app-staged), or null.
    mobile: mobile ?? null,
    stagedAt: at,
  };
}

/** The files downloaded from a staged candidate are byte for byte what staging tested. */
export function verifyStaged({ staged, tag, ref, images, sha256, mobile }) {
  const problems = [];
  for (const file of OPTIONAL_STAGED_FILES)
    if (staged.sha256?.[file] && staged.sha256[file] !== sha256[file])
      problems.push(
        sha256[file]
          ? `${file} is not the file staging tested (sha256 ${sha256[file]}, staged ${staged.sha256[file]})`
          : `${file} is missing, but staging recorded it`,
      );
  if (staged.mobile && mobile) {
    if (staged.mobile.branch !== mobile.branch) problems.push(`the app staged was ${staged.mobile.branch}, mobile.json says ${mobile.branch}`);
    for (const [platform, group] of Object.entries(staged.mobile.groups ?? {}))
      if (mobile.updates?.[platform]?.group !== group) problems.push(`the ${platform} app update is not the group staging pointed at`);
  }
  if (staged.tag !== tag) problems.push(`staged.json is for ${staged.tag}, not ${tag}`);
  if (staged.commit !== ref) problems.push(`staged.json is for commit ${staged.commit}, not ${ref}`);
  if (images.commit !== ref) problems.push(`images.json is for commit ${images.commit}, not ${ref}`);
  for (const file of STAGED_FILES)
    if (staged.sha256?.[file] !== sha256[file])
      problems.push(`${file} is not the file staging tested (sha256 ${sha256[file]}, staged ${staged.sha256?.[file]})`);
  for (const [name, digest] of Object.entries(staged.images ?? {}))
    if (images.images?.[name] !== digest) problems.push(`the ${name} image is not the digest staging tested`);
  if (problems.length) throw new Error(`Refusing to promote ${tag}: ${problems.join("; ")}.`);
}

/** The same build, pointed at one environment's data: a meta tag in index.html. */
export function configureIndexHtml(html, base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`Not a URL: ${base}`);
  }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error(`Forecast data must be served over https: ${base}`);
  const value = url.href.replace(/\/?$/, "/").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const tag = `<meta name="${FORECAST_BASE_META}" content="${value}" />`;
  const existing = new RegExp(`<meta name="${FORECAST_BASE_META}"[^>]*>`);
  if (existing.test(html)) return html.replace(existing, tag);
  if (!html.includes("</head>")) throw new Error("index.html has no </head>");
  return html.replace("</head>", `  ${tag}\n  </head>`);
}

// --- git and the environment ---------------------------------------------------

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gitOk = (...args) => {
  try {
    execFileSync("git", args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const commitOf = (tag) => git("rev-parse", `${tag}^{commit}`);
const allTags = () => git("tag", "--list", "v*").split("\n").filter(Boolean);

function output(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function resolve() {
  const env = process.env;
  const now = env.RELEASE_NOW ? new Date(env.RELEASE_NOW) : new Date();
  const channel = env.EVENT_NAME === "schedule" ? "nightly" : env.DISPATCH_CHANNEL || "nightly";
  const tags = allTags();

  if (channel === "nightly") {
    const head = env.SHA || git("rev-parse", "HEAD");
    const [lastTag] = nightliesNewestFirst(tags);
    const last = lastTag ? { tag: lastTag, commit: commitOf(lastTag) } : null;
    let gate = { build: true, reason: "Dispatched by hand: the gate is skipped." };
    if (env.EVENT_NAME === "schedule")
      gate = nightlyGate({
        head,
        last,
        lastIsAncestor: last ? gitOk("merge-base", "--is-ancestor", last.commit, head) : false,
      });
    console.error(gate.reason);
    const version = nightlyVersion(now, env.RUN_NUMBER);
    return output({
      should_build: gate.build,
      channel,
      version,
      tag: `v${version}`,
      ref: head,
      previous_tag: lastTag ?? "",
    });
  }

  const released = releasesNewestFirst(tags);
  const production = released[0] ? { tag: released[0], commit: commitOf(released[0]) } : null;
  const releasedAt = (commit) => released.find((t) => commitOf(t) === commit);
  const containsProduction = (commit) =>
    production ? gitOk("merge-base", "--is-ancestor", production.commit, commit) : true;

  // Stage a nightly: staging only. What it tested becomes a candidate to promote.
  if (channel === "release") {
    const wanted = (env.DISPATCH_NIGHTLY || "").trim();
    if (wanted && !NIGHTLY_TAG.test(wanted)) throw new Error(`Not a nightly tag: ${wanted}`);
    const tag = wanted || nightliesNewestFirst(tags)[0];
    if (wanted && !tags.includes(wanted)) throw new Error(`No such nightly: ${wanted}`);
    const nightly = tag ? { tag, commit: commitOf(tag) } : null;
    promotionCheck({ nightly, releasedAt: nightly ? releasedAt(nightly.commit) : undefined });
    // Refused now rather than at promote, after half an hour of staging.
    aheadOfProduction({ candidate: nightly, production, containsProduction: containsProduction(nightly.commit) });
    const version = stagedVersion(now, env.RUN_NUMBER);
    console.error(`Staging ${nightly.tag} (${nightly.commit.slice(0, 12)}) as v${version}.`);
    return output({
      should_build: true,
      channel,
      version,
      tag: `v${version}`,
      ref: nightly.commit,
      nightly_tag: nightly.tag,
      staged_tag: "",
      previous_tag: released[0] ?? "",
    });
  }

  // Promote what staging tested: production only.
  if (channel === "promote") {
    const wanted = (env.DISPATCH_STAGED || "").trim();
    if (wanted && !STAGED_TAG.test(wanted)) throw new Error(`Not a staged tag: ${wanted}`);
    if (wanted && !tags.includes(wanted)) throw new Error(`No such staged candidate: ${wanted}`);
    let chosen = null;
    if (wanted) chosen = describeStaged(wanted);
    else {
      // The newest candidate whose staging passed. A candidate only exists once
      // its staging job reached its last step, so skipping one is rare and said.
      const skipped = [];
      for (const tag of stagedNewestFirst(tags).slice(0, 10)) {
        const described = describeStaged(tag);
        if (stagingPassed(described.stagingJob)) {
          chosen = described;
          break;
        }
        skipped.push(tag);
        console.error(`Skipping ${tag}: ${described.error ?? "its staging job did not pass"}.`);
      }
      if (!chosen && skipped.length)
        throw new Error(`No staged candidate passed staging (tried ${skipped.join(", ")}): dispatch a release.`);
    }
    if (chosen?.error) throw new Error(`${chosen.candidate.tag}: ${chosen.error}`);
    const candidate = chosen?.candidate ?? null;
    promoteCheck({
      candidate,
      staged: chosen?.staged,
      stagingJob: chosen?.stagingJob,
      releasedAt: candidate ? releasedAt(candidate.commit) : undefined,
      production,
      containsProduction: candidate ? containsProduction(candidate.commit) : false,
      pagesProject: env.PAGES_PROJECT || "",
    });
    const version = releaseVersion(now, tags);
    console.error(
      `Promoting ${candidate.tag} (${candidate.commit.slice(0, 12)}, staged from ${chosen.staged.nightly}) as v${version}.`,
    );
    return output({
      should_build: true,
      channel,
      version,
      tag: `v${version}`,
      ref: candidate.commit,
      nightly_tag: chosen.staged.nightly ?? "",
      staged_tag: candidate.tag,
      previous_tag: released[0] ?? "",
    });
  }

  throw new Error(`Unknown channel: ${channel}`);
}

// --- GitHub: a staged candidate's record and the job that staged it -------------

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A candidate, its staged.json and its staging job, or the reason one is missing. */
function describeStaged(tag) {
  const candidate = { tag, commit: commitOf(tag) };
  const repo = process.env.GITHUB_REPOSITORY;
  let staged;
  try {
    staged = JSON.parse(gh("release", "download", tag, "--repo", repo, "-p", "staged.json", "-O", "-"));
  } catch (error) {
    return { candidate, error: `no readable staged.json on its release (${String(error.message).split("\n")[0]})` };
  }
  const { runId, runAttempt } = staged.staging ?? {};
  if (!/^\d+$/.test(String(runId ?? "")))
    return { candidate, staged, error: "its staged.json names no staging run" };
  let jobs;
  try {
    jobs = JSON.parse(
      gh("api", `repos/${repo}/actions/runs/${runId}/attempts/${Number(runAttempt) || 1}/jobs?per_page=100`),
    ).jobs;
  } catch (error) {
    return { candidate, staged, error: `could not read staging run ${runId} (${String(error.message).split("\n")[0]})` };
  }
  return { candidate, staged, stagingJob: jobs.find((job) => job.name === STAGING_JOB) };
}

function notes(out) {
  const { REF: ref, PREVIOUS_TAG: previous, NIGHTLY_TAG: nightly, STAGED_TAG: staged, IMAGES_JSON: images } = process.env;
  const range = previous ? `${previous}..${ref}` : ref;
  const limit = previous ? [] : ["-n", "30"];
  const commits = git("log", "--no-merges", "--format=- %s (%h)", ...limit, range);
  const lines = [];
  if (staged)
    lines.push(
      `Promotes ${staged}${nightly ? `, staged from ${nightly}` : ""}: the same commit, image digests and site build staging tested.`,
      "",
    );
  else if (nightly)
    lines.push(
      `Stages ${nightly}: the same commit and the same image digests, tested on staging. ` +
        "Look at staging, then *Run workflow → promote* puts exactly this in production.",
      "",
    );
  if (images) {
    const { images: built } = JSON.parse(readFileSync(images, "utf8"));
    lines.push("## Images", "", ...Object.entries(built).map(([name, ref]) => `- ${name}: \`${ref}\``), "");
  }
  const mobile = process.env.MOBILE_JSON && existsSync(process.env.MOBILE_JSON) ? readJson(process.env.MOBILE_JSON) : null;
  if (mobile?.configured)
    lines.push(
      "## App",
      "",
      `Over-the-air update on EAS branch \`${mobile.branch}\` (app ${mobile.appVersion}):`,
      ...Object.entries(mobile.updates).map(
        ([platform, u]) => `- ${platform}: group \`${u.group}\`, runtime \`${String(u.runtimeVersion).slice(0, 12)}\``,
      ),
      "",
    );
  lines.push(previous ? `## Changes since ${previous}` : "## Changes", "", commits || "- No changes.", "");
  writeFileSync(out, lines.join("\n"));
  console.log(lines.join("\n"));
}

function configureSite(dir, base) {
  const index = join(dir, "index.html");
  writeFileSync(index, configureIndexHtml(readFileSync(index, "utf8"), base));
  console.log(`${index} reads its forecast from ${base}`);
}

async function pruneNightlies(keep) {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token } = process.env;
  const api = (path, init = {}) =>
    fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
  const response = await api("/releases?per_page=100");
  if (!response.ok) throw new Error(`Listing releases: ${response.status}`);
  const releases = (await response.json()).filter((r) => NIGHTLY_TAG.test(r.tag_name) && !r.draft);
  const order = nightliesNewestFirst(releases.map((r) => r.tag_name));
  for (const tag of order.slice(keep)) {
    const release = releases.find((r) => r.tag_name === tag);
    const deleted = await api(`/releases/${release.id}`, { method: "DELETE" });
    console.log(`${deleted.ok ? "Deleted" : "Could not delete"} the ${tag} release (its tag stays).`);
  }
}

const sha256Of = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
/** The staged files here: every required one, and each optional one present. */
const hashes = () =>
  Object.fromEntries(
    [...STAGED_FILES, ...OPTIONAL_STAGED_FILES.filter((file) => existsSync(file))].map((file) => [file, sha256Of(file)]),
  );

/** Run beside images.json and site.tar.gz, at the end of a staging that passed. */
function recordStaged(out) {
  const env = process.env;
  const record = stagedRecord({
    tag: env.TAG,
    version: env.VERSION,
    nightlyTag: env.NIGHTLY_TAG,
    commit: env.REF,
    images: readJson("images.json"),
    sha256: hashes(),
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    siteDeployed: env.SITE_DEPLOYED === "true",
    siteUrl: env.SITE_URL,
    forecastBase: env.FORECAST_BASE,
    at: new Date().toISOString(),
    mobile: existsSync(env.APP_STAGED || "app-staged.json") ? readJson(env.APP_STAGED || "app-staged.json") : undefined,
  });
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
}

/** Run beside the files downloaded from a staged candidate, before anything moves. */
function verifyStagedFiles() {
  const { STAGED_TAG: tag, REF: ref } = process.env;
  verifyStaged({
    staged: readJson("staged.json"),
    tag,
    ref,
    images: readJson("images.json"),
    sha256: hashes(),
    mobile: existsSync("mobile.json") ? readJson("mobile.json") : undefined,
  });
  const files = [...STAGED_FILES, ...OPTIONAL_STAGED_FILES.filter((file) => existsSync(file))];
  console.log(`${tag}: ${files.join(", ")} are the files staging tested, for ${ref}.`);
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "resolve") return resolve();
  if (command === "notes") return notes(args[0] ?? "release-notes.md");
  if (command === "configure-site") return configureSite(args[0], args[1]);
  if (command === "prune-nightlies") return pruneNightlies(Number(args[0] ?? 7));
  if (command === "record-staged") return recordStaged(args[0] ?? "staged.json");
  if (command === "verify-staged") return verifyStagedFiles();
  throw new Error(
    "Usage: release.mjs resolve | notes OUT | configure-site DIR URL | prune-nightlies [KEEP] | " +
      "record-staged OUT | verify-staged",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
