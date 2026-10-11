import { nearestFrame } from "./weather";
import { loadFrame } from "./tiledField";
import { loadManifest, requireModel, type ModelEntry } from "./manifests";

/** Models the map itself can show today; the full registry is MODEL_CATALOG. */
export const MAP_MODEL_IDS = ["harmonie", "icon-eu", "ecmwf", "gfs"] as const;
export type ModelId = (typeof MAP_MODEL_IDS)[number];
const mapModel = <T extends ModelId>(id: T) => ({ ...requireModel(id), id });
export const MODELS: readonly (ModelEntry & { id: ModelId })[] =
  MAP_MODEL_IDS.map(mapModel);

/** Load and validate a complete display transaction before replacing the old model. */
export async function loadModel(
  id: ModelId,
  validTime: string,
  signal: AbortSignal,
) {
  const manifest = await loadManifest(id, signal);
  const index = nearestFrame(manifest.frames, Date.parse(validTime));
  const frame = await loadFrame(manifest, index);
  signal.throwIfAborted();
  return { manifest, index, frame };
}
