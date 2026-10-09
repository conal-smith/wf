import { describe, expect, it } from "vitest";
import { quantile } from "./blend";
import { blendWeight, weightedMedian } from "./weights";

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
