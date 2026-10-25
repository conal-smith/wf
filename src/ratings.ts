/**
 * Every spot's hours, rated: the one model's wind the dock's stars rest on
 * (force5/src/lead.ts), and how far all the models agree beside it, computed
 * for a whole axis at once and fast enough to do for every light on the map.
 *
 * It is the same arithmetic as `blendInputs` → `perModelLines` → `blendStats`
 * (force5/src/blend.ts) under the same headline the dock's chart draws
 * (src/useBlend.ts), and the tests hold it to them value for value. What it does differently is never parse a time
 * twice: a model publishes every spot on the same steps, so where each axis
 * column falls between them is worked out once per model and reused for all
 * 149 places, rather than searched for with `Date.parse` in every series.
 */
import { agreementFrom, leadHours, type Agreement } from "../force5/src/blend";
import {
  DEFAULT_STARS_FROM,
  leadOrder,
  pickModel,
  starsFromAt,
  type StarsFrom,
} from "../force5/src/lead";
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
// Only a type: the blend bundles this module, and the warnings (with their
// area table) are applied apart from it, in src/warnHours.ts.
import type { WarningLevel } from "../force5/src/warnings";

/** What one place is rated as: where it is and which way its shore faces. */
export interface RatedPlace {
  id: string;
  lat: number;
  lon: number;
  facing: number | null;
  /** Its county, for the Met Éireann warnings it is in (force5/src/warnings.ts). */
  county?: string;
}

/** The Met Éireann warnings over a column, at their highest level. */
export interface PlaceHourWarning {
  level: WarningLevel;
  /** Orange or red: the warning stands in place of the column's stars. */
  replacesRating: boolean;
}

/** One column at one place. Speeds in knots; the bearing is where it blows from. */
export interface PlaceHour {
  windKn: number | null;
  gustKn: number | null;
  from: number | null;
  /** How far all the models agree: context beside the stars, never a cost. */
  agreement: Agreement | null;
  daylight: boolean;
  rating: HourRating | null;
  /** The one model the wind, the gust, the bearing and so the stars are; null where none is. */
  model: string | null;
  /** Met Éireann warnings over the column; absent or null with none. */
  warning?: PlaceHourWarning | null;
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

/** A model's own deterministic series on the axis: speed, gust, and u and v for its bearing. */
interface Own {
  speed: Float64Array;
  gust: Float64Array;
  u: Float64Array;
  v: Float64Array;
}

/** The mean series' u and v on the axis, NaN outside its run. */
function vectorOn(
  points: readonly { u: number; v: number }[],
  plan: Plan,
): { u: Float64Array; v: Float64Array } {
  const n = plan.index.length;
  const u = new Float64Array(n).fill(NaN);
  const v = new Float64Array(n).fill(NaN);
  for (let c = 0; c < n; c++) {
    const i = plan.index[c];
    if (i < 0) continue;
    const f = plan.fraction[c];
    const a = points[i];
    if (f === 0) {
      u[c] = a.u;
      v[c] = a.v;
    } else {
      const b = points[i + 1];
      u[c] = a.u + (b.u - a.u) * f;
      v[c] = a.v + (b.v - a.v) * f;
    }
  }
  return { u, v };
}

/**
 * One place's hours on the axis, as the stars rate them: each hour is one
 * model's own wind, gust and bearing — the rider's model (`from.model`,
 * HARMONIE by default) wherever it reaches the hour, else ECMWF, which takes
 * over past the end of its run (`from.then`), else nothing (force5/src/lead.ts).
 * `model` says which, hour by hour. The gust is that model's too, null where
 * it gives none: no other model fills it in. Those two are read from
 * `manifests` whether or not the reader has them in their blend.
 *
 * How far the models agree (`agreementFrom`, against the freshest run's lead)
 * is read across every model in `blendIds`, an ensemble as its member mean.
 * It is context only and never changes the stars. Speeds come back in m/s.
 */
export function placeConsensus(
  manifests: readonly Manifest[],
  blendIds: readonly string[],
  id: string,
  axis: readonly string[],
  from: StarsFrom = DEFAULT_STARS_FROM,
): {
  median: (number | null)[];
  gust: (number | null)[];
  agreement: (Agreement | null)[];
  from: (number | null)[];
  /** The model each hour is, or null where neither reaches it. */
  model: (string | null)[];
} {
  const axisTimes = axis.map((iso) => Date.parse(iso));
  const axisKey = `${axis[0]}|${axis[axis.length - 1]}|${axis.length}`;
  const n = axis.length;
  // The models that may rate an hour, each on its own deterministic series.
  const own = new Map<string, Own>();
  for (const model of leadOrder(from)) {
    const manifest = manifests.find((m) => m.model === model);
    const mean = manifest ? spotSeries(manifest, id) : null;
    if (!mean) continue;
    const plan = planFor(parsed(mean), axisTimes, axisKey);
    own.set(model, { ...lineOn(mean, plan), ...vectorOn(mean, plan) });
  }
  const lines: Line[] = [];
  for (const blendId of blendIds) {
    const manifest = manifests.find((m) => m.model === blendId);
    if (!manifest) continue;
    // The agreement only reads a model that publishes something for this place.
    if (!spotSeries(manifest, id)) continue;
    const run = Date.parse(manifest.runTime);
    for (const line of modelSeries(manifest, id)) {
      const plan = planFor(parsed(line.points), axisTimes, axisKey);
      lines.push({
        model: manifest.model,
        member: line.memberIndex !== undefined,
        run,
        ...lineOn(line.points, plan),
      });
    }
  }
  // `perModelLines`: an ensemble's members collapse to their hourly mean.
  const perModel: { run: number; speed: Float64Array }[] = [];
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
    for (let c = 0; c < n; c++) {
      let s = 0,
        sn = 0;
      for (const line of group)
        if (Number.isFinite(line.speed[c])) {
          s += line.speed[c];
          sn++;
        }
      speed[c] = sn ? s / sn : NaN;
    }
    perModel.push({ run: group[0].run, speed });
  }
  const out = {
    median: [] as (number | null)[],
    gust: [] as (number | null)[],
    agreement: [] as (Agreement | null)[],
    from: [] as (number | null)[],
    model: [] as (string | null)[],
  };
  for (let c = 0; c < n; c++) {
    const speeds: number[] = [];
    // How far ahead the hour is: from the newest run that has it.
    let freshest = -Infinity;
    for (const line of perModel)
      if (Number.isFinite(line.speed[c])) {
        if (line.run > freshest) freshest = line.run;
        speeds.push(line.speed[c]);
      }
    out.agreement.push(
      speeds.length
        ? agreementFrom(
            speeds.map((speed) => speed * KNOTS),
            leadHours(freshest, axisTimes[c]),
          )
        : null,
    );
    // The one model this hour is rated from.
    const model = pickModel(from, (m) => {
      const line = own.get(m);
      return !!line && Number.isFinite(line.speed[c]);
    });
    out.model.push(model);
    if (model === null) {
      out.median.push(null);
      out.gust.push(null);
      out.from.push(null);
      continue;
    }
    const line = own.get(model)!;
    out.median.push(line.speed[c]);
    out.gust.push(Number.isFinite(line.gust[c]) ? line.gust[c] : null);
    const u = line.u[c];
    const v = line.v[c];
    out.from.push(
      Number.isFinite(u) && Number.isFinite(v) && Math.hypot(u, v) >= 0.1
        ? direction(u, v)
        : null,
    );
  }
  return out;
}

/**
 * Whether each axis time is in daylight at a place, as the dock decides it:
 * sunrise to sunset, or with `boundary: "civil"` first light to last light,
 * civil dawn to civil dusk (force5/src/sun.ts).
 */
export function daylightOn(
  place: Pick<RatedPlace, "lat" | "lon">,
  axis: readonly string[],
  options: { boundary?: "sun" | "civil" } = {},
): boolean[] {
  if (!axis.length) return [];
  const nights = dayNights(
    place.lat,
    place.lon,
    new Date(axis[0]),
    new Date(axis[axis.length - 1]),
    options,
  );
  return axis.map((iso) => {
    const time = Date.parse(iso);
    return !nights.some(
      (night) => time >= night.from.getTime() && time < night.to.getTime(),
    );
  });
}

/**
 * One place's columns, rated for this rider, from the model they picked
 * (`starsFromAt`).
 */
export function placeHours(
  manifests: readonly Manifest[],
  blendIds: readonly string[],
  place: RatedPlace,
  axis: readonly string[],
  rider: Rider,
): PlaceHour[] {
  const c = placeConsensus(
    manifests,
    blendIds,
    place.id,
    axis,
    starsFromAt(rider.starsFrom),
  );
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
      model: c.model[at],
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
      model: null,
    };
  });
}

/**
 * A bare point's hours with the hand-over in them: its own run's where that
 * reaches the column, and in each stretch past it the hours of the run the map
 * hands over to there (`pointHandovers` in force5/src/timeline.ts). A column
 * whose handed run has not been read yet stays empty, as one of the point's
 * own does until its file lands.
 */
export function handedPointHours(
  frames: Parameters<typeof pointHours>[0],
  values: Parameters<typeof pointHours>[1],
  handed: readonly {
    manifest: { frames: Parameters<typeof pointHours>[0] };
    values: Parameters<typeof pointHours>[1];
    stretches: readonly { from: number; to: number }[];
  }[],
  place: Pick<RatedPlace, "lat" | "lon">,
  axis: readonly string[],
): PlaceHour[] {
  const hours = pointHours(frames, values, place, axis);
  if (!handed.length) return hours;
  const axisTimes = axis.map((iso) => Date.parse(iso));
  for (const run of handed) {
    if (!run.stretches.length) continue;
    const theirs = pointHours(run.manifest.frames, run.values, place, axis);
    axisTimes.forEach((t, c) => {
      if (run.stretches.some(({ from, to }) => t >= from && t <= to))
        hours[c] = theirs[c];
    });
  }
  return hours;
}

/** "SW 18g24": an hour's wind as a list of spots gives it, in knots; "" with none. */
export function hourWind(
  hour: Pick<PlaceHour, "windKn" | "gustKn" | "from">,
): string {
  if (hour.windKn === null) return "";
  const kn = `${Math.round(hour.windKn)}${hour.gustKn === null ? "" : `g${Math.round(hour.gustKn)}`}`;
  return hour.from === null ? kn : `${compass(hour.from)} ${kn}`;
}
