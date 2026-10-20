import { describe, expect, it } from "vitest";
import {
  KNOTS,
  UNITS,
  convert,
  formatSpeed,
  isUnits,
  knotsIn,
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
    expect(UNITS.map((unit) => unit.id)).toEqual(["kn", "m/s", "km/h", "mph"]);
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
