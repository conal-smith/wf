// Display preferences for the forecast dock. Persistence is best effort:
// private browsing, blocked storage and quota errors must never break the page.
import { isUnits, type Units } from "./units";
import {
  DOWNWIND_DEFAULT,
  UPWIND_DEFAULT,
  clampDownwind,
  clampUpwind,
} from "./rideWedge";
import { parseStarsChoice, withModel, type StarsChoice } from "./lead";
import { modelEntry, windModels } from "./manifests";
import {
  DEFAULT_RIDER,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  isOurs,
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
/**
 * Which hours the dock shows: all of them, round the clock, or only those
 * from first light to last light, civil dawn to civil dusk (force5/src/sun.ts).
 */
export type NightHours = "show" | "hide";
export const NIGHT_HOURS: readonly NightHours[] = ["show", "hide"];

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
  /**
   * Whether the dock shows the hours from last light to first light; "show"
   * unless the reader has hidden them. Shown, they are hatched as dark.
   */
  nightHours: NightHours;
  /**
   * Who the stars are rated for: weight, the wings they own, how far up and
   * down the wind they ride, their own star rating (none while ours rates),
   * and the model the stars come from (stars.ts `Rider`, lead.ts
   * `StarsChoice`).
   */
  rider: Rider;
  /**
   * When the rider last saved their own star rating on this device, or went
   * back to ours, ISO; null if never. A signed-in rider's
   * device and account copies are compared on it, the newer winning
   * (shared/web/riderSync.ts).
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
 * The shape stored under PREFS_KEY, written with it as `version`.
 *   1 (no `version`)  the rider had a level (Learning, Riding, Advanced), and
 *                     `rider.custom` was their own rating, always in use
 *   2                 their own rating could also be kept while a level rated
 *                     (`rider.keptCustom`)
 *   3                 one rating, ours, unless the rider has their own
 *                     (25 October 2026)
 * Before version 3 the rider's own rating and how far into the wind they
 * rode belonged to their level, so they are not read: the rider starts from
 * ours. Their weight, wings and model come over as they are.
 */
export const PREFS_VERSION = 3;

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
  nightHours: "show",
  rider: DEFAULT_RIDER,
  starsUpdatedAt: null,
  starsAccount: null,
});

/**
 * The rider's own star rating saved, and rating from now on; or, with null
 * or ours as it stands, gone, and ours rates. Stamped now: the one way a
 * device changes what the account keeps, so the stamp it compares is always
 * the moment of the change.
 */
export function withCustomStars(
  prefs: Prefs,
  custom: CustomRating | null,
  now: Date = new Date(),
): Prefs {
  const { custom: _old, ...rider } = prefs.rider;
  return stamped(
    {
      ...prefs,
      rider: custom && !isOurs(custom) ? { ...rider, custom } : rider,
    },
    now,
  );
}

const stamped = (prefs: Prefs, now: Date): Prefs => ({
  ...prefs,
  starsUpdatedAt: now.toISOString(),
  // Made on this device: it is whoever is signed in's to keep, and the
  // sync marks it as theirs once their account has it.
  starsAccount: null,
});

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
 * the dock can say the stars assume the estimate. Their own star rating goes
 * through its own validation (stars.ts `parseCustomRating`); one that does
 * not pass, or was stored in another version (a level's, from before 25
 * October 2026), is left out and ours rates. How far up and down the wind
 * they ride is kept only when it is not ours. Anything else stored on the
 * rider (the old level, gusty wind, a kept rating) is ignored.
 */
export function parseRider(value: unknown): Rider {
  if (!value || typeof value !== "object") return DEFAULT_RIDER;
  const raw = value as Record<string, unknown>;
  const weight = raw.weightKg;
  const wings = Array.isArray(raw.wings) ? raw.wings : [];
  const custom = parseCustomRating(raw.custom);
  return {
    weightKg:
      typeof weight === "number" &&
      weight >= MIN_WEIGHT_KG &&
      weight <= MAX_WEIGHT_KG
        ? Math.round(weight)
        : null,
    ...withAngle("upwind", raw.upwind, UPWIND_DEFAULT, clampUpwind),
    ...withAngle("downwind", raw.downwind, DOWNWIND_DEFAULT, clampDownwind),
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
    ...(custom && !isOurs(custom) ? { custom } : {}),
    ...withStarsChoice(parseStarsChoice(raw.starsFrom)),
  };
}

/**
 * A rider carries an angle only when it is a number of degrees that is not
 * ours, so a default rider stays as it always was. Out of range it is held
 * to the end it passed.
 */
function withAngle<K extends "upwind" | "downwind">(
  key: K,
  value: unknown,
  ours: number,
  clampTo: (deg: number) => number,
): Partial<Pick<Rider, K>> {
  if (typeof value !== "number" || !Number.isFinite(value)) return {};
  const deg = clampTo(value);
  return deg === ours ? {} : ({ [key]: deg } as Partial<Pick<Rider, K>>);
}

/** A rider carries `starsFrom` only when it is not the default, so a default rider stays as it always was. */
const withStarsChoice = (
  choice: StarsChoice | undefined,
): Pick<Rider, "starsFrom"> => (choice ? { starsFrom: choice } : {});

/**
 * The rider with their model changed: the one the map draws, the dock and
 * the spot page give, and the stars rate (force5/src/lead.ts).
 */
export function withRiderModel(rider: Rider, model: string): Rider {
  const { starsFrom: _old, ...rest } = rider;
  return { ...rest, ...withStarsChoice(withModel(model)) };
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
    const stored = JSON.parse(raw) as Partial<Prefs> & {
      blendKnown?: unknown;
      version?: unknown;
    };
    if (!stored || typeof stored !== "object") return defaults;
    // Before version 3 the rating and the angles were a level's: the rider
    // starts again from ours, keeping their weight, wings and model.
    const rider =
      stored.version === PREFS_VERSION ||
      !stored.rider ||
      typeof stored.rider !== "object"
        ? stored.rider
        : {
            ...stored.rider,
            custom: undefined,
            upwind: undefined,
            downwind: undefined,
          };
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
    // A model retired since the list was saved is no longer published, so it
    // is no longer a choice: it is dropped rather than counted. Were it ever
    // switched back on, `blendKnown` (saved without it) brings it back as new.
    const kept = Array.isArray(stored.blendModels)
      ? stored.blendModels.filter((id) => !modelEntry(id)?.retired)
      : null;
    return {
      rows: mergeRows(stored.rows, defaults.rows),
      touchedRows: Array.isArray(stored.touchedRows)
        ? ROW_KEYS.filter((key) => stored.touchedRows!.includes(key))
        : defaults.touchedRows,
      units: isUnits(stored.units) ? stored.units : defaults.units,
      blendModels:
        kept &&
        kept.every((id) => typeof id === "string") &&
        kept.length + added.length > 0
          ? [...new Set([...kept, ...added])]
          : defaults.blendModels,
      view:
        stored.view && VIEWS.includes(stored.view)
          ? stored.view
          : defaults.view,
      nightHours: NIGHT_HOURS.includes(stored.nightHours as NightHours)
        ? (stored.nightHours as NightHours)
        : defaults.nightHours,
      rider: parseRider(rider),
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
        version: PREFS_VERSION,
        blendKnown: windModels().map((model) => model.id),
      }),
    );
    return storage !== null;
  } catch {
    return false;
  }
}

/**
 * A change of weight, wings, angles or model, saved over what is stored now,
 * so a change made in another tab or adopted from the account is not undone.
 * The rider's own star rating is the stored one: it changes only through
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
    rider: {
      ...fields,
      ...(stored.rider.custom ? { custom: stored.rider.custom } : {}),
    },
  };
  savePrefs(next, storage);
  return next;
}
