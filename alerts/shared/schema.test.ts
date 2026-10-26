import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, OURS, oursCopy } from "../../force5/src/stars";
import { clampDownwind, clampUpwind } from "../../force5/src/rideWedge";
import { riderSchema, storedRider } from "./schema";

/** A rider as an app from before 25 October 2026 sent it: a level, a gust setting, and a rating made from the level. */
const OLD_RIDER = {
  weightKg: 85,
  skill: "advanced",
  gusty: "lots",
  upwind: 35,
  wings: [4, 5.5],
  custom: {
    version: 2,
    base: "advanced",
    wind: { min: 9, sweetLow: 13, sweetHigh: 26, max: 35 },
    direction: { onshore: 0.5, crossOn: 0, cross: 0, crossOff: 1, offshore: 3 },
  },
  keptCustom: null,
};

describe("the rider a device sends", () => {
  it("keeps the model its stars come from, so its alerts follow it", () => {
    expect(
      riderSchema.parse({ ...DEFAULT_RIDER, starsFrom: { model: "gfs" } })
        .starsFrom,
    ).toEqual({ model: "gfs" });
  });

  it("takes an older app's fallback and spots of its own, and drops them", () => {
    expect(
      riderSchema.parse({
        ...DEFAULT_RIDER,
        starsFrom: { model: "gfs", then: "harmonie", spots: { portrane: "harmonie" } },
      }).starsFrom,
    ).toEqual({ model: "gfs" });
  });

  it("drops a model no longer offered, and the default altogether", () => {
    expect(
      riderSchema.parse({
        ...DEFAULT_RIDER,
        starsFrom: { model: "gefs", then: "gfs" },
      }).starsFrom,
    ).toBeUndefined();
    expect(
      riderSchema.parse({
        ...DEFAULT_RIDER,
        starsFrom: { model: "harmonie", then: "ecmwf" },
      }).starsFrom,
    ).toBeUndefined();
    expect(
      riderSchema.safeParse({ ...DEFAULT_RIDER, starsFrom: { model: "../x" } })
        .success,
    ).toBe(false);
  });

  it("takes an older app's level, gust setting and old rating, and rates it on ours", () => {
    expect(riderSchema.parse(OLD_RIDER)).toEqual({
      weightKg: 85,
      upwind: 35,
      wings: [4, 5.5],
      custom: null,
    });
    // Whatever level or gust setting it names, never an error.
    expect(riderSchema.safeParse({ ...OLD_RIDER, skill: "pro", gusty: "very" }).success).toBe(true);
  });

  it("keeps the rider's own rating, clamped, with offshore never", () => {
    const own = { ...oursCopy(), wind: { min: 9, sweetLow: 13, sweetHigh: 26, max: 50 } };
    expect(riderSchema.parse({ ...DEFAULT_RIDER, custom: own }).custom).toEqual({
      ...own,
      wind: { ...own.wind, max: 40 },
    });
    expect(
      riderSchema.parse({ ...DEFAULT_RIDER, custom: { ...OURS, direction: { ...OURS.direction, offshore: 0 } } }).custom,
    ).toEqual(OURS);
  });

  it("keeps how far up and down the wind the rider rides, held to its range", () => {
    expect(riderSchema.parse({ ...DEFAULT_RIDER, upwind: 20, downwind: 15 })).toMatchObject({
      upwind: 20,
      downwind: 15,
    });
    expect(riderSchema.parse({ ...DEFAULT_RIDER, upwind: 90, downwind: -5 })).toMatchObject({
      upwind: 45,
      downwind: 0,
    });
    expect(riderSchema.parse(DEFAULT_RIDER)).toEqual(DEFAULT_RIDER);
    expect(riderSchema.safeParse({ ...DEFAULT_RIDER, upwind: "high" }).success).toBe(false);
    // As the map holds them.
    for (const deg of [-10, 0, 12.4, 30, 44.6, 60]) {
      const { upwind, downwind } = riderSchema.parse({ ...DEFAULT_RIDER, upwind: deg, downwind: deg });
      expect([upwind, downwind]).toEqual([clampUpwind(deg), clampDownwind(deg)]);
    }
  });
});

describe("a rider read back from a device's row", () => {
  it("reads an older app's rider as ours, and anything unreadable as the default rider", () => {
    expect(storedRider(OLD_RIDER)).toEqual({ weightKg: 85, upwind: 35, wings: [4, 5.5], custom: null });
    expect(storedRider({ weightKg: 900, wings: [] })).toEqual(DEFAULT_RIDER);
    expect(storedRider(null)).toEqual(DEFAULT_RIDER);
  });
});
