/**
 * Every spot's hours, rated: the consensus the dock's stars rest on, computed
 * for a whole axis at once and fast enough to do for every light on the map.
 *
 * It is the same arithmetic as `blendInputs` → `perModelLines` → `blendStats`
 * and `meanDirections` (force5/src/blend.ts, src/chart.ts), and the tests hold
 * it to them value for value. What it does differently is never parse a time
 * twice: a model publishes every spot on the same steps, so where each axis
 * column falls between them is worked out once per model and reused for all
 * 148 places, rather than searched for with `Date.parse` in every series.
 */
import {
  agreementFrom,
  LEAD_MODEL,
  leadHours,
  modelWeight,
  weightedMedian,
  type Agreement,
} from "../force5/src/blend";
import { modelSeries, spotSeries } from "../force5/src/series";
import { dayNights } from "../force5/src/sun";
import { KNOTS } from "../force5/src/units";
import { compass, direction, type Manifest } from "../force5/src/weather";
import {
  directionCost,
  rateHour,
  type HourRating,
  type Rider,
} from "../force5/src/stars";
import { clock, dayShort } from "./strip";

/** What one place is rated as: where it is and which way its shore faces. */
export interface RatedPlace {
  id: string;
  lat: number;
  lon: number;
  facing: number | null;
}

/** One column at one place. Speeds in knots; the bearing is where it blows from. */
export interface PlaceHour {
  windKn: number | null;
  gustKn: number | null;
  from: number | null;
  agreement: Agreement | null;
  daylight: boolean;
  rating: HourRating | null;
}

const HOUR = 3600000;

/** Where each axis time falls in a run's steps: an index and a fraction, or none. */
interface Plan {
  index: Int32Array;
  fraction: Float64Array;
}

const plans = new Map<string, Plan>();
const times = new WeakMap<object, number[]>();

function parsed(points: readonly { validTime: string }[]): number[] {
  let out = times.get(points);
  if (!out) {
    out = points.map((point) => Date.parse(point.validTime));
    times.set(points, out);
  }
  return out;
}

function medianStep(at: readonly number[]): number {
  const steps: number[] = [];
  for (let i = 1; i < at.length; i++) steps.push((at[i] - at[i - 1]) / HOUR);
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return steps[Math.floor((steps.length - 1) / 2)];
}

/** Each model's weight per axis column, worked out once per run and axis. */
const weights = new Map<string, Float64Array>();
function weightsFor(
  manifest: Manifest,
  run: number,
  axis: readonly number[],
  axisKey: string,
) {
  const key = `${manifest.model}|${run}|${axisKey}`;
  const hit = weights.get(key);
  if (hit) return hit;
  const weight = new Float64Array(axis.length);
  for (let c = 0; c < axis.length; c++)
    weight[c] = modelWeight(
      manifest.model,
      leadHours(run, axis[c]),
      manifest.resolutionKm,
    );
  if (weights.size > 64) weights.clear();
  weights.set(key, weight);
  return weight;
}

/**
 * `framePosition` and the gap rule of `interpolateSeries`, for a whole axis:
 * index −1 is a column outside the run or across a gap it cannot bridge.
 */
function planFor(
  at: readonly number[],
  axis: readonly number[],
  axisKey: string,
) {
  const key = `${at.length}|${at[0]}|${at[at.length - 1]}|${axisKey}`;
  const hit = plans.get(key);
  if (hit) return hit;
  const maxGap = 2 * medianStep(at);
  const index = new Int32Array(axis.length).fill(-1);
  const fraction = new Float64Array(axis.length);
  const first = at[0];
  const last = at[at.length - 1];
  axis.forEach((time, column) => {
    if (!at.length || !Number.isFinite(time) || time < first || time > last)
      return;
    if (time === last) {
      index[column] = at.length - 1;
      return;
    }
    // The first step after this time.
    let lo = 0,
      hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid] > time) hi = mid;
      else lo = mid + 1;
    }
    const right = lo;
    if (right < 1) return;
    const left = right - 1;
    const f = (time - at[left]) / (at[right] - at[left]);
    if (f !== 0 && (at[right] - at[left]) / HOUR > maxGap + 1e-9) return;
    index[column] = left;
    fraction[column] = f;
  });
  const plan = { index, fraction };
  if (plans.size > 400) plans.clear();
  plans.set(key, plan);
  return plan;
}

interface Line {
  model: string;
  member: boolean;
  /** The model's weight at each axis column (`modelWeight`). */
  weight: Float64Array;
  /** When its run started, in ms: how far ahead each column is. */
  run: number;
  speed: Float64Array;
  gust: Float64Array;
}

/** One series on the axis, as `interpolateSeries` puts it there; NaN for null. */
function lineOn(
  points: readonly { u: number; v: number; gust: number | null }[],
  plan: Plan,
): { speed: Float64Array; gust: Float64Array } {
  const n = plan.index.length;
  const speed = new Float64Array(n);
  const gust = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const i = plan.index[c];
    if (i < 0) {
      speed[c] = NaN;
      gust[c] = NaN;
      continue;
    }
    const f = plan.fraction[c];
    const a = points[i];
    if (f === 0) {
      speed[c] = Math.hypot(a.u, a.v);
      gust[c] = a.gust === null ? NaN : a.gust;
      continue;
    }
    const b = points[i + 1];
    speed[c] = Math.hypot(a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f);
    gust[c] =
      a.gust === null || b.gust === null ? NaN : a.gust + (b.gust - a.gust) * f;
  }
  return { speed, gust };
}

/**
 * One place's consensus on the axis. Wherever HARMONIE (`LEAD_MODEL`) reaches
 * the hour, the wind, gust and bearing are its own, the gust falling back to
 * the blend's at an hour it gives none. Elsewhere they are the blend: each
 * model taken once (an ensemble as its member mean) at its weight for how far
 * into its run the hour is (`modelWeight`), the weighted median wind and gust
 * and the weighted mean bearing. How far the models agree (`agreementFrom`,
 * against the freshest run's lead) is read across every model either way.
 * Speeds come back in m/s, as the blend keeps them.
 */
export function placeConsensus(
  manifests: readonly Manifest[],
  blendIds: readonly string[],
  id: string,
  axis: readonly string[],
): {
  median: (number | null)[];
  gust: (number | null)[];
  agreement: (Agreement | null)[];
  from: (number | null)[];
} {
  const axisTimes = axis.map((iso) => Date.parse(iso));
  const axisKey = `${axis[0]}|${axis[axis.length - 1]}|${axis.length}`;
  const n = axis.length;
  const lines: Line[] = [];
  const vectors: { u: Float64Array; v: Float64Array; weight: Float64Array }[] =
    [];
  // The lead model's own line and bearing, where it is in the blend.
  let leadLine: Line | undefined;
  let leadVector: { u: Float64Array; v: Float64Array } | undefined;
  for (const blendId of blendIds) {
    const manifest = manifests.find((m) => m.model === blendId);
    if (!manifest) continue;
    const mean = spotSeries(manifest, id);
    // The blend only reads a model that publishes something for this place.
    if (!mean) continue;
    const run = Date.parse(manifest.runTime);
    const weight = weightsFor(manifest, run, axisTimes, axisKey);
    for (const line of modelSeries(manifest, id)) {
      const plan = planFor(parsed(line.points), axisTimes, axisKey);
      const on: Line = {
        model: manifest.model,
        member: line.memberIndex !== undefined,
        weight,
        run,
        ...lineOn(line.points, plan),
      };
      lines.push(on);
      if (on.model === LEAD_MODEL && !on.member) leadLine = on;
    }
    // The arrows read the mean series, as `meanDirections` does.
    const plan = planFor(parsed(mean), axisTimes, axisKey);
    const u = new Float64Array(n).fill(NaN);
    const v = new Float64Array(n).fill(NaN);
    for (let c = 0; c < n; c++) {
      const i = plan.index[c];
      if (i < 0) continue;
      const f = plan.fraction[c];
      const a = mean[i];
      if (f === 0) {
        u[c] = a.u;
        v[c] = a.v;
      } else {
        const b = mean[i + 1];
        u[c] = a.u + (b.u - a.u) * f;
        v[c] = a.v + (b.v - a.v) * f;
      }
    }
    vectors.push({ u, v, weight });
    if (manifest.model === LEAD_MODEL) leadVector = { u, v };
  }
  // `perModelLines`: an ensemble's members collapse to their hourly mean.
  const perModel: {
    weight: Float64Array;
    run: number;
    speed: Float64Array;
    gust: Float64Array;
  }[] = [];
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    if (!line.member) perModel.push(line);
    else groups.set(line.model, [...(groups.get(line.model) ?? []), line]);
  }
  for (const group of groups.values()) {
    if (group.length === 1) {
      perModel.push(group[0]);
      continue;
    }
    const speed = new Float64Array(n);
    const gust = new Float64Array(n);
    for (let c = 0; c < n; c++) {
      let s = 0,
        sn = 0,
        g = 0,
        gn = 0;
      for (const line of group) {
        if (Number.isFinite(line.speed[c])) {
          s += line.speed[c];
          sn++;
        }
        if (Number.isFinite(line.gust[c])) {
          g += line.gust[c];
          gn++;
        }
      }
      speed[c] = sn ? s / sn : NaN;
      gust[c] = gn ? g / gn : NaN;
    }
    perModel.push({ weight: group[0].weight, run: group[0].run, speed, gust });
  }
  const out = {
    median: [] as (number | null)[],
    gust: [] as (number | null)[],
    agreement: [] as (Agreement | null)[],
    from: [] as (number | null)[],
  };
  for (let c = 0; c < n; c++) {
    const speeds: number[] = [];
    const speedWeights: number[] = [];
    const gusts: number[] = [];
    const gustWeights: number[] = [];
    // How far ahead the hour is: from the newest run that has it.
    let freshest = -Infinity;
    for (const line of perModel) {
      if (Number.isFinite(line.speed[c])) {
        if (line.run > freshest) freshest = line.run;
        speeds.push(line.speed[c]);
        speedWeights.push(line.weight[c]);
      }
      if (Number.isFinite(line.gust[c])) {
        gusts.push(line.gust[c]);
        gustWeights.push(line.weight[c]);
      }
    }
    // The lead's own hour, where it has one: the headline.
    const leadSpeed =
      leadLine && Number.isFinite(leadLine.speed[c]) ? leadLine.speed[c] : null;
    out.gust.push(
      leadSpeed !== null && Number.isFinite(leadLine!.gust[c])
        ? leadLine!.gust[c]
        : gusts.length
          ? weightedMedian(gusts, gustWeights)
          : null,
    );
    if (speeds.length) {
      out.median.push(leadSpeed ?? weightedMedian(speeds, speedWeights));
      out.agreement.push(
        agreementFrom(
          speeds.map((speed) => speed * KNOTS),
          leadHours(freshest, axisTimes[c]),
        ),
      );
    } else {
      out.median.push(null);
      out.agreement.push(null);
    }
    if (
      leadSpeed !== null &&
      leadVector &&
      Number.isFinite(leadVector.u[c]) &&
      Number.isFinite(leadVector.v[c])
    ) {
      const lu = leadVector.u[c];
      const lv = leadVector.v[c];
      out.from.push(Math.hypot(lu, lv) >= 0.1 ? direction(lu, lv) : null);
      continue;
    }
    let u = 0,
      v = 0,
      k = 0;
    for (const vector of vectors)
      if (Number.isFinite(vector.u[c]) && Number.isFinite(vector.v[c])) {
        u += vector.u[c] * vector.weight[c];
        v += vector.v[c] * vector.weight[c];
        k += vector.weight[c];
      }
    out.from.push(
      k && Math.hypot(u / k, v / k) >= 0.1 ? direction(u / k, v / k) : null,
    );
  }
  return out;
}

/** Whether each axis time is in daylight at a place, as the dock decides it. */
export function daylightOn(
  place: Pick<RatedPlace, "lat" | "lon">,
  axis: readonly string[],
): boolean[] {
  if (!axis.length) return [];
  const nights = dayNights(
    place.lat,
    place.lon,
    new Date(axis[0]),
    new Date(axis[axis.length - 1]),
  );
  return axis.map((iso) => {
    const time = Date.parse(iso);
    return !nights.some(
      (night) => time >= night.from.getTime() && time < night.to.getTime(),
    );
  });
}

/** One place's columns, rated for this rider. */
export function placeHours(
  manifests: readonly Manifest[],
  blendIds: readonly string[],
  place: RatedPlace,
  axis: readonly string[],
  rider: Rider,
): PlaceHour[] {
  const c = placeConsensus(manifests, blendIds, place.id, axis);
  const light = daylightOn(place, axis);
  return axis.map((_, at) => {
    const windKn = c.median[at] === null ? null : c.median[at]! * KNOTS;
    const gustKn = c.gust[at] === null ? null : c.gust[at]! * KNOTS;
    return {
      windKn,
      gustKn,
      from: c.from[at],
      agreement: c.agreement[at],
      daylight: light[at],
      rating: rateHour(
        {
          windKn,
          gustKn,
          from: c.from[at],
          agreement: c.agreement[at],
          daylight: light[at],
        },
        { facing: place.facing },
        rider,
      ),
    };
  });
}

/**
 * The light's verdict on an hour's shore, for a wind that blows out from the
 * beach: struck through where the rider's rating takes three stars or more off
 * for it (a true offshore on a level's rating, and a cross-offshore for a
 * learner), and otherwise a quieter mark.
 */
export function offshoreMark(
  rating: HourRating | null,
  rider: Rider,
): "struck" | "cross-off" | null {
  if (rating?.shore !== "offshore" && rating?.shore !== "cross-off")
    return null;
  return directionCost(rider, rating.shore) >= 3 ? "struck" : "cross-off";
}

/**
 * A bare point's columns: no model publishes a series for it, so it is read
 * from the map model's own frames as they are sampled (src/usePointSeries.ts),
 * bridging no further than that run's cadence. Not rated: stars are for a
 * riding place, measured against its beach, and a point has none.
 */
export function pointHours(
  frames: readonly { hour: number; validTime: string }[],
  values: readonly (
    { u: number; v: number; gust: number | null } | null | undefined
  )[],
  place: Pick<RatedPlace, "lat" | "lon">,
  axis: readonly string[],
): PlaceHour[] {
  const points = frames.flatMap((frame, index) => {
    const wind = values[index];
    return wind
      ? [{ hour: frame.hour, validTime: frame.validTime, ...wind }]
      : [];
  });
  const at = parsed(frames);
  const maxGap = 2 * medianStep(at);
  const light = daylightOn(place, axis);
  const axisTimes = axis.map((iso) => Date.parse(iso));
  const known = points.map((p) => Date.parse(p.validTime));
  return axis.map((_, c) => {
    const t = axisTimes[c];
    let windKn: number | null = null;
    let gustKn: number | null = null;
    let from: number | null = null;
    // The sampled steps either side of the column, within the run's cadence.
    const right = known.findIndex((k) => k >= t);
    if (right >= 0) {
      const exact = known[right] === t;
      const left = exact ? right : right - 1;
      if (
        left >= 0 &&
        (exact || (known[right] - known[left]) / HOUR <= maxGap + 1e-9)
      ) {
        const a = points[left];
        const b = points[right];
        const f = exact ? 0 : (t - known[left]) / (known[right] - known[left]);
        const u = a.u + (b.u - a.u) * f;
        const v = a.v + (b.v - a.v) * f;
        windKn = Math.hypot(u, v) * KNOTS;
        gustKn =
          a.gust === null || b.gust === null
            ? null
            : (a.gust + (b.gust - a.gust) * f) * KNOTS;
        from = Math.hypot(u, v) >= 0.1 ? direction(u, v) : null;
      }
    }
    return {
      windKn,
      gustKn,
      from,
      agreement: null,
      daylight: light[c],
      // No beach to face, so nothing to rate against.
      rating: null,
    };
  });
}

/** "SW 18g24": an hour's wind as a list of spots gives it, in knots; "" with none. */
export function hourWind(
  hour: Pick<PlaceHour, "windKn" | "gustKn" | "from">,
): string {
  if (hour.windKn === null) return "";
  const kn = `${Math.round(hour.windKn)}${hour.gustKn === null ? "" : `g${Math.round(hour.gustKn)}`}`;
  return hour.from === null ? kn : `${compass(hour.from)} ${kn}`;
}

/**
 * What the pen writes beside the selected light: the hour the map shows, its
 * stars, its wind and the wing they assume ("Sat 15:00 ★★★, SW 18g24, 5 m²").
 * An hour with no rating (dark, or not reached) gets no note. It names the
 * hour and never a day: a rider picks the hours, not a day's best.
 */
export function hourNote(hour: PlaceHour | undefined, time: number): string {
  const rating = hour?.rating;
  if (!hour || !rating) return "";
  const stars = rating.stars ? "★".repeat(rating.stars) : "no stars";
  const wing = rating.potential
    ? `${rating.wing.own ?? rating.wing.recommended} m²`
    : "";
  return [`${dayShort(time)} ${clock(time)} ${stars}`, hourWind(hour), wing]
    .filter(Boolean)
    .join(", ");
}
