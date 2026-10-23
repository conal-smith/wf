import { describe, expect, it } from "vitest";
import {
  DEFAULT_STARS_FROM,
  FALLBACK_MODEL,
  STARS_MODELS,
  chosenModel,
  handovers,
  isDefaultChoice,
  leadFor,
  leadOrder,
  leadText,
  modelName,
  parseStarsChoice,
  pickModel,
  starsFromAt,
  withModel,
} from "./lead";

describe("the one model the stars come from", () => {
  it("is HARMONIE, then ECMWF, by default", () => {
    expect(DEFAULT_STARS_FROM).toEqual({ model: "harmonie", then: "ecmwf" });
    expect(starsFromAt(undefined)).toEqual(DEFAULT_STARS_FROM);
    expect(chosenModel(undefined)).toBe("harmonie");
    expect(leadText(DEFAULT_STARS_FROM)).toBe("HARMONIE, then ECMWF");
  });

  it("offers every published deterministic wind model, and no ensemble", () => {
    expect(STARS_MODELS).toEqual(["harmonie", "icon-eu", "ecmwf", "gfs"]);
    expect(modelName("icon-eu")).toBe("ICON-EU");
  });

  it("hands every model over to ECMWF past its run, and ECMWF to nobody", () => {
    expect(FALLBACK_MODEL).toBe("ecmwf");
    for (const model of STARS_MODELS)
      expect(starsFromAt({ model })).toEqual({ model, then: "ecmwf" });
    expect(leadOrder(leadFor("gfs"))).toEqual(["gfs", "ecmwf"]);
    expect(leadOrder(leadFor("ecmwf"))).toEqual(["ecmwf"]);
    expect(leadText(leadFor("ecmwf"))).toBe("ECMWF");
  });

  it("rates an hour from the chosen model where it has it, else ECMWF alone", () => {
    const from = leadFor("gfs");
    expect(pickModel(from, (m) => m === "gfs" || m === "ecmwf")).toBe("gfs");
    expect(pickModel(from, (m) => m === "ecmwf" || m === "harmonie")).toBe(
      "ecmwf",
    );
    // Neither reaches the hour: no other model stands in.
    expect(pickModel(from, (m) => m === "harmonie" || m === "icon-eu")).toBe(
      null,
    );
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
    expect(withModel("harmonie")).toBeUndefined();
  });

  it("keeps an old choice's model, and drops what it said for after the run and for spots of its own", () => {
    expect(
      parseStarsChoice({
        model: "gfs",
        then: "harmonie",
        spots: { portrane: "icon-eu" },
      }),
    ).toEqual({ model: "gfs" });
    // An old choice of HARMONIE with its own fallback and spots is the default now.
    expect(
      parseStarsChoice({
        model: "harmonie",
        then: "gfs",
        spots: { portrane: "gfs" },
      }),
    ).toBeUndefined();
  });

  it("drops a model that is not one to pick", () => {
    expect(parseStarsChoice({ model: "gefs", then: "gfs" })).toBeUndefined();
    expect(parseStarsChoice({ model: "../x" })).toBeUndefined();
    expect(parseStarsChoice("gfs")).toBeUndefined();
    expect(withModel("icon-eu")).toEqual({ model: "icon-eu" });
    expect(isDefaultChoice({ model: "icon-eu" })).toBe(false);
  });
});
