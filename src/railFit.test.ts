import { describe, expect, it } from "vitest";
import { railFits } from "./railFit";

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("railFits", () => {
  const rail = box(1180, 18, 1210, 496);

  it("fits above the window's foot with nothing below it", () => {
    expect(railFits(rail, [], 720, 12)).toBe(true);
    expect(railFits(rail, [], 500, 12)).toBe(false);
  });

  it("keeps clear of what stands in its column", () => {
    // The spot's tools on the dock's edge, under the rail.
    expect(railFits(rail, [box(886, 545, 1268, 581)], 720, 12)).toBe(true);
    expect(railFits(rail, [box(886, 465, 1268, 501)], 720, 12)).toBe(false);
    // Clear, but by less than the gap.
    expect(railFits(rail, [box(886, 500, 1268, 540)], 720, 12)).toBe(false);
  });

  it("minds nothing beside it or above it", () => {
    // The small print at the left, as high as the rail reaches.
    expect(railFits(rail, [box(16, 300, 178, 320)], 720, 12)).toBe(true);
    // The zoom's box beside it, at its top.
    expect(railFits(rail, [box(1220, 18, 1262, 118)], 720, 12)).toBe(true);
  });
});
