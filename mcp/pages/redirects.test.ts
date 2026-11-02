import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * public/_redirects hands the app's own addresses (/ai, /spot/*, …) to
 * index.html on Cloudflare Pages, which applies those rewrites before it
 * serves a file. A file the build ships under one of them would never be
 * served: the page would get index.html in its place, as the AI page's marks
 * did under /ai/logos/. The dev and preview servers serve the file, so only
 * this catches it before production does.
 */
const PUBLIC = join(__dirname, "../../public");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield `/${relative(PUBLIC, path).split(sep).join("/")}`;
  }
}

/** Each rewrite to the app, as a test of a path. */
const rewrites = readFileSync(join(PUBLIC, "_redirects"), "utf8")
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter(([from, , status]) => from?.startsWith("/") && status === "200")
  .map(([from]) => {
    const pattern = from.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", ".*");
    return { from, test: new RegExp(`^${pattern}$`) };
  });

describe("public/_redirects", () => {
  it("rewrites the app's addresses", () => {
    expect(rewrites.map((r) => r.from)).toContain("/ai/*");
  });

  it("shadows no file the site ships", () => {
    const shadowed = [...files(PUBLIC)].flatMap((file) =>
      rewrites.filter((r) => r.test.test(file)).map((r) => `${file} (${r.from})`),
    );
    expect(shadowed).toEqual([]);
  });
});
