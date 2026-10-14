#!/usr/bin/env node
/**
 * The app's counterpart of the site's design-token lints (scripts/lint-design-
 * tokens.mjs at the root, which read CSS): every colour, space, font and
 * weight in src/ comes from src/theme/tokens.ts, which comes from ui/theme.css.
 *
 *   raw-color    a hex or rgb() literal outside the token files
 *   raw-spacing  a number on padding, margin or gap (use space.*)
 *   raw-font     a fontFamily string (use fonts.* or a type.* style)
 *   raw-weight   a fontWeight (the families carry their weights: fonts.*Bold)
 *
 * A guard that cannot fail is decoration, so `--selftest` feeds it known-bad
 * source and fails if any rule stays quiet (as SprintEngine mobile's does).
 * Escape hatch: `design-tokens-allow: <reason>` on the line or the two above.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");

const TOKEN_FILES = ["src/theme/tokens.ts", "src/theme/css.generated.ts"];

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const SPACING =
  /\b(padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|gap|rowGap|columnGap)\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}]/;
const FONT = /\bfontFamily\s*:\s*["'`]/;
const WEIGHT = /\bfontWeight\s*:/;
const ALLOW = /design-tokens-allow:\s*\S/;

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry) ? [full] : [];
  });
}

const allowed = (lines, i) =>
  lines.slice(Math.max(0, i - 2), i + 1).some((line) => ALLOW.test(line));

export function check(path, source) {
  if (TOKEN_FILES.includes(path)) return [];
  const lines = source.split("\n");
  const found = [];
  lines.forEach((raw, i) => {
    if (allowed(lines, i)) return;
    // Comments are prose about values, not values.
    const line = raw.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    const at = `${path}:${i + 1}`;
    if (COLOR.test(line)) found.push({ rule: "raw-color", at, text: "a colour literal: use colors.* from theme/tokens" });
    const spacing = SPACING.exec(line);
    if (spacing && spacing[2] !== "0")
      found.push({ rule: "raw-spacing", at, text: `${spacing[1]}: ${spacing[2]}: use space.*` });
    if (FONT.test(line)) found.push({ rule: "raw-font", at, text: "a fontFamily string: use fonts.* or type.*" });
    if (WEIGHT.test(line)) found.push({ rule: "raw-weight", at, text: "fontWeight: the families carry their weight (fonts.*Bold)" });
  });
  return found;
}

function selftest() {
  const cases = [
    ["raw-color", 'const a = { color: "#ff0000" };'],
    ["raw-color", 'const a = { color: "rgba(0,0,0,0.5)" };'],
    ["raw-spacing", "const a = { padding: 13 };"],
    ["raw-font", 'const a = { fontFamily: "Comic Sans" };'],
    ["raw-weight", 'const a = { fontWeight: "700" };'],
  ];
  const failures = cases
    .filter(([rule, source]) => !check("src/fixture.ts", source).some((v) => v.rule === rule))
    .map(([rule, source]) => `${rule} did not fire on: ${source}`);
  if (check("src/fixture.ts", '// design-tokens-allow: a map style expression\nconst a = "#ff0000";').length)
    failures.push("the allow comment did not suppress a violation");
  if (check("src/fixture.ts", "const a = { padding: 0, margin: space.md };").length)
    failures.push("a zero or a token was reported");
  if (failures.length) {
    console.error("lint-design-tokens selftest FAILED:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log(`lint-design-tokens selftest: ${cases.length + 2}/${cases.length + 2}`);
}

if (process.argv.includes("--selftest")) selftest();
else {
  const violations = files(src).flatMap((file) => check(relative(root, file), readFileSync(file, "utf8")));
  for (const v of violations) console.error(`${v.at}  ${v.rule}  ${v.text}`);
  console.log(`lint-design-tokens: ${violations.length} violation(s)`);
  process.exit(violations.length ? 1 : 0);
}
