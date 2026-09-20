import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `scripts/lint-ui.mjs` is run here the way `npm run ui:lint` runs it: as a
 * process, against a tree, judged by its exit code and what it prints. Each
 * case is a scratch tree laid out like the repo, so nothing in the working
 * tree is ever written to.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/lint-ui.mjs");

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0))
    rmSync(tree, { recursive: true, force: true });
});

function lint(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ui-lint-test-"));
  trees.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const run = spawnSync(process.execPath, [SCRIPT, "--root", root], {
    encoding: "utf8",
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

describe("ui lint: arbitrary values", () => {
  it.each([
    ["a length", "p-[13px]"],
    ["a colour", "bg-[#123456]"],
    ["behind a variant", "hover:w-[3px]"],
    ["a bare custom property", "w-(--gutter)"],
    ["a modifier", "bg-accent/[0.35]"],
    ["a variant", "[&>p]:mt-0"],
    ["a named variant", "data-[state=open]:bg-card"],
    ["a property", "[mask-type:alpha]"],
  ])("fails on %s: %s", (_, name) => {
    const { status, output } = lint({
      "ui/Button.tsx": `export const b = <i className="flex ${name}" />;\n`,
    });
    expect(status).toBe(1);
    expect(output).toContain("ui/Button.tsx:1");
    expect(output).toContain("arbitrary");
  });

  it("fails in each of the three directories, and in a stylesheet", () => {
    const { status, output } = lint({
      "ui/a.tsx": 'export const a = "p-[13px]";\n',
      "market/web/pages/b.tsx": 'export const b = "p-[13px]";\n',
      "community/web/c.css": ".c { @apply p-[13px]; }\n",
    });
    expect(status).toBe(1);
    expect(output).toContain("3 problems");
  });

  it("passes theme classes, and the brackets ordinary code is full of", () => {
    const { status, output } = lint({
      "ui/Button.tsx": [
        'export const b = <i className="bg-accent text-accent-ink rounded-full h-control-md md:p-4" />;',
        "const first = list[0], rest = { [key]: value, [`${a}-${b}`]: 1 };",
        "type Index = { [name: string]: number };",
        'const node = document.querySelector("a[href], [data-open]");',
        "const word = /[a-z0-9-]+/.exec(text);",
        "",
      ].join("\n"),
      "ui/kit.css": '.kit a[href^="http"] { color: var(--color-accent); }\n',
    });
    expect(output).toContain("clean");
    expect(status).toBe(0);
  });
});

describe("ui lint: colour literals", () => {
  it.each([
    ["short hex", "#fff"],
    ["hex", "#1463ff"],
    ["hex with alpha", "#0a1f3c1a"],
    ["rgb()", "rgb(20 99 255)"],
    ["rgba()", "rgba(10, 31, 60, 0.1)"],
    ["hsl()", "hsl(220 100% 54%)"],
    ["oklch()", "oklch(0.55 0.24 263)"],
  ])("fails on %s", (_, literal) => {
    const { status, output } = lint({
      "community/web/thread.css": `.thread { color: ${literal}; }\n`,
    });
    expect(status).toBe(1);
    expect(output).toContain("community/web/thread.css:1");
    expect(output).toContain("colour literal");
  });

  it("fails on a literal in a style prop", () => {
    const { status } = lint({
      "market/web/Card.tsx":
        'export const c = <i style={{ color: "#1463ff" }} />;\n',
    });
    expect(status).toBe(1);
  });

  it("lets the theme, and only the theme, hold literals", () => {
    expect(
      lint({ "ui/theme.css": "@theme { --color-accent: #1463ff; }\n" }).status,
    ).toBe(0);
    expect(
      lint({ "ui/other.css": ":root { --accent: #1463ff; }\n" }).status,
    ).toBe(1);
  });

  it("passes what only looks like one", () => {
    const { status } = lint({
      "ui/Link.tsx": [
        'export const l = <a href="#replies">&#160;&#8230;</a>;',
        "const mixed = `color-mix(in srgb, var(--color-ink) 50%, transparent)`;",
        "",
      ].join("\n"),
    });
    expect(status).toBe(0);
  });
});

describe("ui lint: the escape hatch", () => {
  it("honours a reason on the line", () => {
    const { status } = lint({
      "ui/Map.tsx":
        'export const paint = "#b8d0d7"; // ui-lint-allow: map paint is not CSS\n',
    });
    expect(status).toBe(0);
  });

  it("honours a reason on the line above, in any comment form", () => {
    const { status } = lint({
      "ui/Map.tsx":
        '{/* ui-lint-allow: measured against the basemap */}\n<i className="w-[3px]" />\n',
      "ui/map.css":
        "/* ui-lint-allow: third-party widget colour */\n.widget { color: #123456; }\n",
    });
    expect(status).toBe(0);
  });

  it("does not reach past the next line", () => {
    const { status } = lint({
      "ui/Map.tsx":
        '// ui-lint-allow: only the next line\nconst a = 1;\nexport const b = "p-[13px]";\n',
    });
    expect(status).toBe(1);
  });

  it.each([
    "// ui-lint-allow:",
    "/* ui-lint-allow: */",
    "{/* ui-lint-allow:   */}",
  ])("refuses an allow with no reason: %s", (comment) => {
    const { status, output } = lint({
      "ui/Map.tsx": `${comment}\nexport const b = "p-[13px]";\n`,
    });
    expect(status).toBe(1);
    expect(output).toContain("no reason");
  });
});

describe("ui lint: the repo, and the probe", () => {
  it("is clean today", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(run.stdout + run.stderr).toContain("clean");
    expect(run.status).toBe(0);
  });

  it("the probe passes while the lint works", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--probe"], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
  });

  // The probe exists for the day the lint goes quiet, so that day is staged:
  // a copy of the script whose line check returns before it looks at anything.
  it("the probe fails once the lint stays quiet", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const quiet = source.replace("if (allowed) return;", "return;");
    expect(quiet).not.toBe(source);

    const dir = mkdtempSync(join(tmpdir(), "ui-lint-test-"));
    trees.push(dir);
    const copy = join(dir, "lint-ui.mjs");
    writeFileSync(copy, quiet);
    const run = spawnSync(process.execPath, [copy, "--probe"], {
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("an arbitrary value - expected exit 1, got 0");
  });

  it("ignores directories outside the three, and a tree with none of them", () => {
    expect(
      lint({ "src/styles.css": ".map { color: #82aab4; }\n" }).status,
    ).toBe(0);
  });
});
