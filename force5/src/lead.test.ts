import { describe, expect, it } from "vitest";
import {
  DEFAULT_STARS_FROM,
  STARS_MODELS,
  handovers,
  isDefaultChoice,
  leadOrder,
  modelName,
  parseStarsChoice,
  pickModel,
  sameStarsFrom,
  spotOverride,
  starsFromAt,
  starsFromText,
  withSpotStars,
  withStarsFrom,
} from "./lead";

describe("the one model the stars come from", () => {
  it("is HARMONIE, then ECMWF, by default", () => {
    expect(DEFAULT_STARS_FROM).toEqual({ model: "harmonie", then: "ecmwf" });
    expect(starsFromAt(undefined)).toEqual(DEFAULT_STARS_FROM);
    expect(starsFromAt(undefined, "portrane")).toEqual(DEFAULT_STARS_FROM);
    expect(starsFromText(DEFAULT_STARS_FROM)).toBe("HARMONIE, then ECMWF");
  });

  it("offers every published deterministic wind model, and no ensemble", () => {
    expect(STARS_MODELS).toEqual(["harmonie", "icon-eu", "ecmwf", "gfs"]);
    expect(modelName("icon-eu")).toBe("ICON-EU");
  });

  it("rates an hour from the chosen model where it has it, else the fallback alone", () => {
    const from = { model: "gfs", then: "ecmwf" };
    expect(pickModel(from, (m) => m === "gfs" || m === "ecmwf")).toBe("gfs");
    expect(pickModel(from, (m) => m === "ecmwf" || m === "harmonie")).toBe(
      "ecmwf",
    );
    // Neither reaches the hour: no other model stands in.
    expect(pickModel(from, (m) => m === "harmonie" || m === "icon-eu")).toBe(
      null,
    );
    expect(leadOrder({ model: "gfs", then: "gfs" })).toEqual(["gfs"]);
  });

  it("lets a spot of the rider's own take another model, keeping the fallback", () => {
    const choice = {
      model: "harmonie",
      then: "ecmwf",
      spots: { portrane: "gfs" },
    };
    expect(starsFromAt(choice, "portrane")).toEqual({
      model: "gfs",
      then: "ecmwf",
    });
    expect(starsFromAt(choice, "brandon")).toEqual(DEFAULT_STARS_FROM);
    expect(spotOverride(choice, "portrane")).toBe("gfs");
    expect(spotOverride(choice, "brandon")).toBeNull();
  });

  it("finds each handover along a row of hours, across the hours none rates", () => {
    expect(
      handovers(["harmonie", "harmonie", null, "ecmwf", "ecmwf", null]),
    ).toEqual([{ at: 3, from: "harmonie", to: "ecmwf" }]);
    expect(handovers(["gfs", "gfs"])).toEqual([]);
  });
});

describe("a stored choice", () => {
  it("is nothing at all while it is the default", () => {
    expect(parseStarsChoice(undefined)).toBeUndefined();
    expect(
      parseStarsChoice({ model: "harmonie", then: "ecmwf" }),
    ).toBeUndefined();
    expect(isDefaultChoice(undefined)).toBe(true);
  });

  it("drops a model that is not one to rate from, and a spot that says what everywhere says", () => {
    expect(
      parseStarsChoice({
        model: "gefs",
        then: "gfs",
        spots: { a: "ukv", b: "ecmwf", c: "harmonie", "": "gfs" },
      }),
    ).toEqual({ model: "harmonie", then: "gfs", spots: { b: "ecmwf" } });
    expect(parseStarsChoice("gfs")).toBeUndefined();
  });

  it("changes everywhere or at one spot, and back", () => {
    const gfs = withStarsFrom(undefined, { model: "gfs" });
    expect(gfs).toEqual({ model: "gfs", then: "ecmwf" });
    const portrane = withSpotStars(gfs, "portrane", "harmonie");
    expect(portrane).toEqual({
      model: "gfs",
      then: "ecmwf",
      spots: { portrane: "harmonie" },
    });
    // The spot keeps its own model when the rest changes.
    expect(withStarsFrom(portrane, { then: "gfs" })).toEqual({
      model: "gfs",
      then: "gfs",
      spots: { portrane: "harmonie" },
    });
    expect(withSpotStars(portrane, "portrane", null)).toEqual(gfs);
    expect(withStarsFrom(gfs, { model: "harmonie" })).toBeUndefined();
    expect(
      sameStarsFrom(starsFromAt(portrane, "portrane"), DEFAULT_STARS_FROM),
    ).toBe(true);
  });
});
