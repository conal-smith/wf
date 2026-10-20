import { describe, expect, it } from "vitest";
import { nearestLight } from "./lightHit";

describe("nearestLight", () => {
  const lights = [
    { id: "a", x: 100, y: 100 },
    { id: "b", x: 130, y: 100 },
    { id: "c", x: 300, y: 300 },
  ];

  it("takes a light within reach of the tap, not only on its ring", () => {
    expect(nearestLight(lights, 300, 320, 22)).toBe("c");
    expect(nearestLight(lights, 315, 315, 22)).toBe("c");
  });

  it("takes the nearest where two lights' reach overlaps", () => {
    expect(nearestLight(lights, 112, 100, 22)).toBe("a");
    expect(nearestLight(lights, 118, 104, 22)).toBe("b");
  });

  it("takes none beyond reach", () => {
    expect(nearestLight(lights, 300, 323, 22)).toBeNull();
    expect(nearestLight([], 0, 0, 22)).toBeNull();
  });
});
