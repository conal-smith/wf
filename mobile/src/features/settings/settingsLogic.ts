/**
 * The More tab's arithmetic: who the stars are rated for, in the site's words
 * (spot/web/RiderSwitch.tsx) and through its validation (`parseRider`), the
 * rider's one model (force5/src/lead.ts), the models in the blend,
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
  chosenModel,
  DEFAULT_MODEL,
  leadOrder,
  modelName,
  STARS_MODELS,
  starsFromAt,
  type StarsChoice,
} from "../../../../force5/src/lead";
import { modelEntry, type ModelAvailability, type ModelEntry } from "../../../../force5/src/manifests";
import { parseRider } from "../../../../force5/src/prefs";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  type Rider,
} from "../../../../force5/src/stars";

/** "~80 kg" until a weight is given. */
export const weightText = (rider: Rider) =>
  `${rider.weightKg === null ? "~" : ""}${rider.weightKg ?? ESTIMATE_WEIGHT_KG} kg`;

/** Whose stars rate: "Ours", or "Your own stars" once the rider has made them their own in Customise. */
export const starsName = (rider: Pick<Rider, "custom">) => (rider.custom ? "Your own stars" : "Ours");

/**
 * "Ours · ~80 kg", or "Your own stars · 80 kg": who the stars are for
 * (spot/web/RiderSwitch.tsx). The weight never moves a star; it is said
 * because it sizes the wing.
 */
export const riderWords = (rider: Rider) => `${starsName(rider)} · ${weightText(rider)}`;

/** The way into "Your stars": a new rating from ours, or the rider's own to edit. */
export const customiseText = (rider: Pick<Rider, "custom">) => (rider.custom ? "Edit your stars" : "Customise");

/** "Ours · ~80 kg · 4, 5.5 m²": the More tab's summary. */
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

/* ----------------------------------------------------------------- model */

/** Under "Model", in the site's words: what follows it, and what takes over. */
export const MODEL_NOTE =
  "The chart, the wind and the stars are this model's forecast. Past the end of its run ECMWF's, which runs fifteen days.";

/**
 * "The stars stay your model's own: HARMONIE's, then ECMWF's past the end of
 * its run." Said under the blend's models, which never rate a star.
 */
export function modelStarsLine(choice: StarsChoice | null | undefined): string {
  const [model, then] = leadOrder(starsFromAt(choice)).map(modelName);
  return `The stars stay your model's own: ${model}'s${then ? `, then ${then}'s past the end of its run` : ""}.`;
}

/** "HARMONIE": the More tab's value for "Model". */
export const modelValue = (choice: StarsChoice | null | undefined) => modelName(chosenModel(choice));

export interface ModelChoiceRow {
  id: string;
  name: string;
  /** "2 km · 2½ days · recommended". */
  detail: string;
  on: boolean;
}

const modelDetail = (id: string) =>
  [modelEntry(id)?.detail, id === DEFAULT_MODEL ? "recommended" : null].filter(Boolean).join(" · ");

/** Every model a rider can pick, and whether it is theirs. */
export const modelChoiceRows = (choice: StarsChoice | null | undefined): ModelChoiceRow[] => {
  const model = chosenModel(choice);
  return STARS_MODELS.map((id) => ({ id, name: modelName(id), detail: modelDetail(id), on: id === model }));
};

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
  { what: "Tides and sea temperature", who: "The stations named in each spot's tide row and water reading" },
  { what: "Riding places", who: "Fáilte Ireland (CC BY 4.0), OpenStreetMap contributors (ODbL) and the sources listed with the site's places" },
  { what: "Depths", who: "EMODnet Bathymetry (CC BY 4.0)" },
];
