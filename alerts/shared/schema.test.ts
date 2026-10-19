import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER } from "../../force5/src/stars";
import { riderSchema } from "./schema";

describe("the rider a device sends", () => {
  it("keeps the models its stars come from, so its alerts follow them", () => {
    const starsFrom = {
      model: "gfs",
      then: "ecmwf",
      spots: { portrane: "harmonie" },
    };
    expect(
      riderSchema.parse({ ...DEFAULT_RIDER, starsFrom }).starsFrom,
    ).toEqual(starsFrom);
  });

  it("drops a model no longer offered, and the default altogether", () => {
    expect(
      riderSchema.parse({
        ...DEFAULT_RIDER,
        starsFrom: { model: "gefs", then: "gfs" },
      }).starsFrom,
    ).toEqual({ model: "harmonie", then: "gfs" });
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
});
