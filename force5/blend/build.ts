/**
 * Work out the blend every riding place's stars are rated from
 * (src/spotBlend.ts) and write it beside the manifests it was read from.
 *
 *   npx tsx force5/blend/build.ts [--root public] [--out public/weather/blend.json]
 *
 * It reads every live wind model's pointer manifest under `--root`, at the
 * path the site reads it from (force5/src/manifests.ts), so locally that is
 * `public/` and in the forecast image the directory force5/ingest/fetch_blend.py
 * has just filled from the bucket. A model with no manifest is left out and
 * named; with none at all there is nothing to blend and it fails.
 *
 * In the image it runs as one bundled file (force5/Dockerfile), so it imports
 * the site's own blend rather than a second copy of it.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { windModels } from "../src/manifests";
import { validateManifest, type Manifest } from "../src/weather";
import { buildSpotBlend, SPOT_BLEND_PATH } from "../../src/spotBlend";

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function main() {
  const root = option("root", "public");
  const out = option("out", join(root, SPOT_BLEND_PATH));
  const manifests: Manifest[] = [];
  const missing: string[] = [];
  for (const entry of windModels()) {
    let body: string;
    try {
      body = await readFile(join(root, entry.manifestUrl), "utf8");
    } catch {
      missing.push(entry.id);
      continue;
    }
    const manifest = validateManifest(JSON.parse(body) as Manifest);
    if (manifest.model !== entry.id)
      throw new Error(`${entry.manifestUrl} holds ${manifest.model}, not ${entry.id}.`);
    manifests.push(manifest);
  }
  if (!manifests.length)
    throw new Error(`No wind manifests under ${root}: nothing to blend.`);
  const blend = buildSpotBlend(manifests);
  const body = JSON.stringify(blend);
  await mkdir(dirname(out), { recursive: true });
  // Written whole or not at all: the site may be reading the old one.
  await writeFile(`${out}.tmp`, body);
  await rename(`${out}.tmp`, out);
  console.log(
    `Blend ${blend.run}: ${manifests.map((m) => `${m.model} ${m.run}`).join(", ")}; ` +
      `${Object.keys(blend.spots).length} places, ${blend.times.length} times, ` +
      `${Math.round(body.length / 1024)} kB` +
      (missing.length ? `. Not published, left out: ${missing.join(", ")}` : ""),
  );
}

main().catch((error: unknown) => {
  console.error(
    `Blend failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
