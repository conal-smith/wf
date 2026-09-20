import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";

/**
 * ui/theme.css compiled exactly as the build compiles it, for tests that ask
 * what a class name comes to. A name the theme does not hold comes to nothing,
 * silently, so the kit's tests ask rather than trust.
 */

export const UI = dirname(fileURLToPath(import.meta.url));
export const THEME_SOURCE = readFileSync(resolve(UI, "theme.css"), "utf8");

const require = createRequire(import.meta.url);

export async function compileTheme(): Promise<(names: string[]) => string> {
  const compiled = await compile(THEME_SOURCE, {
    base: UI,
    loadStylesheet: async (id, base) => {
      const path = id.startsWith(".") ? resolve(base, id) : require.resolve(id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return (names) => compiled.build(names);
}

/** A class name as it is written in a selector. */
export const selector = (name: string) => `.${name.replace(/[^\w-]/g, "\\$&")}`;

/**
 * Whether the CSS holds a rule for this name itself. `.text-ink` is also how
 * `.text-ink-muted` begins, so the selector has to end where the name does.
 */
export const holds = (css: string, name: string) =>
  new RegExp(
    `${selector(name).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w\\\\-])`,
  ).test(css);

/** The names the theme declares under one prefix: `--radius-` gives `control`… */
export function declared(prefix: string): string[] {
  const names = new Set<string>();
  for (const [, name] of THEME_SOURCE.matchAll(
    new RegExp(`^\\s*--${prefix}-([a-z0-9-]+?)(?:--[a-z-]+)?:`, "gm"),
  ))
    names.add(name);
  return [...names];
}
