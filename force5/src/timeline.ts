import { FALLBACK_MODEL } from "./lead";
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

const IRISH_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The start of the Irish calendar day a time falls in: local midnight in
 * Europe/Dublin, as a UTC instant. Ireland is an hour ahead of UTC or level
 * with it, and changes its clocks at 01:00 UTC, never at midnight, so midnight
 * is always one of two instants and always exists: 23:00 UTC the evening
 * before in summer time, 00:00 UTC in winter. The day the clocks go back is
 * 25 hours long and the day they go forward 23.
 */
export function irishMidnight(time: number): number {
  const date = IRISH_DATE.format(new Date(time));
  const utc = Date.parse(`${date}T00:00:00Z`);
  return IRISH_DATE.format(new Date(utc - HOUR)) === date ? utc - HOUR : utc;
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
 * today's hours before the near run begins as well as the days after it ends.
 * Only two runs, because a third source would put two joins in a row where the
 * reader can least tell one model from the next.
 *
 * Today is kept whole, from Irish midnight (`irishMidnight`; the ruling of 25
 * October 2026): someone who rode this morning can look back at what the
 * forecast said for it. The published blend carries today's earlier hours of
 * the finest run forward from run to run (src/spotBlend.ts `carryToday`), so
 * in production the near run normally reaches back to midnight and there is
 * one seam, at its end. Where it does not — the first run of a day, a reader
 * working the hours out from the models' own runs, which keep no earlier
 * hours — the long-range run's own steps fill the morning up to the near run's
 * first time, rather than the morning standing empty. Nothing before today's
 * midnight is added: yesterday is not kept.
 *
 * A finest run that has only just landed (it is published on the hour and
 * covers nothing before it) would otherwise give an axis beginning in the
 * future, with no column for now and no Now line at all: the long-range run
 * fills that gap too, from the last time it publishes at or before now, even
 * when that is before midnight.
 *
 * A model counts unless its run has **expired** — its last forecast time is
 * already behind us. Being **stale** — older than its schedule allows
 * (catalog.ts's `staleAfterHours`) — deliberately does not disqualify one: a
 * failed ECMWF slot would otherwise collapse the dock from fifteen days to ten
 * until the next one lands. An older run keeps its columns; the header's model
 * band is what says it is older.
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
  // The head is today's long-range times before the near run begins, and at
  // the least the last one the clock has already passed, which is the column
  // the Now line needs when the near run has not reached now yet.
  const nowColumn =
    near.first > now
      ? far.times.reduce(
          (start, validTime) =>
            Date.parse(validTime) <= now ? Date.parse(validTime) : start,
          -Infinity,
        )
      : Infinity;
  const headStart = Math.min(irishMidnight(now), nowColumn);
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
 * What one run can draw for a time: the frame that stands for it, or, where
 * the run does not reach it, which end of the run it lies past and that end's
 * valid time. Past either end that run draws nothing: a frame from another
 * hour, under the dock's and the lights' reading of this one, would be two
 * moments shown as one. The map hands the hour to a run that reaches it
 * (`handoverModel`), or draws no wind where none does.
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
 * The model the map hands over to at a time its own run does not reach, or
 * null where the reader's run reaches it or no other run the map can draw does.
 *
 * ECMWF wherever it covers the time: past the end of the rider's model it is
 * the one the stars take over to (force5/src/lead.ts), so the map, the dock
 * and the stars tell the same model's story at every hour. Where ECMWF is not
 * published, the dock's column at that time names a model and the map draws
 * that one where it can, GFS as a rule. A column owned by a model the map
 * cannot draw (the long range can fall to one) gives way to the drawable run
 * that covers the time and reaches furthest, finest grid first on a tie, as
 * the dock's own long range is chosen.
 *
 * Only a run that spans the time counts, and never an ensemble mean or an
 * expired run: the map draws a forecast for the hour or nothing at all.
 */
export function handoverModel(
  models: readonly ColumnModel[],
  drawable: readonly string[],
  own: { id: string; frames: readonly Pick<FrameInfo, "validTime">[] },
  time: number,
  column?: Pick<DockColumn, "model">,
  now = Date.now(),
): string | null {
  if (!Number.isFinite(time)) return null;
  if (own.frames.length && frameForTime(own.frames, time) !== null) return null;
  const covering = models.flatMap((model) => {
    if (model.ensemble || model.id === own.id) return [];
    if (!drawable.includes(model.id)) return [];
    if (freshness(model.manifest, now) === "expired") return [];
    const times = modelTimes(model.manifest).map((validTime) => ({
      validTime,
    }));
    if (framePosition(times, time) === null) return [];
    return [
      {
        id: model.id,
        km: model.manifest.resolutionKm ?? Infinity,
        last: Date.parse(times[times.length - 1].validTime),
      },
    ];
  });
  if (covering.some((model) => model.id === FALLBACK_MODEL))
    return FALLBACK_MODEL;
  if (column && covering.some((model) => model.id === column.model))
    return column.model;
  covering.sort(
    (a, b) => b.last - a.last || a.km - b.km || (a.id < b.id ? -1 : 1),
  );
  return covering[0]?.id ?? null;
}

/**
 * When the hand-over the map is drawing begins, for the label that names it.
 * Past the end of the reader's run it is the first column of the stretch the
 * same model owns beyond that end, so the label names the hour the other
 * model's wind begins rather than the reader's last; before the reader's run
 * starts it is that start, where the hand-over stops. Null without a column.
 */
export function handoverStart(
  columns: readonly { time: number; model: string }[],
  index: number,
  beyond: { side: "before" | "after"; edge: string },
): number | null {
  const column = columns[index];
  if (!column) return null;
  const edge = Date.parse(beyond.edge);
  if (beyond.side === "before") return edge;
  let from = index;
  while (
    from > 0 &&
    columns[from - 1].time > edge &&
    columns[from - 1].model === column.model
  )
    from--;
  return columns[from].time;
}

/** A run of the dock's columns a bare point reads from a model not its own. */
export interface HandedStretch {
  model: string;
  /** The first and the last column's time handed to it, both included. */
  from: number;
  to: number;
}

/**
 * Where a bare map point's wind comes from past the reader's own run: each
 * unbroken stretch of the dock's columns that the map would hand to another
 * model (`handoverModel`), with that model. A point is read out of the map's
 * frames, so without this its cells went empty wherever the reader's run
 * stopped, beside a spot's that went on in ECMWF's; now the point's columns
 * and the map tell the same model's story at every hour. Columns the reader's
 * run reaches belong to no stretch.
 */
export function pointHandovers(
  models: readonly ColumnModel[],
  drawable: readonly string[],
  own: { id: string; frames: readonly Pick<FrameInfo, "validTime">[] },
  columns: readonly Pick<DockColumn, "validTime" | "model">[],
  now = Date.now(),
): HandedStretch[] {
  const stretches: HandedStretch[] = [];
  // The model the column before was handed to, so a stretch is unbroken.
  let before: string | null = null;
  for (const column of columns) {
    const time = Date.parse(column.validTime);
    const id = handoverModel(models, drawable, own, time, column, now);
    if (id && id === before) stretches[stretches.length - 1].to = time;
    else if (id) stretches.push({ model: id, from: time, to: time });
    before = id;
  }
  return stretches;
}

/**
 * The frames of a run handed over to that a point needs read: those inside
 * its stretches, and the one either side of each where a column falls between
 * two of the run's steps, so the column can be drawn between them. Nothing
 * else of the run is read: inside the reader's own run its wind is the one
 * shown, and every file is a download.
 */
export function handedFrames(
  frames: readonly Pick<FrameInfo, "validTime">[],
  stretches: readonly Pick<HandedStretch, "from" | "to">[],
): number[] {
  const times = frames.map((frame) => Date.parse(frame.validTime));
  const wanted = new Set<number>();
  for (const { from, to } of stretches) {
    const first = times.findIndex((time) => time >= from);
    let last = times.length - 1;
    while (last >= 0 && times[last] > to) last--;
    if (first === -1 || last === -1) continue;
    const lo = times[first] > from ? first - 1 : first;
    const hi = times[last] < to ? last + 1 : last;
    for (let i = Math.max(0, lo); i <= Math.min(times.length - 1, hi); i++)
      wanted.add(i);
  }
  return [...wanted].sort((a, b) => a - b);
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
