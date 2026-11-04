/**
 * What the two blend jobs share (./build.ts for the wind, ./waves.ts for the
 * waves): their options, the riding-place catalogue that places each spot in
 * its square, and writing a run directory and then its pointer.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
// @ts-expect-error -- scripts/runs.mjs has no declaration file.
import { jsonText, retire } from "../../scripts/runs.mjs";

export function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

export interface Place {
  id: string;
  lat: number;
  lon: number;
}

/** The catalogue, and the run without any place under `key` it does not place. */
export async function placed<
  K extends string,
  R extends Record<K, Record<string, unknown>>,
>(
  run: R,
  key: K,
  catalogue: string,
): Promise<{ places: Place[]; unplaced: string[]; blend: R }> {
  const places = (
    JSON.parse(await readFile(catalogue, "utf8")) as Place[]
  ).filter(
    (place) =>
      typeof place?.id === "string" &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lon),
  );
  if (!places.length) throw new Error(`${catalogue} lists no riding places.`);
  const known = new Set(places.map((place) => place.id));
  const unplaced = Object.keys(run[key]).filter((id) => !known.has(id));
  const kept = Object.fromEntries(
    Object.entries(run[key]).filter(([id]) => known.has(id)),
  );
  return { places, unplaced, blend: { ...run, [key]: kept } };
}

/**
 * Write the run directory and then the pointer: the directory under a staging
 * name and renamed whole, so a reader never sees half of it, and the pointer
 * last, so it never names a directory that is not all there. A directory of
 * the same name is the same content, published before, and is kept.
 */
export async function writeRun(
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
  // The run directory this pointer replaces stays for readers still holding the
  // old pointer; naming it here is what tells the pruners so (rundir.write_run).
  const previous = await readFile(out, "utf8")
    .then((body) => JSON.parse(body) as unknown)
    .catch(() => null);
  const retired = retire(previous, pointer as { base: string });
  const written = retired.length
    ? { ...pointer, superseded: retired }
    : pointer;
  await writeFile(`${out}.tmp`, jsonText(written));
  await rename(`${out}.tmp`, out);
}
