/**
 * The EPA's bathing water notices as an agent reads them: the same published
 * file and the same rule as the site (force5/src/waterQuality.ts), kept short.
 *
 * get_spot_forecast carries `water_quality`: the notices standing at the
 * bathing waters near the spot, each with the restriction and its cause as
 * the council wrote them, when it applies and its notice; and `water` on each
 * hour one covers. An hour under a prohibition or an advice against bathing
 * gets no rating and is never counted rideable (find_wind leaves it out of
 * every session, and lists the notice in its own `water_quality`); a prior
 * warning or an all-season restriction is named and changes nothing.
 */
import {
  BEACHES_PAGE,
  WATER_QUALITY_URL,
  applyWaterQuality,
  noticeName,
  noticeWhen,
  noticesDuring,
  readWaterQualityManifest,
  spotWaterQuality,
  waterQualityStatus,
  type SpotNotice,
  type SpotWaterQuality,
  type WaterQualityManifest,
  type WaterQualityStatus,
} from "../../force5/src/waterQuality.js";
import type { ForecastSource } from "./httpSource.js";

const HOUR = 3600000;

/** The published notices, or null when there are none to trust. Never throws. */
export async function loadWaterQuality(
  source: ForecastSource,
): Promise<WaterQualityManifest | null> {
  try {
    return readWaterQualityManifest(await source.json(WATER_QUALITY_URL));
  } catch {
    return null;
  }
}

/** One notice as a tool answers it. */
export interface WaterItem {
  /** The EPA's incident id; hours and spots refer to notices by it. */
  id: string;
  /** The bathing water it was issued for, and how far that is from the spot. */
  beach: string;
  km?: number;
  /** The restriction as published: "Bathing is temporarily prohibited". */
  restriction: string;
  /** The cause as published: "Water quality deteriorated due to suspected storm water overflow". */
  cause?: string;
  /** When it applies, Irish days: "From Sun 14 Sept, expected to last 5 days, until lifted". */
  when: string;
  in_force_now: boolean;
  /** A prohibition or advice against bathing: the hours it covers have no rating. */
  replaces_ratings: boolean;
  /** The council's notice. */
  notice?: string;
  /** In find_wind: the searched spots it reaches. */
  spots?: string[];
}

export interface WaterAnswer {
  /**
   * `current`: `items` is every notice for the spot. `not-monitored`: no
   * EPA bathing water near enough to say anything. `stale` or `unavailable`:
   * not checked.
   */
  status: WaterQualityStatus | "not-monitored";
  checked_at?: string | null;
  items: WaterItem[];
  /** What the notices do to the forecast, only when there are some. */
  rule?: string;
  note?: string;
  source: string;
}

export const WATER_RULE =
  "Official bathing water notices (EPA, beaches.ie) at bathing waters near the spot, for people who will be in the water. A prohibition or advice against bathing replaces the rating of every hour it covers: never call such an hour good or rideable. A prior warning or an all-season restriction leaves the rating as it is, but always mention it.";

const SOURCE = "EPA bathing water notices, beaches.ie, CC BY 4.0";

export function waterItem(n: SpotNotice, now: number, km = true): WaterItem {
  const { notice } = n;
  return {
    id: notice.id,
    beach: notice.beach,
    ...(km && { km: n.km }),
    restriction: noticeName(notice),
    ...(notice.description && { cause: notice.description }),
    when: noticeWhen(n),
    in_force_now: n.from <= now && now < n.until,
    replaces_ratings: n.replacesStars,
    ...(notice.notice && { notice: notice.notice }),
  };
}

/** Why there is nothing to say, where that is not "no notices". */
function statusNote(found: SpotWaterQuality): string | undefined {
  if (found.status === "unavailable")
    return `The bathing water notices could not be read just now. Check ${BEACHES_PAGE}.`;
  if (found.status === "stale")
    return `The bathing water notices were last checked at ${found.checkedAt ?? "an unknown time"}, too long ago to rely on. Check ${BEACHES_PAGE}.`;
  if (!found.waters.length)
    return `No EPA bathing water within ${found.maxDistanceKm ?? "range"} km, so nothing is known about the water quality here; that is not a sign it is clean.`;
  return undefined;
}

/** A spot's `water_quality`, as get_spot_forecast gives it. */
export function waterAnswer(found: SpotWaterQuality, now: number): WaterAnswer {
  const note = statusNote(found);
  const items = found.notices.map((n) => waterItem(n, now));
  return {
    status:
      found.status === "current" && !found.waters.length
        ? "not-monitored"
        : found.status,
    ...(found.status === "current" && { checked_at: found.checkedAt }),
    items,
    ...(items.length && { rule: WATER_RULE }),
    ...(note && { note }),
    source: SOURCE,
  };
}

/** What an hour says about the notices covering it; absent with none. */
export interface HourWater {
  ids: string[];
  /** True where a prohibition or advice against bathing stands in place of the rating. */
  replaces_rating: boolean;
}

/** The notices covering [time, time + stepHours), or null with none. */
export function hourWater(
  found: Pick<SpotWaterQuality, "notices">,
  time: number,
  stepHours = 1,
): HourWater | null {
  const covering = noticesDuring(found.notices, time, time + stepHours * HOUR);
  if (!covering.length) return null;
  return {
    ids: covering.map((n) => n.notice.id),
    replaces_rating: applyWaterQuality(null, covering).withheld,
  };
}

/** The one step a rating takes past the notices: null under one that replaces it. */
export const ratingUnderWater = <R>(
  rating: R | null,
  water: Pick<HourWater, "replaces_rating"> | null | undefined,
): R | null =>
  applyWaterQuality(
    rating,
    water ? [{ replacesStars: water.replaces_rating }] : [],
  ).rating;

/**
 * The notices across many spots, for find_wind: each notice once, naming the
 * spots it reaches. With `during`, only notices standing in that window.
 */
export function waterAcross(
  manifest: WaterQualityManifest | null,
  spotIds: readonly string[],
  now: number,
  during?: { from: number; to: number },
): { answer: WaterAnswer; bySpot: Map<string, SpotNotice[]> } {
  const bySpot = new Map<string, SpotNotice[]>();
  const seen = new Map<string, { notice: SpotNotice; spots: string[] }>();
  for (const id of spotIds) {
    const { notices } = spotWaterQuality(manifest, id, now);
    const mine = during
      ? noticesDuring(notices, during.from, during.to)
      : notices;
    if (!mine.length) continue;
    bySpot.set(id, mine);
    for (const n of mine) {
      const entry = seen.get(n.notice.id) ?? { notice: n, spots: [] };
      entry.spots.push(id);
      seen.set(n.notice.id, entry);
    }
  }
  const status = waterQualityStatus(manifest, now);
  const items = [...seen.values()].map(({ notice, spots }) => ({
    ...waterItem(notice, now, false),
    spots,
  }));
  const note =
    status === "current"
      ? undefined
      : statusNote({
          status,
          checkedAt: manifest?.generatedAt ?? null,
          waters: [],
          maxDistanceKm: null,
          notices: [],
        });
  return {
    answer: {
      status,
      ...(status === "current" && { checked_at: manifest!.generatedAt }),
      items,
      ...(items.length && { rule: WATER_RULE }),
      ...(note && { note }),
      source: SOURCE,
    },
    bySpot,
  };
}
