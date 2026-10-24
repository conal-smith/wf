import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../force5/src/stars";
import { riderSchema } from "./schema";

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

  it("keeps how much gusty wind bothers the rider, and refuses anything else", () => {
    expect(riderSchema.parse({ ...DEFAULT_RIDER, gusty: "lots" }).gusty).toBe("lots");
    expect(riderSchema.parse(DEFAULT_RIDER).gusty).toBeUndefined();
    expect(riderSchema.safeParse({ ...DEFAULT_RIDER, gusty: "very" }).success).toBe(false);
  });
});
