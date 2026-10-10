#!/usr/bin/env node
/**
 * The release train's decisions, for .github/workflows/release.yml.
 *
 *   resolve                    channel, version, tag and commit for the run
 *   notes OUT                  release notes: the commits since the last of its kind
 *   configure-site DIR URL     point a built site at an environment's forecast data
 *   prune-nightlies [KEEP]     delete all but the newest KEEP nightly releases
 *
 * Main feeds a nightly; a release promotes what a nightly already built. Both
 * are tags on this repository:
 *
 *   v2026.10.10-nightly.42     a nightly of main's head, built and accepted
 *   v2026.10.10                a release: the same commit and the same image
 *                              digests as the nightly it promoted, through
 *                              staging and into production
 *
 * Versions are dates (UTC), not semver: the forecast is a service, not a library,
 * and its commits are not Conventional Commits. A second release on one day is
 * v2026.10.10.2. Everything that decides is a pure function exported for
 * tests/release.test.ts; the commands below only read git and the environment.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const NIGHTLY_TAG = /^v(\d{4})\.(\d{2})\.(\d{2})-nightly\.(\d+)$/;
export const RELEASE_TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;
export const FORECAST_BASE_META = "wingfoil:forecast-base";

/** 2026.10.10, in UTC: the date a run starts is the date it is named for. */
export function dateStamp(now) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}`;
}

export function nightlyVersion(now, runNumber) {
  if (!/^\d+$/.test(String(runNumber))) throw new Error(`Not a run number: ${runNumber}`);
  return `${dateStamp(now)}-nightly.${runNumber}`;
}

/** Today's date, or today's date and the next free counter if today already shipped. */
export function releaseVersion(now, tags) {
  const day = dateStamp(now);
  const taken = new Set(tags);
  if (!taken.has(`v${day}`)) return day;
  for (let n = 2; ; n += 1) if (!taken.has(`v${day}.${n}`)) return `${day}.${n}`;
}

function nightlyKey(tag) {
  const [, y, m, d, run] = tag.match(NIGHTLY_TAG);
  return [Number(`${y}${m}${d}`), Number(run)];
}

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

  if (channel === "release") {
    const wanted = (env.DISPATCH_NIGHTLY || "").trim();
    if (wanted && !NIGHTLY_TAG.test(wanted)) throw new Error(`Not a nightly tag: ${wanted}`);
    const tag = wanted || nightliesNewestFirst(tags)[0];
    if (wanted && !tags.includes(wanted)) throw new Error(`No such nightly: ${wanted}`);
    const nightly = tag ? { tag, commit: commitOf(tag) } : null;
    const released = releasesNewestFirst(tags);
    const releasedAt = nightly ? released.find((t) => commitOf(t) === nightly.commit) : undefined;
    promotionCheck({ nightly, releasedAt });
    const version = releaseVersion(now, tags);
    console.error(`Promoting ${nightly.tag} (${nightly.commit.slice(0, 12)}) as v${version}.`);
    return output({
      should_build: true,
      channel,
      version,
      tag: `v${version}`,
      ref: nightly.commit,
      nightly_tag: nightly.tag,
      previous_tag: released[0] ?? "",
    });
  }

  throw new Error(`Unknown channel: ${channel}`);
}

function notes(out) {
  const { REF: ref, PREVIOUS_TAG: previous, NIGHTLY_TAG: nightly, IMAGES_JSON: images } = process.env;
  const range = previous ? `${previous}..${ref}` : ref;
  const limit = previous ? [] : ["-n", "30"];
  const commits = git("log", "--no-merges", "--format=- %s (%h)", ...limit, range);
  const lines = [];
  if (nightly) lines.push(`Promotes ${nightly}: the same commit and the same image digests.`, "");
  if (images) {
    const { images: built } = JSON.parse(readFileSync(images, "utf8"));
    lines.push("## Images", "", ...Object.entries(built).map(([name, ref]) => `- ${name}: \`${ref}\``), "");
  }
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

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "resolve") return resolve();
  if (command === "notes") return notes(args[0] ?? "release-notes.md");
  if (command === "configure-site") return configureSite(args[0], args[1]);
  if (command === "prune-nightlies") return pruneNightlies(Number(args[0] ?? 7));
  throw new Error(`Usage: release.mjs resolve | notes OUT | configure-site DIR URL | prune-nightlies [KEEP]`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
