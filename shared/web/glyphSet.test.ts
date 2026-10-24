import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WeatherIcon } from "../../force5/src/surface";
import * as glyphs from "./glyphSet";
import type { GlyphDef, GlyphPart } from "./glyphSet";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const set = Object.entries(glyphs).filter(
  (entry): entry is [string, GlyphDef] => Array.isArray(entry[1]),
);

/** Every coordinate pair a part's path visits, after its relative moves. */
function points(d: string): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLCSQTHVAZ])([^MLCSQTHVAZ]*)/gi)) {
    const v = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const stride = {
      M: 2,
      L: 2,
      T: 2,
      C: 6,
      S: 4,
      Q: 4,
      H: 1,
      V: 1,
      A: 7,
      Z: 0,
    }[up]!;
    for (let i = 0; stride && i < v.length; i += stride) {
      const seg = v.slice(i, i + stride);
      if (up === "H") x = rel ? x + seg[0] : seg[0];
      else if (up === "V") y = rel ? y + seg[0] : seg[0];
      else {
        const [ex, ey] = seg.slice(-2);
        x = rel ? x + ex : ex;
        y = rel ? y + ey : ey;
      }
      out.push([x, y]);
    }
  }
  return out;
}

const inside = (part: GlyphPart) =>
  "d" in part
    ? points(part.d)
    : "r" in part
      ? [
          [part.cx - part.r, part.cy - part.r],
          [part.cx + part.r, part.cy + part.r],
        ]
      : [[part.x, part.y]];

describe("the glyph set", () => {
  it("holds the dock's rows, the blend and the weather's states", () => {
    for (const name of [
      "wind",
      "gust",
      "direction",
      "waves",
      "current",
      "air",
      "seaTemp",
      "drop",
      "wing",
      "ruler",
      "blend",
      "sun",
      "partly",
      "cloudy",
      "fog",
      "drizzle",
      "rain",
      "showers",
      "thunder",
      "snow",
      "night",
      "nightCloud",
    ])
      expect(glyphs, name).toHaveProperty(name);
  });

  it.each(set)("draws %s on the 24-unit grid", (_, glyph) => {
    expect(glyph.length).toBeGreaterThan(0);
    for (const part of glyph)
      for (const [x, y] of inside(part)) {
        expect(x).toBeGreaterThanOrEqual(-0.5);
        expect(x).toBeLessThanOrEqual(24.5);
        expect(y).toBeGreaterThanOrEqual(-0.5);
        expect(y).toBeLessThanOrEqual(24.5);
      }
  });

  it("colours only what means something: the app's glyphs are ink and paper", () => {
    const paints = (glyph: GlyphDef) =>
      glyph.flatMap((part) =>
        "text" in part
          ? [part.fill]
          : [part.fill, part.stroke].filter((p) => p !== "none"),
      );
    for (const name of [
      "menu",
      "customise",
      "tour",
      "search",
      "close",
      "page",
      "warn",
      "lock",
      "wind",
      "blend",
      "air",
      "waves",
      "current",
      // The site menu's sections.
      "windMap",
      "market",
      "community",
      "useWithAi",
    ] as const)
      for (const paint of paints(glyphs[name]))
        expect([undefined, "ink", "paper"], name).toContain(paint);
  });

  it("draws an outline round each colour, as a chart draws a buoy", () => {
    // A cloud, the sun and the moon are filled within an ink line.
    for (const name of ["sun", "cloudy", "night", "drop", "buoy"] as const) {
      const filled = glyphs[name].filter(
        (part) => !("text" in part) && part.fill && part.fill !== "ink",
      );
      expect(filled.length, name).toBeGreaterThan(0);
      for (const part of filled)
        expect("text" in part ? "" : part.stroke, name).toBeUndefined();
    }
  });

  it("gives each weather group its glyph, and the moon to a clear night", () => {
    const icons: WeatherIcon[] = [
      "clear",
      "partly",
      "cloudy",
      "fog",
      "drizzle",
      "rain",
      "showers",
      "thunder",
      "snow",
    ];
    for (const icon of icons) expect(glyphs.skyGlyph(icon)).toBeDefined();
    expect(glyphs.skyGlyph("clear")).toBe(glyphs.sun);
    expect(glyphs.skyGlyph("clear", true)).toBe(glyphs.night);
    expect(glyphs.skyGlyph("partly", true)).toBe(glyphs.nightCloud);
    expect(glyphs.skyGlyph("rain", true)).toBe(glyphs.rain);
  });

  it("draws a scaled cloud with its numbers moved, not a transform", () => {
    // The mockup's cloud(0, -4): the same path four units up.
    const cloud = glyphs.rain[0];
    expect("d" in cloud && cloud.d.startsWith("M6.5 13.5C3.6 13.5")).toBe(true);
    expect(JSON.stringify(glyphs)).not.toContain("transform");
  });

  it("is drawn by the map, the spot page and the app from this one file", () => {
    const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
    expect(read("shared/web/ChartGlyph.tsx")).toMatch(/from "\.\/glyphSet"/);
    expect(read("src/chartGlyphs.tsx")).toMatch(
      /from "\.\.\/shared\/web\/(glyphSet|ChartGlyph)"/,
    );
    expect(read("spot/web/glyphs.tsx")).toMatch(
      /from "\.\.\/\.\.\/shared\/web\/(glyphSet|ChartGlyph)"/,
    );
    expect(read("mobile/src/components/Glyphs.tsx")).toMatch(
      /from "\.\.\/\.\.\/\.\.\/shared\/web\/glyphSet"/,
    );
  });
});
