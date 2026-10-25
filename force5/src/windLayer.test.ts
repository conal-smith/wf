import { describe, expect, it } from "vitest";
import { DEFAULT_WIND, parseWindLayers } from "./windLayer";

describe("parseWindLayers", () => {
  it("reads the two layers as saved", () => {
    for (const wash of [true, false])
      for (const particles of [true, false])
        expect(
          parseWindLayers(JSON.stringify({ wash, particles }), "arrows"),
        ).toEqual({ wash, particles });
  });

  it("reads an older chart's style into the two layers", () => {
    expect(parseWindLayers(null, "ink")).toEqual({
      wash: false,
      particles: true,
    });
    // The coloured wind is the colour alone now: its lines are a layer to add.
    expect(parseWindLayers(null, "wash")).toEqual({
      wash: true,
      particles: false,
    });
    expect(parseWindLayers(null, "arrows")).toEqual({
      wash: true,
      particles: true,
    });
  });

  it("opens a first visit, or a store it cannot read, on the particles alone", () => {
    expect(DEFAULT_WIND).toEqual({ wash: false, particles: true });
    expect(parseWindLayers(null)).toEqual(DEFAULT_WIND);
    expect(parseWindLayers(null, "neon")).toEqual(DEFAULT_WIND);
    expect(parseWindLayers(null, "toString")).toEqual(DEFAULT_WIND);
    expect(parseWindLayers("{not json", "wash")).toEqual({
      wash: true,
      particles: false,
    });
    expect(parseWindLayers('{"wash":"yes","particles":true}')).toEqual(
      DEFAULT_WIND,
    );
    expect(parseWindLayers("null")).toEqual(DEFAULT_WIND);
  });

  it("hands back a copy, never the default itself", () => {
    expect(parseWindLayers(null)).not.toBe(DEFAULT_WIND);
  });
});
