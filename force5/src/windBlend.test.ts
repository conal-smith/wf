import { describe, expect, it } from "vitest";
import { blendHour, type BlendMember } from "./windBlend";

const member = (
  model: string,
  speed: number,
  gust: number | null,
  leadHours = 6,
): BlendMember => ({ model, speed, gust, u: 0, v: -speed, leadHours });

describe("blendHour", () => {
  it("weights each model as the chart's blend does, by its day of run", () => {
    // HARMONIE 4, ECMWF 0.5 on day 0; GFS 2 on day 0, 1 from day 2.
    const b = blendHour([
      member("harmonie", 10, 14),
      member("ecmwf", 20, null),
      member("gfs", 16, 20, 50),
    ])!;
    expect(b.speed).toBeCloseTo((10 * 4 + 20 * 0.5 + 16 * 1) / 5.5, 9);
    // The gust of the models that give one, weighted among themselves.
    expect(b.gust).toBeCloseTo((14 * 4 + 20 * 1) / 5, 9);
    expect(b.count).toBe(3);
    // Each from the north: so is the blend.
    expect(b.u).toBeCloseTo(0, 9);
    expect(b.v).toBeLessThan(0);
  });

  it("has no gust where no model gives one, and nothing with no model", () => {
    expect(blendHour([member("harmonie", 10, null)])!.gust).toBeNull();
    expect(blendHour([])).toBeNull();
  });

  it("averages the speeds, not the vector, so a split on direction does not calm it", () => {
    const b = blendHour([
      { model: "harmonie", speed: 10, gust: null, u: 10, v: 0, leadHours: 0 },
      { model: "icon-eu", speed: 10, gust: null, u: -10, v: 0, leadHours: 0 },
    ])!;
    expect(b.speed).toBe(10);
  });
});
