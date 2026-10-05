#!/usr/bin/env node
// The gate on how product UI is styled. ui/theme.css is the only place a design
// value is written down; this keeps it that way by closing the two doors the
// utility classes leave open:
//
//   - an arbitrary value in a class string (`p-[13px]`, `bg-[#123456]`,
//     `w-(--gutter)`, `[&>p]:mt-0`), which resolves without the theme;
//   - a colour literal (`#1463ff`, `rgb(…)`) anywhere but the theme.
//
// Whole lines are read, comments included: class names are collected from
// comments too, so an arbitrary value written in one still becomes CSS.
//
// The one escape is `ui-lint-allow: <reason>` in a comment on the line or on
// the line above, and it needs a real reason.
//
//   node scripts/lint-ui.mjs                lint the repo
//   node scripts/lint-ui.mjs --root <dir>   lint another tree with the same layout
//   node scripts/lint-ui.mjs --probe        prove the lint still fails when it should
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const REPO = join(dirname(SELF), "..");

// Where utility classes are written. A directory that does not exist yet is
// simply not there to lint. The site menu is the one file of force5/src that
// is written in utilities (ui/theme.css scans it and nothing else there), so it
// is named on its own rather than the map's whole directory.
const DIRS = [
  "ui",
  "market/web",
  "community/web",
  "ai/web",
  "companion/web",
  "force5/src/SiteMenu.tsx",
];
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".html",
]);
// The theme is where the literals live; everything else reads them from it.
const THEME = "ui/theme.css";

const ALLOW = /ui-lint-allow:(.*)/;

const ARBITRARY_RULES = [
  [/[a-z0-9]-\[[^\]\s]*\]/i, "arbitrary value"],
  // `w-(--gutter)`, and the same with a type hint: `bg-(color:--brand)`.
  [/[a-z0-9]-\((?:[a-z-]+:)?--[^)\s]*\)/i, "arbitrary value"],
  [/[a-z0-9]\/(?:\[[^\]\s]+\]|\(--[^)\s]*\))/i, "arbitrary modifier"],
  [/(?:^|[\s"'`:])\[[^\]\s]+\]:(?=[\w!@*[-])/, "arbitrary variant"],
  [/(?:^|[\s"'`:])\[[a-z-]+:[^\]\s]+\](?=[\s"'`]|$)/, "arbitrary property"],
];
const COLOUR_RULES = [
  // `&#123;` is a character reference, not a colour.
  [/(?<![&\w])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i, "colour literal"],
  [/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/, "colour literal"],
];

/** The reason given on an allow comment, without the comment's own closing. */
function allowReason(line) {
  const match = line.match(ALLOW);
  if (!match) return null;
  return match[1].replace(/(\*\/\s*\}?|-->)\s*$/, "").trim();
}

function* walk(dir) {
  if (statSync(dir).isFile()) {
    if (EXTENSIONS.has(extname(dir))) yield dir;
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* walk(path);
    } else if (EXTENSIONS.has(extname(entry.name))) yield path;
  }
}

/** Every problem under `root`, as `{ where, msg }`, and how many files were read. */
function lint(root) {
  const problems = [];
  let files = 0;
  for (const dir of DIRS) {
    if (!existsSync(join(root, dir))) continue;
    for (const path of walk(join(root, dir))) {
      files += 1;
      const file = relative(root, path).split(sep).join("/");
      const rules =
        file === THEME
          ? ARBITRARY_RULES
          : [...ARBITRARY_RULES, ...COLOUR_RULES];
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, i) => {
        const where = `${file}:${i + 1}`;
        const own = allowReason(line);
        if (own === "")
          problems.push({
            where,
            msg: "ui-lint-allow with no reason - say why the theme cannot hold this",
          });
        const allowed = own || (i > 0 && allowReason(lines[i - 1]));
        if (allowed) return;
        for (const [re, label] of rules) {
          const hit = line.match(re);
          if (hit)
            problems.push({
              where,
              msg: `${label} ${hit[0].trim()} - use a value from ${THEME}, or justify it with ui-lint-allow: <reason>`,
            });
        }
      });
    }
  }
  return { problems, files };
}

/* ---------- the probe ---------- */
// A lint that has gone quiet looks exactly like a clean repo. So each case here
// is a scratch tree with one thing in it, linted by this same script in a child
// process, and the exit code has to be the one named.
const PROBES = [
  [
    "an arbitrary value",
    "ui/Probe.tsx",
    'export const probe = <i className="p-[13px]" />;\n',
    1,
  ],
  [
    "a colour literal",
    "community/web/probe.css",
    ".probe { color: #1463ff; }\n",
    1,
  ],
  [
    "a colour function",
    "market/web/probe.ts",
    'export const probe = "rgb(20 99 255)";\n',
    1,
  ],
  [
    "an arbitrary value in the site menu",
    "force5/src/SiteMenu.tsx",
    'export const probe = <i className="p-[13px]" />;\n',
    1,
  ],
  [
    "an allow with no reason",
    "ui/Probe.tsx",
    '// ui-lint-allow:\nexport const probe = "p-[13px]";\n',
    1,
  ],
  [
    "an allow with a reason",
    "ui/Probe.tsx",
    '// ui-lint-allow: the probe needs one that passes\nexport const probe = "p-[13px]";\n',
    0,
  ],
  ["a literal in the theme", THEME, "@theme { --color-accent: #1463ff; }\n", 0],
  [
    "theme classes only",
    "ui/Probe.tsx",
    'export const probe = <i className="bg-accent p-4 rounded-full" />;\n',
    0,
  ],
];

function probe() {
  let failed = 0;
  for (const [name, file, content, expected] of PROBES) {
    const root = mkdtempSync(join(tmpdir(), "ui-lint-probe-"));
    try {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
      const { status } = spawnSync(process.execPath, [SELF, "--root", root], {
        stdio: "pipe",
      });
      if (status !== expected) {
        failed += 1;
        console.error(
          `  probe: ${name} - expected exit ${expected}, got ${status}`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  if (failed) {
    console.error(
      `\nui lint probe: ${failed} of ${PROBES.length} cases wrong - the lint cannot be trusted\n`,
    );
    process.exit(1);
  }
  console.log(
    `ui lint probe: ${PROBES.length} cases, the lint fails when it should`,
  );
}

/* ---------- run ---------- */
const args = process.argv.slice(2);
if (args.includes("--probe")) probe();
else {
  const at = args.indexOf("--root");
  if (at !== -1 && !args[at + 1]) {
    console.error("ui lint: --root needs a directory");
    process.exit(2);
  }
  const { problems, files } = lint(at === -1 ? REPO : args[at + 1]);
  if (problems.length) {
    console.error(
      `\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`,
    );
    for (const p of problems) console.error(`  ${p.where}\n    ${p.msg}`);
    console.error("");
    process.exit(1);
  }
  console.log(`ui lint: clean - ${files} files`);
}
