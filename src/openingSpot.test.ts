import { describe, expect, it } from "vitest";
import type { Spot } from "../force5/src/weather";
import { openingSpot, spotAddress } from "./openingSpot";

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

describe("spotAddress", () => {
  it("names the chosen spot in the link", () => {
    expect(spotAddress("https://wingfoil.ie/", "keel")).toBe("/?spot=keel");
    expect(spotAddress("https://wingfoil.ie/?spot=keel", "brandon")).toBe(
      "/?spot=brandon",
    );
  });

  it("and leaves it out for none, keeping the rest of the address", () => {
    expect(spotAddress("https://wingfoil.ie/?spot=keel", null)).toBe("/");
    expect(spotAddress("https://wingfoil.ie/?x=1&spot=keel#k", null)).toBe(
      "/?x=1#k",
    );
    expect(spotAddress("https://wingfoil.ie/?x=1", "a b")).toBe(
      "/?x=1&spot=a+b",
    );
  });

  it("reads back as the spot it names", () => {
    const search = new URL(
      spotAddress("https://wingfoil.ie/", "rusheen"),
      "https://wingfoil.ie",
    ).search;
    expect(openingSpot(search, SPOTS)).toEqual(SPOTS[2]);
  });
});
