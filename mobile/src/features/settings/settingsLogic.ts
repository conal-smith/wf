/**
 * The More tab's arithmetic: who the stars are rated for, in the site's words
 * (spot/web/RiderSwitch.tsx) and through its validation (`parseRider`), the
 * model the stars come from (force5/src/lead.ts), the models in the blend,
 * and the lines a rider pastes into an AI assistant (ai/web/install.ts's own).
 */
import {
  claudeCodeCommand,
  claudeLink,
  codexConfig,
  EXAMPLE_PROMPTS,
  geminiConfig,
  mcpUrl,
} from "../../../../ai/web/install";
import {
  DEFAULT_STARS_FROM,
  modelName,
  STARS_MODELS,
  starsFromAt,
  starsFromText,
  type StarsChoice,
  type StarsFrom,
} from "../../../../force5/src/lead";
import { modelEntry, type ModelAvailability, type ModelEntry } from "../../../../force5/src/manifests";
import { parseRider } from "../../../../force5/src/prefs";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  SKILL_LABEL,
  SKILLS,
  savedCustom,
  type Rider,
  type StarsOn,
} from "../../../../force5/src/stars";

/** The site's names for the levels (force5/src/stars.ts). */
export { SKILL_LABEL };

/** "~80 kg" until a weight is given. */
export const weightText = (rider: Rider) =>
  `${rider.weightKg === null ? "~" : ""}${rider.weightKg ?? ESTIMATE_WEIGHT_KG} kg`;

/**
 * "Riding · ~80 kg", or "Custom stars · ~80 kg" while the rider's own rating
 * rates: who the stars are for (spot/web/RiderSwitch.tsx). A rating kept
 * aside while a level rates is not who they are for.
 */
export const riderWords = (rider: Rider) =>
  `${rider.custom ? "Custom stars" : SKILL_LABEL[rider.skill]} · ${weightText(rider)}`;

/** The level pill's choices: the levels, and Custom once the rider has a rating of their own. */
export const starsOnSegments = (rider: Rider): { value: StarsOn; label: string }[] => [
  ...SKILLS.map((skill) => ({ value: skill, label: SKILL_LABEL[skill] })),
  ...(savedCustom(rider) ? [{ value: "custom" as const, label: "Custom" }] : []),
];

/** The way into "Your star rating" under the pill: a new rating from the level, or the rider's own. */
export const customiseText = (rider: Rider) => (savedCustom(rider) ? "Edit custom" : "Customise");

/** "Riding · ~80 kg · 4, 5.5 m²": the More tab's summary. */
export const riderSummary = (rider: Rider) =>
  `${riderWords(rider)}${rider.wings.length ? ` · ${rider.wings.join(", ")} m²` : ""}`;

/** A change to the rider, through the site's validation. */
export const changeRider = (rider: Rider, change: Partial<Rider>): Rider =>
  parseRider({ ...rider, ...change });

/** A typed weight: a number in range, else none (the estimate). */
export function parseWeight(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() && Number.isFinite(value) && value >= MIN_WEIGHT_KG && value <= MAX_WEIGHT_KG
    ? Math.round(value)
    : null;
}

/** Typed wings, "4, 5.5 6": every size in range, once each, smallest first. */
export function parseWings(text: string): number[] {
  return [
    ...new Set(
      (text.match(/\d+(?:[.,]\d+)?/g) ?? [])
        .map((n) => Number(n.replace(",", ".")))
        .filter((n) => n >= MIN_WING_M2 && n <= MAX_WING_M2),
    ),
  ].sort((a, b) => a - b);
}

/** The common wing sizes a rider picks from, in half metres. */
export const WING_SIZES: readonly number[] = Array.from(
  { length: Math.round((8 - 2) * 2) + 1 },
  (_, i) => 2 + i / 2,
);

export const toggleWing = (wings: readonly number[], size: number): number[] =>
  wings.includes(size) ? wings.filter((w) => w !== size) : [...wings, size].sort((a, b) => a - b);

export const WEIGHT_RANGE = { min: MIN_WEIGHT_KG, max: MAX_WEIGHT_KG } as const;
export const WING_RANGE = { min: MIN_WING_M2, max: MAX_WING_M2 } as const;

/* ------------------------------------------------------------------ models */

export interface ModelRow {
  id: string;
  name: string;
  detail: string;
  on: boolean;
  /** "Run 06:00 Tue" / "Not published" / "Reading…". */
  status: string;
  answered: boolean;
}

const runFormat = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Tue 06:00", Irish time. */
export const runText = (iso: string) => {
  const parts = runFormat.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")}`;
};

/** Each wind model, whether it is in the rider's blend, and what it answered. */
export function modelRows(
  entries: readonly ModelEntry[],
  models: readonly ModelAvailability[],
  blendModels: readonly string[],
  asked: boolean,
): ModelRow[] {
  return entries.map((entry) => {
    const found = models.find((m) => m.id === entry.id);
    const runTime = found?.wind?.runTime ?? found?.manifest?.runTime ?? null;
    return {
      id: entry.id,
      name: entry.name,
      detail: entry.detail,
      on: blendModels.includes(entry.id),
      answered: !!found?.available,
      status: !found
        ? asked
          ? "Reading…"
          : ""
        : found.available && runTime
          ? `Run ${runText(runTime)}`
          : found.error
            ? "Not answering"
            : "Not published",
    };
  });
}

/** Switch a model in or out of the blend; the last one stays in. */
export function toggleBlendModel(
  blendModels: readonly string[],
  id: string,
  on: boolean,
  order: readonly string[],
): string[] {
  const next = on ? [...new Set([...blendModels, id])] : blendModels.filter((m) => m !== id);
  if (!next.length) return [...blendModels];
  return order.filter((m) => next.includes(m)).concat(next.filter((m) => !order.includes(m)));
}

/* ------------------------------------------------------------ stars from */

/** Under "Stars from", in the site's words: what follows it, and what the blend still does. */
export const STARS_FROM_NOTE =
  "The stars, the lights, the wing and your alerts follow Stars from. The blend's models still give the agreement.";

/** "HARMONIE, then ECMWF": the More tab's value for "Stars from". */
export const starsFromValue = (choice: StarsChoice | null | undefined) =>
  starsFromText(starsFromAt(choice));

export interface StarsModelRow {
  id: string;
  name: string;
  /** "2 km · recommended". */
  detail: string;
  on: boolean;
}

const modelDetail = (id: string) =>
  [modelEntry(id)?.detail, id === DEFAULT_STARS_FROM.model ? "recommended" : null]
    .filter(Boolean)
    .join(" · ");

/** Every model the stars can come from, and whether they do. */
export const starsModelRows = (choice: StarsChoice | null | undefined): StarsModelRow[] => {
  const { model } = starsFromAt(choice);
  return STARS_MODELS.map((id) => ({ id, name: modelName(id), detail: modelDetail(id), on: id === model }));
};

/**
 * The models that can take over where the chosen one ends: every other. Where
 * the two are one (a choice made elsewhere), none is ticked.
 */
export const thenRows = (choice: StarsChoice | null | undefined): StarsModelRow[] => {
  const { model, then } = starsFromAt(choice);
  return STARS_MODELS.filter((id) => id !== model).map((id) => ({
    id,
    name: modelName(id),
    detail: modelEntry(id)?.detail ?? "",
    on: id === then,
  }));
};

/** "When HARMONIE ends". */
export const thenTitle = (choice: StarsChoice | null | undefined) =>
  `When ${modelName(starsFromAt(choice).model)} ends`;

/**
 * A new model for every spot. The one that took over becoming the model
 * itself hands the takeover to the model it replaces, so the two stay two.
 */
export function pickStarsModel(from: StarsFrom, model: string): Partial<StarsFrom> {
  return model === from.then && model !== from.model ? { model, then: from.model } : { model };
}

/** "same" for the rider's choice everywhere, or a model of the spot's own. */
export type SpotStars = "same" | (string & {});

export interface SpotStarsRow {
  value: SpotStars;
  label: string;
  on: boolean;
}

/**
 * The choices at one spot: the same as everywhere, or another model (its
 * fallback stays the rider's). The model that rates everywhere is "same".
 */
export function spotStarsRows(choice: StarsChoice | null | undefined, spotId: string): SpotStarsRow[] {
  const everywhere = starsFromAt(choice);
  const own = choice?.spots?.[spotId] ?? null;
  return [
    { value: "same", label: `Same as everywhere (${modelName(everywhere.model)})`, on: !own },
    ...STARS_MODELS.filter((id) => id !== everywhere.model).map((id) => ({
      value: id,
      label: modelName(id),
      on: own === id,
    })),
  ];
}

/** The spots with a model of their own, by id, with that model's name. */
export const spotOverrides = (choice: StarsChoice | null | undefined) =>
  Object.entries(choice?.spots ?? {}).map(([id, model]) => ({ id, model, name: modelName(model) }));

/* ------------------------------------------------------------------ AI */

// The site's own lines for each assistant (ai/web/install.ts), by the names
// the AI page reads.
export { DISPLAY_NAME, SERVER_NAME } from "../../../../ai/web/install";

/** The MCP endpoint on the API's origin. */
export const mcpEndpoint = (apiRoot: string) => mcpUrl(apiRoot, apiRoot);
export const claudeConnectorLink = claudeLink;
export const claudeCodeLine = claudeCodeCommand;
export const codexLines = codexConfig;
export const geminiLines = geminiConfig;
export const EXAMPLE_QUESTIONS: readonly string[] = EXAMPLE_PROMPTS;

/* ------------------------------------------------------------------ links */

export const SOURCE_CODE_URL = "https://github.com/sprintengine/wingfoil";
export const LICENCE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

/** Where the data comes from, as the site credits it (README.md, "Licence"). */
export const CREDITS: readonly { what: string; who: string }[] = [
  { what: "Wind", who: "Met Éireann HARMONIE, DWD ICON-EU, ECMWF IFS and AIFS, NOAA GFS and GEFS, Météo-France ARPEGE and AROME" },
  { what: "Waves and weather", who: "The Marine Institute, NOAA and DWD" },
  { what: "Tides and sea temperature", who: "The stations named under each spot's tide and sea rows" },
  { what: "Riding places", who: "Fáilte Ireland (CC BY 4.0), OpenStreetMap contributors (ODbL) and the sources listed with the site's places" },
  { what: "Depths", who: "EMODnet Bathymetry (CC BY 4.0)" },
];
