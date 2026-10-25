import { describe, expect, it } from "vitest";
import { feelsLikeC, windChillIndex } from "./feelsLike";

const KN = 1 / 1.852;

describe("windChillIndex", () => {
  it("matches the published JAG/TI wind chill table", () => {
    // Environment Canada's table, rounded to the degree.
    expect(Math.round(windChillIndex(-10, 20))).toBe(-18);
    expect(Math.round(windChillIndex(0, 10))).toBe(-3);
    expect(Math.round(windChillIndex(5, 30))).toBe(0);
    expect(Math.round(windChillIndex(-20, 50))).toBe(-35);
  });
});

describe("feelsLikeC", () => {
  it("reads the mean wind at 10 m in knots", () => {
    expect(feelsLikeC(-10, 20 * KN)).toBeCloseTo(windChillIndex(-10, 20), 1);
    // Kilcrea on Sun 25 Oct 2026 (#182): 9 °C in 23.1 kn, 11 °C in 20.7 kn.
    expect(feelsLikeC(9, 23.1)).toBe(4.5);
    expect(feelsLikeC(11, 20.7)).toBe(7.4);
    expect(feelsLikeC(9, 14.1)).toBe(5.6);
  });

  it("is the air temperature in light wind, and never warmer than the air", () => {
    expect(feelsLikeC(8, 2)).toBe(8);
    expect(feelsLikeC(25, 20)).toBe(25);
    expect(feelsLikeC(15, 20)).toBeLessThan(15);
    // Its cooling fades as the air warms, with no jump at 10 °C.
    const at = (t: number) => t - feelsLikeC(t, 20)!;
    expect(at(10)).toBeGreaterThan(at(10.5));
    expect(at(10) - at(10.5)).toBeLessThan(0.3);
  });

  it("gives nothing without an air temperature or a wind", () => {
    expect(feelsLikeC(null, 20)).toBeNull();
    expect(feelsLikeC(10, null)).toBeNull();
  });
});
