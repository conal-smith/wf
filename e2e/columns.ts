import { readFileSync } from "node:fs";

interface Bundle {
  runTime: string;
  frames: { validTime: string }[];
}
const read = (model: string): Bundle =>
  JSON.parse(readFileSync(`public/weather/${model}.json`, "utf8"));

const harmonie = read("harmonie");
const ecmwf = read("ecmwf");
const aifs = read("aifs");

/**
 * A clock inside HARMONIE's sample run, eight hours after it was initialised.
 * The dock's columns depend on which runs have expired, so a spec that counts
 * columns has to say when it is standing.
 */
export const SAMPLE_CLOCK = new Date(
  Date.parse(harmonie.runTime) + 8 * 3600000,
);

/**
 * The axis `dockColumns` builds from two runs: the near one's own times, with
 * the far one's on either side of them — the hours before the near run was
 * initialised as well as the days after it ends. Written out here rather than
 * imported, so a spec states the expectation instead of re-deriving it.
 */
const join = (near: Bundle, far: Bundle): string[] => {
  const first = Date.parse(near.frames[0].validTime);
  const last = Date.parse(near.frames.at(-1)!.validTime);
  const outside = (keep: (time: number) => boolean) =>
    far.frames
      .filter((frame) => keep(Date.parse(frame.validTime)))
      .map((frame) => frame.validTime);
  return [
    ...outside((time) => time < first),
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
 * long range falls to AIFS, the next run that reaches furthest.
 */
export const sampleColumnsWithoutEcmwf = join(harmonie, aifs);

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
