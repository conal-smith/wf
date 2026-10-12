import { describe, expect, it } from "vitest";
import { foilPoint, terrariumRgb, type FoilReserved } from "./foilDepth";

// A set as scripts/foildepth writes it now: estimates flagged in the blue
// byte, land beside the water padded from 10 m up.
const set = {
  noSurveyMetres: 40,
  landMetres: 50,
  deepMetres: -20,
  estimateBlue: 4,
  padMetres: 10,
};
const area = { dryCeilingMetres: 5 };
const read = (metres: number, m: FoilReserved = set) => {
  const [r, g, b] = terrariumRgb(metres);
  return foilPoint(r * 256 + g + b / 256 - 32768, m, b, area.dryCeilingMetres);
};

describe("a tapped pixel", () => {
  it("reads a surveyed height, and an estimate by its blue byte", () => {
    expect(read(1.25)).toBe(1.25);
    // build.mark_estimate: a 64th of a metre over the 1/32 m step.
    expect(read(1.25 + 1 / 64)).toEqual({ estimate: 1.265625 });
  });
  it("reads the deep value, land and the padding beside land", () => {
    expect(read(-20)).toBe("deep");
    // The deep value flagged: a stretch too large to estimate, unsurveyed.
    expect(read(-20 + 1 / 64)).toBe("unsurveyed");
    expect(read(50)).toBeNull();
    for (const pad of [10, 22.5, 45]) expect(read(pad)).toBeNull();
    // Over the dry ceiling is not foreshore.
    expect(read(6.5)).toBeNull();
  });
  it("still reads an older set's unsurveyed water", () => {
    const old = { noSurveyMetres: 40, landMetres: 50, deepMetres: -20 };
    expect(read(40, old)).toBe("unsurveyed");
    expect(read(1.25 + 1 / 64, old)).toBeCloseTo(1.265625);
  });
});
