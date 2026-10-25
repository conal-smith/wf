/**
 * Met Éireann's weather warnings, and the one rule for what they do to the
 * stars. Every surface that rates an hour reads them through here — the map's
 * dock and lights (src/useRatings.ts), the spot page (spot/web/spot.ts) and the
 * MCP server's tools (mcp/api/warnings.ts) — so a rider and an agent are never
 * told two different things about the same hour.
 *
 * The rule (the owner's, 25 October 2026):
 *
 *   - every warning in force or yet to come that covers the place is shown,
 *     yellow, orange or red, wind, weather or marine, with its level, its kind,
 *     its headline and its validity;
 *   - an ORANGE or RED warning covering an hour takes that hour's stars away:
 *     the warning stands where they were, and no rating or "rideable" verdict
 *     is given for it;
 *   - a YELLOW warning sits beside the stars and leaves them as they are. Some
 *     yellow warnings (rain, fog, heat) say little about the wind on the water,
 *     which is why yellow does not override.
 *
 * The data is Met Éireann's open warnings feed as the `warnings` job publishes
 * it (force5/ingest/fetch_warnings.py, `marine/warnings.json`): every warning
 * exactly as Met Éireann wrote it. Nothing here edits one; it is only matched
 * to places and hours, and an expired one is dropped as the clock passes its
 * expiry, whatever the file says. A file older than WARNINGS_MAX_AGE_HOURS is
 * not trusted at all: a warning lifted since could still be in it, and one
 * issued since would not be, so the page says the warnings could not be
 * checked and sends the rider to met.ie instead of showing stale ones.
 *
 * Licence: CC BY 4.0, with Met Éireann's conditions: say it is Met Éireann's,
 * never alter a warning's times, area, description, severity, certainty, event
 * or headline, keep them current and remove expired ones.
 */
import areas from "../../data/locations/warning-areas.json" with { type: "json" };

/** Where the `warnings` job publishes, under the forecast base. */
export const WARNINGS_URL = "marine/warnings.json";
/**
 * How old the published file may be before it is not trusted: the `warnings`
 * job's maxAgeHours in force5/ingest/registry.py, which a test holds equal.
 * The job reads the feed at :25 every hour and `run` is that hour, so a
 * healthy file is at most about an hour and a half old; three hours lets one
 * late or failed run pass. Expired warnings still drop out at their own
 * expiry, however old the file.
 */
export const WARNINGS_MAX_AGE_HOURS = 3;
/** Met Éireann's own warnings page, for the rider and for a stale file. */
export const MET_WARNINGS_PAGE = "https://www.met.ie/warnings";

const HOUR = 3600000;

export type WarningLevel = "yellow" | "orange" | "red";
export const WARNING_LEVELS: readonly WarningLevel[] = [
  "yellow",
  "orange",
  "red",
];
const RANK: Record<WarningLevel, number> = { yellow: 1, orange: 2, red: 3 };
export const LEVEL_LABEL: Record<WarningLevel, string> = {
  yellow: "Yellow",
  orange: "Orange",
  red: "Red",
};

/**
 * One warning exactly as Met Éireann's feed publishes it (warning_ALL.json;
 * Met_Eireann_Warning_description_June2020.pdf). Never edited: shown as is.
 */
export interface MetWarning {
  id: number;
  /** The CAP identifier: https://cap.met.ie/<capId>.xml. */
  capId: string;
  /** "Wind", "Rain", "Gale", "small-craft", "Thunderstorm", … */
  type: string;
  /** Moderate (yellow), Severe (orange), Extreme (red). */
  severity: string;
  certainty: string;
  level: string;
  issued: string;
  updated: string;
  onset: string;
  expiry: string;
  headline: string;
  /** HTML, as Met Éireann wrote it. descriptionText reads it as plain text. */
  description: string;
  status: string;
  /** County FIPS codes (EI01–EI31) and sea area EMMA_IDs (EI805–EI825). */
  regions: string[];
}

export interface WarningsManifest {
  schemaVersion: 1;
  kind: "warnings";
  model: "warnings";
  /** YYYYMMDDHH: the hour the feed was read in. */
  run: string;
  runTime: string;
  generatedAt: string;
  sourceUrl?: string;
  attribution?: string;
  licenseUrl?: string;
  warnings: MetWarning[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const instant = (value: unknown) => (isText(value) ? Date.parse(value) : NaN);

/** The warning's level, from its `level`, or null for one this site does not show. */
export function levelOf(
  warning: Pick<MetWarning, "level">,
): WarningLevel | null {
  const level = String(warning.level).trim().toLowerCase();
  return (WARNING_LEVELS as readonly string[]).includes(level)
    ? (level as WarningLevel)
    : null;
}

/**
 * The published file, or null when it is not one: a reader that cannot trust
 * the file shows the warnings as not checked, never as none.
 */
export function readWarningsManifest(value: unknown): WarningsManifest | null {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "warnings" ||
    !Number.isFinite(instant(value.runTime)) ||
    !Array.isArray(value.warnings)
  )
    return null;
  const usable = value.warnings.every(
    (w) =>
      isObject(w) &&
      isText(w.capId) &&
      isText(w.type) &&
      isText(w.level) &&
      isText(w.headline) &&
      isText(w.description) &&
      Number.isFinite(instant(w.onset)) &&
      Number.isFinite(instant(w.expiry)) &&
      Array.isArray(w.regions) &&
      w.regions.every(isText),
  );
  return usable ? (value as unknown as WarningsManifest) : null;
}

// ---- where a warning applies -------------------------------------------------

/** A place as the warnings need it: what every riding location already has. */
export interface WarningPlace {
  id: string;
  county: string;
  lat: number;
  lon: number;
}

export interface PlaceAreas {
  /** County FIPS codes whose land warnings apply: its own, and any it shares water with. */
  counties: string[];
  /** Sea area EMMA_IDs whose marine warnings apply: none for an inland lake. */
  sea: string[];
  /**
   * In Northern Ireland, where Met Éireann issues no land warnings: only its
   * marine warnings can reach these places (the Met Office's do not come here).
   */
  northernIreland: boolean;
}

interface AreaTable {
  counties: Record<string, string>;
  northernIreland: string[];
  seaAreas: Record<string, string>;
  headlands: { name: string; lat: number; lon: number }[];
  fallbackKm: number;
  places: Record<string, { sea: string[]; alsoCounties?: string[] }>;
}
const TABLE = areas as AreaTable;

/** County, sea area or Irish Sea area name by code: "Dublin", "Carlingford Lough to Howth Head". */
export const areaName = (code: string): string =>
  TABLE.seaAreas[code] ??
  Object.entries(TABLE.counties).find(([, c]) => c === code)?.[0] ??
  code;

/** The code for a county as the riding locations name it, or null outside the Republic. */
const countyCode = (county: string): string | null =>
  TABLE.counties[county.trim()] ?? null;

const flat = (lat: number, lon: number): [number, number] => [
  lon * Math.cos((53.5 * Math.PI) / 180) * 111.32,
  lat * 110.57,
];

function segmentKm(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * The coastal stretches nearest a point, nearest first, with how far each is:
 * Met Éireann's sea areas run clockwise from Malin Head, each the coast
 * between two headlands (`headlands`), and a stretch is measured as the
 * straight line between its two. Only a fallback and a check: a deep bay can
 * be nearer the line across another stretch than its own, so every riding
 * place has its areas written out in data/locations/warning-areas.json.
 */
export function nearestStretches(
  lat: number,
  lon: number,
): { code: string; km: number }[] {
  const h = TABLE.headlands;
  const p = flat(lat, lon);
  return h
    .map((from, i) => {
      const to = h[(i + 1) % h.length];
      return {
        code: `EI${805 + i}`,
        km: segmentKm(p, flat(from.lat, from.lon), flat(to.lat, to.lon)),
      };
    })
    .sort((a, b) => a.km - b.km);
}

/** Which counties and sea areas a place's warnings come from. */
export function placeAreas(place: WarningPlace): PlaceAreas {
  const own = countyCode(place.county);
  const entry = TABLE.places[place.id];
  const also = (entry?.alsoCounties ?? []).flatMap((county) => {
    const code = countyCode(county);
    return code ? [code] : [];
  });
  // A place the table does not know yet: the nearest stretch, if it is
  // near the coast at all. data/locations/warning-areas.json should name it.
  const nearest = nearestStretches(place.lat, place.lon)[0];
  const sea = entry
    ? entry.sea
    : nearest.km <= TABLE.fallbackKm
      ? [nearest.code]
      : [];
  return {
    counties: [...new Set([...(own ? [own] : []), ...also])],
    sea: [...sea],
    northernIreland: TABLE.northernIreland.includes(place.county.trim()),
  };
}

// ---- which warnings, when ------------------------------------------------------

/** A warning that covers a place, with what its matching rests on. */
export interface PlaceWarning {
  /** The warning as Met Éireann published it. */
  warning: MetWarning;
  level: WarningLevel;
  /** Its onset and expiry, in milliseconds. */
  onset: number;
  expiry: number;
  /** Matched through a sea area (a marine warning) rather than a county. */
  marine: boolean;
  /** The place's codes the warning names. */
  areas: string[];
}

export type WarningsStatus = "current" | "stale" | "unavailable";

export interface PlaceWarnings {
  /**
   * `current`: the file is fresh and `warnings` is everything for the place.
   * `stale` or `unavailable`: the warnings could not be checked, so none are
   * given and none takes a star away; say so, and point at met.ie.
   */
  status: WarningsStatus;
  /** When the published file was written, or null with none. */
  checkedAt: string | null;
  warnings: PlaceWarning[];
}

/** Whether the file is recent enough to show as Met Éireann's current warnings. */
export function warningsStatus(
  manifest: WarningsManifest | null,
  now: number,
): WarningsStatus {
  if (!manifest) return "unavailable";
  const age = now - Date.parse(manifest.runTime);
  return age > WARNINGS_MAX_AGE_HOURS * HOUR ? "stale" : "current";
}

/** Highest level first, then the soonest onset. */
const order = (a: PlaceWarning, b: PlaceWarning) =>
  RANK[b.level] - RANK[a.level] || a.onset - b.onset || a.expiry - b.expiry;

/**
 * Every warning not yet expired that names one of the place's counties or sea
 * areas: those in force and those still to come. Expired ones are dropped
 * here by the clock, whatever the file still lists.
 */
export function placeWarnings(
  manifest: WarningsManifest | null,
  place: WarningPlace,
  now: number,
): PlaceWarnings {
  const status = warningsStatus(manifest, now);
  const checkedAt = manifest?.generatedAt ?? null;
  if (status !== "current") return { status, checkedAt, warnings: [] };
  const { counties, sea } = placeAreas(place);
  const mine = new Set([...counties, ...sea]);
  const warnings = manifest!.warnings.flatMap((warning): PlaceWarning[] => {
    const level = levelOf(warning);
    const onset = Date.parse(warning.onset);
    const expiry = Date.parse(warning.expiry);
    if (!level || !(expiry > now)) return [];
    const hit = warning.regions.filter((code) => mine.has(code));
    if (!hit.length) return [];
    return [
      {
        warning,
        level,
        onset,
        expiry,
        marine: hit.some((code) => sea.includes(code)),
        areas: hit,
      },
    ];
  });
  return { status, checkedAt, warnings: warnings.sort(order) };
}

/** The warnings in force at any moment of [from, to): an hour, or a three-hour row. */
export function warningsDuring(
  warnings: readonly PlaceWarning[],
  from: number,
  to: number = from + HOUR,
): PlaceWarning[] {
  return warnings.filter((w) => w.onset < to && w.expiry > from);
}

/** THE RULE: orange and red stand in place of the stars; yellow sits beside them. */
export const replacesStars = (level: WarningLevel): boolean =>
  level === "orange" || level === "red";

/** The highest level among some warnings, or null with none. */
const topLevel = (
  warnings: readonly Pick<PlaceWarning, "level">[],
): WarningLevel | null =>
  warnings.reduce<WarningLevel | null>(
    (top, w) => (top === null || RANK[w.level] > RANK[top] ? w.level : top),
    null,
  );

/** An hour's rating with the warnings that cover it applied. */
export interface Warned<R, W extends { level: WarningLevel } = PlaceWarning> {
  /** The rating, or null where an orange or red warning stands in its place. */
  rating: R | null;
  /** Every warning covering the hour, highest level first. */
  warnings: W[];
  /** The highest of their levels, or null with none. */
  level: WarningLevel | null;
  /** True where an orange or red warning took the hour's rating away. */
  withheld: boolean;
}

/**
 * Apply the warnings that cover an hour to its rating: the one step every
 * rater shares (the site's stars, the MCP's ratings and its find_wind
 * verdicts), so they always agree. The rating is whatever the caller rates
 * with (stars, a "rideable" verdict); this never looks inside it, and the
 * warnings need only their level.
 */
export function applyWarnings<R, W extends { level: WarningLevel }>(
  rating: R | null,
  covering: readonly W[],
): Warned<R, W> {
  const warnings = [...covering].sort((a, b) => RANK[b.level] - RANK[a.level]);
  const level = topLevel(warnings);
  const withheld = level !== null && replacesStars(level);
  return { rating: withheld ? null : rating, warnings, level, withheld };
}

// ---- in words ------------------------------------------------------------------

const TYPE_LABEL: Record<string, string> = {
  wind: "Wind",
  rain: "Rain",
  "rain-flood": "Rain",
  thunderstorm: "Thunderstorm",
  fog: "Fog",
  "snow-ice": "Snow and ice",
  "low-temperature": "Low temperature",
  "high-temperature": "High temperature",
  gale: "Gale",
  "small-craft": "Small craft",
  storm: "Storm",
  "violent-storm": "Violent storm",
  coastalevent: "Coastal",
  advisory: "Advisory",
};

/** The kind of warning, as Met Éireann names it: "Wind", "Small craft". */
export function warningKind(warning: Pick<MetWarning, "type">): string {
  const key = warning.type.trim().toLowerCase().replace(/\s+/g, "-");
  if (TYPE_LABEL[key]) return TYPE_LABEL[key];
  const words = warning.type.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  deg: "°",
};

/**
 * A warning's description as plain text: Met Éireann writes it as HTML
 * paragraphs and lists. Every word is kept; only the markup goes, a list item
 * becoming a line that starts "• ". Safe to put in a page as text, and works
 * without a DOM, so the MCP server reads it the same way.
 */
export function descriptionText(html: string): string {
  return html
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*(br|\/p|\/li|\/ul|\/ol|\/div|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1].toLowerCase() === "x"
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const whenFormat = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Sat 24 Oct, 14:00": an instant in Irish time. */
const warningTime = (millis: number): string =>
  whenFormat
    .format(new Date(millis))
    .replace(/,(?= \d{2}:)/, "")
    .replace(/,/g, "");

/** "Sat 24 Oct 14:00 – Sun 25 Oct 10:00", Irish time. */
export const validityText = (
  w: Pick<PlaceWarning, "onset" | "expiry">,
): string => `${warningTime(w.onset)} – ${warningTime(w.expiry)}`;
