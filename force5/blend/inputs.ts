/**
 * The blend's inputs: every live wind model's pointer under a root, at the path
 * the site reads it from, with every spot square of the run it names merged in.
 *
 * A model with no pointer is left out and named (`missing`), and so is one whose
 * pointer will not validate (`refused`): an old version 1 pointer left on a
 * persistent volume from before an upgrade, until that model's next run replaces
 * it, or a pointer for another model. Either way the other models still blend;
 * one model's pointer never fails the job. A pointer that validates but whose
 * squares cannot be read or do not hold together still does: that is a broken
 * run, not one waiting for its next.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { windModels } from "../src/manifests";
import { withSpotSquares, type ReadJson } from "../src/spotData";
import {
  validateManifest,
  validateWindSpots,
  type Manifest,
} from "../src/weather";

export interface WindRuns {
  manifests: Manifest[];
  /** Models with no pointer under the root. */
  missing: string[];
  /** Models whose pointer is there and will not validate, with the reason. */
  refused: { id: string; reason: string }[];
}

export async function readWindRuns(root: string): Promise<WindRuns> {
  const manifests: Manifest[] = [];
  const missing: string[] = [];
  const refused: WindRuns["refused"] = [];
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
    let manifest: Manifest;
    try {
      manifest = validateManifest(JSON.parse(body) as Manifest);
      if (manifest.model !== entry.id)
        throw new Error(`It holds ${manifest.model}, not ${entry.id}.`);
    } catch (error) {
      refused.push({
        id: entry.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    // Every place, so every square the run lists.
    manifests.push(
      validateWindSpots(
        await withSpotSquares<Manifest, Manifest>(read, entry.manifestUrl, manifest),
      ),
    );
  }
  return { manifests, missing, refused };
}
