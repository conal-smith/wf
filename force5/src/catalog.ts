// The model registry: every model the product knows about, including ones whose
// ingest adapter is still planned, so the dock can list them greyed out instead
// of hiding future work. Plain data with no imports, so weather.ts can find a
// manifest's own published path (and so resolve its run directory) without
// importing the manifest cache that imports it. manifests.ts re-exports all of
// it.

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
   * Switched off, to save downloads or as not useful: its job no longer runs, so
   * the site neither fetches nor lists it. The adapter stays, and clearing this brings it back.
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
    retired: true,
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
