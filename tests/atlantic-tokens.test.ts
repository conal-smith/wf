import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileTheme } from "../ui/theme.testkit";

/**
 * The Atlantic palette, held to the ruling of 2026-09-20.
 *
 * Every page on the site reads its colour from ui/theme.css, so the theme's
 * values are the whole of it. That makes the palette cheap to change and just
 * as cheap to break: a value re-typed by eye fails nothing and ships. So the
 * theme is compiled as the build compiles it, the values a page will resolve
 * are checked against the ones the ruling names, and the contrast pairs the
 * ruling quotes (docs/DESIGN_PRINCIPLES.md) are measured rather than trusted.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let css = "";
beforeAll(async () => {
  // `@theme static`: every value is written into :root, asked for or not.
  css = (await compileTheme())([]);
});

/** The value a theme variable resolves to in the compiled CSS. */
function resolved(name: string): string {
  const match = css.match(new RegExp(`\\n\\s+--color-${name}: ([^;]+);`));
  if (!match) throw new Error(`--color-${name} is not in the compiled theme`);
  return match[1].trim();
}

function luminance(hex: string): number {
  const full =
    hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const n = parseInt(full.slice(1, 7), 16);
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

describe("the neutral family", () => {
  it("is the navy ramp, at the steps the ruling puts each role on", () => {
    expect(resolved("ground")).toBe("#f4f6fa"); // 50
    expect(resolved("solid")).toBe("#eef2f9"); // 100
    expect(resolved("sunken")).toBe("#e1e8f3"); // 200
    expect(resolved("basemap-water")).toBe("#c3cfe2"); // 300
    expect(resolved("sea")).toBe("#9db0cc"); // 400
    expect(resolved("line-strong")).toBe("#7488a6"); // 500
    expect(resolved("ink-muted")).toBe("#4a607c"); // 600
    expect(resolved("ink-2")).toBe("#1f3a5c"); // 700
    expect(resolved("ink")).toBe("#0a1f3c"); // 800
  });

  it("carries the glass at the panel ground's value and its old alpha", () => {
    expect(resolved("glass")).toBe(`${resolved("solid")}db`);
  });
});

describe("the accent", () => {
  it("is one family of two values: the filled action and its hover", () => {
    expect(resolved("accent")).toBe("#1463ff");
    expect(resolved("accent-hover")).toBe("#0d4fd1");
    expect(resolved("accent-ink")).toBe("#fff");
  });

  it("leaves the quiet action, the focus ring and the inverse surface navy", () => {
    for (const name of ["quiet", "focus", "inverse"])
      expect(resolved(name), name).toBe("#0b2545");
  });

  it("is named by no other colour in the theme", () => {
    const source = readFileSync(resolve(ROOT, "ui/theme.css"), "utf8");
    const holders = [...source.matchAll(/--color-([a-z0-9-]+): #1463ff/g)].map(
      (m) => m[1],
    );
    expect(holders).toEqual(["accent"]);
  });
});

describe("the ink alphas", () => {
  it("are tinted with the navy ink", () => {
    expect(resolved("line")).toBe("#0a1f3c1a");
    expect(resolved("scrim")).toBe("#0a1f3c73");
    for (const shadow of ["control", "marker", "surface", "dock"]) {
      const match = css.match(new RegExp(`--shadow-${shadow}: ([^;]+);`));
      expect(match?.[1], shadow).toMatch(/#0a1f3c/);
    }
  });
});

describe("what Atlantic does not touch", () => {
  it("leaves warm and green alone", () => {
    expect(resolved("warn-ground")).toBe("#fff4e8");
    expect(resolved("now")).toBe("#a8442e");
    expect(resolved("warn")).toBe("#854d31");
    expect(resolved("ok")).toBe("#3c8a72");
  });

  it("leaves no teal in anything a page resolves", () => {
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
      expect(css).not.toContain(old);
  });
});

describe("contrast, as the ruling records it", () => {
  const PRINCIPLES = resolve(ROOT, "docs/DESIGN_PRINCIPLES.md");

  it("is a dated ruling, quoting the figures measured here", () => {
    const principles = readFileSync(PRINCIPLES, "utf8");
    const at = principles.indexOf("**2026-09-20 — Atlantic");
    expect(at).toBeGreaterThan(-1);
    const ruling = principles.slice(at, principles.indexOf("\n**", at + 1));
    expect(ruling).toMatch(
      /^\*\*2026-09-20 — Atlantic: one neutral family and one accent\*\*/,
    );
    const quoted = (pair: number) => `${pair.toFixed(2)}:1`;
    const muted = resolved("ink-muted");
    expect(ruling).toContain(quoted(contrast(muted, resolved("solid"))));
    expect(ruling).toContain(
      quoted(contrast(resolved("line-strong"), resolved("solid"))),
    );
    expect(ruling).toContain(quoted(contrast(muted, resolved("ground"))));
    expect(ruling).toContain(quoted(contrast(muted, resolved("card"))));
    expect(ruling).toContain(
      quoted(contrast(resolved("accent-ink"), resolved("accent"))),
    );
    expect(ruling).toContain(
      quoted(contrast(resolved("accent-ink"), resolved("accent-hover"))),
    );
  });

  it("keeps muted text above 4.5:1 on the content ground, a card and the panel", () => {
    const muted = resolved("ink-muted");
    for (const ground of ["ground", "card", "solid"])
      expect(contrast(muted, resolved(ground)), ground).toBeGreaterThanOrEqual(
        4.5,
      );
  });

  it("keeps the label on the filled action above 4.5:1, at rest and hovered", () => {
    const ink = resolved("accent-ink");
    expect(contrast(ink, resolved("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, resolved("accent-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the step that is barred from text under the bar it is barred by", () => {
    const solid = resolved("solid");
    expect(contrast(resolved("line-strong"), solid)).toBeLessThan(4.5);
    expect(contrast(resolved("line-strong"), solid)).toBeGreaterThanOrEqual(3);
  });
});
