import { describe, expect, it } from "vitest";
import { CHART_LAYERS, chartColours, chartStyle } from "./chartStyle";

const colours = chartColours({ getPropertyValue: () => "#123456" });

const ARCHIVE = "pmtiles://https://data.example.com/bathy/v0/ireland.pmtiles";

const depthLayers = (style: ReturnType<typeof chartStyle>) =>
  style.layers.filter((layer) => "source" in layer && layer.source === "bathy");

describe("chartStyle", () => {
  it("switches every layer drawn from the depth archive together", () => {
    expect(
      depthLayers(chartStyle(colours, ARCHIVE))
        .map((l) => l.id)
        .sort(),
    ).toEqual([...CHART_LAYERS.depths].sort());
  });

  it("draws the depths from the archive it is given", () => {
    const style = chartStyle(colours, ARCHIVE);
    expect(style.sources.bathy).toMatchObject({ type: "vector", url: ARCHIVE });
    for (const layer of depthLayers(style))
      expect(layer.layout?.visibility, layer.id).toBeUndefined();
  });

  it("with no archive, names none and hides the depths, so nothing is read", () => {
    const style = chartStyle(colours, null);
    expect(style.sources.bathy).not.toHaveProperty("url");
    expect(style.sources.bathy).not.toHaveProperty("tiles");
    const hidden = depthLayers(style);
    expect(hidden).toHaveLength(CHART_LAYERS.depths.length);
    for (const layer of hidden)
      expect(layer.layout?.visibility, layer.id).toBe("none");
    // The soundings keep their own layout beside it.
    expect(
      hidden.find((layer) => layer.id === "soundings")?.layout,
    ).toMatchObject({ "text-field": ["get", "label"] });
  });
});
