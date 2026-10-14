/**
 * The More tab's arithmetic: who the stars are rated for, in the site's words
 * (spot/web/RiderSwitch.tsx) and through its validation (`parseRider`), the
 * models in the blend, and the lines a rider pastes into an AI assistant
 * (ai/web/install.ts's own).
 */
import {
  claudeCodeCommand,
  claudeLink,
  codexConfig,
  EXAMPLE_PROMPTS,
  geminiConfig,
  mcpUrl,
} from "../../../../ai/web/install";
import type { ModelAvailability, ModelEntry } from "../../../../force5/src/manifests";
import { parseRider } from "../../../../force5/src/prefs";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  type Rider,
  type Skill,
} from "../../../../force5/src/stars";

/** The site's names for the levels (spot/web/RiderSwitch.tsx). */
export const SKILL_LABEL: Record<Skill, string> = {
  beginner: "Learning",
  intermediate: "Riding",
  advanced: "Advanced",
};

/** "~80 kg" until a weight is given. */
export const weightText = (rider: Rider) =>
  `${rider.weightKg === null ? "~" : ""}${rider.weightKg ?? ESTIMATE_WEIGHT_KG} kg`;

/** "Riding · ~80 kg": who the stars are for. */
export const riderWords = (rider: Rider) => `${SKILL_LABEL[rider.skill]} · ${weightText(rider)}`;

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
