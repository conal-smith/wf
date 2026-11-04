/**
 * Work out the blend every riding place's stars are rated from
 * (src/spotBlend.ts) and publish it beside the manifests it was read from.
 *
 *   npx tsx force5/blend/build.ts [--root public] [--out public/weather/blend.json]
 *                                 [--spots <root>/riding-locations.json]
 *                                 [--previous <out, or root>/weather/blend.json]
 *
 * It reads every live wind model's pointer manifest under `--root`, at the
 * path the site reads it from (force5/src/manifests.ts), and every spot square
 * of the run it names, through the site's own loader (force5/src/spotData.ts).
 * Locally that is `public/`, and in the forecast image the directory
 * force5/ingest/fetch_blend.py has just filled from the bucket. A model with no
 * manifest, or one whose manifest will not validate (an old version 1 pointer
 * left from before an upgrade), is left out and named (./inputs.ts); with none
 * at all there is nothing to blend and it fails.
 *
 * It writes a run, as every model does (docs/TILING_DESIGN.md, decisions 4–6):
 * beside `--out`, a directory named for its content holding each place's
 * consensus in its 2° spot square, `blend-<run>-<hours>h-v2-<hash8>/spots/
 * <square>.json`, and then `--out` itself, the pointer, which lists the
 * squares. `--spots` is the riding-place catalogue that places each spot in
 * its square, the same one the models were split by; a place the catalogue no
 * longer has is left out and named. The layout and the hash are
 * scripts/runs.mjs, the JavaScript twin of force5/ingest/rundir.py.
 *
 * Today's earlier hours are kept from the blend published before it
 * (`carryToday`, the ruling of 25 October 2026): `--previous` names that
 * blend's pointer, its squares beside it, as fetch_blend.py lays out the
 * bucket's; without it, the pointer at `--out`, or else under `--root`. With
 * none, or one that will not read, the blend starts today afresh and says so.
 *
 * In the image it runs as one bundled file (force5/Dockerfile), so it imports
 * the site's own blend rather than a second copy of it.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
// The run layout the sample generator writes too; plain JavaScript, so it
// carries no types of its own.
// @ts-expect-error -- scripts/runs.mjs has no declaration file.
import { publishRun } from "../../scripts/runs.mjs";
import { readWindRuns } from "./inputs";
import { option, placed, writeRun } from "./run";
import type { ReadJson } from "../src/spotData";
import {
  blendPrefix,
  buildSpotBlend,
  carryToday,
  loadBlendSquares,
  parseSpotBlend,
  SPOT_BLEND_PATH,
  type LoadedBlend,
} from "../../src/spotBlend";

/**
 * The blend published before this one, every place of it read, for today's
 * earlier hours to be kept from (`carryToday`), or null. Never fatal: with no
 * blend before it, or one that cannot be read whole, this blend simply starts
 * from what the models publish now, as every blend did before 25 October 2026.
 */
async function previousBlend(path: string): Promise<LoadedBlend | null> {
  // The squares lie beside the pointer, as they do under weather/.
  const read: ReadJson = async (inside) =>
    JSON.parse(
      await readFile(
        join(dirname(path), relative(dirname(SPOT_BLEND_PATH), inside)),
        "utf8",
      ),
    );
  try {
    const body = await readFile(path, "utf8").catch(() => null);
    if (body === null) {
      console.log(`Blend: no earlier blend at ${path}; today starts afresh.`);
      return null;
    }
    const pointer = parseSpotBlend(JSON.parse(body));
    const loaded = await loadBlendSquares(read, pointer, pointer.spots.squares);
    if (loaded.failed.length)
      throw new Error(`its squares ${loaded.failed.join(", ")} cannot be read`);
    return loaded;
  } catch (error) {
    console.log(
      `Blend: today's earlier hours not kept, the earlier blend will not read: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}

async function main() {
  const root = option("root", "public");
  const out = option("out", join(root, SPOT_BLEND_PATH));
  const catalogue = option("spots", join(root, "riding-locations.json"));
  // The blend this one replaces: the bucket's, which fetch_blend.py reads into
  // the scratch root and names here, or else the one at `--out`, or under the
  // root, in a checkout.
  const before = option(
    "previous",
    existsSync(out) ? out : join(root, SPOT_BLEND_PATH),
  );
  const { manifests, missing, refused } = await readWindRuns(root);
  // Named before anything else can fail, so a job that ends with nothing to
  // blend still says which pointers it could not use.
  for (const { id, reason } of refused)
    console.log(`Blend: left out ${id}, whose pointer will not validate: ${reason}`);
  if (!manifests.length)
    throw new Error(`No usable wind manifests under ${root}: nothing to blend.`);
  const previous = await previousBlend(before);
  const { blend: today, carried } = carryToday(
    buildSpotBlend(manifests),
    previous,
  );
  const { places, unplaced, blend } = await placed(today, "spotBlend", catalogue);
  if (!Object.keys(blend.spotBlend).length)
    throw new Error("No blended place is in the catalogue: nothing to publish.");
  const { pointer, base, files } = publishRun(
    blend,
    blendPrefix(blend),
    [],
    places,
  ) as { pointer: object; base: string; files: [string, Buffer][] };
  // What the site will read back, checked before anything is written.
  const checked = parseSpotBlend(JSON.parse(JSON.stringify(pointer)));
  await writeRun(out, files, pointer, base);
  const bytes = files.reduce((sum, [, data]) => sum + data.length, 0);
  console.log(
    `Blend ${blend.run}: ${manifests.map((m) => `${m.model} ${m.run}`).join(", ")}; ` +
      `${Object.keys(blend.spotBlend).length} places in ${checked.spots.squares.length} squares, ` +
      `${blend.times.length} times, ${Math.round(bytes / 1024)} kB in ${base}` +
      (carried.length
        ? `. Kept ${carried.length} of today's earlier times from ${previous!.run}: ` +
          `${carried[0]} to ${carried[carried.length - 1]}`
        : "") +
      (missing.length ? `. Not published, left out: ${missing.join(", ")}` : "") +
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
    `Blend failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
