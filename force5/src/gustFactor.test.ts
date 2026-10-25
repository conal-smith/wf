import { describe, expect, it } from "vitest";
import { gustFactor } from "./gustFactor";
import { DEFAULT_RIDER, GUSTY_FROM, gustiness } from "./stars";

describe("gustFactor", () => {
  it("is the gust over the mean wind", () => {
    expect(gustFactor(20.5, 49.6)).toBeCloseTo(2.42, 2);
    expect(gustFactor(10, 15)).toBe(1.5);
  });

  it("is what the stars call gusty by", () => {
    // 15 kn is over an 80 kg intermediate's floor, so gustiness reads the factor.
    expect(gustiness(15, 15 * GUSTY_FROM, DEFAULT_RIDER)).toBe("gusty");
    expect(gustFactor(15, 15 * GUSTY_FROM)).toBe(GUSTY_FROM);
  });

  it("is null without a gust or a wind to divide by", () => {
    expect(gustFactor(12, null)).toBeNull();
    expect(gustFactor(null, 20)).toBeNull();
    expect(gustFactor(0, 5)).toBeNull();
  });
});
