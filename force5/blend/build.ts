/**
 * Work out the blend every riding place's stars are rated from
 * (src/spotBlend.ts) and publish it beside the manifests it was read from.
 *
 *   npx tsx force5/blend/build.ts [--root public] [--out public/weather/blend.json]
 *                                 [--spots <root>/riding-locations.json]
 *
 * It reads every live wind model's pointer manifest under `--root`, at the
 * path the site reads it from (force5/src/manifests.ts), and every spot square
 * of the run it names, through the site's own loader (force5/src/spotData.ts).
 * Locally that is `public/`, and in the forecast image the directory
 * force5/ingest/fetch_blend.py has just filled from the bucket. A model with no
 * manifest is left out and named; with none at all there is nothing to blend
 * and it fails.
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
 * In the image it runs as one bundled file (force5/Dockerfile), so it imports
 * the site's own blend rather than a second copy of it.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
// The run layout the sample generator writes too; plain JavaScript, so it
// carries no types of its own.
// @ts-expect-error -- scripts/runs.mjs has no declaration file.
import { publishRun } from "../../scripts/runs.mjs";
import { windModels } from "../src/manifests";
import { withSpotSquares, type ReadJson } from "../src/spotData";
import {
  validateManifest,
  validateWindSpots,
  type Manifest,
} from "../src/weather";
import {
  blendPrefix,
  buildSpotBlend,
  parseSpotBlend,
  SPOT_BLEND_PATH,
  type BlendRun,
} from "../../src/spotBlend";

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

interface Place {
  id: string;
  lat: number;
  lon: number;
}

/** The catalogue, and the blend without any place it does not place. */
async function placed(blend: BlendRun, catalogue: string) {
  const places = (JSON.parse(await readFile(catalogue, "utf8")) as Place[]).filter(
    (place) =>
      typeof place?.id === "string" &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lon),
  );
  if (!places.length) throw new Error(`${catalogue} lists no riding places.`);
  const known = new Set(places.map((place) => place.id));
  const unplaced = Object.keys(blend.spotBlend).filter((id) => !known.has(id));
  const spotBlend = Object.fromEntries(
    Object.entries(blend.spotBlend).filter(([id]) => known.has(id)),
  );
  return { places, unplaced, blend: { ...blend, spotBlend } };
}

/**
 * Write the run directory and then the pointer: the directory under a staging
 * name and renamed whole, so a reader never sees half of it, and the pointer
 * last, so it never names a directory that is not all there. A directory of
 * the same name is the same content, published before, and is kept.
 */
async function writeRun(
  out: string,
  files: [string, Buffer][],
  pointer: object,
  base: string,
) {
  const weather = dirname(out);
  const final = join(weather, base.slice(0, -1));
  if (!existsSync(final)) {
    const staging = `${final}.tmp-${process.pid}`;
    await rm(staging, { recursive: true, force: true });
    for (const [path, bytes] of files) {
      // `weather/<base><path inside>`, as the publisher names a file.
      const inside = path.slice(`weather/${base}`.length);
      const target = join(staging, inside);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await rename(staging, final);
  }
  await mkdir(weather, { recursive: true });
  await writeFile(`${out}.tmp`, JSON.stringify(pointer));
  await rename(`${out}.tmp`, out);
}

async function main() {
  const root = option("root", "public");
  const out = option("out", join(root, SPOT_BLEND_PATH));
  const catalogue = option("spots", join(root, "riding-locations.json"));
  const manifests: Manifest[] = [];
  const missing: string[] = [];
  const read: ReadJson = async (path) =>
    JSON.parse(await readFile(join(root, path), "utf8"));
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
    // Every place, so every square the run lists.
    manifests.push(
      validateWindSpots(
        await withSpotSquares<Manifest, Manifest>(read, entry.manifestUrl, manifest),
      ),
    );
  }
  if (!manifests.length)
    throw new Error(`No wind manifests under ${root}: nothing to blend.`);
  const { places, unplaced, blend } = await placed(
    buildSpotBlend(manifests),
    catalogue,
  );
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
      (missing.length ? `. Not published, left out: ${missing.join(", ")}` : "") +
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
