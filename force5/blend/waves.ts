/**
 * Work out the wave blend (src/waveBlend.ts) and publish it beside the wave
 * runs it was read from.
 *
 *   npx tsx force5/blend/waves.ts [--root public]
 *                                 [--out <root>/weather/wave-blend.json]
 *                                 [--spots <root>/riding-locations.json]
 *
 * It reads the pointer of every wave model in `WAVE_BLEND_MODELS` the
 * catalogue publishes, under `--root` at the path the site reads it from, and
 * every spot square of the run it names (./inputs.ts `readWaveRuns`). Locally
 * that is `public/`, and in the forecast image the directory
 * force5/ingest/fetch_wave_blend.py has just filled from the bucket. A model
 * with no pointer, or one that will not validate, is left out and named; with
 * none at all there is nothing to blend and it fails.
 *
 * It writes a run as the wind blend does (./build.ts): beside `--out`, a
 * directory named for its content holding each place's sea state in its 2°
 * spot square, `wave-blend-<run>-<hours>h-v2-<hash8>/spots/<square>.json`, and
 * then `--out` itself, the pointer. In the image it runs as one bundled file
 * (force5/Dockerfile).
 */
import { join } from "node:path";
// @ts-expect-error -- scripts/runs.mjs has no declaration file.
import { publishRun } from "../../scripts/runs.mjs";
import { readWaveRuns } from "./inputs";
import { option, placed, writeRun } from "./run";
import {
  buildWaveBlend,
  parseWaveBlend,
  WAVE_BLEND_KEY,
  WAVE_BLEND_PATH,
  waveBlendPrefix,
} from "../../src/waveBlend";

async function main() {
  const root = option("root", "public");
  const out = option("out", join(root, WAVE_BLEND_PATH));
  const catalogue = option("spots", join(root, "riding-locations.json"));
  const { manifests, missing, refused } = await readWaveRuns(root);
  for (const { id, reason } of refused)
    console.log(
      `Wave blend: left out ${id}, whose pointer will not validate: ${reason}`,
    );
  if (!manifests.length)
    throw new Error(
      `No usable wave manifests under ${root}: nothing to blend.`,
    );
  const { places, unplaced, blend } = await placed(
    buildWaveBlend(manifests),
    WAVE_BLEND_KEY,
    catalogue,
  );
  if (!Object.keys(blend.spotWaveBlend).length)
    throw new Error(
      "No blended place is in the catalogue: nothing to publish.",
    );
  const { pointer, base, files } = publishRun(
    blend,
    waveBlendPrefix(blend),
    [],
    places,
  ) as { pointer: object; base: string; files: [string, Buffer][] };
  // What the site will read back, checked before anything is written.
  const checked = parseWaveBlend(JSON.parse(JSON.stringify(pointer)));
  await writeRun(out, files, pointer, base);
  const bytes = files.reduce((sum, [, data]) => sum + data.length, 0);
  console.log(
    `Wave blend ${blend.run}: ${blend.sources.map((s) => `${s.id} ${s.run}`).join(", ")}; ` +
      `${Object.keys(blend.spotWaveBlend).length} places in ${checked.spots.squares.length} squares, ` +
      `${blend.times.length} times, ${Math.round(bytes / 1024)} kB in ${base}` +
      (missing.length
        ? `. Not published, left out: ${missing.join(", ")}`
        : "") +
      (refused.length
        ? `. Pointer refused, left out: ${refused.map(({ id }) => id).join(", ")}`
        : "") +
      (unplaced.length
        ? `. Not in the catalogue, left out: ${unplaced.join(", ")}`
        : ""),
  );
}

main().catch((error: unknown) => {
  console.error(
    `Wave blend failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
