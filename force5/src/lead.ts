// Which one model an hour's stars come from.
//
// The ruling of 19 October 2026: the stars come from one model, the rider's
// choice, never from a blend of several. The rider picks the model (HARMONIE
// unless they say otherwise) and the one that takes over where its run ends
// (ECMWF unless they say otherwise), and may pick another model for a spot of
// their own. Every hour is rated from the first of those two that reaches it,
// on its own wind, gust and direction; an hour neither reaches has no stars.
// The other models stay on the page as context — the agreement, the range,
// the faint ticks — and never move a star.
//
// Plain data and arithmetic with no imports beyond the catalogue, so the map,
// the dock, the spot page, the forecast server (mcp/api, compiled on its own),
// the alerts and the app all read the same rule.
import { MODEL_CATALOG } from "./catalog.js";

/** The model that rates an hour, and the one that takes over where its run ends. */
export interface StarsFrom {
  model: string;
  then: string;
}

/**
 * What the rider has chosen: one model and its fallback for every spot, and
 * any spot of theirs rated from another model (its fallback stays the same).
 */
export interface StarsChoice extends StarsFrom {
  /** Spot id → the model that rates that spot instead. */
  spots?: Readonly<Record<string, string>>;
}

/** HARMONIE while it reaches the hour, then ECMWF, which runs fifteen days. */
export const DEFAULT_STARS_FROM: StarsFrom = Object.freeze({
  model: "harmonie",
  then: "ecmwf",
});

/**
 * The models a rider can take their stars from: every published wind model
 * that is one forecast rather than an ensemble's members.
 */
export const STARS_MODELS: readonly string[] = MODEL_CATALOG.filter(
  (entry) =>
    entry.kind === "wind" &&
    !entry.planned &&
    !entry.retired &&
    !entry.ensemble,
).map((entry) => entry.id);

export const isStarsModel = (id: unknown): id is string =>
  typeof id === "string" && STARS_MODELS.includes(id);

/** The model's name as the site prints it: "HARMONIE", "ECMWF", "GFS". */
export const modelName = (id: string): string =>
  MODEL_CATALOG.find((entry) => entry.id === id)?.name ?? id.toUpperCase();

/** What rates a spot: the rider's choice, with that spot's own model if they gave it one. */
export function starsFromAt(
  choice: StarsChoice | null | undefined,
  spotId?: string | null,
): StarsFrom {
  const model = choice?.model ?? DEFAULT_STARS_FROM.model;
  const then = choice?.then ?? DEFAULT_STARS_FROM.then;
  const own = spotId ? choice?.spots?.[spotId] : undefined;
  return { model: own ?? model, then };
}

export const sameStarsFrom = (
  a: StarsFrom | null | undefined,
  b: StarsFrom | null | undefined,
): boolean => !!a && !!b && a.model === b.model && a.then === b.then;

/** The models to try for an hour, in order: the chosen one, then its fallback. */
export const leadOrder = (from: StarsFrom): string[] =>
  from.then === from.model ? [from.model] : [from.model, from.then];

/**
 * The one model that rates an hour: the chosen model where it has the hour,
 * else the fallback where that has it, else none. `has` says whether a model
 * gives a wind for the hour.
 */
export function pickModel(
  from: StarsFrom,
  has: (model: string) => boolean,
): string | null {
  for (const model of leadOrder(from)) if (has(model)) return model;
  return null;
}

/** Whether a spot has a model of its own, other than the rider's choice everywhere. */
export const spotOverride = (
  choice: StarsChoice | null | undefined,
  spotId: string | null | undefined,
): string | null => (spotId ? (choice?.spots?.[spotId] ?? null) : null);

/** The spots with a model of their own. */
export const overriddenSpots = (
  choice: StarsChoice | null | undefined,
): string[] => Object.keys(choice?.spots ?? {});

/**
 * A stored choice, field by field: a model that is not (or no longer) one to
 * rate from is dropped, and the default stands in for it. Undefined when what
 * is left is the default everywhere, so a rider who never chose stays as they
 * always were.
 */
export function parseStarsChoice(value: unknown): StarsChoice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const model = isStarsModel(raw.model) ? raw.model : DEFAULT_STARS_FROM.model;
  const then = isStarsModel(raw.then) ? raw.then : DEFAULT_STARS_FROM.then;
  const spots: Record<string, string> = {};
  if (raw.spots && typeof raw.spots === "object" && !Array.isArray(raw.spots))
    for (const [id, own] of Object.entries(
      raw.spots as Record<string, unknown>,
    ))
      if (id && isStarsModel(own) && own !== model) spots[id] = own;
  const choice: StarsChoice = Object.keys(spots).length
    ? { model, then, spots }
    : { model, then };
  return isDefaultChoice(choice) ? undefined : choice;
}

/** Whether a choice rates every spot the default way. */
export const isDefaultChoice = (
  choice: StarsChoice | null | undefined,
): boolean =>
  !choice ||
  (sameStarsFrom(choice, DEFAULT_STARS_FROM) &&
    !overriddenSpots(choice).length);

/** The choice with its model or fallback changed for every spot. */
export function withStarsFrom(
  choice: StarsChoice | null | undefined,
  change: Partial<StarsFrom>,
): StarsChoice | undefined {
  const from = starsFromAt(choice);
  return parseStarsChoice({ ...from, spots: choice?.spots, ...change });
}

/**
 * One spot rated from `model`, or back to the rider's choice everywhere with
 * null (or with the model that already rates everywhere).
 */
export function withSpotStars(
  choice: StarsChoice | null | undefined,
  spotId: string,
  model: string | null,
): StarsChoice | undefined {
  const { [spotId]: _old, ...spots } = choice?.spots ?? {};
  return parseStarsChoice({
    ...starsFromAt(choice),
    spots: model ? { ...spots, [spotId]: model } : spots,
  });
}

/** Where the model rating the hours changes: the column it changes at, and to whom. */
export interface Handover {
  /** The first column the new model rates. */
  at: number;
  from: string;
  to: string;
}

/**
 * Each change of model along a row of hours, `models[i]` being the model that
 * rated column i (null where none did, which neither starts nor ends a run).
 */
export function handovers(models: readonly (string | null)[]): Handover[] {
  const out: Handover[] = [];
  let last: string | null = null;
  models.forEach((model, at) => {
    if (model === null) return;
    if (last !== null && model !== last)
      out.push({ at, from: last, to: model });
    last = model;
  });
  return out;
}

/** "HARMONIE, then ECMWF", or just "GFS" where the two are one. */
export const starsFromText = (from: StarsFrom): string =>
  leadOrder(from).map(modelName).join(", then ");
