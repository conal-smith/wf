import { loadFrame, nearestFrame, validateManifest } from "./weather";

export const MODELS = [
  { id: "icon-eu", name: "ICON-EU", manifestUrl: "weather/latest.json" },
  { id: "harmonie", name: "HARMONIE", manifestUrl: "weather/harmonie.json" },
] as const;
export type ModelId = (typeof MODELS)[number]["id"];

/** Load and validate a complete display transaction before replacing the old model. */
export async function loadModel(
  id: ModelId,
  validTime: string,
  signal: AbortSignal,
) {
  const model = MODELS.find((m) => m.id === id)!;
  const response = await fetch(
    `${import.meta.env.BASE_URL}${model.manifestUrl}`,
    {
      cache: "no-cache",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    },
  );
  if (!response.ok)
    throw new Error(
      `${model.name} forecast is unavailable. Your previous model is still shown.`,
    );
  const manifest = validateManifest(await response.json());
  if (manifest.model !== id)
    throw new Error("The forecast source does not match the requested model.");
  const index = nearestFrame(manifest.frames, Date.parse(validTime));
  const frame = await loadFrame(manifest, index);
  signal.throwIfAborted();
  return { manifest, index, frame };
}
