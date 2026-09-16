#!/usr/bin/env node
// The contribution gate. Exits non-zero if the bundle's own sources break its rules.
// It governs THIS bundle only - enforcing the system across product code is a
// separate rule that lives in the project. See USAGE.md.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = "com.multicode";
const problems = [];
const fail = (file, msg) => problems.push({ file, msg });

const manifest = JSON.parse(readFileSync(join(ROOT, "design-system.json"), "utf8"));
const tokenTree = JSON.parse(readFileSync(join(ROOT, "foundations/tokens.tokens.json"), "utf8"));

/* ---------- (a) manifest shape ---------- */
for (const key of ["schemaVersion", "name", "version", "modes", "namingGrammar", "contents", "derived", "provenance"])
  if (!(key in manifest)) fail("design-system.json", `missing required key "${key}"`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? ""))
  fail("design-system.json", `version "${manifest.version}" is not semver`);

/* ---------- (b) tokens: shape, semantics, aliases ---------- */
const tokens = new Map();
(function walk(node, path = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    if (value && typeof value === "object") {
      if ("$value" in value) tokens.set([...path, key].join("."), value);
      else walk(value, [...path, key]);
    }
  }
})(tokenTree);

const typeOf = (path) => {
  const parts = path.split(".");
  for (let i = parts.length; i > 0; i--) {
    const node = parts.slice(0, i).reduce((n, k) => n?.[k], tokenTree);
    if (node?.$type) return node.$type;
  }
};

const ALIAS = /^\{([A-Za-z0-9_.-]+)\}$/;
const aliasTargets = (v, out = []) => {
  if (typeof v === "string") { const m = v.match(ALIAS); if (m) out.push(m[1]); }
  else if (Array.isArray(v)) v.forEach((x) => aliasTargets(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => aliasTargets(x, out));
  return out;
};

const T = "foundations/tokens.tokens.json";
for (const [path, token] of tokens) {
  if (!typeOf(path)) fail(T, `${path}: no $type on the token or any ancestor group`);
  if (!token.$description?.trim()) fail(T, `${path}: missing $description`);

  const modes = token.$extensions?.[EXT]?.modes;
  for (const value of [token.$value, ...Object.values(modes ?? {})])
    for (const target of aliasTargets(value))
      if (!tokens.has(target)) fail(T, `${path}: alias {${target}} does not resolve`);

  if (modes)
    for (const mode of Object.keys(modes))
      if (!manifest.modes.includes(mode)) fail(T, `${path}: declares unknown mode "${mode}"`);

  if (path.startsWith("sem.")) {
    const meta = token.$extensions?.[EXT];
    if (!meta?.role) fail(T, `${path}: sem token has no $extensions["${EXT}"].role`);
    if (!meta?.use) fail(T, `${path}: sem token has no $extensions["${EXT}"].use`);
    // sem is meaning: it must alias ref, not restate a literal.
    const refs = aliasTargets(token.$value);
    const literal = typeof token.$value === "string" && !ALIAS.test(token.$value);
    if (!refs.length && !literal) fail(T, `${path}: sem token neither aliases ref.* nor holds a value`);
    for (const r of refs)
      if (!r.startsWith("ref.")) fail(T, `${path}: sem token aliases ${r}; sem may only alias ref.*`);
  }
  if (path.startsWith("ref."))
    for (const r of aliasTargets(token.$value))
      if (!r.startsWith("ref."))
        fail(T, `${path}: ref token aliases ${r}; the raw tier may only compose other ref.* tokens`);
}

/* ---------- (c) components: the trio, and tokens-only CSS ---------- */
const listed = manifest.contents?.components ?? [];
const onDisk = readdirSync(ROOT).filter(
  (d) => statSync(join(ROOT, d)).isDirectory() &&
    !["foundations", "catalog", "patterns", "glyphs", "assets", "scripts", "node_modules"].includes(d),
);
for (const d of onDisk)
  if (!listed.includes(d)) fail("design-system.json", `component "${d}" exists on disk but is not in contents.components`);
for (const c of listed)
  if (!onDisk.includes(c)) fail("design-system.json", `contents.components lists "${c}" but the directory is missing`);

const ALLOW = /ds-lint-allow:\s*(.+)/;
// Values the system tokenises. A literal here is a missing step in a scale.
const RAW_RULES = [
  [/#[0-9a-fA-F]{3,8}\b/g, "colour literal"],
  [/\brgba?\(/g, "raw colour function"],
  [/(?<![\w-])\d*\.?\d+px/g, "hard-coded length"],
  [/(?<![\w-])\d*\.?\d+ms\b/g, "hard-coded duration"],
  [/(?<!-)\bz-index:\s*-?\d+/g, "hard-coded z-index"],
];

for (const c of listed) {
  const dir = join(ROOT, c);
  for (const f of ["component.md", "component.css", "component.html"])
    if (!existsSync(join(dir, f))) fail(`${c}/${f}`, "missing - a component is exactly this trio");

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c))
    fail(c, "component directory is not kebab-case");

  const cssPath = join(dir, "component.css");
  if (existsSync(cssPath)) {
    readFileSync(cssPath, "utf8").split("\n").forEach((line, i) => {
      const where = `${c}/component.css:${i + 1}`;
      const code = line.split("/*")[0];
      if (/var\(\s*--ref-/.test(code))
        fail(where, "consumes --ref-* directly; components may only consume --sem-*");
      if (ALLOW.test(line)) return;
      for (const [re, label] of RAW_RULES) {
        const hit = code.match(re);
        if (hit) fail(where, `${label} ${hit[0]} - use a token, or justify it with /* ds-lint-allow: <reason> */`);
      }
    });
  }

  const mdPath = join(dir, "component.md");
  if (existsSync(mdPath)) {
    const md = readFileSync(mdPath, "utf8");
    for (const h of ["Anatomy", "Variants", "States", "Usage", "Accessibility"])
      if (!new RegExp(`^##\\s+${h}\\s*$`, "m").test(md)) fail(`${c}/component.md`, `missing "## ${h}" section`);
  }

  const htmlPath = join(dir, "component.html");
  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, "utf8");
    if (!/data-mode=["']dark["']/.test(html))
      fail(`${c}/component.html`, 'demo does not show dark mode (no data-mode="dark" container)');
    if (!/data-mode=["']light["']/.test(html))
      fail(`${c}/component.html`, 'demo does not pin light mode (no data-mode="light" container)');
    const states = [...(readFileSync(mdPath, "utf8").match(/^- `([^`]+)`/gm) ?? [])];
    if (!states.length) fail(`${c}/component.md`, "States section lists no `selector` entries");
  }
}

/* ---------- (d) derived files are actually derived ---------- */
for (const [out, generator] of Object.entries(manifest.derived ?? {})) {
  const outPath = join(ROOT, out);
  if (!existsSync(outPath)) { fail(out, `derived file missing; run ${generator}`); continue; }
  const before = readFileSync(outPath, "utf8");
  try {
    execFileSync(process.execPath, [join(ROOT, generator)], { stdio: "pipe" });
  } catch (e) {
    fail(generator, `generator failed: ${e.message.split("\n")[0]}`);
    continue;
  }
  if (readFileSync(outPath, "utf8") !== before)
    fail(out, `stale - regenerate with ${generator} and commit the result`);
}

/* ---------- report ---------- */
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const p of problems) console.error(`  ${p.file}\n    ${p.msg}`);
  console.error("");
  process.exit(1);
}
console.log(`lint: clean - ${tokens.size} tokens, ${listed.length} components`);
