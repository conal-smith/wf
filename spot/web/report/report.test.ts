import { describe, expect, it } from "vitest";
import {
  dayCard,
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

  it("marks a day whose daylight hours lost their stars to a warning or a notice", () => {
    const midnight = Date.parse("2026-09-13T23:00:00Z");
    const hour = (h: number, extra: object) =>
      ({
        time: midnight + h * HOUR,
        step: 1,
        hour: {
          daylight: h >= 7 && h <= 19,
          wind: { wind_kn: 18, gust_kn: 24, direction_deg: 270 },
        },
        rating: null,
        shore: null,
        ...extra,
      }) as never;
    const day = {
      date: "2026-09-14",
      windMin: 18,
      windMax: 18,
      rows: [
        hour(3, { warning: { level: "red", ids: [], replaces_rating: true } }),
        hour(9, { water: { ids: [], replaces_rating: true } }),
        hour(13, {
          warning: { level: "orange", ids: [], replaces_rating: true },
        }),
      ],
    } as never;
    // The red one is in the dark: the orange is the day's.
    expect(dayCard(day, midnight, midnight).notice).toEqual({
      level: "orange",
      word: "Orange warning",
    });
  });
});
