/**
 * Every spot's hours, rated: the consensus the dock's stars rest on, computed
 * for a whole axis at once and fast enough to do for every light on the map.
 *
 * It is the same arithmetic as `blendInputs` → `perModelLines` → `blendStats`
 * and `meanDirections` (force5/src/blend.ts, src/chart.ts), and the tests hold
 * it to them value for value. What it does differently is never parse a time
 * twice: a model publishes every spot on the same steps, so where each axis
 * column falls between them is worked out once per model and reused for all
 * 146 places, rather than searched for with `Date.parse` in every series.
 */
import { agreementFor, type Agreement } from "../force5/src/blend";
import { modelSeries, spotSeries } from "../force5/src/series";
import { dayNights } from "../force5/src/sun";
import { KNOTS } from "../force5/src/units";
import { direction, type Manifest } from "../force5/src/weather";
import { rateHour, type HourRating, type Rider } from "../force5/src/stars";

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

/**
 * `framePosition` and the gap rule of `interpolateSeries`, for a whole axis:
 * index −1 is a column outside the run or across a gap it cannot bridge.
 */
function planFor(at: readonly number[], axis: readonly number[], axisKey: string) {
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

const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  const position = (values.length - 1) * 0.5;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return values[low] + (values[high] - values[low]) * (position - low);
};

/**
 * One place's consensus on the axis: each model counted once (an ensemble as
 * its member mean), its median wind and gust, how far the models agree, and
 * the mean bearing. Speeds come back in m/s, as the blend keeps them.
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
  const vectors: { u: Float64Array; v: Float64Array }[] = [];
  for (const blendId of blendIds) {
    const manifest = manifests.find((m) => m.model === blendId);
    if (!manifest) continue;
    const mean = spotSeries(manifest, id);
    // The blend only reads a model that publishes something for this place.
    if (!mean) continue;
    for (const line of modelSeries(manifest, id)) {
      const plan = planFor(parsed(line.points), axisTimes, axisKey);
      lines.push({
        model: manifest.model,
        member: line.memberIndex !== undefined,
        ...lineOn(line.points, plan),
      });
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
    vectors.push({ u, v });
  }
  // `perModelLines`: an ensemble's members collapse to their hourly mean.
  const perModel: { speed: Float64Array; gust: Float64Array }[] = [];
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
    perModel.push({ speed, gust });
  }
  const out = {
    median: [] as (number | null)[],
    gust: [] as (number | null)[],
    agreement: [] as (Agreement | null)[],
    from: [] as (number | null)[],
  };
  for (let c = 0; c < n; c++) {
    const speeds: number[] = [];
    const gusts: number[] = [];
    for (const line of perModel) {
      if (Number.isFinite(line.speed[c])) speeds.push(line.speed[c]);
      if (Number.isFinite(line.gust[c])) gusts.push(line.gust[c]);
    }
    out.gust.push(gusts.length ? median(gusts) : null);
    if (speeds.length) {
      const m = median(speeds);
      out.median.push(m);
      out.agreement.push(agreementFor(speeds[speeds.length - 1] - speeds[0]));
    } else {
      out.median.push(null);
      out.agreement.push(null);
    }
    let u = 0,
      v = 0,
      k = 0;
    for (const vector of vectors)
      if (Number.isFinite(vector.u[c]) && Number.isFinite(vector.v[c])) {
        u += vector.u[c];
        v += vector.v[c];
        k++;
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
 * The light's verdict on an hour's shore: struck through only for a true
 * offshore, and for a learner a cross-offshore too; any other cross-offshore
 * hour carries a quieter mark.
 */
export function offshoreMark(
  rating: HourRating | null,
  rider: Rider,
): "struck" | "cross-off" | null {
  if (!rating?.shore) return null;
  if (rating.shore === "offshore") return "struck";
  if (rating.shore === "cross-off")
    return rider.skill === "beginner" ? "struck" : "cross-off";
  return null;
}
