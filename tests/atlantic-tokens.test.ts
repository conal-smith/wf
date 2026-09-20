import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Atlantic palette, held to the ruling of 2026-09-20.
 *
 * The marketplace and the site menu read nothing but `--sem-*`, so the token
 * values are the whole of their colour. That makes the palette cheap to change
 * and just as cheap to break: a step re-valued by eye, or an alias pointed one
 * step over, fails nothing and ships. So the source of truth is checked for the
 * values the ruling names, the generated CSS is checked for what a page will
 * actually resolve, and the three contrast pairs the ruling quotes are measured
 * rather than trusted.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDATIONS = resolve(ROOT, "design/foundations");

type Node = { [key: string]: Node | string | undefined };
type Modes = { light?: string; dark?: string };

const tokens = JSON.parse(
  readFileSync(resolve(FOUNDATIONS, "tokens.tokens.json"), "utf8"),
) as Node;
const css = readFileSync(resolve(FOUNDATIONS, "tokens.css"), "utf8");

function at(path: string): Node {
  let node: Node | string | undefined = tokens;
  for (const key of path.split(".")) {
    if (typeof node !== "object") throw new Error(`no token at ${path}`);
    node = node[key];
  }
  if (typeof node !== "object") throw new Error(`no token at ${path}`);
  return node;
}

const value = (path: string) => at(path).$value as string;
/** The extension key holds a dot of its own, so it is not walked by `at`. */
function modes(path: string): Modes {
  const meta = at(`${path}.$extensions`)["com.multicode"];
  if (typeof meta !== "object") throw new Error(`${path} carries no modes`);
  return meta.modes as unknown as Modes;
}

/** Every `$value` under a family, keyed by step, in source order. */
function steps(family: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(at(family)))
    if (typeof child === "object" && typeof child.$value === "string")
      out[key] = child.$value;
  return out;
}

/** The light-mode value a page resolves: the first declaration in the file. */
function resolved(property: string): string {
  const match = css.match(new RegExp(`${property}:\\s*([^;]+);`));
  if (!match) throw new Error(`${property} is not in tokens.css`);
  return match[1].trim();
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the neutral ramp", () => {
  it("holds the navy values, step for step, under the names it always had", () => {
    expect(steps("ref.color.teal")).toEqual({
      "50": "#f4f6fa",
      "100": "#eef2f9",
      "200": "#e1e8f3",
      "300": "#c3cfe2",
      "400": "#9db0cc",
      "500": "#7488a6",
      "600": "#4a607c",
      "700": "#1f3a5c",
      "750": "#0b2545",
      "800": "#0a1f3c",
      "900": "#081830",
      "950": "#050f20",
    });
  });

  it("keeps every alias on the step it pointed at", () => {
    expect(value("sem.color.bg.page")).toBe("{ref.color.teal.400}");
    expect(value("sem.color.bg.content")).toBe("{ref.color.teal.50}");
    expect(value("sem.color.surface.solid")).toBe("{ref.color.teal.100}");
    expect(value("sem.color.surface.sunken")).toBe("{ref.color.teal.200}");
    expect(value("sem.color.border.strong")).toBe("{ref.color.teal.500}");
    expect(value("sem.color.text.primary")).toBe("{ref.color.teal.800}");
    expect(value("sem.color.text.secondary")).toBe("{ref.color.teal.700}");
    expect(value("sem.color.text.muted")).toBe("{ref.color.teal.600}");
  });

  it("carries the glass at the panel ground's new value and its old alpha", () => {
    expect(value("sem.color.surface.glass")).toBe(
      `${value("ref.color.teal.100")}db`,
    );
  });
});

describe("the accent", () => {
  it("is one new family of two steps", () => {
    expect(steps("ref.color.blue")).toEqual({
      "500": "#1463ff",
      "600": "#0d4fd1",
    });
  });

  it("fills the action, and nothing else reads it", () => {
    expect(value("sem.color.action.bg")).toBe("{ref.color.blue.500}");
    expect(value("sem.color.action.bgHover")).toBe("{ref.color.blue.600}");
    const source = JSON.stringify(at("sem"));
    expect(source.match(/ref\.color\.blue\.\d+/g)).toHaveLength(4);
  });

  it("leaves the quiet action, the focus ring and the inverse surface navy", () => {
    expect(resolved("--sem-color-action-bg")).toBe("#1463ff");
    expect(resolved("--sem-color-action-bg-hover")).toBe("#0d4fd1");
    expect(resolved("--sem-color-action-quiet")).toBe("#0b2545");
    expect(resolved("--sem-color-action-focus")).toBe("#0b2545");
    expect(resolved("--sem-color-surface-inverse")).toBe("#0b2545");
  });
});

describe("the ink alphas", () => {
  it("are tinted with the navy ink, at the alphas they always had", () => {
    expect(steps("ref.color.ink")).toEqual({
      a08: "#0a1f3c14",
      a12: "#0a1f3c1f",
      a20: "#0a1f3c33",
      a30: "#0a1f3c4d",
      a45: "#0a1f3c73",
    });
  });

  it("reach the hairline, the scrim and every shadow", () => {
    expect(resolved("--sem-color-border-hairline")).toBe("#0a1f3c14");
    expect(resolved("--sem-color-surface-scrim")).toBe("#0a1f3c73");
    for (const shadow of ["control", "marker", "surface", "dock"])
      expect(resolved(`--sem-effect-shadow-${shadow}`)).toMatch(/#0a1f3c/);
  });
});

describe("what Atlantic does not touch", () => {
  it("leaves warm and green alone", () => {
    expect(steps("ref.color.warm")).toEqual({
      "100": "#fff4e8",
      "500": "#bb6c23",
      "700": "#a8442e",
      "800": "#854d31",
    });
    expect(steps("ref.color.green")).toEqual({ "600": "#3c8a72" });
  });

  it("leaves the fourteen wind stops alone", () => {
    expect(Object.values(steps("ref.color.wind"))).toEqual([
      "#355897",
      "#2a76b8",
      "#2e97be",
      "#209e78",
      "#32a74f",
      "#5bb437",
      "#92c134",
      "#bfcc3a",
      "#e8be30",
      "#ea862d",
      "#dd4e38",
      "#be334f",
      "#923d98",
      "#724297",
    ]);
  });

  it("leaves the dark halves on the aliases they had", () => {
    expect(modes("sem.color.action.bg").dark).toBe("{ref.color.teal.400}");
    expect(modes("sem.color.action.bgHover").dark).toBe("{ref.color.teal.300}");
    expect(modes("sem.color.action.quiet").dark).toBe("{ref.color.teal.200}");
    expect(modes("sem.color.action.focus").dark).toBe("{ref.color.teal.200}");
    expect(modes("sem.color.surface.inverse").dark).toBe("{ref.color.teal.300}");
    expect(modes("sem.color.surface.glass").dark).toBe("#103138db");
  });

  it("leaves no teal in anything a page resolves in light", () => {
    const light = css.slice(0, css.indexOf("@media (prefers-color-scheme"));
    for (const old of [
      "#f1fafc",
      "#e6f4f8",
      "#d1e6ec",
      "#afcdd5",
      "#82aab4",
      "#568996",
      "#346a76",
      "#20525d",
      "#163f49",
      "#103138",
      "#0a2126",
    ])
      expect(light).not.toContain(old);
  });
});

describe("contrast, as the ruling records it", () => {
  const muted = resolved("--sem-color-text-muted");

  it("is a dated ruling, quoting the figures measured here", () => {
    const principles = readFileSync(resolve(FOUNDATIONS, "principles.md"), "utf8");
    const ruling = principles.slice(principles.indexOf("**2026-09-20"));
    expect(ruling).toMatch(/^\*\*2026-09-20 — Atlantic: one neutral family and one accent\.\*\*/);
    const quoted = (pair: number) => `${pair.toFixed(2)}:1`;
    expect(ruling).toContain(quoted(contrast(muted, resolved("--sem-color-bg-content"))));
    expect(ruling).toContain(quoted(contrast(muted, resolved("--sem-color-surface-card"))));
    expect(ruling).toContain(
      quoted(contrast(resolved("--sem-color-action-fg"), resolved("--sem-color-action-bg"))),
    );
  });

  it("keeps muted text above 4.5:1 on the content ground and on a card", () => {
    expect(contrast(muted, resolved("--sem-color-bg-content"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, resolved("--sem-color-surface-card"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the label on the filled action above 4.5:1, at rest and hovered", () => {
    const fg = resolved("--sem-color-action-fg");
    expect(contrast(fg, resolved("--sem-color-action-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg, resolved("--sem-color-action-bg-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the step that is barred from text under the bar it is barred by", () => {
    const solid = resolved("--sem-color-surface-solid");
    expect(contrast(value("ref.color.teal.500"), solid)).toBeLessThan(4.5);
    expect(contrast(value("ref.color.teal.500"), solid)).toBeGreaterThanOrEqual(3);
  });
});
