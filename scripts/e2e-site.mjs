#!/usr/bin/env node
/**
 * Stage the scratch site the e2e suite is built and served from.
 *
 * `public/weather` is ingest output: in a working checkout it holds the owner's
 * real forecast runs, and nothing in the e2e path may read it, serve it or
 * write to it. So the suite gets a public directory of its own:
 *
 *   .e2e/public/            the committed files in public/, copied
 *   .e2e/public/weather/    synthetic sample bundles, generated fresh each run
 *                           (`--site`: HARMONIE on the real 0.025° grid, so the
 *                           map has every level of tiles to choose from), and
 *                           the blend of them (force5/blend/build.ts)
 *   .e2e/dist/              the build vite preview then serves
 *
 * `vite.config.ts` points `publicDir` and `build.outDir` at those when E2E_SITE
 * is set, so the e2e build never opens `public/weather` at all. The specs read
 * their expectations from the same staged manifests (see e2e/sample.ts).
 *
 * The generated directories under `public/` are deliberately not copied: weather
 * and marine are both git-ignored ingest output, and a suite that silently
 * depended on whichever of them a machine happened to have would not be a test.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Git-ignored ingest output; never copied into the e2e site. */
const GENERATED = new Set(["weather", "marine"]);

const E2E_ROOT = join(ROOT, ".e2e");
const E2E_PUBLIC = join(E2E_ROOT, "public");
const E2E_WEATHER = join(E2E_PUBLIC, "weather");

function main() {
  // A clean tree every run, so a stale bundle can never answer for a fresh one.
  rmSync(E2E_ROOT, { recursive: true, force: true });
  mkdirSync(E2E_PUBLIC, { recursive: true });
  for (const entry of readdirSync(join(ROOT, "public"), {
    withFileTypes: true,
  })) {
    // By name, not by kind: in a worktree these are often symlinks to the main
    // checkout's ingest output, which `isDirectory()` does not see as one.
    if (GENERATED.has(entry.name)) continue;
    cpSync(join(ROOT, "public", entry.name), join(E2E_PUBLIC, entry.name), {
      recursive: true,
    });
  }
  stageStaticData();
  const generated = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts", "sample-weather.mjs"),
      "--all",
      "--site",
      "--out",
      E2E_WEATHER,
    ],
    { stdio: "inherit" },
  );
  if (generated.status !== 0)
    throw new Error("Sample weather generation failed for the e2e site");
  // The blend the map's lights are rated from, worked out from those samples
  // as the `blend` job works it out from the published runs (src/spotBlend.ts).
  const blended = spawnSync(
    "npx",
    ["--no-install", "tsx", join(ROOT, "force5", "blend", "build.ts"), "--root", E2E_PUBLIC],
    { stdio: "inherit", cwd: ROOT },
  );
  if (blended.status !== 0)
    throw new Error("The blend failed for the e2e site");
  console.log(`Staged the e2e site in ${E2E_ROOT}`);
}

/**
 * The chart's static archives live on the data host, not the site
 * (scripts/foildepth/publish.py); with no data base set, the e2e site is its
 * own data host. So the committed offline copies in public-data/ (the
 * bathymetry and the foilable-depth pilots) are staged beside the site, and
 * the foil index is cut to the archives that are there: the national regions
 * are too large to commit, and an e2e run reads nothing from the network.
 */
function stageStaticData() {
  const data = join(ROOT, "public-data");
  // Never a region a developer built or copied there: the committed files only.
  const region = /\/foildepth\/[^/]+\/tide-[^/]*\.pmtiles$/;
  cpSync(data, E2E_PUBLIC, {
    recursive: true,
    filter: (path) => !region.test(path),
  });
  stageOffline(data, "satellite");
  stageOffline(data, "lidar");
  // The spot pictures are on the data host only, which the e2e site is not:
  // without their list a spot page draws none, and a spec that wants one
  // routes in a set of its own (e2e/spot-page.spec.ts).
  rmSync(join(E2E_PUBLIC, "satellite", "spots.json"), { force: true });
  const indexPath = join(E2E_PUBLIC, "foildepth", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!index.base) return;
  index.areas = index.areas.filter(
    (area) =>
      area.kind !== "region" && existsSync(join(data, index.base, area.url)),
  );
  writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n");
}

/**
 * The satellite imagery is the whole coast, far too large to commit: a small
 * set (Malahide to Bull Island, scripts/satellite/publish.py --offline) is,
 * and so is the LiDAR layer's (scripts/lidar/publish.py --offline),
 * with an index of its own, and the e2e site serves that index in place of
 * the national one, so it is read from disk too. With no offline set, no
 * index: the e2e site reads nothing from the network.
 */
function stageOffline(data, name) {
  const dir = join(data, name);
  const offline =
    existsSync(dir) &&
    readdirSync(dir).find((v) => existsSync(join(dir, v, "index.json")));
  const index = join(E2E_PUBLIC, name, "index.json");
  if (!offline) {
    rmSync(index, { force: true });
    return;
  }
  mkdirSync(join(E2E_PUBLIC, name), { recursive: true });
  cpSync(join(dir, offline, "index.json"), index);
}

main();
