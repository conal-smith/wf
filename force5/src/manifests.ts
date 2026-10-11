// Model registry and manifest cache. The registry describes every model the
// product knows about, including ones whose ingest adapter is still planned, so
// the dock can list them greyed out instead of hiding future work.
import { takeEarly } from "./boot";
import { forecastUrl } from "./urls";
import { validateWeatherManifest, type WeatherManifest } from "./surface";
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
  kind: "wind" | "wave" | "weather";
  /** Publishes per-member spot series. */
  ensemble?: boolean;
  hue: ModelHues;
  /** Has map frames worth drawing as a raster layer. */
  mapCapable: boolean;
  /** No adapter publishes this yet; show it, do not fetch it. */
  planned?: boolean;
  /**
   * Switched off to save downloads: its job no longer runs, so the site neither
   * fetches nor lists it. The adapter stays, and clearing this brings it back.
   */
  retired?: boolean;
}

// Hues are provisional: a design ruling on model identity colours is pending.
// `detail` is what the layers list and the display options print beside a
// name, in one form: the grid in kilometres, then the reach or the members
// where those set a model apart. A grid in degrees is given as the
// kilometres it comes to over Ireland, as near as a reader needs (0.25° is
// some 28 km north to south and 17 km across here; 25 km is the usual
// shorthand), so ECMWF and HARMONIE compare at a glance.
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
    detail: "25 km · 15 days",
    manifestUrl: "weather/ecmwf.json",
    kind: "wind",
    hue: { wind: "#8a4bc9", gust: "#d23a6a" },
    mapCapable: true,
  },
  {
    id: "gfs",
    name: "GFS",
    detail: "25 km · 16 days",
    manifestUrl: "weather/gfs.json",
    kind: "wind",
    hue: { wind: "#2c8f6f", gust: "#d98a2b" },
    mapCapable: true,
  },
  {
    id: "ecmwf-ens",
    name: "ECMWF ENS",
    detail: "25 km · 10 members · from day 3",
    manifestUrl: "weather/ecmwf-ens.json",
    kind: "wind",
    ensemble: true,
    hue: { wind: "#6e5bd6", gust: "#c9497c" },
    mapCapable: false,
    retired: true,
  },
  {
    id: "harmonie-eps",
    name: "HARMONIE EPS",
    detail: "2 km · members",
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
    detail: "25 km · 31 members",
    manifestUrl: "weather/gefs.json",
    kind: "wind",
    ensemble: true,
    hue: { wind: "#4aa3b8", gust: "#e07b3a" },
    mapCapable: true,
    retired: true,
  },
  {
    id: "arpege",
    name: "ARPEGE",
    detail: "11 km",
    manifestUrl: "weather/arpege.json",
    kind: "wind",
    hue: { wind: "#2f7fb5", gust: "#e28a3d" },
    mapCapable: true,
    retired: true,
  },
  {
    id: "arome",
    name: "AROME",
    detail: "2.5 km",
    manifestUrl: "weather/arome.json",
    kind: "wind",
    hue: { wind: "#16a3d0", gust: "#e2703c" },
    mapCapable: true,
    retired: true,
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
    detail: "25 km · 15 days",
    manifestUrl: "weather/aifs.json",
    kind: "wind",
    hue: { wind: "#a05fd6", gust: "#d4653f" },
    mapCapable: true,
    retired: true,
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
    // The surface-weather half of the same DWD run the `icon-eu` wind model
    // reads, as its own bundle with its own cadence. Not map-capable: its frames
    // carry five gridded variables, but nothing draws a temperature raster yet,
    // and the dock reads the precomputed spot series.
    id: "icon-eu-weather",
    name: "ICON-EU weather",
    detail: "6.5 km surface",
    manifestUrl: "weather/icon-eu-weather.json",
    kind: "weather",
    hue: { wind: "#4c86c6", gust: "#dd8b46" },
    mapCapable: false,
  },
  {
    id: "ecmwf-wave",
    name: "ECMWF Wave",
    detail: "25 km · 15 days",
    manifestUrl: "weather/ecmwf-wave.json",
    kind: "wave",
    hue: { wind: "#4a5bc0", gust: "#c96f33" },
    mapCapable: true,
    retired: true,
  },
];

export const modelEntry = (id: string): ModelEntry | undefined =>
  MODEL_CATALOG.find((entry) => entry.id === id);
export function requireModel(id: string): ModelEntry {
  const entry = modelEntry(id);
  if (!entry) throw new Error(`Unknown forecast model ${id}.`);
  return entry;
}
const published = (m: ModelEntry) => !m.planned && !m.retired;
export const liveModels = () => MODEL_CATALOG.filter(published);
export const windModels = () =>
  MODEL_CATALOG.filter((m) => m.kind === "wind" && published(m));
export const waveModels = () =>
  MODEL_CATALOG.filter((m) => m.kind === "wave" && published(m));
export const weatherModels = () =>
  MODEL_CATALOG.filter((m) => m.kind === "weather" && published(m));
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
