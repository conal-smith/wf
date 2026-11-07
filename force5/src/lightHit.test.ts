import { describe, expect, it } from "vitest";
import {
  nearestLight,
  nextLight,
  pressedLight,
  tappedLight,
  thinLights,
} from "./lightHit";

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

describe("thinLights", () => {
  const light = (id: string, x: number, rank: number) => ({
    id,
    x,
    y: 0,
    halfW: 10,
    halfH: 10,
    rank,
  });

  it("keeps the best of a crowd and thins the rest", () => {
    const thin = thinLights([
      light("near", 12, 2),
      light("best", 0, 5),
      light("clear", 40, 1),
    ]);
    expect([...thin]).toEqual(["near"]);
  });

  it("keeps the first of a tie, whatever the order of the ranks", () => {
    expect([...thinLights([light("a", 0, 3), light("b", 5, 3)])]).toEqual([
      "b",
    ]);
  });

  it("compares with what was kept, not with what was thinned", () => {
    const thin = thinLights([
      light("a", 0, 3),
      light("b", 15, 2),
      light("c", 30, 1),
    ]);
    expect([...thin]).toEqual(["b"]);
  });
});

describe("a press among pills and muted dots", () => {
  // A pill, wide enough that a press on its end is far from its centre, with
  // a dot just past that end.
  const marks = [
    { id: "pill", x: 100, y: 100, dot: false },
    { id: "dot", x: 124, y: 100, dot: true },
    { id: "far", x: 300, y: 300, dot: true },
  ];

  it("takes a press on a pill's end as the pill's, though a dot is nearer", () => {
    expect(pressedLight(marks, 118, 100, 22, false)).toBe("pill");
  });

  it("takes a press that reached a dot as a dot's", () => {
    expect(pressedLight(marks, 118, 100, 22, true)).toBe("dot");
  });

  it("through a move, a pill in reach comes before a nearer dot", () => {
    expect(tappedLight(marks, 116, 100, 22, 10)).toBe("pill");
  });

  it("through a move, a dot only where it was all but hit", () => {
    expect(tappedLight(marks, 305, 300, 22, 10)).toBe("far");
    expect(tappedLight(marks, 315, 300, 22, 10)).toBeNull();
  });
});
