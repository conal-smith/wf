import { describe, expect, it } from "vitest";
import { shadows } from "./lightsCanvas";

describe("shadows", () => {
  it("reads a computed text-shadow list, colours with commas in them", () => {
    expect(
      shadows(
        "rgb(245, 240, 230) 0px 0px 2px, color(srgb 0.9 0.9 0.9 / 0.5) 0px 0px 8px",
      ),
    ).toEqual([
      { color: "rgb(245, 240, 230)", blur: 2 },
      { color: "color(srgb 0.9 0.9 0.9 / 0.5)", blur: 8 },
    ]);
  });
  it("is empty with none", () => {
    expect(shadows("none")).toEqual([]);
    expect(shadows("")).toEqual([]);
  });
});
