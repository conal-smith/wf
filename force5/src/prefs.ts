// Display preferences for the forecast dock. Persistence is best effort:
// private browsing, blocked storage and quota errors must never break the page.
import { isUnits, type Units } from "./units";
import { windModels } from "./manifests";

export type RowKey =
  | "blend"
  | "waveOverlay"
  | "wind"
  | "spread"
  | "gust"
  | "dir"
  | "waves"
  | "swell"
  | "windsea"
  | "sea"
  | "air"
  | "tide";
export type ForecastView = "table" | "blend" | "candles";

export interface Prefs {
  rows: Record<RowKey, boolean>;
  units: Units;
  /** Models feeding the blend, separate from the single map model. */
  blendModels: string[];
  view: ForecastView;
}

export const ROW_KEYS: readonly RowKey[] = [
  "blend",
  "waveOverlay",
  "wind",
  "spread",
  "gust",
  "dir",
  "waves",
  "swell",
  "windsea",
  "sea",
  "air",
  "tide",
];
export const VIEWS: readonly ForecastView[] = ["table", "blend", "candles"];
export const PREFS_KEY = "force5.prefs.v1";

/**
 * Per-model wind and gust rows start off: the blend replaces them by default.
 * So do the wave partitions and the chart's wave band: the total sea is the
 * reading a rider wants, and the partitions are for the days it matters.
 */
export const defaultPrefs = (): Prefs => ({
  rows: {
    blend: true,
    waveOverlay: false,
    wind: false,
    spread: true,
    gust: false,
    dir: false,
    waves: true,
    swell: false,
    windsea: false,
    sea: true,
    air: true,
    tide: true,
  },
  units: "kn",
  blendModels: windModels().map((model) => model.id),
  view: "blend",
});

export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): PrefsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function mergeRows(value: unknown, defaults: Record<RowKey, boolean>) {
  if (!value || typeof value !== "object") return defaults;
  const rows = { ...defaults };
  for (const key of ROW_KEYS) {
    const row = (value as Record<string, unknown>)[key];
    if (typeof row === "boolean") rows[key] = row;
  }
  return rows;
}

/** Stored preferences merged over the defaults; anything invalid is ignored. */
export function loadPrefs(
  storage: PrefsStorage | null = browserStorage(),
): Prefs {
  const defaults = defaultPrefs();
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PREFS_KEY) ?? null;
  } catch {
    return defaults;
  }
  if (!raw) return defaults;
  try {
    const stored = JSON.parse(raw) as Partial<Prefs>;
    if (!stored || typeof stored !== "object") return defaults;
    return {
      rows: mergeRows(stored.rows, defaults.rows),
      units: isUnits(stored.units) ? stored.units : defaults.units,
      blendModels:
        Array.isArray(stored.blendModels) &&
        stored.blendModels.every((id) => typeof id === "string")
          ? [...new Set(stored.blendModels)]
          : defaults.blendModels,
      view:
        stored.view && VIEWS.includes(stored.view)
          ? stored.view
          : defaults.view,
    };
  } catch {
    return defaults;
  }
}

/** Returns whether the write landed, so callers can stay silent about failures. */
export function savePrefs(
  prefs: Prefs,
  storage: PrefsStorage | null = browserStorage(),
): boolean {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
    return storage !== null;
  } catch {
    return false;
  }
}
