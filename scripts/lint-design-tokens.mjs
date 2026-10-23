#!/usr/bin/env node
// The drift check between the product's theme and its design-system bundle.
//
// ui/theme.css is where the product writes its design values down (npm run
// ui:lint keeps them there); design-system/ restates them as a SprintEngine
// Studio bundle, in DTCG tokens, so the Studio's Design door can show them and
// agents can build from them. Two copies drift unless something holds them
// equal, and this is that thing:
//
//   - every custom property in ui/theme.css is in MAP below, naming the DTCG
//     path that restates it, and the value that path resolves to (through its
//     aliases, in the light mode) equals the theme's;
//   - every path MAP names exists in design-system/foundations/tokens.tokens.json;
//   - every MAP entry names a property the theme still declares;
//   - the bundle's spacing steps (sem.space.x<n>) are n times the theme's step.
//
// Section additions. Sections append their own values to the END of the theme
// under a banner comment, `/* ==== <section> ====…`, as the map does. A
// property below such a banner that MAP does not name yet is a warning ("to add
// to the bundle"), not a failure, so a section's merge does not break the
// build; one that MAP names must still match. An unmapped property above the
// first banner, in the kit's own theme, fails.
//
// Values are compared after normalising: colours lower-cased, whitespace
// collapsed, a font list compared name by name without its quotes, a number
// compared as a number.
//
//   node scripts/lint-design-tokens.mjs                check the repo
//   node scripts/lint-design-tokens.mjs --root <dir>   check another tree laid out the same
//   node scripts/lint-design-tokens.mjs --probe        prove the check fails when it should
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const REPO = join(dirname(SELF), "..");
const THEME = "ui/theme.css";
const TOKENS = "design-system/foundations/tokens.tokens.json";
const BANNER = /\/\*\s*={3,}\s*([\w-][\w -]*?)\s*={3,}/;
const ALIAS = /^\{([a-z0-9.-]+)\}$/;

/** Tailwind theme property -> the DTCG path in the bundle that restates it. */
const MAP = {
  "--spacing": "sem.space.step",
  "--color-ground": "sem.color.ground",
  "--color-card": "sem.color.card",
  "--color-solid": "sem.color.solid",
  "--color-sunken": "sem.color.sunken",
  "--color-glass": "sem.color.glass",
  "--color-inverse": "sem.color.inverse",
  "--color-scrim": "sem.color.scrim",
  "--color-scrim-solid": "sem.color.scrim-solid",
  "--color-sea": "sem.color.sea",
  "--color-sea-1": "sem.color.sea-1",
  "--color-sea-2": "sem.color.sea-2",
  "--color-sea-3": "sem.color.sea-3",
  "--color-sea-4": "sem.color.sea-4",
  "--color-depth": "sem.color.depth",
  "--color-land": "sem.color.land",
  "--color-relief": "sem.color.relief",
  "--color-basemap-water": "sem.color.basemap-water",
  "--color-basemap-land": "sem.color.basemap-land",
  "--color-wash": "sem.color.wash",
  "--color-line": "sem.color.line",
  "--color-line-strong": "sem.color.line-strong",
  "--color-ink": "sem.color.ink",
  "--color-ink-2": "sem.color.ink-2",
  "--color-ink-muted": "sem.color.ink-muted",
  "--color-ink-disabled": "sem.color.ink-disabled",
  "--color-ink-inverse": "sem.color.ink-inverse",
  "--color-accent": "sem.color.accent.primary",
  "--color-accent-hover": "sem.color.accent.hover",
  "--color-accent-ink": "sem.color.accent.ink",
  "--color-quiet": "sem.color.quiet",
  "--color-focus": "sem.color.focus",
  "--color-chart-magenta": "sem.color.chart-magenta",
  "--color-pen": "sem.color.pen",
  "--color-pen-ink": "sem.color.pen-ink",
  "--color-buoy": "sem.color.buoy",
  "--color-ok": "sem.color.ok",
  "--color-warn": "sem.color.warn",
  "--color-warn-ground": "sem.color.warn-ground",
  "--color-now": "sem.color.now",
  "--color-wind-k00": "sem.color.wind.k00",
  "--color-wind-k05": "sem.color.wind.k05",
  "--color-wind-k09": "sem.color.wind.k09",
  "--color-wind-k10": "sem.color.wind.k10",
  "--color-wind-k15": "sem.color.wind.k15",
  "--color-wind-k20": "sem.color.wind.k20",
  "--color-wind-k25": "sem.color.wind.k25",
  "--color-wind-k30": "sem.color.wind.k30",
  "--color-wind-k35": "sem.color.wind.k35",
  "--color-wind-k40": "sem.color.wind.k40",
  "--color-wind-k45": "sem.color.wind.k45",
  "--color-wind-k50": "sem.color.wind.k50",
  "--color-wind-k60": "sem.color.wind.k60",
  "--color-wind-k65": "sem.color.wind.k65",
  "--color-now-marker": "sem.color.now-marker",
  "--color-gust": "sem.color.gust",
  "--font-display": "sem.font.family.display",
  "--font-body": "sem.font.family.body",
  "--font-mono": "sem.font.family.mono",
  "--font-hand": "sem.font.family.hand",
  "--font-weight-normal": "sem.font.weight.normal",
  "--font-weight-medium": "sem.font.weight.medium",
  "--font-weight-semibold": "sem.font.weight.semibold",
  "--font-weight-bold": "sem.font.weight.bold",
  "--font-weight-extrabold": "sem.font.weight.extrabold",
  "--text-eyebrow": "sem.font.size.eyebrow",
  "--text-eyebrow--line-height": "sem.font.line.eyebrow",
  "--text-eyebrow--font-weight": "sem.font.weight.eyebrow",
  "--text-eyebrow--letter-spacing": "sem.font.tracking.eyebrow",
  "--text-caption": "sem.font.size.caption",
  "--text-caption--line-height": "sem.font.line.caption",
  "--text-label": "sem.font.size.label",
  "--text-label--line-height": "sem.font.line.label",
  "--text-label--font-weight": "sem.font.weight.label",
  "--text-label--letter-spacing": "sem.font.tracking.label",
  "--text-body": "sem.font.size.body",
  "--text-body--line-height": "sem.font.line.body",
  "--text-prose": "sem.font.size.prose",
  "--text-prose--line-height": "sem.font.line.prose",
  "--text-input": "sem.font.size.input",
  "--text-input--line-height": "sem.font.line.input",
  "--text-lead": "sem.font.size.lead",
  "--text-lead--line-height": "sem.font.line.lead",
  "--text-lead--font-weight": "sem.font.weight.lead",
  "--text-figure": "sem.font.size.figure",
  "--text-figure--line-height": "sem.font.line.figure",
  "--text-figure--font-weight": "sem.font.weight.figure",
  "--text-figure--letter-spacing": "sem.font.tracking.figure",
  "--text-title": "sem.font.size.title",
  "--text-title--line-height": "sem.font.line.title",
  "--text-title--font-weight": "sem.font.weight.title",
  "--text-title--letter-spacing": "sem.font.tracking.title",
  "--text-headline": "sem.font.size.headline",
  "--text-headline--line-height": "sem.font.line.headline",
  "--text-headline--font-weight": "sem.font.weight.headline",
  "--text-headline--letter-spacing": "sem.font.tracking.headline",
  "--text-reading": "sem.font.size.reading",
  "--text-reading--line-height": "sem.font.line.reading",
  "--leading-tight": "sem.font.line.tight",
  "--leading-normal": "sem.font.line.normal",
  "--leading-loose": "sem.font.line.loose",
  "--radius-control": "sem.radius.control",
  "--radius-surface": "sem.radius.surface",
  "--radius-pill": "sem.radius.pill",
  "--radius-dialog": "sem.radius.dialog",
  "--radius-full": "sem.radius.full",
  "--shadow-control": "sem.shadow.control",
  "--shadow-marker": "sem.shadow.marker",
  "--shadow-surface": "sem.shadow.surface",
  "--shadow-dock": "sem.shadow.dock",
  "--inset-shadow-frame": "sem.shadow.frame",
  "--blur-glass": "sem.blur.glass",
  "--blur-scrim": "sem.blur.scrim",
  "--container-dialog": "sem.container.dialog",
  "--container-dialog-wide": "sem.container.dialog-wide",
  "--container-reading": "sem.container.reading",
  "--container-measure": "sem.container.measure",
  "--container-page": "sem.container.page",
  "--container-form": "sem.container.form",
  "--grid-template-columns-shell": "sem.grid.shell",
  "--grid-template-columns-cards": "sem.grid.cards",
  "--grid-template-columns-detail": "sem.grid.detail",
  "--grid-template-columns-specs": "sem.grid.specs",
  "--grid-template-columns-meter": "sem.grid.meter",
  "--grid-template-columns-profile": "sem.grid.profile",
  "--grid-template-columns-fields": "sem.grid.fields",
  "--grid-template-columns-tiles": "sem.grid.tiles",
  "--breakpoint-rail": "sem.breakpoint.rail",
  "--breakpoint-wide": "sem.breakpoint.wide",
  "--transition-duration-fast": "sem.duration.fast",
  "--transition-duration-base": "sem.duration.base",
  "--z-index-popover": "sem.z-index.popover",
  "--z-index-panel": "sem.z-index.panel",
  "--z-index-header": "sem.z-index.header",
  "--z-index-dialog": "sem.z-index.dialog",
  "--animate-pulse": "sem.animate.pulse",
  "--animate-dialog-in": "sem.animate.dialog-in",
  "--animate-scrim-in": "sem.animate.scrim-in",
  "--animate-menu-in": "sem.animate.menu-in",
  "--animate-ink": "sem.animate.ink",
  "--animate-bob": "sem.animate.bob",
  "--spacing-control-sm": "sem.size.control.sm",
  "--spacing-control-md": "sem.size.control.md",
  "--spacing-control-lg": "sem.size.control.lg",
  "--spacing-touch": "sem.size.touch",
};

/* ---------- reading ---------- */

/** Every `--name: value;` in the theme, with whether it sits in a section addition. */
function themeDeclarations(css) {
  const out = [];
  let section = null;
  // Comments are dropped before a declaration is read, but a banner is noted
  // first: everything after it belongs to that section.
  const lines = css.split("\n");
  let inComment = false;
  lines.forEach((raw, i) => {
    const banner = raw.match(BANNER);
    if (banner) section = banner[1].trim();
    let line = raw;
    if (inComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }
    const decl = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*;\s*$/i);
    if (!decl || decl[1].endsWith("-*")) return;
    out.push({ name: decl[1], value: decl[2], line: i + 1, section });
  });
  return out;
}

function leaf(tokens, path) {
  let node = tokens;
  for (const seg of path.split(".")) {
    if (!node || typeof node !== "object" || !(seg in node)) return null;
    node = node[seg];
  }
  return node && typeof node === "object" && "$value" in node ? node : null;
}

/** A token's light value, its aliases followed. */
function resolve(tokens, path, seen = new Set()) {
  const node = leaf(tokens, path);
  if (!node) return { error: `${path} is not a token in the bundle` };
  if (seen.has(path)) return { error: `${path} is an alias loop` };
  seen.add(path);
  const alias = typeof node.$value === "string" && node.$value.match(ALIAS);
  if (alias) return resolve(tokens, alias[1], seen);
  return { value: node.$value, type: node.$type };
}

/* ---------- comparing ---------- */

const squash = (s) => String(s).trim().replace(/\s+/g, " ").toLowerCase();
const fontList = (v) =>
  (Array.isArray(v) ? v : String(v).split(","))
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .join(",")
    .toLowerCase();

function same(themeValue, token) {
  if (token.type === "fontFamily")
    return fontList(themeValue) === fontList(token.value);
  if (typeof token.value === "number")
    return Number(themeValue) === token.value;
  return squash(themeValue) === squash(token.value);
}

const show = (v) => (Array.isArray(v) ? v.join(", ") : String(v));

/* ---------- the check ---------- */

function check(root, map = MAP) {
  const problems = [];
  const warnings = [];
  const themePath = join(root, THEME);
  const tokensPath = join(root, TOKENS);
  for (const p of [themePath, tokensPath])
    if (!existsSync(p))
      return { problems: [`missing ${p}`], warnings, count: 0 };
  const decls = themeDeclarations(readFileSync(themePath, "utf8"));
  let tokens;
  try {
    tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
  } catch (error) {
    return {
      problems: [`${TOKENS} is not valid JSON: ${error.message}`],
      warnings,
      count: 0,
    };
  }

  const declared = new Set();
  const pending = new Map();
  let matched = 0;
  for (const d of decls) {
    declared.add(d.name);
    const where = `${THEME}:${d.line} ${d.name}`;
    const path = map[d.name];
    if (!path) {
      if (d.section)
        pending.set(d.section, [...(pending.get(d.section) ?? []), d.name]);
      else
        problems.push(
          `${where} has no token in the bundle - add one to ${TOKENS} and name it in MAP in scripts/lint-design-tokens.mjs`,
        );
      continue;
    }
    const token = resolve(tokens, path);
    if (token.error) {
      problems.push(`${where} maps to ${path}, but ${token.error}`);
      continue;
    }
    if (!same(d.value, token))
      problems.push(
        `${where} is ${d.value} in the theme but ${show(token.value)} at ${path} in the bundle - change both together`,
      );
    else matched += 1;
  }
  for (const [section, names] of pending)
    warnings.push(
      `section "${section}" has ${names.length} value${names.length === 1 ? "" : "s"} to add to the bundle (a token in ${TOKENS} and a MAP entry here): ${names.join(", ")}`,
    );

  for (const [name, path] of Object.entries(map)) {
    if (!declared.has(name))
      problems.push(
        `MAP names ${name} (-> ${path}), which ${THEME} no longer declares - remove it from MAP`,
      );
    else if (!leaf(tokens, path)) {
      // Reported above when the declaration was read.
    }
  }

  // The bundle's named spacing steps are multiples of the one step.
  const step = resolve(tokens, "sem.space.step");
  const space = tokens.sem?.space ?? {};
  if (!step.error) {
    const unit = parseFloat(step.value);
    for (const key of Object.keys(space)) {
      const n = key.match(/^x(\d+)(?:-(\d+))?$/);
      if (!n) continue;
      const times = Number(n[1]) + (n[2] ? Number(`0.${n[2]}`) : 0);
      const got = resolve(tokens, `sem.space.${key}`);
      if (got.error || parseFloat(got.value) !== unit * times)
        problems.push(
          `sem.space.${key} is ${show(got.value)} in the bundle, but ${times} steps of ${step.value} is ${unit * times}px`,
        );
    }
  }
  return { problems, warnings, count: matched };
}

/* ---------- the probe ---------- */
// A check that has gone quiet looks exactly like two files that agree. Each
// case copies the real theme and tokens into a scratch tree, changes one thing,
// and runs this same script on it in a child process: the exit code has to be
// the one named.
const swap = (from, to) => (text) => {
  if (!text.includes(from))
    throw new Error(`probe: "${from}" is not in the file any more`);
  return text.replace(from, to);
};
const PROBES = [
  ["the two as they are", {}, 0],
  [
    "a drifted colour in the theme",
    { theme: swap("--color-ink: #1a1d21;", "--color-ink: #1a1d22;") },
    1,
  ],
  [
    "a drifted type step in the theme",
    { theme: swap("--text-lead: 19px;", "--text-lead: 20px;") },
    1,
  ],
  [
    "a drifted value in the bundle",
    { tokens: swap('"$value": "#b0186a"', '"$value": "#b0186b"') },
    1,
  ],
  [
    "a mapped token missing from the bundle",
    {
      tokens: (t) => {
        const doc = JSON.parse(t);
        delete doc.sem.color["pen-ink"];
        return JSON.stringify(doc);
      },
    },
    1,
  ],
  [
    "an unmapped value in the kit's theme",
    {
      theme: swap(
        "--color-gust: #e0803a;",
        "--color-gust: #e0803a;\n  --color-probe: #123456;",
      ),
    },
    1,
  ],
  [
    "an unmapped value in a section addition",
    {
      theme: (t) =>
        `${t}\n/* ==== probe ==== a section's own values */\n@theme static {\n  --color-probe: #123456;\n}\n`,
    },
    0,
  ],
  [
    "a drifted mapped value in a section addition",
    {
      theme: (t) =>
        `${t}\n/* ==== probe ==== */\n@theme static {\n  --color-pen: #000000;\n}\n`,
    },
    1,
  ],
  [
    "a spacing step that is not a multiple",
    { tokens: swap('"$value": "24px"', '"$value": "25px"') },
    1,
  ],
];

function probe() {
  let failed = 0;
  for (const [name, edit, expected] of PROBES) {
    const root = mkdtempSync(join(tmpdir(), "design-tokens-probe-"));
    try {
      for (const [rel, key] of [
        [THEME, "theme"],
        [TOKENS, "tokens"],
      ]) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        const text = readFileSync(join(REPO, rel), "utf8");
        writeFileSync(join(root, rel), edit[key] ? edit[key](text) : text);
      }
      const { status } = spawnSync(process.execPath, [SELF, "--root", root], {
        stdio: "pipe",
      });
      if (status !== expected) {
        failed += 1;
        console.error(
          `  probe: ${name} - expected exit ${expected}, got ${status}`,
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`  probe: ${name} - ${error.message}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  if (failed) {
    console.error(
      `\ndesign-token drift probe: ${failed} of ${PROBES.length} cases wrong - the check cannot be trusted\n`,
    );
    process.exit(1);
  }
  console.log(
    `design-token drift probe: ${PROBES.length} cases, the check fails when it should`,
  );
}

/* ---------- run ---------- */
const args = process.argv.slice(2);
if (args.includes("--probe")) probe();
else {
  const at = args.indexOf("--root");
  if (at !== -1 && !args[at + 1]) {
    console.error("design-token drift: --root needs a directory");
    process.exit(2);
  }
  const { problems, warnings, count } = check(at === -1 ? REPO : args[at + 1]);
  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (problems.length) {
    console.error(
      `\n${problems.length} design-token drift problem${problems.length === 1 ? "" : "s"}:\n`,
    );
    for (const p of problems) console.error(`  ${p}`);
    console.error("");
    process.exit(1);
  }
  console.log(
    `design-token drift: clean - ${count} theme values match the bundle` +
      (warnings.length
        ? `; ${warnings.length} section${warnings.length === 1 ? "" : "s"} with values to add to the bundle`
        : ""),
  );
}
