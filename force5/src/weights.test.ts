import { describe, expect, it } from "vitest";
import { quantile } from "./blend";
import {
  blendWeight,
  leadDay,
  leadHours,
  MODEL_WEIGHTS,
  modelWeight,
  weightedMedian,
} from "./weights";

describe("modelWeight", () => {
  it("reads the backtest's weight for the day of the run the hour falls on", () => {
    expect(leadDay(0)).toBe(0);
    expect(leadDay(23.9)).toBe(0);
    expect(leadDay(24)).toBe(1);
    expect(leadDay(48)).toBe(2);
    expect(leadDay(72)).toBe(3);
    expect(leadDay(300)).toBe(3);
    expect(modelWeight("harmonie", 6)).toBe(4);
    expect(modelWeight("arome", 6)).toBe(2);
    expect(modelWeight("arome", 30)).toBe(1);
    expect(modelWeight("aifs", 6)).toBe(0.5);
    expect(modelWeight("aifs", 100)).toBe(1.5);
    expect(modelWeight("ecmwf-ens", 60)).toBe(1.5);
    expect(modelWeight("arpege", 6)).toBe(0.5);
  });

  it("counts an hour before its run, or with no run time, as day 0", () => {
    expect(modelWeight("gfs", -1)).toBe(2);
    expect(modelWeight("gfs", Number.NaN)).toBe(2);
    expect(
      leadHours("2026-10-07T12:00:00Z", Date.parse("2026-10-08T18:00:00Z")),
    ).toBe(30);
  });

  it("falls back to the grid for a model the backtest has not judged", () => {
    expect(MODEL_WEIGHTS.ukv).toBeUndefined();
    expect(modelWeight("ukv", 6, 2)).toBe(3);
    expect(modelWeight("harmonie-eps", 6, 2)).toBe(3);
    expect(modelWeight("something-new", 6, null)).toBe(1);
  });

  it("judges every wind model the blend reads", () => {
    for (const id of [
      "harmonie",
      "icon-eu",
      "ecmwf",
      "gfs",
      "ecmwf-ens",
      "gefs",
      "arpege",
      "arome",
      "aifs",
    ])
      expect(MODEL_WEIGHTS[id]).toHaveLength(4);
  });
});

describe("blendWeight", () => {
  it("counts a model by its grid: fine three times, regional twice, global once", () => {
    expect(blendWeight(2)).toBe(3); // HARMONIE
    expect(blendWeight(2.5)).toBe(3); // AROME
    expect(blendWeight(3)).toBe(3);
    expect(blendWeight(6.5)).toBe(2); // ICON-EU
    expect(blendWeight(8)).toBe(2);
    expect(blendWeight(9)).toBe(1);
    expect(blendWeight(25)).toBe(1);
  });

  it("counts a model that does not say once", () => {
    expect(blendWeight(null)).toBe(1);
    expect(blendWeight(undefined)).toBe(1);
    expect(blendWeight(Number.NaN)).toBe(1);
  });
});

describe("weightedMedian", () => {
  it("is the ordinary median when every weight is the same", () => {
    for (const values of [[4], [1, 9], [3, 1, 2], [5, 1, 8, 2], [7, 7, 1, 3, 9, 2]]) {
      const sorted = [...values].sort((a, b) => a - b);
      expect(weightedMedian(values, values.map(() => 1))).toBeCloseTo(
        quantile(sorted, 0.5),
      );
      expect(weightedMedian(values, values.map(() => 2))).toBeCloseTo(
        quantile(sorted, 0.5),
      );
    }
  });

  it("moves toward the heavier values", () => {
    expect(weightedMedian([10, 4, 5], [3, 1, 1])).toBe(10);
    expect(weightedMedian([10, 4, 5, 6], [3, 1, 1, 1])).toBe(8);
    expect(weightedMedian([10, 4, 5, 6, 7], [3, 1, 1, 1, 1])).toBe(7);
  });
});
