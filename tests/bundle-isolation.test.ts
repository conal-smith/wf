import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The three apps on this origin must not reach each other.
 *
 * `src/main.tsx` picks the wind map, the marketplace or the community from the
 * pathname and lazy-loads the latter two, so the map never pays for them and
 * they never pay for MapLibre, nor for each other. The shared site menu is the
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
  const base = join(dirname(from), specifier);
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

describe("the map bundle", () => {
  it("reaches the marketplace only through the lazy import in main.tsx", () => {
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

  it("still reaches MapLibre, so the check above is about something", () => {
    expect(staticGraph("src/main.tsx")).toContain("maplibre-gl");
  });
});
