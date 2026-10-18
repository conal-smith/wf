import { describe, expect, it } from "vitest";
import { releaseReplacedColorRamps } from "./colorRelief";

/** A stand-in for MapLibre's ColorReliefStyleLayer: a new pair per ramp. */
class FakeLayer {
  ramp = 1;
  built = 0;
  destroyed: string[] = [];
  colorRampTextures?: {
    elevationTexture: { destroy(): void };
    colorTexture: { destroy(): void };
  };
  private builtFor = 0;
  getColorRampTextures() {
    if (this.colorRampTextures && this.builtFor === this.ramp)
      return this.colorRampTextures;
    const n = ++this.built;
    this.builtFor = this.ramp;
    this.colorRampTextures = {
      elevationTexture: {
        destroy: () => this.destroyed.push(`elevation ${n}`),
      },
      colorTexture: { destroy: () => this.destroyed.push(`colour ${n}`) },
    };
    return this.colorRampTextures;
  }
}

describe("releaseReplacedColorRamps", () => {
  it("deletes the ramp a new one replaces, and only that", () => {
    const layer = new FakeLayer();
    expect(releaseReplacedColorRamps(layer)).toBe(true);
    const first = layer.getColorRampTextures();
    // The same ramp, drawn again: nothing built, nothing deleted.
    expect(layer.getColorRampTextures()).toBe(first);
    expect(layer.destroyed).toEqual([]);
    layer.ramp = 2;
    const second = layer.getColorRampTextures();
    expect(second).not.toBe(first);
    expect(layer.destroyed).toEqual(["elevation 1", "colour 1"]);
    layer.ramp = 3;
    layer.getColorRampTextures();
    expect(layer.destroyed).toEqual([
      "elevation 1",
      "colour 1",
      "elevation 2",
      "colour 2",
    ]);
  });

  it("wraps a layer once", () => {
    const layer = new FakeLayer();
    expect(releaseReplacedColorRamps(layer)).toBe(true);
    expect(releaseReplacedColorRamps(layer)).toBe(false);
    layer.getColorRampTextures();
    layer.ramp = 2;
    layer.getColorRampTextures();
    expect(layer.destroyed).toEqual(["elevation 1", "colour 1"]);
  });

  it("leaves anything without a ramp alone", () => {
    expect(releaseReplacedColorRamps(undefined)).toBe(false);
    expect(releaseReplacedColorRamps({ id: "rivers" })).toBe(false);
  });
});
