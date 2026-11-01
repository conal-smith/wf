#!/usr/bin/env node
// Every pull request's title, and every commit in it, is a Conventional Commit
// (https://www.conventionalcommits.org): `type(scope)!: summary`. Pull requests
// are squash-merged with their title as the commit, so the title is what lands
// on main. Merge commits (bringing main into a branch) are left alone.
//
//   node scripts/conventional-commits.mjs --title "feat(spot): ..." --range origin/main..HEAD
//
// The pull request workflow (.github/workflows/pull-request.yml) runs
// this on every pull request.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const HEADER = new RegExp(
  `^(?<type>[a-z]+)(?:\\((?<scope>[a-z0-9][a-z0-9._/-]*)\\))?(?<breaking>!)?: (?<summary>\\S.*)$`,
);
const MAX_LENGTH = 100;

/** Why `subject` is not a Conventional Commit header, or null if it is. */
export function problem(subject) {
  const match = HEADER.exec(subject);
  if (!match) {
    return `expected "type(scope): summary", with type one of ${TYPES.join(", ")}`;
  }
  if (!TYPES.includes(match.groups.type)) {
    return `"${match.groups.type}" is not a type; use one of ${TYPES.join(", ")}`;
  }
  if (subject.length > MAX_LENGTH) {
    return `${subject.length} characters; keep it to ${MAX_LENGTH}`;
  }
  if (/\.$/.test(match.groups.summary)) {
    return "no full stop at the end";
  }
  return null;
}

/** The subjects of the commits in `range` that are not merges. */
function subjects(range) {
  const out = execFileSync(
    "git",
    ["log", "--no-merges", "--format=%h %s", range],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ");
      return { sha: line.slice(0, space), subject: line.slice(space + 1) };
    });
}

function main(argv) {
  const arg = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const title = arg("--title");
  const range = arg("--range");
  if (title === undefined && range === undefined) {
    console.error("usage: conventional-commits.mjs [--title TITLE] [--range BASE..HEAD]");
    return 2;
  }
  const failures = [];
  if (title !== undefined) {
    const why = problem(title);
    if (why) failures.push(`pull request title "${title}": ${why}`);
  }
  if (range !== undefined) {
    for (const { sha, subject } of subjects(range)) {
      const why = problem(subject);
      if (why) failures.push(`commit ${sha} "${subject}": ${why}`);
    }
  }
  for (const failure of failures) console.error(`::error::${failure}`);
  if (failures.length) {
    console.error(
      `\n${failures.length} not a Conventional Commit. See CLAUDE.md, "Commits and pull requests".`,
    );
    return 1;
  }
  console.log("Every title and commit is a Conventional Commit.");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
