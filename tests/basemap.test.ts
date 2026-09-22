import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { basemapColours } from "../force5/src/basemap";

/**
 * The basemap's land and water are the one part of the map's colour that is not
 * CSS: MapLibre paints them, so TypeScript has to hand them over. They are read
 * off the theme on the document, which leaves two ways to be wrong — asking for
 * a name the theme does not hold, and what to do when nothing answers — and
 * neither of them shows up in a screenshot of a machine that has the theme.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const theme = readFileSync(resolve(ROOT, "ui/theme.css"), "utf8");

/** A stand-in for `getComputedStyle(document.documentElement)`. */
const root = (values: Record<string, string>) => ({
  getPropertyValue: (name: string) => values[name] ?? "",
});

/** What the theme declares `--color-<name>` as, as the browser would report it. */
function declared(name: string): string {
  const match = theme.match(new RegExp(`--color-${name}: ([^;]+);`));
  if (!match) throw new Error(`ui/theme.css declares no --color-${name}`);
  return match[1];
}

describe("the basemap's colours", () => {
  it("names two variables the theme actually holds", () => {
    expect(
      basemapColours(
        root({
          "--color-basemap-land": declared("basemap-land"),
          "--color-basemap-water": declared("basemap-water"),
        }),
      ),
    ).toEqual({ land: "#f0f1e8", water: "#c3cfe2" });
  });

  // A computed value arrives with the whitespace the declaration had.
  it("trims what the document gives back", () => {
    expect(
      basemapColours(
        root({
          "--color-basemap-land": " #f0f1e8 ",
          "--color-basemap-water": "\n  #c3cfe2",
        }),
      ),
    ).toEqual({ land: "#f0f1e8", water: "#c3cfe2" });
  });

  // An embedder that never imported ui/theme.css. The caller paints a layer
  // only when it has a colour for it, so the basemap keeps the provider's own —
  // a map in the wrong palette, rather than a hex written down twice.
  it("gives nothing away when the theme is not on the document", () => {
    expect(basemapColours(root({}))).toEqual({ land: "", water: "" });
  });

  it("is the only place WindMap names a basemap colour", () => {
    const source = readFileSync(
      resolve(ROOT, "force5/src/WindMap.tsx"),
      "utf8",
    );
    const paint = source.slice(
      source.indexOf("VITE_BASEMAP_STYLE_URL) {"),
      source.indexOf('map.addSource("towns"'),
    );
    expect(paint).toContain("basemap.land");
    expect(paint).toContain("basemap.water");
    expect(paint).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  // The warning is for a developer who forgot the import, and a build must not
  // carry it. `import.meta.env.DEV` follows NODE_ENV, so a machine that exports
  // NODE_ENV=development ships it — measured, before this was the mode check:
  // the string was in dist/assets/index-*.js. The mode is "production" for
  // `vite build` whatever the shell says, which is why src/main.tsx guards the
  // kit gallery the same way.
  it("keeps its missing-theme warning out of a build", () => {
    const source = readFileSync(
      resolve(ROOT, "force5/src/WindMap.tsx"),
      "utf8",
    );
    const warning = source.slice(
      0,
      source.indexOf("ui/theme.css is not on the document"),
    );
    expect(warning).toMatch(/import\.meta\.env\.MODE === "development"/);
    expect(source).not.toMatch(/import\.meta\.env\.DEV/);
  });
});
