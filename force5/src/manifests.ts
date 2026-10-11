// The manifest cache, and the model registry (catalog.ts) re-exported beside it.
// The registry describes every model the product knows about, including ones
// whose ingest adapter is still planned, so the dock can list them greyed out
// instead of hiding future work.
import { takeEarly } from "./boot";
import { liveModels, requireModel, type ModelEntry } from "./catalog";
import { loadSpotSquares, type ReadJson } from "./spotData";
import { forecastUrl } from "./urls";
import {
  validateWeatherManifest,
  validateWeatherSpots,
  type WeatherManifest,
} from "./surface";
import {
  validateWaveManifest,
  validateWaveSpots,
  type WaveManifest,
} from "./waves";
import {
  manifestPath,
  validateManifest,
  validateWindSpots,
  type Manifest,
} from "./weather";

export {
  MODEL_CATALOG,
  liveModels,
  modelEntry,
  modelHue,
  requireModel,
  waveModels,
  weatherModels,
  windModels,
} from "./catalog";
export type { ModelEntry, ModelHues } from "./catalog";

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
 * Any contract. The catalogue entry's `kind` says which one a URL holds, so the
 * cache is shared and only the validator differs; `loadManifest`,
 * `loadWaveManifest` and `loadWeatherManifest` are the typed doors onto it.
 */
export type AnyManifest = Manifest | WaveManifest | WeatherManifest;
export const isWaveManifest = (
  manifest: AnyManifest,
): manifest is WaveManifest => manifest.kind === "wave";
export const isWeatherManifest = (
  manifest: AnyManifest,
): manifest is WeatherManifest => manifest.kind === "weather";

export const MANIFEST_REVALIDATE_MS = 5 * 60 * 1000;
const cached = new Map<
  string,
  {
    url: string;
    at: number;
    manifest: AnyManifest;
    /** The validator the response came with: its ETag, or its Last-Modified. */
    tag: string | null;
  }
>();
const inflight = new Map<string, Promise<AnyManifest>>();

/** Reject as soon as the caller aborts without cancelling a shared request. */
export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
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
  // The map's own model may already be on its way, asked for by the boot
  // script in index.html before this bundle had even loaded.
  const response = await (takeEarly(url) ??
    fetch(url, {
      cache: "no-cache",
      signal: AbortSignal.timeout(20000),
    }));
  if (!response.ok)
    throw new ManifestUnavailableError(
      entry.id,
      response.status,
      `${entry.name} forecast is unavailable. Your previous model is still shown.`,
    );
  // A revalidation that found nothing new. The body is the same bytes as last
  // time, so they are neither read nor parsed nor validated again: for all
  // thirteen manifests that is about 18 MB of JSON on the main thread every
  // five minutes, for nothing.
  const tag =
    response.headers.get("etag") ?? response.headers.get("last-modified");
  const known = cached.get(entry.id);
  if (tag && known && known.url === url && known.tag === tag) {
    void response.body?.cancel().catch(() => {});
    known.at = Date.now();
    return known.manifest;
  }
  const body = await response.json();
  // The registry, not the file, decides which contract to hold it to: a wind
  // URL that suddenly answers with a wave bundle is a fault, not a conversion.
  const manifest =
    entry.kind === "wave"
      ? validateWaveManifest(body as WaveManifest)
      : entry.kind === "weather"
        ? validateWeatherManifest(body as WeatherManifest)
        : validateManifest(body);
  if (manifest.model !== entry.id)
    throw new Error("The forecast source does not match the requested model.");
  cached.set(entry.id, { url, at: Date.now(), manifest, tag });
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

/** Asking for the wrong contract is a programming error, named as such. */
const wrongKind = (id: string, wanted: ModelEntry["kind"]): never => {
  const entry = requireModel(id);
  throw new Error(
    `${entry.name} is a ${entry.kind} model, not a ${wanted} model.`,
  );
};

/**
 * The wind manifest for one model. Asking a wave or weather model for one is a
 * programming error, not a data error, so it rejects rather than widening every
 * wind call site's type.
 */
export async function loadManifest(
  id: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<Manifest> {
  const manifest = await loadAnyManifest(id, signal, now);
  if (isWaveManifest(manifest) || isWeatherManifest(manifest))
    return wrongKind(id, "wind");
  return manifest;
}

/** The wave manifest for one model, through the same cache. */
export async function loadWaveManifest(
  id: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<WaveManifest> {
  const manifest = await loadAnyManifest(id, signal, now);
  if (!isWaveManifest(manifest)) return wrongKind(id, "wave");
  return manifest;
}

/** The surface-weather manifest for one model, through the same cache. */
export async function loadWeatherManifest(
  id: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<WeatherManifest> {
  const manifest = await loadAnyManifest(id, signal, now);
  if (!isWeatherManifest(manifest)) return wrongKind(id, "weather");
  return manifest;
}

/**
 * Ask again next time, past the five minutes, but keep what was read: if the
 * server says the file has not changed, the copy in hand is still the answer
 * and nothing is parsed.
 */
export function expireManifest(id: string): void {
  const hit = cached.get(id);
  if (hit) hit.at = Number.NEGATIVE_INFINITY;
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
  weather: WeatherManifest | null;
  available: boolean;
  /** Why it is unavailable, for a tooltip; never thrown at the caller. */
  error: string | null;
}

/**
 * Try every non-planned manifest at once, wind, wave and weather alike. A
 * missing model is not an error: `mi-swan.json` is git-ignored, so a fresh
 * checkout simply has one wave source instead of two.
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
        const weather = isWeatherManifest(manifest);
        return {
          id: entry.id,
          entry,
          manifest,
          wind: wave || weather ? null : manifest,
          wave: wave ? manifest : null,
          weather: weather ? manifest : null,
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
          weather: null,
          available: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

/**
 * One published JSON file, read in the browser by its path from the site root.
 * The one `ReadJson` the site gives the spot loader (spotData.ts), so its cache
 * is shared by every reader on the page. A run's files are immutable — the run
 * directory is named for its content — so the HTTP cache may keep them too.
 */
export const readForecastJson: ReadJson = async (path) => {
  const response = await fetch(forecastUrl(path), {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`Forecast data ${path} answered ${response.status}.`);
  return response.json();
};

/** Each manifest's spot data per set of squares, read and checked once. */
const withSquares = new WeakMap<object, Map<string, Promise<AnyManifest>>>();

/**
 * A manifest with the spot data of `squares` merged in — every square the run
 * lists when `squares` is omitted — and checked by its kind, as the whole
 * manifest used to be checked when it carried every spot itself. The squares
 * come through the shared loader, so a square two readers want is read once.
 */
export function loadSpots<M extends AnyManifest>(
  manifest: M,
  squares?: readonly string[],
): Promise<M> {
  const key = squares === undefined ? "*" : [...squares].sort().join(",");
  let byManifest = withSquares.get(manifest);
  if (!byManifest) withSquares.set(manifest, (byManifest = new Map()));
  const hit = byManifest.get(key);
  if (hit) return hit as Promise<M>;
  const loading = loadSpotSquares(
    readForecastJson,
    manifestPath(manifest),
    manifest,
    squares,
  ).then((data) => {
    const whole = { ...manifest, ...data } as AnyManifest;
    return (
      isWaveManifest(whole)
        ? validateWaveSpots(whole)
        : isWeatherManifest(whole)
          ? validateWeatherSpots(whole)
          : validateWindSpots(whole)
    ) as M;
  });
  const kept = byManifest;
  kept.set(key, loading);
  loading.catch(() => {
    if (kept.get(key) === loading) kept.delete(key);
  });
  return loading;
}

/**
 * The same models with the spot data of `squares` merged into each manifest
 * (every listed square when omitted). A model whose squares cannot be read is
 * reported unavailable, as one whose manifest could not be read is, and never
 * fails the others.
 */
export function withSpots(
  models: readonly ModelAvailability[],
  squares?: readonly string[],
): Promise<ModelAvailability[]> {
  return Promise.all(
    models.map(async (model): Promise<ModelAvailability> => {
      if (!model.manifest) return model;
      try {
        const manifest = await loadSpots(model.manifest, squares);
        return {
          ...model,
          manifest,
          wind: model.wind ? (manifest as Manifest) : null,
          wave: model.wave ? (manifest as WaveManifest) : null,
          weather: model.weather ? (manifest as WeatherManifest) : null,
        };
      } catch (error) {
        return {
          ...model,
          manifest: null,
          wind: null,
          wave: null,
          weather: null,
          available: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
