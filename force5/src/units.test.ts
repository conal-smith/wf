import { describe, expect, it } from "vitest";
import {
  BEAUFORT_KN,
  KNOTS,
  UNITS,
  beaufort,
  convert,
  forceKn,
  formatSpeed,
  isUnits,
  knotsIn,
  scaleUnits,
  speedShort,
  speedWords,
  unitLabel,
  unitName,
  type Units,
} from "./units";
import { convert as convertFromWeather } from "./weather";

describe("display units", () => {
  it("gives a speed held in knots in the rider's units, rounded", () => {
    expect(knotsIn(12, "kn")).toBe(12);
    expect(knotsIn(12, "m/s")).toBe(6);
    expect(knotsIn(12, "km/h")).toBe(22);
    expect(knotsIn(12, "mph")).toBe(14);
  });

  it("names every unit as it is read aloud", () => {
    expect(unitName("kn")).toBe("knots");
    expect(unitName("m/s")).toBe("metres per second");
    expect(unitName("km/h")).toBe("kilometres per hour");
    expect(unitName("mph")).toBe("miles per hour");
  });

  it("converts metres per second into every offered unit", () => {
    expect(convert(10, "m/s")).toBe(10);
    expect(convert(10, "kn")).toBeCloseTo(19.4384, 3);
    expect(convert(10, "km/h")).toBeCloseTo(36, 6);
    expect(convert(10, "mph")).toBeCloseTo(22.3694, 3);
    expect(convert(0, "kn")).toBe(0);
    expect(convert(-3, "kn")).toBeCloseTo(-3 * KNOTS, 6);
  });
  it("offers a label for each unit and rejects anything else", () => {
    expect(UNITS.map((unit) => unit.id)).toEqual([
      "kn",
      "m/s",
      "km/h",
      "mph",
      "bft",
    ]);
    for (const unit of UNITS) expect(unitLabel(unit.id)).toBe(unit.label);
    expect(UNITS.every((unit) => isUnits(unit.id))).toBe(true);
    expect(isUnits("beaufort")).toBe(false);
    expect(isUnits(undefined)).toBe(false);
  });
  it("formats missing readings as an em dash, never as calm", () => {
    expect(formatSpeed(10, "kn")).toBe("19 kn");
    expect(formatSpeed(10, "kn", 1)).toBe("19.4 kn");
    expect(formatSpeed(0, "m/s")).toBe("0 m/s");
    expect(formatSpeed(null, "kn")).toBe("—");
    expect(formatSpeed(undefined, "kn")).toBe("—");
    expect(formatSpeed(NaN, "kn")).toBe("—");
  });
  it("stays importable from weather.ts so existing callers keep working", () => {
    const units: Units = "kn";
    expect(convertFromWeather(10, units)).toBe(convert(10, units));
  });

});

describe("Force (Beaufort)", () => {
  it("starts each force at its knot, Force 1 to Force 12", () => {
    expect(BEAUFORT_KN).toEqual([1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64]);
    BEAUFORT_KN.forEach((kn, i) => {
      expect(beaufort(kn)).toBe(i + 1);
      expect(beaufort(kn - 1)).toBe(i);
    });
    expect(beaufort(0)).toBe(0);
    expect(beaufort(0.4)).toBe(0);
    expect(beaufort(80)).toBe(12);
    expect(beaufort(NaN)).toBe(0);
  });

  it("reads the whole knot the knots show, so 3.6 kn is Force 2 as 4 kn is", () => {
    expect(beaufort(3.6)).toBe(2);
    expect(beaufort(3.4)).toBe(1);
    expect(beaufort(16.4)).toBe(4);
    expect(beaufort(16.5)).toBe(5);
  });

  it("gives each force's first and last knot", () => {
    expect(forceKn(5, "first")).toBe(17);
    expect(forceKn(5, "last")).toBe(21);
    expect(forceKn(1, "first")).toBe(1);
    expect(forceKn(0, "first")).toBe(0);
    expect(forceKn(0, "last")).toBe(0);
    expect(forceKn(12, "last")).toBe(64);
    expect(forceKn(14, "first")).toBe(64);
    for (let f = 0; f <= 12; f++) {
      expect(beaufort(forceKn(f, "first"))).toBe(f);
      expect(beaufort(forceKn(f, "last"))).toBe(f);
    }
  });

  it("is a unit a rider can choose, labelled Force", () => {
    expect(isUnits("bft")).toBe(true);
    expect(unitLabel("bft")).toBe("Force");
    expect(unitName("bft")).toBe("force");
  });

  it("writes a force whole: a figure, a line, words", () => {
    expect(knotsIn(18, "bft")).toBe(5);
    expect(speedShort(18, "bft")).toBe("F5");
    expect(speedShort(18, "kn")).toBe("18");
    expect(speedWords(18, "bft")).toBe("Force 5");
    expect(speedWords(18, "kn")).toBe("18 knots");
    expect(formatSpeed(18 / KNOTS, "bft")).toBe("Force 5");
    expect(formatSpeed(null, "bft")).toBe("—");
  });

  it("draws a scale in knots for a rider in Force", () => {
    expect(scaleUnits("bft")).toBe("kn");
    expect(scaleUnits("m/s")).toBe("m/s");
    expect(convert(10, "bft")).toBe(convert(10, "kn"));
  });
});
