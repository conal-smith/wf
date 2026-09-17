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
  | "weather"
  | "air"
  | "rain"
  | "cloud"
  | "pressure"
  | "sea"
  | "tide";
export type ForecastView = "table" | "blend" | "candles";

export interface Prefs {
  rows: Record<RowKey, boolean>;
  /**
   * Rows the reader has switched by hand. Everything else follows its default,
   * and a default may depend on what the spot actually has rather than on a
   * fixed boolean: the Sea row is on where a station is reporting and off where
   * none is. Once a row is listed here its stored boolean wins for good, so a
   * reader who turned it off never has it come back at the next spot.
   */
  touchedRows: RowKey[];
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
  "weather",
  "air",
  "rain",
  "cloud",
  "pressure",
  "sea",
  "tide",
];
export const VIEWS: readonly ForecastView[] = ["table", "blend", "candles"];
export const PREFS_KEY = "force5.prefs.v1";

/**
 * Per-model wind and gust rows start off: the blend replaces them by default.
 * So do the wave partitions and the chart's wave band: the total sea is the
 * reading a rider wants, and the partitions are for the days it matters.
 *
 * Of the surface-weather rows, the three a rider decides with are on — is it
 * warm, is it raining, and what is the sky doing. Cloud cover is the detail
 * behind the present weather and pressure is a synoptic reading, so both start
 * off.
 *
 * The sea row's boolean here is only its fallback: it is decided by
 * availability through `rowOn`, on where an observation covers the spot and off
 * where the row would be the model's own skin temperature instead.
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
    weather: true,
    air: true,
    rain: false,
    cloud: false,
    pressure: false,
    sea: false,
    tide: true,
  },
  touchedRows: [],
  units: "kn",
  blendModels: windModels().map((model) => model.id),
  view: "blend",
});

/**
 * Whether a row is shown. `available` is the default-by-availability answer for
 * the rows that have one — pass it as undefined for a row whose default is just
 * its stored boolean. An untouched row follows availability; a touched one is
 * the reader's own choice and is never overridden.
 */
export function rowOn(prefs: Prefs, key: RowKey, available?: boolean): boolean {
  if (available === undefined || prefs.touchedRows.includes(key))
    return prefs.rows[key];
  return available;
}

/** Switch a row by hand, which also takes it out of availability's hands. */
export function setRow(prefs: Prefs, key: RowKey, on: boolean): Prefs {
  return {
    ...prefs,
    rows: { ...prefs.rows, [key]: on },
    touchedRows: prefs.touchedRows.includes(key)
      ? prefs.touchedRows
      : [...prefs.touchedRows, key],
  };
}

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
      touchedRows: Array.isArray(stored.touchedRows)
        ? ROW_KEYS.filter((key) => stored.touchedRows!.includes(key))
        : defaults.touchedRows,
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
