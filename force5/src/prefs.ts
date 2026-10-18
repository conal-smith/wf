// Display preferences for the forecast dock. Persistence is best effort:
// private browsing, blocked storage and quota errors must never break the page.
import { isUnits, type Units } from "./units";
import { windModels } from "./manifests";
import {
  DEFAULT_RIDER,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  SKILLS,
  parseCustomRating,
  type CustomRating,
  type Rider,
} from "./stars";

export type RowKey =
  | "stars"
  | "wing"
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
  /** Who the stars are rated for: weight, level, the wings they own, and their own star rating. */
  rider: Rider;
  /**
   * When the rider last set or reset their own star rating on this device,
   * ISO; null if never. A signed-in rider's device and account copies are
   * compared on it, the newer winning (shared/web/riderSync.ts).
   */
  starsUpdatedAt: string | null;
  /** The account this device's star rating was last matched with; null if none. */
  starsAccount: string | null;
}

export const ROW_KEYS: readonly RowKey[] = [
  "stars",
  "wing",
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
    stars: true,
    wing: false,
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
  rider: DEFAULT_RIDER,
  starsUpdatedAt: null,
  starsAccount: null,
});

/**
 * The rider's own star rating set, or reset with null, and stamped now: the
 * one way a device changes it, so the stamp the account compares is always
 * the moment of the change.
 */
export function withCustomStars(
  prefs: Prefs,
  custom: CustomRating | null,
  now: Date = new Date(),
): Prefs {
  const { custom: _old, ...rider } = prefs.rider;
  return {
    ...prefs,
    rider: custom ? { ...rider, custom } : rider,
    starsUpdatedAt: now.toISOString(),
  };
}

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

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

/**
 * A stored rider, field by field: a weight or a wing outside what a person or a
 * wing can be is dropped rather than rated, and a missing weight stays missing so
 * the dock can say the stars assume the estimate. A custom star rating goes
 * through its own validation (stars.ts `parseCustomRating`); one that does not
 * pass, or was stored in another version, is left out and the level rates.
 */
export function parseRider(value: unknown): Rider {
  if (!value || typeof value !== "object") return DEFAULT_RIDER;
  const raw = value as Record<string, unknown>;
  const weight = raw.weightKg;
  const wings = Array.isArray(raw.wings) ? raw.wings : [];
  return {
    weightKg:
      typeof weight === "number" &&
      weight >= MIN_WEIGHT_KG &&
      weight <= MAX_WEIGHT_KG
        ? Math.round(weight)
        : null,
    skill: SKILLS.includes(raw.skill as Rider["skill"])
      ? (raw.skill as Rider["skill"])
      : DEFAULT_RIDER.skill,
    wings: [
      ...new Set(
        wings.filter(
          (size): size is number =>
            typeof size === "number" &&
            size >= MIN_WING_M2 &&
            size <= MAX_WING_M2,
        ),
      ),
    ].sort((a, b) => a - b),
    ...withCustom(parseCustomRating(raw.custom)),
  };
}

/** A rider carries `custom` only when there is one, so a standard rider stays as it always was. */
const withCustom = (custom: Rider["custom"]) => (custom ? { custom } : {});

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
    const stored = JSON.parse(raw) as Partial<Prefs> & {
      blendKnown?: unknown;
    };
    if (!stored || typeof stored !== "object") return defaults;
    // The models there were to choose from when the list was saved. One that
    // has been published since is not one the reader left out: it joins the
    // blend as it would for anyone else. A list saved before this was recorded
    // is taken as it stands.
    const known = Array.isArray(stored.blendKnown)
      ? new Set(stored.blendKnown.filter((id) => typeof id === "string"))
      : null;
    const added = known
      ? defaults.blendModels.filter((id) => !known.has(id))
      : [];
    return {
      rows: mergeRows(stored.rows, defaults.rows),
      touchedRows: Array.isArray(stored.touchedRows)
        ? ROW_KEYS.filter((key) => stored.touchedRows!.includes(key))
        : defaults.touchedRows,
      units: isUnits(stored.units) ? stored.units : defaults.units,
      blendModels:
        Array.isArray(stored.blendModels) &&
        stored.blendModels.every((id) => typeof id === "string")
          ? [...new Set([...stored.blendModels, ...added])]
          : defaults.blendModels,
      view:
        stored.view && VIEWS.includes(stored.view)
          ? stored.view
          : defaults.view,
      rider: parseRider(stored.rider),
      starsUpdatedAt: isoOrNull(stored.starsUpdatedAt),
      starsAccount:
        typeof stored.starsAccount === "string" ? stored.starsAccount : null,
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
    storage?.setItem(
      PREFS_KEY,
      JSON.stringify({
        ...prefs,
        blendKnown: windModels().map((model) => model.id),
      }),
    );
    return storage !== null;
  } catch {
    return false;
  }
}

/**
 * A change of weight, level or wings, saved over what is stored now, so a
 * change made in another tab or adopted from the account is not undone. The
 * rider's own star rating is the stored one: it changes only through
 * `withCustomStars`.
 */
export function saveRider(
  rider: Rider,
  storage: PrefsStorage | null = browserStorage(),
): Prefs {
  const stored = loadPrefs(storage);
  const { custom: _ignored, ...fields } = rider;
  const next: Prefs = {
    ...stored,
    rider: stored.rider.custom
      ? { ...fields, custom: stored.rider.custom }
      : fields,
  };
  savePrefs(next, storage);
  return next;
}
