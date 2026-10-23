import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The three apps on this origin must not reach each other.
 *
 * `src/main.tsx` picks the wind map, the marketplace, the community, the AI
 * page or the spot page from the pathname and loads each with a dynamic
 * import, so none pays for another: the map never pays for them, and they
 * never pay for MapLibre. The shared site menu is the
 * one piece of code all three import, and a single careless
 * `from "../force5/src"` in it — the barrel, which exports `WindMap` — would
 * quietly pull the whole map into the marketplace chunk and the community's.
 * Nothing about that would fail: the site would build, run and look right, and
 * the marketplace would have grown by half a megabyte.
 *
 * So the graph is checked rather than the bundle. This walks static imports
 * from the entry points and asserts what each one may not reach. Dynamic
 * `import()` is deliberately ignored: that is exactly the seam the split is
 * made of.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `import x from "y"`, `import "y"`, `export … from "y"` — statics only. */
const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
];

function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  // Node-style TypeScript writes `./source.js` for `./source.ts` (mcp/api).
  const base = join(dirname(from), specifier).replace(/\.js$/, "");
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every module and bare package the entry statically reaches, as repo-relative
 * paths (`force5/src/WindMap.tsx`) and package names (`maplibre-gl`).
 */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    const key = relative(ROOT, file);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const local = resolveLocal(file, specifier);
      if (local) queue.push(local);
      // A bare specifier is a package; record the package, not its contents.
      else if (!specifier.startsWith("."))
        seen.add(
          specifier
            .split("/")
            .slice(0, specifier[0] === "@" ? 2 : 1)
            .join("/"),
        );
    }
  }
  return seen;
}

const reached = (entry: string, needle: string) =>
  [...staticGraph(entry)].filter((m) => m.includes(needle));

describe("the shared site menu", () => {
  for (const entry of ["force5/src/SiteMenu.tsx", "force5/src/siteNav.ts"]) {
    it(`${entry} reaches neither the force5 barrel nor the map`, () => {
      const graph = staticGraph(entry);
      expect([...graph].filter((m) => m === "force5/src/index.ts")).toEqual([]);
      expect([...graph].filter((m) => /WindMap/.test(m))).toEqual([]);
      expect([...graph].filter((m) => m === "maplibre-gl")).toEqual([]);
    });
  }

  it("is reached from every app, so the check above is about something", () => {
    expect(staticGraph("market/web/MarketApp.tsx")).toContain(
      "force5/src/SiteMenu.tsx",
    );
    expect(staticGraph("community/web/CommunityApp.tsx")).toContain(
      "force5/src/SiteMenu.tsx",
    );
    expect(staticGraph("src/App.tsx")).toContain("force5/src/SiteMenu.tsx");
  });
});

describe("the marketplace bundle", () => {
  it("does not statically reach the map", () => {
    expect(reached("market/web/MarketApp.tsx", "force5/src/index.ts")).toEqual(
      [],
    );
    expect(reached("market/web/MarketApp.tsx", "WindMap")).toEqual([]);
    expect(reached("market/web/MarketApp.tsx", "maplibre-gl")).toEqual([]);
    // Nor the map app's own sources, which is where the map's state lives.
    expect(
      [...staticGraph("market/web/MarketApp.tsx")].filter((m) =>
        m.startsWith("src/"),
      ),
    ).toEqual([]);
  });
});

describe("the community bundle", () => {
  const ENTRY = "community/web/CommunityApp.tsx";

  it("does not statically reach the map", () => {
    expect(reached(ENTRY, "force5/src/index.ts")).toEqual([]);
    expect(reached(ENTRY, "WindMap")).toEqual([]);
    expect(reached(ENTRY, "maplibre-gl")).toEqual([]);
    expect([...staticGraph(ENTRY)].filter((m) => m.startsWith("src/"))).toEqual(
      [],
    );
  });

  it("does not reach the marketplace, nor the marketplace it", () => {
    expect(
      [...staticGraph(ENTRY)].filter((m) => m.startsWith("market/")),
    ).toEqual([]);
    expect(
      [...staticGraph("market/web/MarketApp.tsx")].filter((m) =>
        m.startsWith("community/"),
      ),
    ).toEqual([]);
  });

  // The spot card reads the forecast contract, and that is all of the map it
  // takes: the series loader in src/ stays where the first check keeps it.
  it("reaches the forecast contract, so the check above is about something", () => {
    expect(staticGraph(ENTRY)).toContain("force5/src/weather.ts");
  });

  // A thread stores a spot's id. The wind at it is the browser's to fetch.
  it("has an API that knows nothing about weather", () => {
    expect(
      [...staticGraph("community/api/router.ts")].filter(
        (m) => m.startsWith("force5/") || m.startsWith("src/"),
      ),
    ).toEqual([]);
  });

  // The API's code is Node's: a repo or a handler in the browser's graph would
  // build, and ship a database client to every reader.
  it("takes only plain data from the API's side of the section", () => {
    expect(
      [...staticGraph(ENTRY)].filter(
        (m) =>
          m.startsWith("community/") && !/^community\/(web|shared)\//.test(m),
      ),
    ).toEqual([]);
  });
});

describe("the entry point", () => {
  // src/main.tsx is what every path downloads first, so it carries the base
  // and the path test and nothing else: each section, the map included, is a
  // dynamic import of its own.
  it("reaches the marketplace only through the lazy import", () => {
    const graph = staticGraph("src/main.tsx");
    expect([...graph].filter((m) => m.startsWith("market/web/"))).toEqual([]);
    // The one line that does cross, and it is a dynamic import.
    expect(readFileSync(join(ROOT, "src/main.tsx"), "utf8")).toMatch(
      /React\.lazy\(\s*\(\)\s*=>\s*import\("\.\.\/market\/web\/MarketApp"\)/,
    );
  });

  it("reaches the community only through its lazy import, likewise", () => {
    const graph = staticGraph("src/main.tsx");
    expect([...graph].filter((m) => m.startsWith("community/"))).toEqual([]);
    expect(readFileSync(join(ROOT, "src/main.tsx"), "utf8")).toMatch(
      /React\.lazy\(\s*\(\)\s*=>\s*import\("\.\.\/community\/web\/CommunityApp"\)/,
    );
  });

  // A spot page, /stars and /ai must not download the map's 1.6 MB: the map
  // is imported, not linked, and only on its own paths.
  it("does not statically reach the map, MapLibre or the map's app", () => {
    const graph = staticGraph("src/main.tsx");
    expect([...graph].filter((m) => m === "src/App.tsx")).toEqual([]);
    expect(reached("src/main.tsx", "force5/src/index.ts")).toEqual([]);
    expect(reached("src/main.tsx", "WindMap")).toEqual([]);
    expect(reached("src/main.tsx", "maplibre-gl")).toEqual([]);
    expect(readFileSync(join(ROOT, "src/main.tsx"), "utf8")).toMatch(
      /import\("\.\/App"\)/,
    );
  });

  it("still reaches the base and the path test, so the check above is about something", () => {
    const graph = staticGraph("src/main.tsx");
    expect(graph).toContain("src/styles.css");
    expect(graph).toContain("ui/theme.css");
    expect(graph).toContain("force5/src/siteNav.ts");
  });
});

describe("the map bundle", () => {
  const ENTRY = "src/App.tsx";

  it("reaches none of the other sections", () => {
    expect(
      [...staticGraph(ENTRY)].filter((m) =>
        /^(market|community|spot|ai)\//.test(m),
      ),
    ).toEqual([]);
  });

  it("still reaches MapLibre and its stylesheet, so the checks above are about something", () => {
    const graph = staticGraph(ENTRY);
    expect(graph).toContain("maplibre-gl");
    expect(graph).toContain("src/map.css");
  });
});

// The map and the spot page explain an hour's stars with one component. It
// is the kit's, which both may import, because neither may import the other.
describe("the stars' explanation", () => {
  it("is ui/RatingTip.tsx on the spot page, and nowhere else", () => {
    const graph = [...staticGraph("spot/web/SpotApp.tsx")];
    expect(
      graph.filter((m) => /(StarTip|RatingTip)\.tsx$/.test(m)),
    ).toEqual(["ui/RatingTip.tsx"]);
  });

  it("is not on the map, whose dock shows the stars and nothing over them", () => {
    expect(
      [...staticGraph("src/App.tsx")].filter((m) =>
        /(StarTip|RatingTip)\.tsx$/.test(m),
      ),
    ).toEqual([]);
  });
});

describe("the spot page bundle", () => {
  const ENTRY = "spot/web/SpotApp.tsx";

  it("does not statically reach the map, MapLibre or the map's app", () => {
    expect(reached(ENTRY, "force5/src/index.ts")).toEqual([]);
    expect(reached(ENTRY, "WindMap")).toEqual([]);
    expect(reached(ENTRY, "maplibre-gl")).toEqual([]);
    // It borrows nothing from the map's sources: its stars come from the kit
    // and its sky from the glyph set the map draws from too
    // (shared/web/glyphSet.ts, drawn by shared/web/ChartGlyph.tsx).
    expect(
      [...staticGraph(ENTRY)].filter((m) => m.startsWith("src/")).sort(),
    ).toEqual([]);
  });

  it("reaches neither the marketplace nor the community, nor they it", () => {
    expect(
      [...staticGraph(ENTRY)].filter(
        (m) => m.startsWith("market/") || m.startsWith("community/"),
      ),
    ).toEqual([]);
    for (const other of [
      "market/web/MarketApp.tsx",
      "community/web/CommunityApp.tsx",
      "src/App.tsx",
    ])
      expect(
        [...staticGraph(other)].filter((m) => m.startsWith("spot/")),
      ).toEqual([]);
  });

  // The page reads the forecast through the MCP server's reduction, and the
  // browser-safe half of its reader: never the half that opens the disk.
  it("reads the forecast through the shared, browser-safe modules", () => {
    const graph = staticGraph(ENTRY);
    expect(graph).toContain("mcp/api/forecast.ts");
    expect(graph).toContain("mcp/api/httpSource.ts");
    expect(graph).toContain("force5/src/stars.ts");
    expect(graph).not.toContain("mcp/api/source.ts");
    expect(graph).toContain("shared/web/glyphSet.ts");
    expect([...graph].filter((m) => m.startsWith("node:"))).toEqual([]);
  });

  it("is reached from the entry point only through its lazy import", () => {
    const graph = staticGraph("src/main.tsx");
    expect([...graph].filter((m) => m.startsWith("spot/"))).toEqual([]);
    expect(readFileSync(join(ROOT, "src/main.tsx"), "utf8")).toMatch(
      /React\.lazy\(\s*\(\)\s*=>\s*import\("\.\.\/spot\/web\/SpotApp"\)/,
    );
  });
});
