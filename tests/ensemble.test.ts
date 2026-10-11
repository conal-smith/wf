import { expect, it } from "vitest";
import { validateManifest, validateWindSpots } from "../force5/src/weather";
import type { Manifest } from "../force5/src/weather";
import { pointerOf, tilesFor } from "../force5/src/testing";

/** The pointer as published, then the spot data as it arrives from its squares. */
const validate = (m: Manifest): Manifest => {
  validateManifest(pointerOf(m));
  return validateWindSpots(m);
};

const runTime = "2026-09-16T12:00:00Z";
const hours = [0, 6, 12];
const at = (hour: number) =>
  new Date(Date.parse(runTime) + hour * 3600000)
    .toISOString()
    .replace(".000", "");

const grid = {
  width: 2,
  height: 2,
  west: -8,
  east: -7.75,
  north: 54.25,
  south: 54,
  dx: 0.25,
  dy: 0.25,
};
const frames = hours.map((hour) => ({
  hour,
  validTime: at(hour),
  gustIntervalHours: hour === 0 ? null : ([hour - 6, hour] as [number, number]),
}));

const ensembleManifest = () =>
  ({
    schemaVersion: 2,
    model: "ecmwf-ens",
    modelName: "ECMWF ENS",
    provider: "ECMWF",
    modelDetail: "IFS ensemble, 2 perturbed members",
    run: "2026091612",
    runTime,
    generatedAt: runTime,
    resolutionKm: null,
    resolutionLabel: "0.25° open-data grid",
    stepHours: 6,
    stepRanges: [{ throughHour: 12, stepHours: 6 }],
    grid,
    tiles: tilesFor(grid, frames),
    base: "ecmwf-ens-2026091612-12h-2m-v1-0a1b2c3d/",
    spots: {
      squareDegrees: 2,
      url: "spots/{square}.json",
      squares: ["n52w012"],
      keys: ["spotForecasts", "spotMembers"],
    },
    frames: frames.map((frame) => ({ ...frame })),
    spotForecasts: {
      brandon: hours.map((hour) => ({
        hour,
        validTime: at(hour),
        u: 1.5,
        v: -1.5,
        gust: hour === 0 ? null : 11.5,
      })),
    },
    spotMembers: {
      brandon: hours.map((hour) => ({
        hour,
        validTime: at(hour),
        u: [1, 2],
        v: [-1, -2],
        gust: hour === 0 ? [null, null] : [11, 12],
      })),
    },
    ensemble: {
      members: 2,
      control: null,
      description:
        "Perturbed members 1–2; the control is the separate ecmwf product.",
    },
    spotForecastsDescription: "spotForecasts holds the ensemble mean.",
    gustAvailable: true,
    gustMissingHours: [0],
    sourceUrl: "https://www.ecmwf.int/en/forecasts/datasets/open-data",
    attribution: "Based on ECMWF data, processed by Force5 under CC BY 4.0.",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  }) as Manifest;

it("accepts an ensemble manifest's extra optional keys and uniform six-hour ladder", () => {
  const m = validate(ensembleManifest());
  expect(m.ensemble?.members).toBe(2);
  expect(m.ensemble?.control).toBeNull();
  expect(m.spotMembers?.brandon[1].u).toEqual([1, 2]);
  expect(m.spotMembers?.brandon[0].gust).toEqual([null, null]);
  expect(m.spotForecastsDescription).toContain("mean");
});

it("ignores unknown manifest keys without rejecting the forecast", () => {
  const extended = {
    ...ensembleManifest(),
    probabilityBlend: { thresholdsKnots: [12, 18, 25] },
    unexpected: "ignored",
  } as unknown as Manifest;
  expect(validate(extended).frames).toHaveLength(3);
});

it("still enforces the declared cadence and gust rules on an ensemble manifest", () => {
  const m = ensembleManifest();
  expect(() =>
    validate({ ...m, stepRanges: [{ throughHour: 13, stepHours: 6 }] }),
  ).toThrow(/cadence/);
  expect(() => validate({ ...m, frames: m.frames.slice(0, 2) })).toThrow(
    /cadence/,
  );
  expect(() =>
    validate({
      ...m,
      frames: [
        { ...m.frames[0], gustIntervalHours: [0, 0] },
        ...m.frames.slice(1),
      ],
    }),
  ).toThrow(/interval/);
});
