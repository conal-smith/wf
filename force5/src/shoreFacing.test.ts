import { describe, expect, it } from "vitest";
import shore from "../../data/locations/shore-facing.json" with { type: "json" };
import { isOnWater, shoreFacing, shoreType } from "./shoreFacing";

describe("shoreFacing", () => {
  it("is a beach's facing: a hand correction first, then the computed one", () => {
    expect(shoreFacing("dollymount")).toBe(125);
    expect(shoreFacing("kilcrea")).toBe(163);
    expect(shoreType("kilcrea")).toBe("beach");
  });

  it("knows Malahide Estuary as a spot on the water, rated on the wind alone", () => {
    expect(isOnWater("malahide-estuary")).toBe(true);
    expect(shoreFacing("malahide-estuary")).toBeNull();
    expect(shoreType("malahide-estuary")).toBe("on-water");
    // Its neighbours on the same estuary are beaches.
    expect(shoreType("malahide-estuary-south-park")).toBe("beach");
  });

  it("calls a beach whose facing was not clear enough unknown, not on the water", () => {
    expect(shoreType("bertra")).toBe("unknown");
    expect(shoreType("fi-white-strand-doonbeg")).toBe("unknown");
  });

  it("lists only places it knows on the water", () => {
    for (const id of shore.onWater) expect(id in shore.places, id).toBe(true);
  });
});
