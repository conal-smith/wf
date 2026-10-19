import { describe, expect, it } from "vitest";
import {
  bezelTicks,
  isFocusStyle,
  loupeRadius,
  metresPerPixel,
  rangeLabel,
  rangeRing,
  washHoles,
} from "./focus";

describe("the mark round the chosen spot", () => {
  it("knows its three styles and nothing else", () => {
    expect(isFocusStyle("loupe")).toBe(true);
    expect(isFocusStyle("ring")).toBe(true);
    expect(isFocusStyle("off")).toBe(true);
    expect(isFocusStyle("spotlight")).toBe(false);
    expect(isFocusStyle(null)).toBe(false);
  });

  it("measures the ground under a pixel as MapLibre draws it", () => {
    // Portrane, at the zoom a chosen spot is flown to: about 34 m a pixel.
    expect(metresPerPixel(10.4, 53.49)).toBeCloseTo(34.4, 0);
    expect(metresPerPixel(11.4, 53.49)).toBeCloseTo(17.2, 0);
  });

  it("lays a 400 px glass on a desktop's chart, and a smaller one on a phone", () => {
    expect(loupeRadius(1440, 620)).toBe(200);
    expect(loupeRadius(390, 480)).toBe(156);
    expect(loupeRadius(200, 160)).toBe(110);
  });

  it("rules the bezel every 5°, longer every 30°, with north left for its letter", () => {
    const ticks = bezelTicks(100);
    expect(ticks).toHaveLength(71);
    expect(ticks.filter((t) => t.long)).toHaveLength(11);
    // East, 90° round: a long tick straight out to the right.
    const east = ticks[17];
    expect(east.long).toBe(true);
    expect(east.x1).toBeCloseTo(101.5);
    expect(east.x2).toBeCloseTo(108);
    expect(east.y2).toBeCloseTo(0);
  });

  it("draws the ring at the longest round distance inside 42% of the view", () => {
    // 3 NM is 161 px at 34.4 m a pixel; 5 NM, 269 px, is over 260.
    expect(rangeRing(34.4, 620)).toEqual({ nm: 3, px: (3 * 1852) / 34.4 });
    // Two zooms in, four times the pixels a mile: 1 NM is 215 px.
    expect(rangeRing(8.6, 620).nm).toBe(1);
    // Nothing fits: the shortest, rather than none.
    expect(rangeRing(1, 620).nm).toBe(0.25);
    expect(rangeLabel(0.5)).toBe("0.5 NM");
  });

  it("washes lightly beyond the loupe, and more lightly still beyond the ring", () => {
    expect(washHoles("loupe", 200)).toEqual({ holes: [206.5], opacity: 0.18 });
    const ring = washHoles("ring", 100);
    expect(ring.holes).toEqual([145, 185, 225, 265, 305]);
    // The five layers add up to 10% at the most.
    expect(1 - (1 - ring.opacity) ** 5).toBeCloseTo(0.1);
    expect(washHoles("off", 100)).toEqual({ holes: [], opacity: 0 });
  });
});
