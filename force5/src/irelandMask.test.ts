import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MASK_BOUNDS, MASK_PATH } from "./irelandMask";

/** The PNG's size and a few pixels' alpha, read without a decoder: IHDR only. */
function size(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("the Ireland mask", () => {
  const png = readFileSync(`public/${MASK_PATH}`);

  it("is a grey-and-alpha PNG over the bounds the map is held to", () => {
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png[25]).toBe(4);
    const { width, height } = size(png);
    // Web Mercator rows: the image's shape is the bounds' shape in Mercator.
    const [[west, south], [east, north]] = MASK_BOUNDS;
    const rad = Math.PI / 180;
    const merc = (lat: number) =>
      Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
    const expected =
      (width * (merc(north) - merc(south))) / ((east - west) * rad);
    expect(Math.abs(height - expected)).toBeLessThanOrEqual(1);
  });
});
