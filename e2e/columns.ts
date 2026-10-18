import { readSample } from "./sample";
import { stripColumns } from "../src/strip";

interface Bundle {
  runTime: string;
  frames: { validTime: string }[];
}

const harmonie = readSample<Bundle>("harmonie");
const ecmwf = readSample<Bundle>("ecmwf");
const gfs = readSample<Bundle>("gfs");

/**
 * A clock inside HARMONIE's sample run, eight hours after it was initialised.
 * The dock's columns depend on which runs have expired, so a spec that counts
 * columns has to say when it is standing.
 *
 * Every spec stands here by default: `e2e/fixtures.ts` pins it before the page
 * is opened, so a suite written against a calendar frozen in September 2026
 * gives the same answers whatever the wall clock says.
 */
export const SAMPLE_CLOCK = new Date(
  Date.parse(harmonie.runTime) + 8 * 3600000,
);

/**
 * The axis `dockColumns` builds from two runs: the near one's own times, with
 * the far one's after them. There is a head before them only when the near run
 * has not started yet — and the sample HARMONIE run started eight hours before
 * `SAMPLE_CLOCK`, so here there is none. Written out rather than imported, so a
 * spec states the expectation instead of re-deriving it.
 */
const join = (near: Bundle, far: Bundle, now = SAMPLE_CLOCK.getTime()) => {
  const first = Date.parse(near.frames[0].validTime);
  const last = Date.parse(near.frames.at(-1)!.validTime);
  const times = far.frames.map((frame) => frame.validTime);
  // The head runs from the last far time the clock has already passed up to
  // (not including) the near run's first, and only when that first is ahead.
  const from =
    first > now
      ? times.reduce(
          (start, validTime) =>
            Date.parse(validTime) <= now ? Date.parse(validTime) : start,
          -Infinity,
        )
      : Infinity;
  const outside = (keep: (time: number) => boolean) =>
    times.filter((validTime) => keep(Date.parse(validTime)));
  return [
    ...outside((time) => time >= from && time < first),
    ...near.frames.map((frame) => frame.validTime),
    ...outside((time) => time > last),
  ];
};

/**
 * The dock's columns for the sample set at `SAMPLE_CLOCK`: HARMONIE's own
 * hourly times — the finest grid published — then ECMWF's from the first one
 * past them, because it reaches furthest.
 */
export const sampleColumns = join(harmonie, ecmwf);

/**
 * And when ECMWF is unavailable: HARMONIE still owns the near term, and the
 * long range falls to GFS, the next live run that reaches furthest.
 */
export const sampleColumnsWithoutEcmwf = join(harmonie, gfs);

/** Index of the column nearest a valid time, as the dock resolves a selection. */
export const sampleColumn = (validTime: string, columns = sampleColumns) => {
  const target = Date.parse(validTime);
  return columns.reduce(
    (best, time, index) =>
      Math.abs(Date.parse(time) - target) <
      Math.abs(Date.parse(columns[best]) - target)
        ? index
        : best,
    0,
  );
};

/**
 * The dock's strip at `SAMPLE_CLOCK`: the columns above, the next fifteen
 * Irish days of them, every hour day and night (src/strip.ts). The slider
 * indexes these.
 */
export const stripAt = (now: number, columns = sampleColumns) =>
  stripColumns(
    columns.map((validTime) => ({
      validTime,
      model: harmonie.frames.some((f) => f.validTime === validTime)
        ? "harmonie"
        : "ecmwf",
    })),
    now,
  );
export const sampleStrip = stripAt(SAMPLE_CLOCK.getTime());
