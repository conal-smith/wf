/**
 * The EPA's bathing water notices, and the one rule for what they do to the
 * stars. Every surface that rates an hour reads them through here — the map's
 * dock and lights (src/useRatings.ts), the spot page (through the MCP's
 * `spotForecast`) and the MCP server's tools (mcp/api/waterQuality.ts) — so a
 * rider and an agent are never told two different things about the same water.
 *
 * The rule, after Met Éireann's warnings (force5/src/warnings.ts):
 *
 *   - every notice standing at a bathing water near the place is shown, with
 *     the restriction and the cause as the council wrote them, and when;
 *   - a PROHIBITION or an ADVICE AGAINST BATHING covering an hour takes that
 *     hour's stars away, as an orange or red warning does: the notice stands
 *     where they were, and no rating or "rideable" verdict is given for it.
 *     A restriction of a type this site does not know is read the same way;
 *   - a PRIOR WARNING (water quality may be affected, usually by heavy rain
 *     expected) and a restriction for the WHOLE SEASON (a bathing water rated
 *     poor over four years) sit beside the stars and leave them as they are.
 *     The first is a may, not a finding; the second stands all year, whatever
 *     the water is like on the day.
 *
 * The data is the EPA's Bathing Water API as the `water-quality` job publishes
 * it (force5/ingest/fetch_water_quality.py, `marine/water-quality.json`): each
 * notice as the EPA has it, and for each riding place the bathing waters within
 * `maxDistanceKm`. A place with none has nothing known about its water, which
 * is not the same as clean water: the EPA monitors bathing waters in the
 * Republic, in the bathing season. A file older than
 * WATER_QUALITY_MAX_AGE_HOURS is not trusted at all, as with the warnings.
 *
 * Licence: CC BY 4.0. Say it is the EPA's (beaches.ie).
 */

/** Where the `water-quality` job publishes, under the forecast base. */
export const WATER_QUALITY_URL = "marine/water-quality.json";
/**
 * How old the published file may be before it is not trusted: the job's
 * maxAgeHours in force5/ingest/registry.py, which a test holds equal. It runs
 * hourly at :40, so a file on time is under two hours old.
 */
export const WATER_QUALITY_MAX_AGE_HOURS = 3;
/** The EPA's bathing water site, where every notice is published first. */
export const BEACHES_PAGE = "https://www.beaches.ie";

const HOUR = 3600000;

export type NoticeKind =
  | "prohibition"
  | "advice-against"
  | "restriction"
  | "prior-warning"
  | "all-season";

/** One notice as the job publishes it: the EPA's own fields, unaltered. */
export interface WaterNotice {
  /** The EPA's incident id ("BWI002046"), or `season-<water>` for an all-season restriction. */
  id: string;
  /** The bathing water's EPA id. */
  water: string;
  /** The bathing water's name, as the EPA gives it. */
  beach: string;
  county: string | null;
  authority: string | null;
  kind: NoticeKind;
  /** As published: "Bathing is temporarily prohibited". Null for an all-season restriction. */
  restriction: string | null;
  /** The cause, as published: "Water quality deteriorated due to suspected storm water overflow". */
  description: string | null;
  /** The start and end dates as published (no zone); end null while open. */
  start: string | null;
  expectedDays: number | null;
  end: string | null;
  /** The start of the first day and the end of the last, Irish time, in UTC; null for none. */
  from: string | null;
  until: string | null;
  /** The council's notice (a PDF on beaches.ie). */
  notice: string | null;
  updated: string | null;
}

/** A bathing water near a place. */
export interface NearWater {
  water: string;
  name: string;
  km: number;
}

export interface WaterQualityManifest {
  schemaVersion: 1;
  kind: "water-quality";
  model: "water-quality";
  run: string;
  runTime: string;
  generatedAt: string;
  sourceUrl?: string;
  page?: string;
  attribution?: string;
  licenseUrl?: string;
  maxDistanceKm: number;
  notices: WaterNotice[];
  /** Each riding place's bathing waters within maxDistanceKm, nearest first. */
  spots: Record<string, NearWater[]>;
}

const KINDS: readonly NoticeKind[] = [
  "prohibition",
  "advice-against",
  "restriction",
  "prior-warning",
  "all-season",
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const textOrNull = (value: unknown) => value === null || isText(value);
const instant = (value: unknown) => (isText(value) ? Date.parse(value) : NaN);
const instantOrNull = (value: unknown) =>
  value === null || Number.isFinite(instant(value));

/**
 * The published file, or null when it is not one: a reader that cannot trust
 * the file shows the water quality as not checked, never as clear.
 */
export function readWaterQualityManifest(
  value: unknown,
): WaterQualityManifest | null {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "water-quality" ||
    !Number.isFinite(instant(value.runTime)) ||
    typeof value.maxDistanceKm !== "number" ||
    !Array.isArray(value.notices) ||
    !isObject(value.spots)
  )
    return null;
  const notices = value.notices.every(
    (n) =>
      isObject(n) &&
      isText(n.id) &&
      isText(n.water) &&
      isText(n.beach) &&
      (KINDS as readonly unknown[]).includes(n.kind) &&
      textOrNull(n.restriction) &&
      textOrNull(n.description) &&
      textOrNull(n.notice) &&
      instantOrNull(n.from) &&
      instantOrNull(n.until),
  );
  const spots = Object.values(value.spots).every(
    (near) =>
      Array.isArray(near) &&
      near.every(
        (w) => isObject(w) && isText(w.water) && typeof w.km === "number",
      ),
  );
  return notices && spots ? (value as unknown as WaterQualityManifest) : null;
}

// ---- the rule --------------------------------------------------------------------

/** THE RULE: a prohibition or advice against bathing stands in place of the stars. */
export const noticeReplacesStars = (kind: NoticeKind): boolean =>
  kind === "prohibition" || kind === "advice-against" || kind === "restriction";

/** A notice standing at one of a place's bathing waters. */
export interface SpotNotice {
  notice: WaterNotice;
  /** How far the bathing water is from the place. */
  km: number;
  /** When it applies, in milliseconds: -Infinity and Infinity where it has no start or end. */
  from: number;
  until: number;
  /** A prohibition or advice against bathing: no stars for the hours it covers. */
  replacesStars: boolean;
}

export type WaterQualityStatus = "current" | "stale" | "unavailable";

export interface SpotWaterQuality {
  /**
   * `current`: the file is fresh, and `notices` is everything at the place's
   * bathing waters. `stale` or `unavailable`: nothing could be checked, so
   * nothing is given and nothing takes a star away.
   */
  status: WaterQualityStatus;
  checkedAt: string | null;
  /** The bathing waters near the place; none where the EPA monitors none. */
  waters: NearWater[];
  /** How near a bathing water must be, in km; null with no file. */
  maxDistanceKm: number | null;
  notices: SpotNotice[];
}

export function waterQualityStatus(
  manifest: WaterQualityManifest | null,
  now: number,
): WaterQualityStatus {
  if (!manifest) return "unavailable";
  const age = now - Date.parse(manifest.runTime);
  return age > WATER_QUALITY_MAX_AGE_HOURS * HOUR ? "stale" : "current";
}

/** Those that take the stars first, then the soonest, then the nearest. */
const order = (a: SpotNotice, b: SpotNotice) =>
  Number(b.replacesStars) - Number(a.replacesStars) ||
  a.from - b.from ||
  a.km - b.km;

/**
 * Every notice at a bathing water near the place, not yet over: those in force
 * and those still to come. One past its end is dropped by the clock.
 */
export function spotWaterQuality(
  manifest: WaterQualityManifest | null,
  spotId: string,
  now: number,
): SpotWaterQuality {
  const status = waterQualityStatus(manifest, now);
  const checkedAt = manifest?.generatedAt ?? null;
  const maxDistanceKm = manifest?.maxDistanceKm ?? null;
  if (status !== "current")
    return { status, checkedAt, waters: [], maxDistanceKm, notices: [] };
  const waters = manifest!.spots[spotId] ?? [];
  const near = new Map(waters.map((w) => [w.water, w.km]));
  const notices = manifest!.notices.flatMap((notice): SpotNotice[] => {
    const km = near.get(notice.water);
    if (km === undefined) return [];
    const from = notice.from ? Date.parse(notice.from) : -Infinity;
    const until = notice.until ? Date.parse(notice.until) : Infinity;
    if (!(until > now)) return [];
    return [
      {
        notice,
        km,
        from,
        until,
        replacesStars: noticeReplacesStars(notice.kind),
      },
    ];
  });
  return {
    status,
    checkedAt,
    waters: [...waters],
    maxDistanceKm,
    notices: notices.sort(order),
  };
}

/** The notices standing at any moment of [from, to): an hour, or a three-hour row. */
export function noticesDuring(
  notices: readonly SpotNotice[],
  from: number,
  to: number = from + HOUR,
): SpotNotice[] {
  return notices.filter((n) => n.from < to && n.until > from);
}

/** An hour's rating with the notices that cover it applied. */
export interface WaterRated<R> {
  /** The rating, or null where a prohibition or advice against bathing stands in its place. */
  rating: R | null;
  /** True where a notice took the hour's rating away. */
  withheld: boolean;
}

/**
 * Apply the notices covering an hour to its rating: the one step every rater
 * shares (the site's stars, the MCP's ratings and find_wind's sessions). It
 * never looks inside the rating; the notices need only say whether they
 * replace the stars.
 */
export function applyWaterQuality<R>(
  rating: R | null,
  covering: readonly Pick<SpotNotice, "replacesStars">[],
): WaterRated<R> {
  const withheld = covering.some((n) => n.replacesStars);
  return { rating: withheld ? null : rating, withheld };
}

// ---- in words ------------------------------------------------------------------

/** What the notice restricts, in the EPA's words where it gives them. */
export function noticeName(
  notice: Pick<WaterNotice, "restriction" | "kind">,
): string {
  return (
    notice.restriction ??
    (notice.kind === "all-season"
      ? "Bathing restricted for the whole season"
      : "Bathing restriction")
  );
}

/** The word a notice's mark has room for, in a star cell. */
export const NOTICE_MARK = "Water";

const dayFormat = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const day = (millis: number) => dayFormat.format(new Date(millis)).replace(/,/g, "");

/**
 * When a notice applies, in Irish days: "Sun 14 Sept – Thu 18 Sept", "From
 * Sun 14 Sept, expected to last 5 days, until lifted", "All season".
 */
export function noticeWhen(
  n: Pick<SpotNotice, "from" | "until"> & {
    notice: Pick<WaterNotice, "expectedDays" | "kind">;
  },
): string {
  if (n.notice.kind === "all-season" && !Number.isFinite(n.from))
    return "All season, until lifted";
  const start = Number.isFinite(n.from) ? day(n.from) : null;
  if (Number.isFinite(n.until))
    // `until` is the end of the last day: name that day.
    return `${start ?? "Until"}${start ? " – " : " "}${day(n.until - 1)}`;
  const expected = n.notice.expectedDays
    ? `, expected to last ${n.notice.expectedDays} day${n.notice.expectedDays === 1 ? "" : "s"}`
    : "";
  return start
    ? `From ${start}${expected}, until lifted`
    : `Until lifted${expected}`;
}
