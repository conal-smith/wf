import {
  KNOTS,
  freshness,
  nearestFrame,
  speed,
  windColor,
  type Manifest,
  type RunTimes,
  type Wind,
  type FrameInfo,
} from "./weather";

const HOUR = 3600000;

/** Fractional column index at a real time, never clamped into an expired run. */
export function framePosition(
  frames: readonly Pick<FrameInfo, "validTime">[],
  time: number,
): number | null {
  if (!frames.length || !Number.isFinite(time)) return null;
  const first = Date.parse(frames[0].validTime);
  const last = Date.parse(frames[frames.length - 1].validTime);
  if (time < first || time > last) return null;
  if (time === last) return frames.length - 1;
  const right = frames.findIndex((frame) => Date.parse(frame.validTime) > time);
  if (right < 1) return null;
  const leftTime = Date.parse(frames[right - 1].validTime);
  return (
    right -
    1 +
    (time - leftTime) / (Date.parse(frames[right].validTime) - leftTime)
  );
}

/** One dock column: a forecast time, and the run whose timeline publishes it. */
export interface DockColumn {
  validTime: string;
  /** Model id, for the header's model band and for filling the cells. */
  model: string;
}

/** A wind model offered to the column builder, with the run it has published. */
export interface ColumnModel {
  id: string;
  /** The run: a whole manifest, or the blend's summary of one. */
  manifest: RunTimes & Pick<Manifest, "resolutionKm">;
  /** An ensemble mean is a summary of a spread, not a timeline of its own. */
  ensemble?: boolean;
}

/**
 * The times a run publishes: its map frames, or the longest spot series of
 * whichever squares have been merged into it (a run with no frames).
 */
export function modelTimes(manifest: RunTimes): string[] {
  if (manifest.frames?.length)
    return manifest.frames.map((frame) => frame.validTime);
  let longest: readonly { validTime: string }[] = [];
  for (const series of Object.values(manifest.spotForecasts ?? {}))
    if (series.length > longest.length) longest = series;
  return longest.map((point) => point.validTime);
}

/** Median gap between consecutive times, in hours; zero for a single time. */
function medianStepHours(times: readonly string[]): number {
  const steps: number[] = [];
  for (let i = 1; i < times.length; i++)
    steps.push((Date.parse(times[i]) - Date.parse(times[i - 1])) / HOUR);
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return steps[Math.floor((steps.length - 1) / 2)];
}

interface Candidate {
  id: string;
  times: string[];
  /** Native grid spacing; a run that does not state one is treated as coarsest. */
  km: number;
  stepHours: number;
  first: number;
  last: number;
}

/**
 * The dock's own time columns, independent of whatever the map is drawing.
 *
 * Two runs make the axis: the finest grid on offer carries the near term at its
 * own cadence, and the run that reaches furthest carries everything outside it —
 * the hours before it was initialised as well as the days after it ends. Only
 * two runs, because a third source would put two joins in a row where the
 * reader can least tell one model from the next.
 *
 * There is a head only when the near run does not yet cover now. A run is
 * published on the hour and covers nothing before it, so a finest run that has
 * only just landed would give an axis beginning in the future, with no column
 * for now and no Now line at all; in that case the long-range run fills the gap,
 * from the last time it publishes at or before now up to the near run's first.
 * Every other time — which in production is nearly always, HARMONIE's run having
 * started a couple of hours ago while ECMWF's started at 00 or 12 UTC — the axis
 * starts at the near run's first time, so the reader crosses one seam and not
 * two.
 *
 * A model counts unless its run has **expired** — its last forecast time is
 * already behind us. The eighteen-hour "stale" mark deliberately does not
 * disqualify one: ECMWF runs at 00 and 12 UTC and lands eight or nine hours
 * late, so it reads as stale for about three hours twice a day, and gating on
 * that would collapse the dock from fifteen days to ten every time. An older
 * run keeps its columns; the header's model band is what says it is older.
 */
export function dockColumns(
  models: readonly ColumnModel[],
  now = Date.now(),
): DockColumn[] {
  const usable: Candidate[] = [];
  for (const model of models) {
    if (model.ensemble) continue;
    if (freshness(model.manifest, now) === "expired") continue;
    const times = modelTimes(model.manifest);
    if (!times.length) continue;
    usable.push({
      id: model.id,
      times,
      km: model.manifest.resolutionKm ?? Infinity,
      stepHours: medianStepHours(times),
      first: Date.parse(times[0]),
      last: Date.parse(times[times.length - 1]),
    });
  }
  if (!usable.length) return [];
  const byId = (a: Candidate, b: Candidate) => (a.id < b.id ? -1 : 1);
  const best = (rank: (a: Candidate, b: Candidate) => number) =>
    usable.reduce((winner, model) =>
      rank(model, winner) < 0 ? model : winner,
    );
  // The near term goes to the sharpest picture of it: the finest grid, then the
  // finest cadence, then the one that lasts longest, so the choice is stable.
  const near = best(
    (a, b) =>
      a.km - b.km || a.stepHours - b.stepHours || b.last - a.last || byId(a, b),
  );
  // The long range goes to whichever run reaches furthest out.
  const far = best(
    (a, b) =>
      b.last - a.last || a.km - b.km || a.stepHours - b.stepHours || byId(a, b),
  );
  const outside = (keep: (time: number) => boolean) =>
    far.id === near.id
      ? []
      : far.times
          .filter((validTime) => keep(Date.parse(validTime)))
          .map((validTime) => ({ validTime, model: far.id }));
  // The head starts at the last long-range time the clock has already passed,
  // which is the column the Now line needs; everything earlier is yesterday.
  const headStart =
    near.first > now
      ? far.times.reduce(
          (start, validTime) =>
            Date.parse(validTime) <= now ? Date.parse(validTime) : start,
          -Infinity,
        )
      : Infinity;
  return [
    ...outside((time) => time >= headStart && time < near.first),
    ...near.times.map((validTime) => ({ validTime, model: near.id })),
    ...outside((time) => time > near.last),
  ];
}

/**
 * The map frame that stands for a column, or null where the run does not reach
 * it. "Nearest" alone would let a run that ended two days ago own every column
 * to the end of the dock, so the frame has to be inside half that model's own
 * step — near enough that it really is the forecast for this column.
 */
export function frameForTime(
  frames: readonly Pick<FrameInfo, "validTime">[],
  time: number,
): number | null {
  if (!frames.length || !Number.isFinite(time)) return null;
  let nearest = 0;
  let distance = Infinity;
  frames.forEach((frame, index) => {
    const gap = Math.abs(Date.parse(frame.validTime) - time);
    if (gap < distance) {
      distance = gap;
      nearest = index;
    }
  });
  if (distance === 0) return nearest;
  const at = (index: number) =>
    frames[index] === undefined ? null : Date.parse(frames[index].validTime);
  const here = at(nearest)!;
  // The step on the side the column lies, falling back to the other side at an
  // end of the run, so a single-frame run reaches nobody but its own hour.
  const neighbour = time > here ? at(nearest + 1) : at(nearest - 1);
  const other = time > here ? at(nearest - 1) : at(nearest + 1);
  const step =
    neighbour !== null
      ? Math.abs(neighbour - here)
      : other !== null
        ? Math.abs(other - here)
        : 0;
  return distance <= step / 2 + 1 ? nearest : null;
}

/**
 * What the map can draw for a time: the frame that stands for it, or, where
 * the run does not reach it, which end of the run it lies past and that end's
 * valid time. Past either end the map draws no wind at all: a frame from
 * another hour, under the dock's and the lights' reading of this one, would
 * be two moments shown as one.
 */
export type MapReach =
  | { drawn: true; index: number }
  | { drawn: false; side: "before" | "after"; edge: string };
export function mapReach(
  frames: readonly Pick<FrameInfo, "validTime">[],
  time: number,
): MapReach | null {
  if (!frames.length || !Number.isFinite(time)) return null;
  const index = frameForTime(frames, time);
  if (index !== null) return { drawn: true, index };
  const first = frames[0].validTime;
  return time < Date.parse(first)
    ? { drawn: false, side: "before", edge: first }
    : {
        drawn: false,
        side: "after",
        edge: frames[frames.length - 1].validTime,
      };
}

/**
 * The order to read a run's frames in for a bare map point, which has no
 * precomputed series and has to be sampled out of the frames one file at a time.
 *
 * Two rules, both about being useful before the download finishes. It starts at
 * the hour the reader is looking at and works outwards, rather than at the first
 * frame, which for an afternoon click is already behind them. And where the run
 * is finer than three-hourly it takes every third hour first and fills the rest
 * in afterwards, so the table is readable after about a third of the bytes.
 */
export function loadOrder(
  frames: readonly Pick<FrameInfo, "validTime">[],
  now = Date.now(),
  coarseHours = 3,
): number[] {
  if (!frames.length) return [];
  const start = nearestFrame(frames, now);
  const outward = [start];
  for (let step = 1; step < frames.length; step++) {
    if (start + step < frames.length) outward.push(start + step);
    if (start - step >= 0) outward.push(start - step);
  }
  const anchor = Date.parse(frames[start].validTime);
  const span = coarseHours * HOUR;
  const onStride = (index: number) =>
    (Date.parse(frames[index].validTime) - anchor) % span === 0;
  const first = outward.filter(onStride);
  // A run already at or beyond the stride gains nothing from a second pass.
  return first.length === outward.length
    ? outward
    : [...first, ...outward.filter((index) => !onStride(index))];
}

/**
 * The reads for a bare point's every model at once (src/usePointModels.ts):
 * each run's frames inside the dock's hours, give or take a step either side
 * for the interpolation, in `loadOrder`'s order, and taken a model at a time
 * in turn, so every line starts filling in together rather than one model
 * finishing before the next begins. Frames already read are skipped.
 */
export function pointReadQueue(
  runs: readonly {
    frames: readonly Pick<FrameInfo, "validTime">[];
    done?: readonly boolean[];
  }[],
  from: number,
  to: number,
  now = Date.now(),
  marginHours = 6,
): [run: number, frame: number][] {
  const orders = runs.map(({ frames, done }) =>
    loadOrder(frames, now).filter((index) => {
      const time = Date.parse(frames[index].validTime);
      return (
        !done?.[index] &&
        time >= from - marginHours * HOUR &&
        time <= to + marginHours * HOUR
      );
    }),
  );
  const queue: [number, number][] = [];
  const longest = Math.max(0, ...orders.map((order) => order.length));
  for (let step = 0; step < longest; step++)
    orders.forEach((order, run) => {
      if (step < order.length) queue.push([run, order[step]]);
    });
  return queue;
}

/** Where one column's cell values come from. */
export interface ColumnSource {
  /** True when the map model's own run spans this column's time. */
  onMap: boolean;
  /** The run the cell is read from: the map model, or the column's own owner. */
  model: string;
}

/**
 * The run behind every column's cells. The map model answers for every column
 * its own run spans, so the table and the map agree wherever both have
 * something to say; outside that the column's own owner takes over, from the
 * precomputed spot series already in its manifest.
 *
 * "Spans", not "has a frame near": between its published steps the cell is
 * interpolated from that run's series, the same way the chart draws it. The
 * half-step rule in `frameForTime` decides which frame the MAP paints, which is
 * a different question — a raster has to be one frame or another.
 *
 * An expired map run answers nothing. It is still on the map, labelled there as
 * an archived snapshot, but its forecast is already behind us and printing it
 * in a table of what is coming would be a plain lie.
 */
export function columnSources(
  columns: readonly DockColumn[],
  mapTimes: readonly Pick<FrameInfo, "validTime">[],
  mapModel: string,
  mapUsable = true,
): ColumnSource[] {
  return columns.map((column) => {
    const onMap =
      mapUsable &&
      framePosition(mapTimes, Date.parse(column.validTime)) !== null;
    return { onMap, model: onMap ? mapModel : column.model };
  });
}

/** Consecutive columns one run owns, for the header's model band. */
export interface ModelStretch {
  model: string;
  start: number;
  count: number;
}
export function modelStretches(
  sources: readonly ColumnSource[],
): ModelStretch[] {
  return sources.reduce<ModelStretch[]>((stretches, source, index) => {
    const last = stretches[stretches.length - 1];
    if (last?.model === source.model) last.count++;
    else stretches.push({ model: source.model, start: index, count: 1 });
    return stretches;
  }, []);
}

/**
 * Forecast strength for the selected location; grey means not loaded/available.
 *
 * One stop per column, evenly spaced, because that is where the scrubber's own
 * thumb sits: the range input counts columns, so a stop placed by elapsed time
 * would drift away from the value under it as soon as the cadence changed.
 */
export function windTrackBackground(
  values: readonly (Wind | null | undefined)[],
  count: number,
) {
  if (count < 1) return "#b8cbd0";
  const stops = Array.from({ length: Math.max(2, count) }, (_, i) => {
    const value = values[Math.min(i, count - 1)];
    const colour = value
      ? `rgb(${windColor(speed(value) * KNOTS).join(",")})`
      : "#b8cbd0";
    return `${colour} ${(i / (Math.max(2, count) - 1)) * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
