// Model registry and manifest cache. The registry describes every model the
// product knows about, including ones whose ingest adapter is still planned, so
// the dock can list them greyed out instead of hiding future work.
import { forecastUrl } from "./urls";
import { validateWaveManifest, type WaveManifest } from "./waves";
import { validateManifest, type Manifest } from "./weather";

export interface ModelHues {
  /** Line/ribbon colour for wind speed. */
  wind: string;
  /** Warm companion colour for the same model's gusts. */
  gust: string;
}
export interface ModelEntry {
  id: string;
  name: string;
  detail: string;
  manifestUrl: string;
  kind: "wind" | "wave";
  /** Publishes per-member spot series. */
  ensemble?: boolean;
  hue: ModelHues;
  /** Has map frames worth drawing as a raster layer. */
  mapCapable: boolean;
  /** No adapter publishes this yet; show it, do not fetch it. */
  planned?: boolean;
}

// Hues are provisional: a design ruling on model identity colours is pending.
export const MODEL_CATALOG: readonly ModelEntry[] = [
  {
    id: "harmonie",
    name: "HARMONIE",
    detail: "2 km",
    manifestUrl: "weather/harmonie.json",
    kind: "wind",
    hue: { wind: "#1a9e8a", gust: "#e9a23b" },
    mapCapable: true,
  },
  {
    id: "icon-eu",
    name: "ICON-EU",
    detail: "6.5 km",
    manifestUrl: "weather/latest.json",
    kind: "wind",
    hue: { wind: "#3f6fd8", gust: "#e5672f" },
    mapCapable: true,
  },
  {
    id: "ecmwf",
    name: "ECMWF",
    detail: "15 days",
    manifestUrl: "weather/ecmwf.json",
    kind: "wind",
    hue: { wind: "#8a4bc9", gust: "#d23a6a" },
    mapCapable: true,
  },
  {
    id: "gfs",
    name: "GFS",
    detail: "0.25° · 16 days",
    manifestUrl: "weather/gfs.json",
    kind: "wind",
    hue: { wind: "#2c8f6f", gust: "#d98a2b" },
    mapCapable: true,
  },
  {
    id: "ecmwf-ens",
    name: "ECMWF ENS",
    detail: "51 members",
    manifestUrl: "weather/ecmwf-ens.json",
    kind: "wind",
    ensemble: true,
    hue: { wind: "#6e5bd6", gust: "#c9497c" },
    mapCapable: false,
  },
  {
    id: "harmonie-eps",
    name: "HARMONIE EPS",
    detail: "2 km members",
    manifestUrl: "weather/harmonie-eps.json",
    kind: "wind",
    ensemble: true,
    hue: { wind: "#31bfa6", gust: "#f0b44f" },
    mapCapable: false,
    planned: true,
  },
  {
    id: "gefs",
    name: "GEFS",
    detail: "31 members",
    manifestUrl: "weather/gefs.json",
    kind: "wind",
    ensemble: true,
    hue: { wind: "#4aa3b8", gust: "#e07b3a" },
    mapCapable: true,
  },
  {
    id: "arpege",
    name: "ARPEGE",
    detail: "0.1°",
    manifestUrl: "weather/arpege.json",
    kind: "wind",
    hue: { wind: "#2f7fb5", gust: "#e28a3d" },
    mapCapable: true,
    planned: true,
  },
  {
    id: "arome",
    name: "AROME",
    detail: "2.5 km",
    manifestUrl: "weather/arome.json",
    kind: "wind",
    hue: { wind: "#16a3d0", gust: "#e2703c" },
    mapCapable: true,
    planned: true,
  },
  {
    id: "icon",
    name: "ICON global",
    detail: "13 km",
    manifestUrl: "weather/icon.json",
    kind: "wind",
    hue: { wind: "#7b93f5", gust: "#e5842f" },
    mapCapable: true,
    planned: true,
  },
  {
    id: "ukv",
    name: "UKV",
    detail: "2 km",
    manifestUrl: "weather/ukv.json",
    kind: "wind",
    hue: { wind: "#5b6f8f", gust: "#d98f3a" },
    mapCapable: true,
    planned: true,
  },
  {
    id: "aifs",
    name: "AIFS",
    detail: "0.25° · 15 days",
    manifestUrl: "weather/aifs.json",
    kind: "wind",
    hue: { wind: "#a05fd6", gust: "#d4653f" },
    mapCapable: true,
  },
  {
    id: "gfs-wave",
    name: "GFS-Wave",
    detail: "9 km",
    manifestUrl: "weather/gfs-wave.json",
    kind: "wave",
    hue: { wind: "#1f6f8b", gust: "#cf7d2f" },
    mapCapable: true,
  },
  {
    id: "mi-swan",
    name: "MI SWAN",
    detail: "Irish shelf",
    manifestUrl: "weather/mi-swan.json",
    kind: "wave",
    hue: { wind: "#2a7f62", gust: "#cf8a2f" },
    mapCapable: true,
  },
  {
    id: "ecmwf-wave",
    name: "ECMWF Wave",
    detail: "0.25° · 15 days",
    manifestUrl: "weather/ecmwf-wave.json",
    kind: "wave",
    hue: { wind: "#4a5bc0", gust: "#c96f33" },
    mapCapable: true,
  },
];

export const modelEntry = (id: string): ModelEntry | undefined =>
  MODEL_CATALOG.find((entry) => entry.id === id);
export function requireModel(id: string): ModelEntry {
  const entry = modelEntry(id);
  if (!entry) throw new Error(`Unknown forecast model ${id}.`);
  return entry;
}
export const liveModels = () => MODEL_CATALOG.filter((m) => !m.planned);
export const windModels = () =>
  MODEL_CATALOG.filter((m) => m.kind === "wind" && !m.planned);
export const waveModels = () =>
  MODEL_CATALOG.filter((m) => m.kind === "wave" && !m.planned);
export const modelHue = (id: string) =>
  modelEntry(id)?.hue ?? { wind: "#7d8b91", gust: "#b9a06a" };

/** A manifest we could not fetch: missing (404) is a normal state, not a fault. */
export class ManifestUnavailableError extends Error {
  constructor(
    readonly id: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ManifestUnavailableError";
  }
}

/**
 * Either contract. The catalogue entry's `kind` says which one a URL holds, so
 * the cache is shared and only the validator differs; `loadManifest` and
 * `loadWaveManifest` are the two typed doors onto it.
 */
export type AnyManifest = Manifest | WaveManifest;
export const isWaveManifest = (
  manifest: AnyManifest,
): manifest is WaveManifest => manifest.kind === "wave";

export const MANIFEST_REVALIDATE_MS = 5 * 60 * 1000;
const cached = new Map<
  string,
  { url: string; at: number; manifest: AnyManifest }
>();
const inflight = new Map<string, Promise<AnyManifest>>();

/** Reject as soon as the caller aborts without cancelling a shared request. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function fetchManifest(
  entry: ModelEntry,
  url: string,
): Promise<AnyManifest> {
  const response = await fetch(url, {
    cache: "no-cache",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new ManifestUnavailableError(
      entry.id,
      response.status,
      `${entry.name} forecast is unavailable. Your previous model is still shown.`,
    );
  const body = await response.json();
  // The registry, not the file, decides which contract to hold it to: a wind
  // URL that suddenly answers with a wave bundle is a fault, not a conversion.
  const manifest =
    entry.kind === "wave"
      ? validateWaveManifest(body as WaveManifest)
      : validateManifest(body);
  if (manifest.model !== entry.id)
    throw new Error("The forecast source does not match the requested model.");
  cached.set(entry.id, { url, at: Date.now(), manifest });
  return manifest;
}

/**
 * Validated manifest for one model, whichever contract it follows, deduped
 * while in flight and cached per id against its URL; a cache entry older than
 * five minutes is refetched.
 */
export function loadAnyManifest(
  id: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<AnyManifest> {
  const entry = requireModel(id);
  const url = forecastUrl(entry.manifestUrl);
  const hit = cached.get(id);
  if (hit && hit.url === url && now - hit.at < MANIFEST_REVALIDATE_MS)
    return abortable(Promise.resolve(hit.manifest), signal);
  const shared =
    inflight.get(url) ??
    fetchManifest(entry, url).finally(() => inflight.delete(url));
  inflight.set(url, shared);
  return abortable(shared, signal);
}

/**
 * The wind manifest for one model. Asking a wave model for one is a programming
 * error, not a data error, so it rejects rather than widening every wind call
 * site's type.
 */
export async function loadManifest(
  id: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<Manifest> {
  const manifest = await loadAnyManifest(id, signal, now);
  if (isWaveManifest(manifest))
    throw new Error(
      `${requireModel(id).name} is a wave model, not a wind model.`,
    );
  return manifest;
}

/** The wave manifest for one model, through the same cache. */
export async function loadWaveManifest(
  id: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<WaveManifest> {
  const manifest = await loadAnyManifest(id, signal, now);
  if (!isWaveManifest(manifest))
    throw new Error(
      `${requireModel(id).name} is a wind model, not a wave model.`,
    );
  return manifest;
}

export function clearManifestCache(id?: string): void {
  if (id === undefined) cached.clear();
  else cached.delete(id);
}

export interface ModelAvailability {
  id: string;
  entry: ModelEntry;
  manifest: AnyManifest | null;
  /** The same manifest narrowed by contract, so callers need no cast. */
  wind: Manifest | null;
  wave: WaveManifest | null;
  available: boolean;
  /** Why it is unavailable, for a tooltip; never thrown at the caller. */
  error: string | null;
}

/**
 * Try every non-planned manifest at once, wind and wave alike. A missing model
 * is not an error: `mi-swan.json` is git-ignored, so a fresh checkout simply
 * has one wave source instead of two.
 */
export function availableModels(
  signal?: AbortSignal,
  models: readonly ModelEntry[] = liveModels(),
): Promise<ModelAvailability[]> {
  return Promise.all(
    models.map(async (entry): Promise<ModelAvailability> => {
      try {
        const manifest = await loadAnyManifest(entry.id, signal);
        const wave = isWaveManifest(manifest);
        return {
          id: entry.id,
          entry,
          manifest,
          wind: wave ? null : manifest,
          wave: wave ? manifest : null,
          available: true,
          error: null,
        };
      } catch (error) {
        return {
          id: entry.id,
          entry,
          manifest: null,
          wind: null,
          wave: null,
          available: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
