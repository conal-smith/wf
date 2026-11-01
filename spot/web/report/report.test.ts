import { describe, expect, it } from "vitest";
import {
  deepUntil,
  hoursMinutes,
  lightLeft,
  rowAt,
  smoothPath,
} from "./report";

const HOUR = 3600000;
const row = (time: number) => ({ time }) as never;

describe("the spot report's sums", () => {
  it("finds the row that covers a moment", () => {
    const rows = [row(0), row(HOUR), row(2 * HOUR)];
    expect(rowAt(rows, 1.5 * HOUR)).toBe(rows[1]);
    expect(rowAt(rows, -5)).toBe(rows[0]);
    expect(rowAt([], 0)).toBeNull();
  });

  it("draws a curve that passes through every point", () => {
    const d = smoothPath([
      [0, 10],
      [10, 0],
      [20, 10],
    ]);
    expect(d.startsWith("M0,10C")).toBe(true);
    expect(d).toContain(" 10,0C");
    expect(d.endsWith(" 20,10")).toBe(true);
    expect(smoothPath([])).toBe("");
  });

  it("counts the light left to last light, and none after it", () => {
    const sun = {
      firstLight: 6 * HOUR,
      sunrise: 7 * HOUR,
      sunset: 17 * HOUR,
      lastLight: 17.5 * HOUR,
    };
    expect(lightLeft(14 * HOUR, sun)).toBe(210);
    expect(lightLeft(18 * HOUR, sun)).toBeNull();
    expect(hoursMinutes(191)).toEqual({ h: 3, m: 11 });
  });

  it("says when the launch stops being deep enough", () => {
    const depth = (t: number) => 3 - t / HOUR;
    expect(deepUntil(depth, 0)).toBe(2 * HOUR + 5 * 60000);
    expect(deepUntil(() => 0.5, 0)).toBeNull();
    expect(deepUntil(() => null, 0)).toBeNull();
  });
});
