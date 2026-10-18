// The blend job over a work directory that still holds a pointer from before an
// upgrade: an old version 1 pointer is left out and named, and the other wind
// models still blend, rather than one stale file failing the job every hour
// until that model publishes again (force5/blend/build.ts, ./inputs.ts).
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWindRuns } from "../force5/blend/inputs";

const FIXTURES = join(import.meta.dirname, "fixtures", "weather");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The sample runs under a scratch root, with GFS's pointer an old version 1 one. */
function rootWithAnOldPointer(): string {
  const root = mkdtempSync(join(tmpdir(), "blend-"));
  roots.push(root);
  cpSync(FIXTURES, join(root, "weather"), { recursive: true });
  const gfs = JSON.parse(readFileSync(join(FIXTURES, "gfs.json"), "utf8"));
  const { base: _base, spots: _spots, tiles: _tiles, ...rest } = gfs;
  writeFileSync(
    join(root, "weather", "gfs.json"),
    JSON.stringify({
      ...rest,
      schemaVersion: 1,
      encoding: "f5-wind-v1",
      spotForecasts: {},
    }),
  );
  return root;
}

describe("the blend's inputs", () => {
  it("leaves out and names a pointer that will not validate, and reads the rest", async () => {
    const root = rootWithAnOldPointer();
    const { manifests, missing, refused } = await readWindRuns(root);
    expect(refused.map(({ id }) => id)).toEqual(["gfs"]);
    expect(refused[0].reason).toMatch(/old format/);
    expect(manifests.map((manifest) => manifest.model)).toEqual([
      "harmonie",
      "icon-eu",
      "ecmwf",
    ]);
    expect(missing).toEqual([]);
  });

  it("publishes a blend of the others, naming the model it left out", () => {
    const root = rootWithAnOldPointer();
    const out = join(root, "weather", "blend.json");
    const log = execFileSync(
      join("node_modules", ".bin", "tsx"),
      [
        "force5/blend/build.ts",
        "--root",
        root,
        "--out",
        out,
        "--spots",
        "public/riding-locations.json",
      ],
      { encoding: "utf8" },
    );
    expect(log).toMatch(/left out gfs, whose pointer will not validate/);
    expect(log).toMatch(/Pointer refused, left out: gfs/);
    const blend = JSON.parse(readFileSync(out, "utf8"));
    expect(blend.sources.map((source: { id: string }) => source.id)).toEqual([
      "harmonie",
      "icon-eu",
      "ecmwf",
    ]);
  }, 30000);
});
