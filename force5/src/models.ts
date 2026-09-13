import { loadFrame, nearestFrame, validateManifest } from "./weather";
import { forecastUrl } from "./urls";

export const MODELS = [
  {
    id: "harmonie",
    name: "HARMONIE",
    detail: "2 km",
    manifestUrl: "weather/harmonie.json",
  },
  {
    id: "icon-eu",
    name: "ICON-EU",
    detail: "6.5 km",
    manifestUrl: "weather/latest.json",
  },
  {
    id: "ecmwf",
    name: "ECMWF",
    detail: "15 days",
    manifestUrl: "weather/ecmwf.json",
  },
] as const;
export type ModelId = (typeof MODELS)[number]["id"];

/** Load and validate a complete display transaction before replacing the old model. */
export async function loadModel(
  id: ModelId,
  validTime: string,
  signal: AbortSignal,
) {
  const model = MODELS.find((m) => m.id === id)!;
  const response = await fetch(forecastUrl(model.manifestUrl), {
    cache: "no-cache",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
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
