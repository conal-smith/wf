import { describe, expect, it } from "vitest";
import type { Spot } from "../force5/src/weather";
import { openingSpot } from "./openingSpot";

const spot = (id: string): Spot => ({
  id,
  name: id,
  county: "Kerry",
  lat: 53,
  lon: -9,
  note: "",
});
const SPOTS = ["brandon", "keel", "rusheen", "dollymount"].map(spot);

describe("openingSpot", () => {
  it("is the spot named in the link", () => {
    expect(openingSpot("?spot=brandon", SPOTS)).toEqual(SPOTS[0]);
  });

  it("and otherwise no spot at all: there is no default place", () => {
    expect(openingSpot("", SPOTS)).toBeNull();
    expect(openingSpot("?spot=", SPOTS)).toBeNull();
  });

  it("passes over a link to a place the catalogue does not hold", () => {
    expect(openingSpot("?spot=atlantis", SPOTS)).toBeNull();
  });
});
