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
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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
  const generated = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts", "sample-weather.mjs"),
      "--all",
      "--out",
      E2E_WEATHER,
    ],
    { stdio: "inherit" },
  );
  if (generated.status !== 0)
    throw new Error("Sample weather generation failed for the e2e site");
  console.log(`Staged the e2e site in ${E2E_ROOT}`);
}

main();
