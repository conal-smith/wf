#!/usr/bin/env node
// Nothing personal and nothing naming a competitor goes into this public
// repository (CLAUDE.md, "What may be published"). This reads a pull request's
// title and description, every commit message in it, and every line it adds,
// and fails on:
//
// - a real tailnet: a `tail<hex>.ts.net` name or a `tail<hex>` id
//   (`tail1234` and `example` are the placeholders);
// - a Tailscale address (100.64.0.0/10);
// - a home directory (`/Users/…`, `/home/<user>`) other than the placeholders
//   `/Users/dev`, `/Users/me`, `/home/runner`, `/home/dev`, `/home/user`;
// - an email address other than example domains and no-reply senders;
// - anything matching PUBLICATION_DENYLIST, one regular expression per line
//   (case-insensitive unless it starts with `=`), kept as a repository
//   secret: the competitors' names and the owner's own machine names and
//   addresses, which this file must not spell out either.
//
//   node scripts/publication-check.mjs --range BASE..HEAD [--text-env TITLE --text-env BODY]
//
// The pull request workflow (.github/workflows/pull-request.yml) runs it.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Files that must spell out a pattern to test for it. */
const EXEMPT = new Set([
  "scripts/publication-check.mjs",
  "tests/publication-check.test.ts",
]);

const PLACEHOLDER_HOMES = /^\/(Users\/(dev|me)|home\/(runner|dev|user))\b/;
const ALLOWED_EMAIL =
  /@(example\.(com|org|net)|[a-z0-9-]+\.(example|test|invalid)|users\.noreply\.github\.com|anthropic\.com|wingfoil\.ie)$/i;

const RULES = [
  {
    why: "a real tailnet name",
    find: /\b[a-z0-9-]*\.?tail[0-9a-f]{4,}\.ts\.net\b/gi,
    allow: /\btail1234\.ts\.net$/i,
  },
  {
    why: "a real tailnet id",
    find: /\btail[0-9a-f]{6}\b/gi,
    allow: /^tail1234$/i,
  },
  {
    why: "a Tailscale address",
    find: /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
  },
  {
    why: "a home directory",
    find: /\/Users\/[A-Za-z0-9._-]+|\/home\/[a-z][a-z0-9._-]*/g,
    allow: PLACEHOLDER_HOMES,
  },
  {
    why: "an email address",
    find: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    allow: ALLOWED_EMAIL,
  },
];

/**
 * Compiles PUBLICATION_DENYLIST: one expression per line, case-insensitive
 * unless the line starts with `=` (a name that is also an everyday word).
 */
export function denylist(text = "") {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) =>
      line.startsWith("=") ? new RegExp(line.slice(1), "g") : new RegExp(line, "gi"),
    );
}

/**
 * What in `text` must not be published. A denylisted match is reported
 * without its text, so a log never repeats what the secret holds.
 */
export function findings(text, deny = []) {
  const found = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.find)) {
      if (rule.allow?.test(match[0])) continue;
      found.push(`${rule.why} (${match[0]})`);
    }
  }
  for (const pattern of deny) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.push("a denylisted name (PUBLICATION_DENYLIST)");
  }
  return found;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });
}

/** Every added line in `range`, against where the branch left its base. */
function addedLines(range) {
  const [base, head] = range.split("..");
  const out = [];
  let file = null;
  let line = 0;
  for (const row of git("diff", "-U0", "--no-color", "--no-ext-diff", `${base}...${head}`).split("\n")) {
    if (row.startsWith("+++ ")) {
      file = row === "+++ /dev/null" ? null : row.slice(6);
    } else if (row.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
    } else if (row.startsWith("+") && file) {
      if (!EXEMPT.has(file)) out.push({ where: `${file}:${line}`, text: row.slice(1) });
      line += 1;
    }
  }
  return out;
}

function main(argv) {
  const ranges = [];
  const texts = [];
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--range") ranges.push(argv[i + 1]);
    else if (argv[i] === "--text-env") texts.push(argv[i + 1]);
    else {
      console.error("usage: publication-check.mjs [--range BASE..HEAD] [--text-env NAME]...");
      return 2;
    }
  }
  const deny = denylist(process.env.PUBLICATION_DENYLIST);
  const failures = [];
  const check = (where, text) => {
    for (const what of findings(text, deny)) failures.push(`${where}: ${what}`);
  };
  for (const name of texts) check(`pull request ${name.toLowerCase()}`, process.env[name] ?? "");
  for (const range of ranges) {
    // Merge commits too: their messages are published like any other.
    for (const entry of git("log", "--format=%h%x00%B%x1e", range).split("\x1e")) {
      const [sha, message] = entry.trim().split("\0");
      if (sha) check(`commit ${sha}`, message ?? "");
    }
    for (const { where, text } of addedLines(range)) check(where, text);
  }
  for (const failure of failures) console.error(`::error::${failure}`);
  if (failures.length) {
    console.error(
      `\n${failures.length} thing(s) that must not be published. See CLAUDE.md, "What may be published".`,
    );
    return 1;
  }
  console.log(`Nothing personal or denylisted (${deny.length} denylist patterns).`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
