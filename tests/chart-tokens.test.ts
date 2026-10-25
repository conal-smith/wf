import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileTheme } from "../ui/theme.testkit";

/**
 * The chart's palette, held to the ruling of 2026-10-05 (docs/BRAND.md, and
 * the ruling in docs/DESIGN_PRINCIPLES.md).
 *
 * Every page on the site reads its colour from ui/theme.css, so the theme's
 * values are the whole of it. That makes the palette cheap to change and just
 * as cheap to break: a value re-typed by eye fails nothing and ships. So the
 * theme is compiled as the build compiles it, the values a page will resolve
 * are checked against the ones the ruling names, and the contrast pairs the
 * ruling quotes are measured rather than trusted.
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

describe("paper and ink", () => {
  it("is one paper: the ground, the card and the solid fallback", () => {
    for (const name of ["ground", "card", "solid", "ink-inverse"])
      expect(resolved(name), name).toBe("#f3eee3");
    expect(resolved("sunken")).toBe("#ede6d6");
  });

  it("is one ink, for text, the filled action and the inverse fill", () => {
    for (const name of ["ink", "accent", "quiet", "inverse"])
      expect(resolved(name), name).toBe("#1a1d21");
  });

  it("paints the double rule's gap in the paper every surface is", () => {
    const frame = css.match(/--inset-shadow-frame: ([^;]+);/)?.[1] ?? "";
    expect(frame).toContain(resolved("card"));
    expect(frame).toContain(resolved("ink"));
  });

  it("lays the glass a badge stands on in the same paper, a little open", () => {
    expect(resolved("glass")).toBe(`${resolved("solid")}eb`);
  });
});

describe("the chart's inks", () => {
  it("are the mockup's: magenta, the pen, the buoy, the land and the sea", () => {
    expect(resolved("chart-magenta")).toBe("#b0186a");
    expect(resolved("pen")).toBe("#d43a2c");
    expect(resolved("buoy")).toBe("#e9b200");
    expect(resolved("land")).toBe("#ede3c8");
    expect(resolved("sea")).toBe("#d5e6ea");
    expect(resolved("depth")).toBe("#5f8c9c");
  });

  it("tints the sea darker where it is shallower, as a chart does", () => {
    const tints = ["sea-1", "sea-2", "sea-3", "sea-4"].map((name) =>
      luminance(resolved(name)),
    );
    expect([...tints].sort((a, b) => a - b)).toEqual(tints);
  });

  it("turns the filled action and the focus ring magenta, and nothing else blue", () => {
    expect(resolved("accent-hover")).toBe(resolved("chart-magenta"));
    expect(resolved("focus")).toBe(resolved("chart-magenta"));
    expect(css).not.toContain("#1463ff");
  });

  it("leaves no Atlantic navy in anything a page resolves", () => {
    for (const old of ["#0a1f3c", "#0b2545", "#1f3a5c", "#4a607c", "#7488a6"])
      expect(css).not.toContain(old);
  });

  it("holds the wind ramp's ends and the two fixed marks", () => {
    expect(resolved("wind-k00")).toBe("#aacbea");
    expect(resolved("wind-k65")).toBe("#231628");
    expect(resolved("now-marker")).toBe("#bf6546");
    expect(resolved("gust")).toBe("#e0803a");
  });
});

describe("the weather's colours", () => {
  it("are the glyph sheet's, the sun the buoy's own yellow", () => {
    expect(resolved("weather-sun")).toBe(resolved("buoy"));
    expect(resolved("weather-rain")).toBe("#3a7fb0");
    expect(resolved("weather-cloud")).toBe("#d6d0c2");
    expect(resolved("weather-night")).toBe("#e7dcb4");
  });

  it("keep rain to a mark: it shows on paper, and does not read as words", () => {
    const paper = resolved("ground");
    const rain = contrast(resolved("weather-rain"), paper);
    expect(rain).toBeGreaterThanOrEqual(3);
    expect(rain).toBeLessThan(4.5);
  });

  it("keep the pale fills inside an ink line that reads round them", () => {
    for (const fill of ["weather-cloud", "weather-night", "weather-sun"])
      expect(
        contrast(resolved("ink"), resolved(fill)),
        fill,
      ).toBeGreaterThanOrEqual(7);
  });
});

describe("the stars' colours", () => {
  // Read once the theme is compiled, in each test.
  const stars = () => [1, 2, 3, 4, 5].map((n) => resolved(`stars-${n}`));

  it("are the ruling's, pale pink to deep magenta", () => {
    expect(stars()).toEqual([
      "#e28bb3",
      "#d2609a",
      "#bd3d84",
      "#a01f6c",
      "#7c0f55",
    ]);
  });

  it("darken with every star, each step plain against the last", () => {
    const STARS = stars();
    for (let i = 1; i < STARS.length; i++) {
      expect(luminance(STARS[i]), `stars-${i + 1}`).toBeLessThan(
        luminance(STARS[i - 1]),
      );
      expect(contrast(STARS[i], STARS[i - 1])).toBeGreaterThan(1.3);
    }
  });

  it("show on paper from the first star", () => {
    expect(contrast(stars()[0], resolved("ground"))).toBeGreaterThanOrEqual(2);
  });

  it("are not the wind's", () => {
    const wind = css.match(/--color-wind-k\d\d: #[0-9a-f]{6}/g) ?? [];
    expect(wind.length).toBeGreaterThan(10);
    for (const star of stars())
      expect(wind.some((w) => w.endsWith(star))).toBe(false);
  });
});

describe("contrast, as the ruling records it", () => {
  const PRINCIPLES = resolve(ROOT, "docs/DESIGN_PRINCIPLES.md");

  it("is a dated ruling, quoting the figures measured here", () => {
    const principles = readFileSync(PRINCIPLES, "utf8");
    const at = principles.indexOf("**2026-10-05 — The chart");
    expect(at).toBeGreaterThan(-1);
    const ruling = principles.slice(at, principles.indexOf("\n**", at + 1));
    const quoted = (pair: number) => `${pair.toFixed(2)}:1`;
    const paper = resolved("ground");
    for (const name of [
      "ink",
      "ink-2",
      "ink-muted",
      "line-strong",
      "chart-magenta",
      "pen",
      "pen-ink",
      "warn",
    ])
      expect(ruling, name).toContain(
        quoted(contrast(resolved(name), paper)),
      );
    expect(ruling).toContain(
      quoted(contrast(resolved("ink-muted"), resolved("sunken"))),
    );
    expect(ruling).toContain(
      quoted(contrast(resolved("accent-ink"), resolved("accent-hover"))),
    );
  });

  it("keeps muted text above 4.5:1 on paper and on the second sheet", () => {
    const muted = resolved("ink-muted");
    for (const ground of ["ground", "card", "solid", "sunken"])
      expect(contrast(muted, resolved(ground)), ground).toBeGreaterThanOrEqual(
        4.5,
      );
  });

  it("keeps the label on the filled action above 4.5:1, at rest and hovered", () => {
    const ink = resolved("accent-ink");
    expect(contrast(ink, resolved("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, resolved("accent-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("writes the pen's words in an ink that reads, and its marks in one that shows", () => {
    const paper = resolved("ground");
    expect(contrast(resolved("pen-ink"), paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(resolved("pen"), paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(resolved("warn"), resolved("warn-ground"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(resolved("ok"), paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the step that is barred from text under the bar it is barred by", () => {
    const paper = resolved("ground");
    expect(contrast(resolved("line-strong"), paper)).toBeLessThan(4.5);
    expect(contrast(resolved("line-strong"), paper)).toBeGreaterThanOrEqual(3);
  });
});
