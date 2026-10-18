import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, standardRating } from "../../../../force5/src/stars";
import { WIND_KEYS, polar, unitScale, webRadius } from "../../../../spot/web/yourStars";
import { dotAt, grabHandle, gridPick, knAtX } from "./yourStarsLogic";

const riding = standardRating(DEFAULT_RIDER);

describe("a scale under a finger", () => {
  it("reads knots along it, snapped to the rider's unit and kept inside it", () => {
    const kn = unitScale("kn");
    expect(knAtX(180, 360, 40, kn)).toBe(20);
    expect(knAtX(-30, 360, 40, kn)).toBe(0);
    expect(knAtX(999, 360, 40, kn)).toBe(40);
    // Half a metre per second at a time, kept in knots to the tenth.
    const ms = unitScale("m/s");
    const got = knAtX(100, 360, 40, ms);
    expect(Number((got * ms.perKn).toFixed(1)) % 0.5).toBe(0);
    expect(knAtX(10, 0, 40, kn)).toBe(0);
  });

  it("takes the nearest handle, and of two together the one the finger pulls", () => {
    const values = { min: 11, sweetLow: 12, sweetHigh: 24, max: 30 };
    expect(grabHandle(WIND_KEYS, values, 23, 0, 1.5)).toBe("sweetHigh");
    expect(grabHandle(WIND_KEYS, values, 11.5, 4, 1.5)).toBe("sweetLow");
    expect(grabHandle(WIND_KEYS, values, 11.5, -4, 1.5)).toBe("min");
    // Apart, the direction does not matter.
    expect(grabHandle(WIND_KEYS, values, 29, -4, 1.5)).toBe("max");
  });
});

describe("the web under a finger", () => {
  it("finds a dot within reach, the picked one first", () => {
    const off = riding.direction;
    const [x, y] = polar(50, webRadius(off.crossOff));
    expect(dotAt(x + 3, y, off, "onshore", 12)).toBe("crossOff");
    expect(dotAt(x + 30, y + 30, off, "onshore", 12)).toBeNull();
    // Two dots within reach: the picked direction's is on top, the nearest otherwise.
    const same = { ...off, cross: 0, crossOn: 0 };
    const [cx, cy] = polar(90, webRadius(0));
    expect(dotAt(cx, cy + 20, same, "crossOn", 60)).toBe("crossOn");
    expect(dotAt(cx, cy + 20, same, "cross", 60)).toBe("cross");
  });
});

describe("the grid under a finger", () => {
  it("reads whole knots, the gust never under the wind", () => {
    expect(gridPick(30 + 180, 230 - 115)).toEqual([20, 25]);
    expect(gridPick(30 + 300, 230)).toEqual([33, 33]);
    expect(gridPick(-50, -50)).toEqual([0, 50]);
  });
});
