import { describe, expect, it } from "vitest";
import { isNotch, takesWheel, wheelPixels } from "./wheelHours";

const wheel = (
  deltaY: number,
  more: Partial<Parameters<typeof isNotch>[0]> = {},
) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ...more,
});

describe("a vertical wheel over the hours", () => {
  it("tells a mouse wheel's notch from a trackpad's step", () => {
    expect(isNotch(wheel(100))).toBe(true);
    expect(isNotch(wheel(-120, { wheelDeltaY: 120 }))).toBe(true);
    expect(isNotch(wheel(3, { deltaMode: 1 }))).toBe(true);
    expect(isNotch(wheel(4))).toBe(false);
    expect(isNotch(wheel(-12.5))).toBe(false);
    expect(isNotch(wheel(52.75))).toBe(false);
  });
  it("counts lines and pages in pixels", () => {
    expect(wheelPixels(wheel(3, { deltaMode: 1 }), 800)).toBe(48);
    expect(wheelPixels(wheel(-1, { deltaMode: 2 }), 800)).toBe(-800);
    expect(wheelPixels(wheel(7.5), 800)).toBe(7.5);
  });
  it("takes it only while the hours can go that way", () => {
    expect(takesWheel(wheel(10), 0, 500)).toBe(true);
    expect(takesWheel(wheel(-10), 0, 500)).toBe(false);
    expect(takesWheel(wheel(10), 500, 500)).toBe(false);
    expect(takesWheel(wheel(-10), 500, 500)).toBe(true);
    // Nowhere to go at all.
    expect(takesWheel(wheel(10), 0, 0)).toBe(false);
  });
  it("leaves a sideways swipe, a pinch and a still wheel to the browser", () => {
    expect(takesWheel(wheel(10, { deltaX: 20 }), 100, 500)).toBe(false);
    expect(takesWheel({ ...wheel(10), ctrlKey: true }, 100, 500)).toBe(false);
    expect(takesWheel(wheel(0), 100, 500)).toBe(false);
  });
});
