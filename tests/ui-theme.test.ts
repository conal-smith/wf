import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";
import { PALETTE } from "../force5/src/weather";

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

/**
 * The declarations of `.name { … }` in compiled CSS, or null if no such rule.
 * Only a rule at the top level is found: one inside `@layer` is indented, and
 * is not where a utility may be (see the cascade test below).
 */
function rule(css: string, name: string): string | null {
  const selector = `.${name.replace(/[^\w-]/g, "\\$&")} {`;
  const start = css.indexOf(`\n${selector}`);
  if (start === -1) return null;
  const open = start + selector.length + 1;
  return css.slice(open, css.indexOf("\n}", open));
}

/** The value a theme variable is emitted with, or null if it is not emitted. */
function variable(css: string, name: string): string | null {
  const match = css.match(new RegExp(`\\n\\s+${name}: ([^;]+);`));
  return match ? match[1] : null;
}

// The chart (ruling of 2026-10-05, docs/BRAND.md).
const COLOURS: Record<string, string> = {
  ground: "#f3eee3",
  card: "#f3eee3",
  solid: "#f3eee3",
  sunken: "#ede6d6",
  glass: "#f3eee3eb",
  inverse: "#1a1d21",
  scrim: "#1a1d212e",
  // The sea and the shore, as a chart tints them, shallow to deep.
  sea: "#d5e6ea",
  "sea-1": "#a9cbd8",
  "sea-2": "#c3dae2",
  "sea-3": "#dae8ea",
  "sea-4": "#ecf0ea",
  depth: "#5f8c9c",
  land: "#ede3c8",
  relief: "#b59e74",
  // The basemap's two fills, and the bar a forecast cell draws behind its
  // number: a quantity, so the chart's magenta rather than water.
  "basemap-water": "#e5edea",
  "basemap-land": "#ede3c8",
  wash: "#b0186a",
  line: "#1a1d2133",
  "line-strong": "#7c7b78",
  ink: "#1a1d21",
  "ink-2": "#3b3c3e",
  "ink-muted": "#5b5c5b",
  "ink-disabled": "#7c7b78",
  "ink-inverse": "#f3eee3",
  accent: "#1a1d21",
  "accent-hover": "#b0186a",
  "accent-ink": "#f3eee3",
  quiet: "#1a1d21",
  focus: "#b0186a",
  "chart-magenta": "#b0186a",
  pen: "#d43a2c",
  "pen-ink": "#bf3125",
  buoy: "#e9b200",
  ok: "#2a7046",
  warn: "#b02a1f",
  "warn-ground": "#efd8cd",
  now: "#b02a1f",
  // Two marks the palette does not move: the dashed line at the present hour,
  // and the gust cap on a candle. D12.
  "now-marker": "#bf6546",
  gust: "#e0803a",
};

// Size, line height, then weight and tracking where the step has one.
const TYPE: Record<string, [string, string, string?, string?]> = {
  eyebrow: ["10px", "1.3", "500", "0.14em"],
  caption: ["11px", "1.4"],
  label: ["11px", "1.2", "500", "0.09em"],
  body: ["13px", "1.4"],
  prose: ["15px", "1.45"],
  input: ["16px", "1.3"],
  lead: ["19px", "1.2", "600"],
  figure: ["19px", "1", "600", "-0.02em"],
  title: ["30px", "1.05", "700", "-0.02em"],
  headline: ["44px", "1", "700", "-0.035em"],
  reading: ["48px", "1"],
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

  // An unlayered rule beats a layered one whatever its specificity, and the
  // site's reset is unlayered: `button { background: none }`, `a { color:
  // inherit }`, `h1, h2, p { margin: 0 }`. In a layer, `bg-accent` never
  // reached a button. Out of one, a class beats an element.
  it("keeps the utilities out of a cascade layer, level with the site's reset", () => {
    const css = build(["bg-accent", "mt-4"]);
    expect(css).not.toMatch(/@layer[^;{]*\butilities\b/);
    expect(css).toMatch(/^\.bg-accent \{$/m);
    expect(css).toMatch(/^\.mt-4 \{$/m);

    const reset = readFileSync(resolve(ROOT, "src/styles.css"), "utf8");
    expect(reset).not.toMatch(/@layer/);
    expect(reset).toMatch(/^button \{[^}]*background: none;/m);
  });
});

/**
 * Every `:hover` selector in a stylesheet, with whether it sits inside the
 * one media query a hover is allowed under. Comments are dropped first; the
 * walk keeps the stack of open blocks, so a rule inside the query, at any
 * depth, counts as held.
 */
const HOVER_GATE = /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/;
function hovers(css: string): { selector: string; gated: boolean }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const open: string[] = [];
  const found: { selector: string; gated: boolean }[] = [];
  let from = 0;
  for (const match of source.matchAll(/[{}]/g)) {
    const at = match.index;
    if (match[0] === "{") {
      const head = source.slice(from, at).split(/[;}]/).pop()!.trim();
      if (head.includes(":hover") && !head.startsWith("@"))
        found.push({
          selector: head,
          gated: open.some((outer) => HOVER_GATE.test(outer)),
        });
      open.push(head);
    } else open.pop();
    from = at + 1;
  }
  return found;
}

// A tap leaves the browser hovering over what was pressed. `(hover: hover)`
// alone is answered yes by touch laptops, tablets with a trackpad and some
// phones, and there a tapped pill stayed inked; a fine pointer is a mouse.
describe("a hover is for a mouse", () => {
  it("holds the kit's hover, and the variants built from it, to a fine pointer", () => {
    const found = hovers(
      build([
        "hover:bg-sunken",
        "not-disabled:hover:bg-inverse",
        "group-hover:text-chart-magenta",
      ]),
    );
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.filter((h) => !h.gated)).toEqual([]);
  });

  it("holds every hand-written hover on the site to the same query", () => {
    const sheets = [
      "src/styles.css",
      "src/map.css",
      "src/dock.css",
      "src/panels.css",
      "companion/web/gust.css",
    ];
    const ungated = sheets.flatMap((sheet) =>
      hovers(readFileSync(resolve(ROOT, sheet), "utf8"))
        .filter((h) => !h.gated)
        .map((h) => `${sheet}: ${h.selector}`),
    );
    expect(ungated).toEqual([]);
    // And the walk finds them, so the check above is about something.
    expect(
      hovers(readFileSync(resolve(ROOT, "src/map.css"), "utf8")).length,
    ).toBeGreaterThan(5);
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
    "font-sans",
    "font-serif",
    // The wildcards in S4 stop short of these families.
    "font-thin",
    "font-light",
    "font-black",
    "inset-shadow-sm",
    "drop-shadow-md",
    "text-shadow-md",
  ])("%s produces no CSS", (name) => {
    expect(rule(build([name]), name)).toBeNull();
  });

  // Not the stock quarter rem: the root font size is 14px here, so a quarter
  // rem is 3.5px and `p-4` would be 14px.
  it("keeps the spacing scale, with one step pinned at 4px", () => {
    const css = build(["p-4"]);
    expect(rule(css, "p-4")).toContain("padding: calc(var(--spacing) * 4);");
    expect(variable(css, "--spacing")).toBe("4px");

    const reset = readFileSync(resolve(ROOT, "src/styles.css"), "utf8");
    expect(reset).toMatch(/^:root \{[^}]*font-size: 14px;/m);
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

  it("copies the wind ramp verbatim from the PALETTE that paints the map", () => {
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

  // The basemap's deep water is nearly paper, as a chart's is: a step
  // deeper than the last of the sea's four tints, and lighter than the sea
  // the map floats on.
  it("puts the basemap's water past the deepest tint, and above the sea", () => {
    const css = build(["bg-basemap-water", "bg-sea", "bg-sea-4"]);
    const light = (name: string) =>
      parseInt(variable(css, name)!.slice(1, 3), 16);
    expect(light("--color-basemap-water")).toBeGreaterThan(
      light("--color-sea"),
    );
    expect(variable(css, "--color-basemap-water")).not.toBe(
      variable(css, "--color-sea-4"),
    );
  });

  // A quantity's bar takes the wash, never a sea tint: the dock's day slider
  // paints each hour's stars in it, and was once drawn with `--color-sea`
  // while the two happened to be one value.
  it("keeps the dock's star bars off the water", () => {
    const dock = readFileSync(resolve(ROOT, "src/dock.css"), "utf8");
    expect(dock).toMatch(/\.sc-strip i \{[^}]*var\(--color-wash\)/);
    expect(dock).not.toMatch(/\.sc-strip i \{[^}]*var\(--color-sea\)/);
  });

  // index.html cannot read a CSS variable, so the browser chrome's colour is
  // written out there. This is the only thing holding the copy to the original.
  it("is the colour index.html hands the browser chrome", () => {
    const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    const meta = html.match(/<meta name="theme-color" content="([^"]+)"/);
    expect(meta?.[1]).toBe(variable(build(["bg-ground"]), "--color-ground"));
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

  // Square, as print is: a field keeps a whisper of a corner, a pressable
  // thing is a capsule, and a box is square.
  it.each([
    ["control", "2px"],
    ["surface", "0px"],
    ["pill", "9999px"],
    ["dialog", "0px"],
    ["full", "9999px"],
  ])("radius %s is %s", (name, value) => {
    const css = build([`rounded-${name}`]);
    expect(rule(css, `rounded-${name}`)).toContain(
      `border-radius: var(--radius-${name});`,
    );
    expect(variable(css, `--radius-${name}`)).toBe(value);
  });

  // Little shadow, and a warm one: paper lifts off paper.
  it.each([
    ["control", "0px 1px 0px", "#1a1d210f"],
    ["marker", "0px 4px 10px -6px", "#3c2d1466"],
    ["surface", "0px 6px 18px -10px", "#3c2d1459"],
    ["dock", "0px -8px 22px -16px", "#3c2d1473"],
  ])("shadow %s is a little warm paper shadow", (name, geometry, ink) => {
    const declarations = rule(build([`shadow-${name}`]), `shadow-${name}`);
    expect(declarations).toMatch(/--tw-shadow: [^;]+;/);
    expect(declarations).toContain(
      `${geometry} var(--tw-shadow-color, ${ink})`,
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

  it("is four faces, each with its job, in the weights they use", () => {
    const css = build([
      "font-display",
      "font-body",
      "font-mono",
      "font-hand",
      "font-normal",
      "font-medium",
      "font-semibold",
      "font-bold",
      "font-extrabold",
    ]);
    for (const [name, first] of [
      ["display", '"Fraunces Variable"'],
      ["body", '"Newsreader Variable"'],
      ["mono", '"IBM Plex Mono"'],
      ["hand", '"Kalam"'],
    ]) {
      expect(rule(css, `font-${name}`)).toContain(
        `font-family: var(--font-${name});`,
      );
      expect(variable(css, `--font-${name}`)?.startsWith(first), name).toBe(
        true,
      );
    }
    for (const [name, weight] of [
      ["normal", "400"],
      ["medium", "500"],
      ["semibold", "600"],
      ["bold", "700"],
      ["extrabold", "800"],
    ]) {
      expect(rule(css, `font-${name}`)).toContain(
        `font-weight: var(--font-weight-${name});`,
      );
      expect(variable(css, `--font-weight-${name}`)).toBe(weight);
    }
  });
});

/**
 * `[step, hex]` for each wind band, read from `PALETTE` in
 * force5/src/weather.ts: the ramp that actually paints the map, the forecast
 * cells and the wind fills, which the theme's `--color-wind-*` must copy.
 */
function windRamp(): [string, string][] {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return PALETTE.map(([knots, [r, g, b]]) => [
    `k${String(knots).padStart(2, "0")}`,
    `#${hex(r)}${hex(g)}${hex(b)}`,
  ]);
}
