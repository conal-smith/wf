// Per-spot time series taken straight from a manifest, and a tapped point's
// series sampled from the map frames into the same shape, so the blend reads
// both alike.
import type { Manifest, Wind } from "./weather";

export interface SeriesPoint extends Wind {
  hour: number;
  validTime: string;
}
export interface MemberSeries {
  /** Index into the manifest's member arrays; matches `ensemble.control`. */
  member: number;
  control: boolean;
  points: SeriesPoint[];
}

const covered = (point: SeriesPoint) =>
  Number.isFinite(point.u) && Number.isFinite(point.v);
/**
 * A series of nulls is a model saying it has no coverage at this place — AROME
 * stops at 55.4°N — and not a forecast of calm. Treat it as absent, so the blend
 * never draws a flat zero line for a place the model cannot see.
 */
const usable = (series: SeriesPoint[] | undefined) =>
  Array.isArray(series) && series.length && series.some(covered)
    ? series
    : null;

/** Precomputed series for a named spot, or null when this model omits it. */
export function spotSeries(
  manifest: Manifest,
  spotId: string,
): SeriesPoint[] | null {
  return usable(manifest.spotForecasts?.[spotId]);
}

/** One series per ensemble member, or null for deterministic models. */
export function memberSeries(
  manifest: Manifest,
  spotId: string,
): MemberSeries[] | null {
  const frames = manifest.spotMembers?.[spotId];
  const ensemble = manifest.ensemble;
  if (!ensemble || !Array.isArray(frames) || !frames.length) return null;
  return Array.from({ length: ensemble.members }, (_, member) => ({
    member,
    control: ensemble.control === member,
    points: frames.map((frame) => ({
      hour: frame.hour,
      validTime: frame.validTime,
      u: frame.u[member],
      v: frame.v[member],
      gust: frame.gust[member],
    })),
  }));
}

/**
 * The id a tapped point's sampled series is filed under in a manifest's
 * `spotForecasts` (`withPointSeries`). No riding place's id starts with "@".
 */
export const POINT_SERIES_ID = "@point";

/**
 * A bare point's series out of a run's map frames, sampled one file at a time
 * (src/usePointModels.ts): the frames read so far with a value, in order, or
 * null while there are none. An unread frame or one outside the model's domain
 * is left out rather than written as calm; the blend bridges no gap wider than
 * twice the run's step, so a line fills in as the reads land.
 */
export function sampledSeries(
  frames: readonly Pick<SeriesPoint, "hour" | "validTime">[],
  values: readonly (Wind | null | undefined)[],
): SeriesPoint[] | null {
  const points: SeriesPoint[] = [];
  frames.forEach((frame, at) => {
    const wind = values[at];
    if (wind && Number.isFinite(wind.u) && Number.isFinite(wind.v))
      points.push({
        hour: frame.hour,
        validTime: frame.validTime,
        u: wind.u,
        v: wind.v,
        gust: wind.gust ?? null,
      });
  });
  return points.length ? points : null;
}

/** A manifest carrying a point's sampled series as its one spot's. */
export function withPointSeries(
  manifest: Manifest,
  series: SeriesPoint[] | null,
): Manifest {
  return {
    ...manifest,
    spotForecasts: series ? { [POINT_SERIES_ID]: series } : {},
    spotMembers: undefined,
  };
}

/** Every line a model offers for one spot: members if any, else the mean. */
export function modelSeries(
  manifest: Manifest,
  spotId: string,
): { memberIndex?: number; points: SeriesPoint[] }[] {
  const members = memberSeries(manifest, spotId);
  if (members)
    return members.map((m) => ({ memberIndex: m.member, points: m.points }));
  const mean = spotSeries(manifest, spotId);
  return mean ? [{ points: mean }] : [];
}
