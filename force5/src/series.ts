// Per-spot time series taken straight from a manifest. The multi-model chart
// must never download map frames, so everything here is precomputed-only.
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

const usable = (series: SeriesPoint[] | undefined) =>
  Array.isArray(series) && series.length ? series : null;

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
 * Placeholder for sampling an arbitrary point out of map frames. It always
 * returns null: frame downloads stay in `ForecastSheet`, which already samples
 * progressively with retries, and the blend never triggers them.
 */
export function sampledSeries(
  _manifest: Manifest,
  _lon: number,
  _lat: number,
): SeriesPoint[] | null {
  return null;
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
