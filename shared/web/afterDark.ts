/**
 * The hours after dark, and the forecast without them.
 *
 * A rider may leave the night out of every chart and list (Settings, "Show
 * the hours after dark"; `nightHours` in force5/src/prefs.ts, kept on the
 * device). After dark is from last light to first light, civil dusk to civil
 * dawn, the sun 6° below the horizon (force5/src/sun.ts): an hour is after
 * dark when its time falls in that stretch, as the chart's scrub bar and the
 * spot page both decide it. The twilight either side of the sun's own day
 * stays.
 *
 * Left out, the night is not drawn as a gap: the days are joined side by side,
 * a thin line between them. A `Fold` is that timeline: a time along it with
 * the hidden stretches taken out, and back. Plain arithmetic, so the scrub
 * bar (src/ScrubBar.tsx) and the spot page's graph
 * (spot/web/report/SpotReport.tsx) fold the same night the same way.
 */
import { dayNights } from "../../force5/src/sun";

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Whether each time is after dark at a place: from last light to first light. */
export function afterDark(
  place: { lat: number; lon: number },
  times: readonly number[],
): boolean[] {
  if (!times.length) return [];
  const first = Math.min(...times);
  // A day past the last time, so the night it falls in is not cut short at
  // it (`dayNights` clips each night to the stretch it is asked about).
  const last = Math.max(...times) + DAY;
  const nights = dayNights(
    place.lat,
    place.lon,
    new Date(first),
    new Date(last),
    {
      boundary: "civil",
    },
  );
  return times.map((time) =>
    nights.some(
      (night) => time >= night.from.getTime() && time < night.to.getTime(),
    ),
  );
}

/** A stretch of time kept whole, from `from` up to `to`, in milliseconds. */
export interface Span {
  from: number;
  to: number;
}

/**
 * The stretches a run of hours makes, the hidden ones left out: each hour
 * from its time over its step (in hours), and the hours that follow on from
 * one another joined into one.
 */
export function keptSpans(
  hours: readonly { time: number; step: number }[],
  hidden: readonly boolean[],
): Span[] {
  const spans: Span[] = [];
  hours.forEach((hour, at) => {
    if (hidden[at]) return;
    const to = hour.time + hour.step * HOUR;
    const last = spans[spans.length - 1];
    if (last && last.to === hour.time) last.to = to;
    else spans.push({ from: hour.time, to });
  });
  return spans;
}

/**
 * The stretches a run of times makes, the hidden ones left out, where each
 * time stands for its share of the line: from halfway to the one before it
 * to halfway to the one after (the chart's strip, its columns points on a
 * curve). The first and last take as much again either side of themselves.
 */
export function keptShares(
  times: readonly number[],
  hidden: readonly boolean[],
): Span[] {
  const spans: Span[] = [];
  times.forEach((time, at) => {
    if (hidden[at]) return;
    const before = times[at - 1];
    const next = times[at + 1];
    const back = before !== undefined ? (time - before) / 2 : null;
    const on = next !== undefined ? (next - time) / 2 : null;
    const from = time - (back ?? on ?? HOUR / 2);
    const to = time + (on ?? back ?? HOUR / 2);
    const last = spans[spans.length - 1];
    if (last && last.to >= from) last.to = Math.max(last.to, to);
    else spans.push({ from, to });
  });
  return spans;
}

/** A timeline with stretches of it taken out, the rest joined end to end. */
export interface Fold {
  /** The stretches kept, in order. */
  spans: readonly Span[];
  /**
   * A time's place along the folded line, in milliseconds from the first
   * stretch's start. A time in a hidden stretch stands where the next kept
   * one starts. One before the first stretch or after the last stands at its
   * end, or with `ends: "run"` runs on straight.
   */
  at(time: number): number;
  /**
   * The time at a place along the folded line: never in a hidden stretch.
   * Where two stretches join, the later one's start.
   */
  time(at: number): number;
  /** Whether a time is in a kept stretch. */
  kept(time: number): boolean;
  /** How long the kept stretches are, end to end. */
  length: number;
  /** Where each hidden stretch was taken out, along the folded line. */
  joins: readonly number[];
}

/**
 * The timeline that keeps `spans` alone (in order, apart), joined end to
 * end. Either side of them is hidden too, unless `ends` is "run".
 */
export function fold(
  spans: readonly Span[],
  ends: "hold" | "run" = "hold",
): Fold {
  const run = ends === "run";
  const kept = spans.filter((span) => span.to > span.from);
  const starts: number[] = [];
  let length = 0;
  for (const span of kept) {
    starts.push(length);
    length += span.to - span.from;
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  return {
    spans: kept,
    length,
    joins: starts.slice(1),
    at(time) {
      if (!first) return 0;
      if (time < first.from) return run ? time - first.from : 0;
      for (let i = 0; i < kept.length; i++) {
        const span = kept[i];
        if (time < span.from) return starts[i];
        if (time < span.to) return starts[i] + (time - span.from);
      }
      return run ? length + (time - last.to) : length;
    },
    time(at) {
      if (!first) return 0;
      if (at < 0) return run ? first.from + at : first.from;
      if (at >= length && !run) return last.to;
      for (let i = kept.length - 1; i >= 0; i--)
        if (at >= starts[i])
          return i === kept.length - 1 && at >= length
            ? last.to + (at - length)
            : kept[i].from + (at - starts[i]);
      return first.from;
    },
    kept(time) {
      return kept.some((span) => time >= span.from && time < span.to);
    },
  };
}

/** The one stretch from `from` to `to`: nothing taken out. */
export const unfolded = (from: number, to: number): Fold =>
  fold([{ from, to: Math.max(to, from + 1) }], "run");
