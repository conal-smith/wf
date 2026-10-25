// Display preferences for the forecast dock. Persistence is best effort:
// private browsing, blocked storage and quota errors must never break the page.
import { isUnits, type Units } from "./units";
import { UPWIND_DEFAULT, clampUpwind } from "./rideWedge";
import { parseStarsChoice, withModel, type StarsChoice } from "./lead";
import { modelEntry, windModels } from "./manifests";
import {
  DEFAULT_RIDER,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  GUSTIES,
  SKILLS,
  parseCustomRating,
  rateOn,
  type CustomRating,
  type Gusty,
  type Rider,
  type StarsOn,
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
   * Who the stars are rated for: weight, level, the wings they own, their
   * own star rating, rating or kept, and the model the stars come from
   * (stars.ts `Rider`, lead.ts `StarsChoice`).
   */
  rider: Rider;
  /**
   * When the rider last saved or deleted their own star rating on this
   * device, or went on or off it, ISO; null if never. A signed-in rider's
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
 *   1 (no `version`)  `rider.custom` was the rider's own star rating, always
 *                     in use while it was there
 *   2                 the rider's own rating may also be kept while a level
 *                     rates (`rider.keptCustom`)
 * A version 1 rider's `custom` is theirs saved and in use, as it is read in
 * version 2, so it comes over as it is and only a `keptCustom` it never
 * wrote is left out.
 */
export const PREFS_VERSION = 2;

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
 * The rider's own star rating saved, and rating from now on; or deleted with
 * null, and the level rates. Stamped now, as `withStarsOn` is: the two ways a
 * device changes what the account keeps, so the stamp it compares is always
 * the moment of the change.
 */
export function withCustomStars(
  prefs: Prefs,
  custom: CustomRating | null,
  now: Date = new Date(),
): Prefs {
  const { custom: _old, keptCustom: _kept, ...rider } = prefs.rider;
  return stamped(
    { ...prefs, rider: custom ? { ...rider, custom } : rider },
    now,
  );
}

/**
 * The level pill: rated on a level, or on the rider's own rating ("custom"),
 * which is kept either way. Stamped only when the rider goes on or off their
 * own rating, which the account keeps; a level alone is this device's.
 */
export function withStarsOn(
  prefs: Prefs,
  on: StarsOn,
  now: Date = new Date(),
): Prefs {
  const next = { ...prefs, rider: rateOn(prefs.rider, on) };
  return !!next.rider.custom === !!prefs.rider.custom
    ? next
    : stamped(next, now);
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
 * the dock can say the stars assume the estimate. A custom star rating, rating
 * or kept, goes through its own validation (stars.ts `parseCustomRating`); one
 * that does not pass, or was stored in another version, is left out and the
 * level rates. Given both, the one rating wins and the kept one is dropped.
 * How far into the wind the rider rides is kept only when it is not their
 * level's own; a rider stored before 24 October 2026 with a `pointing` has it
 * read as degrees (`withUpwind`).
 * How much gusty wind bothers them is kept only when it is not "some".
 */
export function parseRider(value: unknown): Rider {
  if (!value || typeof value !== "object") return DEFAULT_RIDER;
  const raw = value as Record<string, unknown>;
  const weight = raw.weightKg;
  const wings = Array.isArray(raw.wings) ? raw.wings : [];
  const skill = SKILLS.includes(raw.skill as Rider["skill"])
    ? (raw.skill as Rider["skill"])
    : DEFAULT_RIDER.skill;
  return {
    weightKg:
      typeof weight === "number" &&
      weight >= MIN_WEIGHT_KG &&
      weight <= MAX_WEIGHT_KG
        ? Math.round(weight)
        : null,
    skill,
    ...withUpwind(skill, raw.upwind, raw.pointing),
    ...withGusty(raw.gusty),
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
    ...withCustom(
      parseCustomRating(raw.custom),
      parseCustomRating(raw.keptCustom),
    ),
    ...withStarsChoice(parseStarsChoice(raw.starsFrom)),
  };
}

/**
 * Before 24 October 2026 a rider said how high they pointed in three words,
 * against their level: typical was the level's, cautious about 10° lower and
 * sharp about 10° higher. Read as degrees into the wind from the level's own.
 */
const OLD_POINTING: Record<string, number> = {
  cautious: -10,
  typical: 0,
  sharp: 10,
};

/**
 * A rider carries `upwind` only when it is a number of degrees that is not
 * their level's own, so a default rider stays as it always was and follows
 * their level when it changes. Out of 0–45 it is held to the end it passed.
 */
function withUpwind(
  skill: Rider["skill"],
  upwind: unknown,
  pointing: unknown,
): Pick<Rider, "upwind"> {
  const level = UPWIND_DEFAULT[skill];
  const deg =
    typeof upwind === "number" && Number.isFinite(upwind)
      ? clampUpwind(upwind)
      : typeof pointing === "string" && Object.hasOwn(OLD_POINTING, pointing)
        ? clampUpwind(level + OLD_POINTING[pointing])
        : level;
  return deg === level ? {} : { upwind: deg };
}

/** A rider carries `gusty` only when it is known and not "some", so a default rider stays as it always was. */
const withGusty = (value: unknown): Pick<Rider, "gusty"> =>
  GUSTIES.includes(value as Gusty) && value !== "some"
    ? { gusty: value as Gusty }
    : {};

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

/** A rider carries `custom` or `keptCustom` only when there is one, so a standard rider stays as it always was. */
const withCustom = (
  custom: CustomRating | null,
  kept: CustomRating | null,
): Pick<Rider, "custom" | "keptCustom"> =>
  custom ? { custom } : kept ? { keptCustom: kept } : {};

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
    // Version 1 never kept a rating aside: its `custom` is saved and in use.
    const rider =
      stored.version === PREFS_VERSION ||
      !stored.rider ||
      typeof stored.rider !== "object"
        ? stored.rider
        : { ...stored.rider, keptCustom: undefined };
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
 * A change of weight, level or wings, saved over what is stored now, so a
 * change made in another tab or adopted from the account is not undone. The
 * rider's own star rating, rating or kept, is the stored one: it changes only
 * through `withCustomStars` and `withStarsOn`.
 */
export function saveRider(
  rider: Rider,
  storage: PrefsStorage | null = browserStorage(),
): Prefs {
  const stored = loadPrefs(storage);
  const { custom: _ignored, keptCustom: _kept, ...fields } = rider;
  const next: Prefs = {
    ...stored,
    rider: {
      ...fields,
      ...(stored.rider.custom ? { custom: stored.rider.custom } : {}),
      ...(stored.rider.keptCustom
        ? { keptCustom: stored.rider.keptCustom }
        : {}),
    },
  };
  savePrefs(next, storage);
  return next;
}
