import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `ui/theme.css` is the only place a design value is written down, so what it
 * promises is checked against the compiler rather than by reading the file:
 * the theme is compiled exactly as the build compiles it, handed class names,
 * and the CSS that comes back is what is asserted on.
 *
 * Two halves. A class that names a theme value must produce that value. A
 * class that names one of the stock values must produce nothing at all, which
 * is what "defaults removed" means in practice: `bg-red-500` is not an error
 * anywhere, it is just silence, and only a test notices silence going away.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const THEME = resolve(ROOT, "ui/theme.css");
const require = createRequire(import.meta.url);

let build: (candidates: string[]) => string;

beforeAll(async () => {
  const compiled = await compile(readFileSync(THEME, "utf8"), {
    base: dirname(THEME),
    loadStylesheet: async (id, base) => {
      const path = id.startsWith(".") ? resolve(base, id) : require.resolve(id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  // The compiler accumulates candidates across calls; each assertion below
  // looks for its own rule, so that is harmless.
  build = (candidates) => compiled.build(candidates);
});

/** The declarations of `.name { … }` in compiled CSS, or null if no such rule. */
function rule(css: string, name: string): string | null {
  const selector = `.${name.replace(/[^\w-]/g, "\\$&")} {`;
  const start = css.indexOf(`\n  ${selector}`);
  if (start === -1) return null;
  const open = start + selector.length + 3;
  return css.slice(open, css.indexOf("\n  }", open));
}

/** The value a theme variable is emitted with, or null if it is not emitted. */
function variable(css: string, name: string): string | null {
  const match = css.match(new RegExp(`\\n\\s+${name}: ([^;]+);`));
  return match ? match[1] : null;
}

// S5, as the item lists it.
const COLOURS: Record<string, string> = {
  ground: "#f4f6fa",
  sea: "#9db0cc",
  card: "#fff",
  solid: "#eef2f9",
  glass: "#eef2f9db",
  sunken: "#e1e8f3",
  inverse: "#0b2545",
  scrim: "#0a1f3c73",
  line: "#0a1f3c1a",
  "line-strong": "#7488a6",
  ink: "#0a1f3c",
  "ink-2": "#1f3a5c",
  "ink-muted": "#4a607c",
  "ink-disabled": "#7488a6",
  "ink-inverse": "#fff",
  accent: "#1463ff",
  "accent-hover": "#0d4fd1",
  "accent-ink": "#fff",
  quiet: "#0b2545",
  focus: "#0b2545",
  ok: "#3c8a72",
  warn: "#854d31",
  "warn-ground": "#fff4e8",
  now: "#a8442e",
};

// S7: size, line height, then weight and tracking where the step has one.
const TYPE: Record<string, [string, string, string?, string?]> = {
  eyebrow: ["9px", "1.5", "600", "1.1px"],
  caption: ["10px", "1.5"],
  label: ["11px", "1.3", "600"],
  body: ["12px", "1.5"],
  prose: ["14px", "1.5"],
  lead: ["17px", "1.3", "600"],
  title: ["25px", "1.3", "600", "-0.7px"],
  reading: ["48px", "1.3"],
};

describe("ui/theme.css: how it is wired", () => {
  it("is imported once, from src/main.tsx, after src/styles.css", () => {
    const main = readFileSync(resolve(ROOT, "src/main.tsx"), "utf8");
    const imports = main.match(/import "\.\.\/ui\/theme\.css";/g) ?? [];
    expect(imports).toHaveLength(1);
    expect(main.indexOf('"../ui/theme.css"')).toBeGreaterThan(
      main.indexOf('"./styles.css"'),
    );
  });

  it("is compiled by the Vite plugin, with no JavaScript config beside it", () => {
    const config = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    expect(config).toMatch(/from "@tailwindcss\/vite"/);
    expect(config).toMatch(/plugins: \[[^\]]*tailwindcss\(\)/);
    for (const name of [
      "tailwind.config.js",
      "tailwind.config.ts",
      "tailwind.config.mjs",
    ])
      expect(existsSync(resolve(ROOT, name)), name).toBe(false);
  });

  it("imports the theme and utilities layers only: no reset", () => {
    const source = readFileSync(THEME, "utf8");
    const imported = [...source.matchAll(/@import\s+"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(imported).toEqual([
      "tailwindcss/theme.css",
      "tailwindcss/utilities.css",
    ]);

    const css = build(["bg-card"]);
    expect(css).not.toMatch(/@layer base/);
    expect(css).not.toMatch(/box-sizing/);
  });
});

describe("ui/theme.css: the stock values are gone", () => {
  it.each([
    "bg-red-500",
    "text-white",
    "border-black",
    "text-lg",
    "text-xs",
    "rounded-lg",
    "rounded-md",
    "shadow-md",
    "shadow-xl",
    "font-mono",
    "font-serif",
  ])("%s produces no CSS", (name) => {
    expect(rule(build([name]), name)).toBeNull();
  });

  it("keeps the spacing base: one step is a quarter rem, 4px", () => {
    const css = build(["p-4"]);
    expect(rule(css, "p-4")).toContain("padding: calc(var(--spacing) * 4);");
    expect(variable(css, "--spacing")).toBe("0.25rem");
  });
});

describe("ui/theme.css: the values", () => {
  it.each(Object.entries(COLOURS))("colour %s is %s", (name, hex) => {
    const css = build([`bg-${name}`, `text-${name}`]);
    expect(rule(css, `bg-${name}`)).toContain(
      `background-color: var(--color-${name});`,
    );
    expect(rule(css, `text-${name}`)).toContain(`color: var(--color-${name});`);
    expect(variable(css, `--color-${name}`)).toBe(hex);
  });

  // `solid` is a surface, and as a border it is already a word with a meaning:
  // the style wins over the colour. Pinned so nobody reaches for it as a line.
  it("border-solid stays the border style, not the solid surface colour", () => {
    const css = build(["border-solid", "border-line"]);
    expect(rule(css, "border-solid")).toContain("border-style: solid;");
    expect(rule(css, "border-solid")).not.toContain("border-color");
    expect(rule(css, "border-line")).toContain(
      "border-color: var(--color-line);",
    );
  });

  it("holds exactly those colours and the wind ramp, no others", () => {
    const source = readFileSync(THEME, "utf8");
    const declared = [...source.matchAll(/^\s*--color-([a-z0-9-]+):/gm)].map(
      (m) => m[1],
    );
    const expected = [
      ...Object.keys(COLOURS),
      ...windRamp().map(([step]) => `wind-${step}`),
    ];
    expect(declared.sort()).toEqual(expected.sort());
  });

  it("copies the wind ramp verbatim from the design tokens", () => {
    const ramp = windRamp();
    expect(ramp.map(([step]) => step)).toEqual([
      "k00",
      "k05",
      "k09",
      "k10",
      "k15",
      "k20",
      "k25",
      "k30",
      "k35",
      "k40",
      "k45",
      "k50",
      "k60",
      "k65",
    ]);
    const css = build(ramp.map(([step]) => `bg-wind-${step}`));
    for (const [step, hex] of ramp)
      expect(variable(css, `--color-wind-${step}`), step).toBe(hex);
  });

  it.each(Object.entries(TYPE))(
    "type step %s",
    (name, [size, leading, weight, tracking]) => {
      const css = build([`text-${name}`]);
      const declarations = rule(css, `text-${name}`);
      expect(declarations).toContain(`font-size: var(--text-${name});`);
      expect(variable(css, `--text-${name}`)).toBe(size);
      expect(variable(css, `--text-${name}--line-height`)).toBe(leading);
      expect(variable(css, `--text-${name}--font-weight`)).toBe(weight ?? null);
      expect(variable(css, `--text-${name}--letter-spacing`)).toBe(
        tracking ?? null,
      );
      // A step with no weight or tracking of its own must not set one.
      expect(declarations?.includes("font-weight:")).toBe(weight !== undefined);
      expect(declarations?.includes("letter-spacing:")).toBe(
        tracking !== undefined,
      );
    },
  );

  it.each([
    ["control", "12px"],
    ["surface", "20px"],
    ["pill", "24px"],
    ["dialog", "30px"],
    ["full", "9999px"],
  ])("radius %s is %s", (name, value) => {
    const css = build([`rounded-${name}`]);
    expect(rule(css, `rounded-${name}`)).toContain(
      `border-radius: var(--radius-${name});`,
    );
    expect(variable(css, `--radius-${name}`)).toBe(value);
  });

  it.each([
    ["control", "0px 1px 5px", "#0a1f3c1f"],
    ["marker", "0px 3px 12px", "#0a1f3c2e"],
    ["surface", "0px 10px 40px", "#0a1f3c33"],
    ["dock", "0px -4px 24px", "#0a1f3c33"],
  ])("shadow %s is drawn in the Atlantic ink", (name, geometry, ink) => {
    const declarations = rule(build([`shadow-${name}`]), `shadow-${name}`);
    expect(declarations).toContain(
      `--tw-shadow: ${geometry} var(--tw-shadow-color, ${ink});`,
    );
  });

  it.each([
    ["fast", "150ms"],
    ["base", "250ms"],
  ])("duration %s is %s", (name, value) => {
    const css = build([`duration-${name}`]);
    expect(rule(css, `duration-${name}`)).toContain(
      `transition-duration: var(--transition-duration-${name});`,
    );
    expect(variable(css, `--transition-duration-${name}`)).toBe(value);
  });

  it.each([
    ["popover", "6"],
    ["panel", "15"],
    ["header", "20"],
    ["dialog", "30"],
  ])("layer %s is z-index %s", (name, value) => {
    const css = build([`z-${name}`]);
    expect(rule(css, `z-${name}`)).toContain(
      `z-index: var(--z-index-${name});`,
    );
    expect(variable(css, `--z-index-${name}`)).toBe(value);
  });

  it.each([
    ["control-sm", "30px"],
    ["control-md", "40px"],
    ["control-lg", "46px"],
    ["touch", "44px"],
  ])("control height %s is %s, as named spacing", (name, value) => {
    const css = build([`h-${name}`, `min-h-${name}`]);
    expect(rule(css, `h-${name}`)).toContain(`height: var(--spacing-${name});`);
    expect(rule(css, `min-h-${name}`)).toContain(
      `min-height: var(--spacing-${name});`,
    );
    expect(variable(css, `--spacing-${name}`)).toBe(value);
  });

  it("font-sans is the site's one family, in the four weights it uses", () => {
    const css = build([
      "font-sans",
      "font-normal",
      "font-medium",
      "font-semibold",
      "font-bold",
    ]);
    expect(rule(css, "font-sans")).toContain("font-family: var(--font-sans);");
    expect(variable(css, "--font-sans")).toBe(
      '"DM Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    );
    for (const [name, weight] of [
      ["normal", "400"],
      ["medium", "500"],
      ["semibold", "600"],
      ["bold", "700"],
    ]) {
      expect(rule(css, `font-${name}`)).toContain(
        `font-weight: var(--font-weight-${name});`,
      );
      expect(variable(css, `--font-weight-${name}`)).toBe(weight);
    }
  });
});

/** `[step, hex]` for each `--sem-color-wind-*` in the generated design tokens. */
function windRamp(): [string, string][] {
  const tokens = readFileSync(
    resolve(ROOT, "design/foundations/tokens.css"),
    "utf8",
  );
  const root = tokens.slice(0, tokens.indexOf("}"));
  return [...root.matchAll(/--sem-color-wind-(k\d+): (#[0-9a-f]+);/g)].map(
    (m) => [m[1], m[2]],
  );
}
