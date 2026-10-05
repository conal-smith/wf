#!/usr/bin/env node
// No raw primitives: product code draws its controls from the kit (ui/), not
// from the bare elements the kit wraps. A raw <button>, <input>, <select> or
// <textarea> outside ui/ is a control the design system cannot see: it misses
// the ring, the tap target, the disabled ink and the next restyle.
//
// The ones already there are counted, per area and per element, in
// scripts/raw-primitives.baseline.json, and the count only drains:
//
//   - over the number fails: a new raw element, use the kit's component;
//   - under the number fails too, naming the smaller number to write, or a
//     lowered count becomes parking space for the next regression;
//   - an area missing from the file fails on its first raw element: a new
//     surface is the strictest place in the tree.
//
// What counts: a JSX opening tag `<button`, `<input`, `<select`, `<textarea` in
// a .tsx or .jsx file under an area below, outside comments. Tests
// (*.test.*, *.spec.*) are not product code and are not read. ui/ is the kit,
// and is where these elements belong.
//
// There is no allow marker. A raw element with a reason to stay raw (a native
// file picker, say) stays counted in the baseline, where a review sees it.
//
// Regenerating the baseline. Sections being rebuilt move their counts; when
// their branches are integrated, regenerate the file from the merged tree and
// review the diff (every number in it should have gone down, or say why not):
//
//   node scripts/lint-raw-primitives.mjs --write-baseline
//
//   node scripts/lint-raw-primitives.mjs                lint the repo
//   node scripts/lint-raw-primitives.mjs --root <dir>   lint another tree laid out the same
//   node scripts/lint-raw-primitives.mjs --report       print the counts, never fail
//   node scripts/lint-raw-primitives.mjs --probe        prove the lint fails when it should
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
const BASELINE = "scripts/raw-primitives.baseline.json";

/** The product's areas: each one's count is held on its own. */
const AREAS = [
  "src",
  "force5/src",
  "market/web",
  "community/web",
  "spot/web",
  "companion/web",
  "ai/web",
];
const ELEMENTS = ["button", "input", "select", "textarea"];
const KIT = {
  button: "Button (or Segmented, Checkbox)",
  input: "TextInput, SearchField or Checkbox",
  select: "Select",
  textarea: "TextArea",
};
const EXTENSIONS = new Set([".tsx", ".jsx"]);
const TEST = /\.(test|spec)\.[jt]sx?$/;
const TAG = /<(button|input|select|textarea)(?=[\s/>])/g;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist")
        yield* walk(path);
    } else if (EXTENSIONS.has(extname(entry.name)) && !TEST.test(entry.name))
      yield path;
  }
}

/** The source with its comments blanked, line breaks kept so lines still count. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (m, lead) => lead + " ".repeat(m.length - lead.length),
    );
}

/** Every raw element under `root`, as { area, element, file, line }. */
function scan(root) {
  const hits = [];
  for (const area of AREAS) {
    const dir = join(root, area);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const path of walk(dir)) {
      const file = relative(root, path).split(sep).join("/");
      const text = withoutComments(readFileSync(path, "utf8"));
      for (const match of text.matchAll(TAG)) {
        const line = text.slice(0, match.index).split("\n").length;
        hits.push({ area, element: match[1], file, line });
      }
    }
  }
  return hits;
}

function counts(hits) {
  const out = {};
  for (const area of AREAS) {
    const per = Object.fromEntries(ELEMENTS.map((e) => [e, 0]));
    for (const h of hits) if (h.area === area) per[h.element] += 1;
    out[area] = per;
  }
  return out;
}

function readBaseline(root) {
  const path = join(root, BASELINE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")).areas ?? {};
}

function writeBaseline(root, now) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = {
    $comment:
      "Raw <button>/<input>/<select>/<textarea> in product code outside ui/, per area, that predate the no-raw-primitive rule (scripts/lint-raw-primitives.mjs). The numbers only go down. Regenerate with `node scripts/lint-raw-primitives.mjs --write-baseline` when sections are integrated, and review the diff.",
    writtenAt: today,
    areas: now,
  };
  writeFileSync(join(root, BASELINE), JSON.stringify(doc, null, 2) + "\n");
}

function lint(root) {
  const hits = scan(root);
  const now = counts(hits);
  const baseline = readBaseline(root);
  const problems = [];
  if (baseline === null) {
    problems.push(
      `${BASELINE} is missing, so there are no numbers to hold - write it from a tree you have read with --write-baseline`,
    );
    return { problems, now, hits };
  }
  for (const area of AREAS) {
    for (const element of ELEMENTS) {
      const have = now[area][element];
      const held = baseline[area]?.[element];
      const sites = hits.filter(
        (h) => h.area === area && h.element === element,
      );
      if (held === undefined) {
        if (have > 0)
          problems.push(
            `${area}: ${have} raw <${element}> and no baseline for this area - a new surface takes ${KIT[element]} from ui/\n` +
              sites.map((h) => `      ${h.file}:${h.line}`).join("\n"),
          );
        continue;
      }
      if (have > held)
        problems.push(
          `${area}: ${have} raw <${element}>, over the baseline of ${held} - use ${KIT[element]} from ui/; the baseline never goes up\n` +
            sites.map((h) => `      ${h.file}:${h.line}`).join("\n"),
        );
      else if (have < held)
        problems.push(
          `${area}: ${have} raw <${element}>, under the baseline of ${held} - write ${have} for ${area}.${element} in ${BASELINE}; a baseline left high is parking space for the next regression`,
        );
    }
  }
  return { problems, now, hits };
}

/* ---------- the probe ---------- */
// Each case is a scratch tree holding a baseline and one or two files, linted
// by this same script in a child process; the exit code has to be the one named.
const BASE = (areas) => JSON.stringify({ areas });
const ZERO = { button: 0, input: 0, select: 0, textarea: 0 };
const PROBES = [
  [
    "a tree that matches its baseline",
    {
      [BASELINE]: BASE({ "market/web": { ...ZERO, button: 1 } }),
      "market/web/A.tsx":
        'export const a = <button type="button">Go</button>;\n',
    },
    0,
  ],
  [
    "a new raw button over the baseline",
    {
      [BASELINE]: BASE({ "market/web": { ...ZERO, button: 1 } }),
      "market/web/A.tsx":
        "export const a = <><button>Go</button><button>Stop</button></>;\n",
    },
    1,
  ],
  [
    "a raw element drained without lowering the baseline",
    {
      [BASELINE]: BASE({ "community/web": { ...ZERO, input: 2 } }),
      "community/web/A.tsx": "export const a = <input />;\n",
    },
    1,
  ],
  [
    "a raw element in an area with no baseline",
    {
      [BASELINE]: BASE({}),
      "spot/web/A.tsx": "export const a = <select><option /></select>;\n",
    },
    1,
  ],
  [
    "a raw textarea split over lines",
    {
      [BASELINE]: BASE({ "ai/web": ZERO }),
      "ai/web/A.tsx":
        "export const a = (\n  <textarea\n    rows={3}\n  />\n);\n",
    },
    1,
  ],
  [
    "raw elements in the kit",
    { [BASELINE]: BASE({}), "ui/Button.tsx": "export const b = <button />;\n" },
    0,
  ],
  [
    "raw elements in a test",
    { [BASELINE]: BASE({}), "src/A.test.tsx": "render(<button />);\n" },
    0,
  ],
  [
    "raw elements named in comments",
    {
      [BASELINE]: BASE({}),
      "src/A.tsx":
        "// a raw <button> here would fail\n/* so would <input /> */\nexport const a = 1;\n",
    },
    0,
  ],
  ["no baseline file at all", { "src/A.tsx": "export const a = 1;\n" }, 1],
];

function probe() {
  let failed = 0;
  for (const [name, files, expected] of PROBES) {
    const root = mkdtempSync(join(tmpdir(), "raw-primitives-probe-"));
    try {
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  if (failed) {
    console.error(
      `\nraw-primitive probe: ${failed} of ${PROBES.length} cases wrong - the lint cannot be trusted\n`,
    );
    process.exit(1);
  }
  console.log(
    `raw-primitive probe: ${PROBES.length} cases, the lint fails when it should`,
  );
}

/* ---------- run ---------- */
const args = process.argv.slice(2);
const at = args.indexOf("--root");
if (at !== -1 && !args[at + 1]) {
  console.error("raw-primitive lint: --root needs a directory");
  process.exit(2);
}
const root = at === -1 ? REPO : args[at + 1];
const total = (now) =>
  Object.values(now).reduce(
    (sum, per) => sum + Object.values(per).reduce((a, b) => a + b, 0),
    0,
  );

if (args.includes("--probe")) probe();
else if (args.includes("--write-baseline")) {
  const now = counts(scan(root));
  writeBaseline(root, now);
  console.log(
    `raw-primitive baseline: wrote ${BASELINE} (${total(now)} raw elements across ${AREAS.length} areas)`,
  );
} else {
  const { problems, now } = lint(root);
  if (args.includes("--report")) {
    for (const [area, per] of Object.entries(now))
      console.log(
        `  ${area}: ${ELEMENTS.map((e) => `${e} ${per[e]}`).join(", ")}`,
      );
  }
  if (problems.length && !args.includes("--report")) {
    console.error(
      `\n${problems.length} raw-primitive problem${problems.length === 1 ? "" : "s"}:\n`,
    );
    for (const p of problems) console.error(`  ${p}`);
    console.error("");
    process.exit(1);
  }
  console.log(
    `raw-primitive lint: clean - ${total(now)} raw elements, none over or under ${BASELINE}`,
  );
}
