/**
 * Met Éireann's warnings as an agent reads them: the same published file and
 * the same rule as the site (force5/src/warnings.ts), said in the MCP's words.
 *
 * Every tool that talks about a spot carries `warnings`: what Met Éireann has
 * in force or still to come there, each warning's headline, description and
 * times exactly as Met Éireann published them. An hour an orange or red
 * warning covers gets no rating and is never counted rideable (find_wind
 * leaves it out of every session); a yellow one is named beside the hour and
 * changes nothing. Whatever rates an hour here passes its rating through
 * `ratingUnderWarnings`, the site's own `applyWarnings`, so the two agree.
 */
import {
  LEVEL_LABEL,
  MET_WARNINGS_PAGE,
  WARNINGS_URL,
  applyWarnings,
  areaName,
  descriptionText,
  placeAreas,
  placeWarnings,
  readWarningsManifest,
  replacesStars,
  warningKind,
  warningsDuring,
  warningsStatus,
  type PlaceWarning,
  type PlaceWarnings,
  type WarningLevel,
  type WarningPlace,
  type WarningsManifest,
  type WarningsStatus,
} from "../../force5/src/warnings.js";
import type { ForecastSource } from "./httpSource.js";

const HOUR = 3600000;

/** The published warnings, or null when there are none to trust. Never throws. */
export async function loadWarnings(
  source: ForecastSource,
): Promise<WarningsManifest | null> {
  try {
    return readWarningsManifest(await source.json(WARNINGS_URL));
  } catch {
    return null;
  }
}

/** One warning as a tool answers it. */
export interface WarningItem {
  /** Met Éireann's CAP identifier; hours and spots refer to warnings by it. */
  id: string;
  level: WarningLevel;
  /** Met Éireann's own type, as published: "Wind", "Gale", "small-craft". */
  type: string;
  /** Matched through a sea area: a marine warning for the spot's coast. */
  marine: boolean;
  /** Headline, unaltered. */
  headline: string;
  /** The description as plain text: Met Éireann's words, its HTML markup removed. */
  description: string;
  /** Onset and expiry exactly as published, with their offset. */
  onset: string;
  expiry: string;
  /** The same instants in Irish time, for people. */
  local: string;
  in_force_now: boolean;
  /** True for orange and red: the hours it covers have no rating. */
  replaces_ratings: boolean;
  issued: string;
  updated: string;
  severity: string;
  certainty: string;
  /** The spot's areas the warning names: a county, or a stretch of coast. */
  areas: string[];
}

export interface WarningsAnswer {
  /** What the warnings do to the forecast, in words for the agent. */
  rule: string;
  /**
   * `current`: `items` is every warning for the place. `stale` or
   * `unavailable`: the warnings could not be checked; nothing is known either
   * way, so say so and send people to Met Éireann's page.
   */
  status: WarningsStatus;
  checked_at: string | null;
  items: WarningItem[];
  note?: string;
  page: string;
  attribution: string;
}

export const WARNINGS_RULE =
  "Met Éireann's official warnings (yellow, orange, red; wind, weather and marine) for the spot, in force or still to come. An orange or red warning covering an hour replaces that hour's rating: never call such an hour good, rideable or a session. A yellow warning is named beside the hour and leaves it as it is (some, such as rain, matter little on the water), but always mention it.";

const ATTRIBUTION =
  "Weather warnings © Met Éireann (met.ie), CC BY 4.0, published unaltered.";

const localFormat = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const local = (millis: number) =>
  localFormat.format(new Date(millis)).replace(/,/g, "");

export function warningItem(w: PlaceWarning, now: number): WarningItem {
  const m = w.warning;
  return {
    id: m.capId,
    level: w.level,
    type: m.type,
    marine: w.marine,
    headline: m.headline,
    description: descriptionText(m.description),
    onset: m.onset,
    expiry: m.expiry,
    local: `${LEVEL_LABEL[w.level]} ${warningKind(m).toLowerCase()} warning, ${local(w.onset)} – ${local(w.expiry)} Irish time`,
    in_force_now: w.onset <= now && now < w.expiry,
    replaces_ratings: replacesStars(w.level),
    issued: m.issued,
    updated: m.updated,
    severity: m.severity,
    certainty: m.certainty,
    areas: w.areas.map(areaName),
  };
}

/** Why there is nothing to say, where that is not "no warnings". */
function statusNote(
  found: PlaceWarnings,
  place: WarningPlace | null,
): string | undefined {
  if (found.status === "unavailable")
    return `Met Éireann's warnings could not be read just now. Check ${MET_WARNINGS_PAGE} before going out.`;
  if (found.status === "stale")
    return `Met Éireann's warnings were last checked at ${found.checkedAt ?? "an unknown time"}, too long ago to rely on. Check ${MET_WARNINGS_PAGE} before going out.`;
  if (place && placeAreas(place).northernIreland)
    return "Met Éireann issues marine warnings for Northern Ireland's coast but no land warnings there; see the Met Office for those.";
  return undefined;
}

export function warningsAnswer(
  found: PlaceWarnings,
  now: number,
  place: WarningPlace | null = null,
  /** Items worked out already (warningsAcross); else the place's own. */
  items?: WarningItem[],
): WarningsAnswer {
  const note = statusNote(found, place);
  return {
    rule: WARNINGS_RULE,
    status: found.status,
    checked_at: found.checkedAt,
    items: items ?? found.warnings.map((w) => warningItem(w, now)),
    ...(note && { note }),
    page: MET_WARNINGS_PAGE,
    attribution: ATTRIBUTION,
  };
}

/** What an hour says about the warnings covering it; absent with none. */
export interface HourWarning {
  level: WarningLevel;
  /** The warnings' ids, highest level first. */
  ids: string[];
  /** True where an orange or red warning stands in place of the rating. */
  replaces_rating: boolean;
}

/** The warnings covering [time, time + stepHours), or null with none. */
export function hourWarning(
  found: PlaceWarnings,
  time: number,
  stepHours = 1,
): HourWarning | null {
  const covering = warningsDuring(
    found.warnings,
    time,
    time + stepHours * HOUR,
  );
  if (!covering.length) return null;
  const { warnings, level, withheld } = applyWarnings(null, covering);
  return {
    level: level!,
    ids: warnings.map((w) => w.warning.capId),
    replaces_rating: withheld,
  };
}

/**
 * The one step a rating takes past the warnings: null under an orange or red
 * warning, unchanged otherwise. Pass any rating (stars, a rideable verdict).
 */
export const ratingUnderWarnings = <R>(
  rating: R | null,
  warning: Pick<HourWarning, "level"> | null | undefined,
): R | null => applyWarnings(rating, warning ? [warning] : []).rating;

/**
 * The warnings across many places at once, for list_spots and find_wind: each
 * warning once, naming every area it covers, and which places it reaches.
 * With `during`, only warnings in force at some moment of that window.
 */
export function warningsAcross(
  manifest: WarningsManifest | null,
  places: readonly WarningPlace[],
  now: number,
  during?: { from: number; to: number },
): { answer: WarningsAnswer; bySpot: Map<string, PlaceWarning[]> } {
  const bySpot = new Map<string, PlaceWarning[]>();
  const seen = new Map<string, PlaceWarning>();
  for (const place of places) {
    const { warnings } = placeWarnings(manifest, place, now);
    const mine = during
      ? warningsDuring(warnings, during.from, during.to)
      : warnings;
    if (!mine.length) continue;
    bySpot.set(place.id, mine);
    for (const w of mine)
      if (!seen.has(w.warning.capId)) seen.set(w.warning.capId, w);
  }
  const status = warningsStatus(manifest, now);
  const items = [...seen.values()].sort(byLevel).map((w) => ({
    ...warningItem(w, now),
    marine: w.warning.regions.every((code) => SEA_CODE.test(code)),
    areas: w.warning.regions.map(areaName),
  }));
  return {
    answer: warningsAnswer(
      { status, checkedAt: manifest?.generatedAt ?? null, warnings: [] },
      now,
      null,
      items,
    ),
    bySpot,
  };
}

const SEA_CODE = /^EI8\d\d$/;
const RANK: Record<WarningLevel, number> = { yellow: 1, orange: 2, red: 3 };
const byLevel = (a: PlaceWarning, b: PlaceWarning) =>
  RANK[b.level] - RANK[a.level] || a.onset - b.onset;

export { placeWarnings, type PlaceWarnings };
