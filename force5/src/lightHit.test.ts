import { describe, expect, it } from "vitest";
import { nearestLight, nextLight } from "./lightHit";

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

describe("nextLight", () => {
  // A coast running east, a light up the shore from the middle one, and two
  // drawn on the same spot.
  const lights = [
    { id: "west", x: 0, y: 100 },
    { id: "mid", x: 100, y: 100 },
    { id: "east", x: 200, y: 110 },
    { id: "north", x: 110, y: 0 },
    { id: "pier", x: 300, y: 300 },
    { id: "pier2", x: 300, y: 300 },
  ];
  const at = (id: string) => lights.find((light) => light.id === id)!;

  it("goes the arrow's way, along the coast before up it", () => {
    expect(nextLight(lights, at("mid"), "right")).toBe("east");
    expect(nextLight(lights, at("mid"), "left")).toBe("west");
    expect(nextLight(lights, at("mid"), "up")).toBe("north");
    expect(nextLight(lights, at("west"), "right")).toBe("mid");
  });

  it("takes none where no light lies that way", () => {
    expect(nextLight(lights, at("west"), "left")).toBeNull();
    expect(nextLight(lights, at("north"), "up")).toBeNull();
  });

  it("walks lights on the same spot in the list's order", () => {
    expect(nextLight(lights, at("pier"), "right")).toBe("pier2");
    expect(nextLight(lights, at("pier2"), "left")).toBe("pier");
    expect(nextLight(lights, at("pier2"), "up")).toBe("pier");
    expect(nextLight(lights, at("pier"), "down")).toBe("pier2");
  });
});
