import { describe, expect, it } from "vitest";
import {
  GUST_FACTOR_MIN_WIND_KN,
  gustFactor,
  gustFactorText,
} from "./gustFactor";
import { DEFAULT_RIDER, GUSTY_FROM, VERY_GUSTY_FROM, gustiness } from "./stars";

describe("gustFactor", () => {
  it("is the gust over the mean", () => {
    expect(gustFactor(10, 19)).toBeCloseTo(1.9);
    expect(gustFactor(20, 26)).toBeCloseTo(1.3);
    expect(gustFactor(12, 12)).toBe(1);
  });

  it("is null where the wind or the gust is missing", () => {
    expect(gustFactor(null, 20)).toBeNull();
    expect(gustFactor(12, null)).toBeNull();
    expect(gustFactor(undefined, undefined)).toBeNull();
    expect(gustFactor(Number.NaN, 20)).toBeNull();
    expect(gustFactor(12, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("is null in a near calm, from 5 kn of mean wind up a factor", () => {
    expect(GUST_FACTOR_MIN_WIND_KN).toBe(5);
    expect(gustFactor(0, 4)).toBeNull();
    expect(gustFactor(2, 5)).toBeNull();
    expect(gustFactor(4.9, 9)).toBeNull();
    expect(gustFactor(5, 9)).toBeCloseTo(1.8);
  });

  it("is what the stars call gusty by", () => {
    // 15 kn is over an 80 kg intermediate's floor, so gustiness reads the factor.
    expect(gustiness(15, 15 * GUSTY_FROM, DEFAULT_RIDER)).toBe("gusty");
    expect(gustFactor(15, 15 * GUSTY_FROM)).toBe(GUSTY_FROM);
  });

  it("reads a gust under the mean as none over it", () => {
    expect(gustFactor(15, 13)).toBe(1);
  });
});

describe("gustFactorText", () => {
  it("is the factor to a tenth, with a times sign", () => {
    expect(gustFactorText(1.9)).toBe("1.9×");
    expect(gustFactorText(1)).toBe("1.0×");
    expect(gustFactorText(2.25)).toBe("2.2×");
  });

  it("cuts rather than rounds, so it agrees with the stars' thresholds", () => {
    expect(gustFactorText(GUSTY_FROM - 0.001)).toBe("1.4×");
    expect(gustFactorText(GUSTY_FROM)).toBe("1.5×");
    expect(gustFactorText(VERY_GUSTY_FROM - 0.001)).toBe("1.7×");
    expect(gustFactorText(VERY_GUSTY_FROM)).toBe("1.8×");
    // As the factor is worked out from knots: 18 over 10.
    expect(gustFactorText(gustFactor(10, 18)!)).toBe("1.8×");
    expect(gustFactorText(gustFactor(10, 15)!)).toBe("1.5×");
  });
});
