import { readFileSync } from "node:fs";

const read = (model: string) =>
  JSON.parse(readFileSync(`public/weather/${model}.json`, "utf8"));

const harmonie = read("harmonie");
const ecmwf = read("ecmwf");

/**
 * A clock inside HARMONIE's sample run, eight hours after it was initialised.
 * The dock's columns depend on which runs have expired, so a spec that counts
 * columns has to say when it is standing.
 */
export const SAMPLE_CLOCK = new Date(
  Date.parse(harmonie.runTime) + 8 * 3600000,
);

/**
 * The dock's columns for the sample set at `SAMPLE_CLOCK`: HARMONIE's own
 * times — the finest grid published — then ECMWF's from the first one past
 * them, because it reaches furthest. Built here the way `dockColumns` builds
 * it, from the manifests rather than from whichever model the map is drawing.
 */
export const sampleColumns: string[] = (() => {
  const last = Date.parse(harmonie.frames.at(-1).validTime);
  return [
    ...harmonie.frames.map((frame: { validTime: string }) => frame.validTime),
    ...ecmwf.frames
      .filter(
        (frame: { validTime: string }) => Date.parse(frame.validTime) > last,
      )
      .map((frame: { validTime: string }) => frame.validTime),
  ];
})();

/**
 * Index of the column nearest a valid time, which is how the dock resolves a
 * selection: a model's own hour need not land exactly on a column.
 */
export const sampleColumn = (validTime: string) => {
  const target = Date.parse(validTime);
  return sampleColumns.reduce(
    (best, time, index) =>
      Math.abs(Date.parse(time) - target) <
      Math.abs(Date.parse(sampleColumns[best]) - target)
        ? index
        : best,
    0,
  );
};
