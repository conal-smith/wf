import { describe, expect, it } from "vitest";
import type { ChartColours } from "./chartStyle";
import { colourSwaps, rethemeMap, swapColours } from "./retheme";

const light: ChartColours = {
  paper: "#ffffff",
  land: "#f1f1f3",
  ink: "#111114",
  depth: "#3f86a0",
  relief: "#a9a9b1",
  sand: "#ebe6d6",
  wetland: "#d3dbc8",
  halo: "#ffffff",
  tints: ["#a9cbd8", "#f7f8fa"],
};
const dark: ChartColours = {
  ...light,
  paper: "#0c0c0e",
  land: "#1b1b1f",
  ink: "#f2f2f4",
  halo: "#0c0c0e",
  tints: ["#2c6c84", "#0f1013"],
};

describe("the chart in the other theme", () => {
  it("pairs each changed colour, case and all", () => {
    const swaps = colourSwaps(light, dark);
    expect(swaps.get("#ffffff")).toBe("#0c0c0e");
    expect(swaps.get("#111114")).toBe("#f2f2f4");
    expect(swaps.get("#a9cbd8")).toBe("#2c6c84");
    expect(swaps.has("#3f86a0")).toBe(false);
  });

  it("swaps colours inside an expression and leaves the rest", () => {
    const swaps = colourSwaps(light, dark);
    expect(
      swapColours(
        ["interpolate", ["linear"], ["zoom"], 6, "#F1F1F3", 9, "#111114"],
        swaps,
      ),
    ).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      6,
      "#1b1b1f",
      9,
      "#f2f2f4",
    ]);
    expect(swapColours(0.5, swaps)).toBe(0.5);
  });

  it("sets only the paint properties that change", () => {
    const set: [string, string, unknown][] = [];
    const map = {
      getStyle: () => ({
        layers: [
          { id: "land", paint: { "fill-color": "#f1f1f3", "fill-opacity": 1 } },
          { id: "wind", paint: { "raster-opacity": 0.8 } },
        ],
      }),
      setPaintProperty: (id: string, name: string, value: unknown) =>
        set.push([id, name, value]),
    };
    expect(rethemeMap(map, colourSwaps(light, dark))).toBe(1);
    expect(set).toEqual([["land", "fill-color", "#1b1b1f"]]);
  });
});
