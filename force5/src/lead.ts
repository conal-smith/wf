// Which one model an hour's stars come from.
//
// The ruling of 19 October 2026: the stars come from one model, the rider's
// choice, never from a blend of several. Since 23 October 2026 that choice is
// the one model the rider picks to see: the map draws it, the dock and the
// spot page give its wind, and the stars rate it (HARMONIE unless they pick
// another). Past the end of its run ECMWF takes over, on its own and with no
// setting for it, because ECMWF runs fifteen days and HARMONIE some two and a
// half; ECMWF itself has nothing to hand over to. Every hour is rated from
// the first of those two that reaches it, on its own wind, gust and
// direction; an hour neither reaches has no stars. Where the handover falls is
// still marked, quietly, on the hours. The other models stay on the page as
// context — the blend, the agreement, the range, the faint ticks — and never
// move a star.
//
// Plain data and arithmetic with no imports beyond the catalogue, so the map,
// the dock, the spot page, the forecast server (mcp/api, compiled on its own),
// the alerts and the app all read the same rule.
import { MODEL_CATALOG } from "./catalog.js";

/**
 * The model that rates an hour, and the one that takes over where its run
 * ends: always `leadFor` a chosen model, never a choice of its own.
 */
export interface StarsFrom {
  model: string;
  then: string;
}

/** What the rider has chosen: the one model they see, and so the one the stars rate. */
export interface StarsChoice {
  model: string;
}

/** HARMONIE, Met Éireann's 2 km model, unless the rider picks another. */
export const DEFAULT_MODEL = "harmonie";

/** The model that takes over past the end of any other's run: ECMWF, fifteen days. */
export const FALLBACK_MODEL = "ecmwf";

/** The models to rate an hour from for a chosen model: it, then ECMWF past its run. */
export const leadFor = (model: string): StarsFrom => ({
  model,
  then: FALLBACK_MODEL,
});

/** HARMONIE while it reaches the hour, then ECMWF. */
export const DEFAULT_STARS_FROM: StarsFrom = Object.freeze(
  leadFor(DEFAULT_MODEL),
);

/**
 * The models a rider can pick: every published wind model that is one
 * forecast rather than an ensemble's members.
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

/** The one model the rider picked, HARMONIE if they never did. */
export const chosenModel = (choice: StarsChoice | null | undefined): string =>
  choice?.model ?? DEFAULT_MODEL;

/** What rates every spot for this rider: their model, then ECMWF past its run. */
export const starsFromAt = (
  choice: StarsChoice | null | undefined,
): StarsFrom => leadFor(chosenModel(choice));

export const sameStarsFrom = (
  a: StarsFrom | null | undefined,
  b: StarsFrom | null | undefined,
): boolean => !!a && !!b && a.model === b.model && a.then === b.then;

/** The models to try for an hour, in order: the chosen one, then ECMWF, once each. */
export const leadOrder = (from: StarsFrom): string[] =>
  from.then === from.model ? [from.model] : [from.model, from.then];

/**
 * The one model that rates an hour: the chosen model where it has the hour,
 * else ECMWF where that has it, else none. `has` says whether a model gives a
 * wind for the hour.
 */
export function pickModel(
  from: StarsFrom,
  has: (model: string) => boolean,
): string | null {
  for (const model of leadOrder(from)) if (has(model)) return model;
  return null;
}

/**
 * A stored choice: its model kept while it is still one to pick, the default
 * otherwise. What the rider once chose for after the run's end (`then`) and
 * for spots of their own (`spots`) is no longer a choice and is dropped.
 * Undefined when what is left is the default, so a rider who never chose
 * stays as they always were.
 */
export function parseStarsChoice(value: unknown): StarsChoice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const model = (value as Record<string, unknown>).model;
  return isStarsModel(model) && model !== DEFAULT_MODEL ? { model } : undefined;
}

/** Whether a choice is the default: HARMONIE. */
export const isDefaultChoice = (
  choice: StarsChoice | null | undefined,
): boolean => chosenModel(choice) === DEFAULT_MODEL;

/** The choice of `model`, or undefined for the default. */
export const withModel = (model: string): StarsChoice | undefined =>
  parseStarsChoice({ model });

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

/** "HARMONIE, then ECMWF", or just "ECMWF" where the two are one. */
export const leadText = (from: StarsFrom): string =>
  leadOrder(from).map(modelName).join(", then ");
