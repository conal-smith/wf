import { describe, expect, it } from "vitest";
import type { Spot } from "../force5/src/weather";
import { findSpots } from "./spotSearch";

const place = (id: string, name: string, extra: Partial<Spot> = {}): Spot =>
  ({ id, name, lat: 53, lon: -9, ...extra }) as Spot;

const spots = [
  place("keel", "Keel Beach", { county: "Mayo" }),
  place("brandon", "Brandon Bay", { county: "Kerry" }),
  place("inch", "Inch Strand", { county: "Kerry", aliases: ["Inse"] }),
  place("bunbeg", "Bunbeg", { county: "Donegal" }),
  place("tra", "Trá na Rossan", { county: "Donegal" }),
];

const ids = (found: Spot[]) => found.map((s) => s.id);

describe("finding a spot by name", () => {
  it("finds nothing for no words", () => {
    expect(findSpots(spots, "  ", [])).toEqual([]);
  });

  it("matches a name anywhere in it, an alias, or a county's start", () => {
    expect(ids(findSpots(spots, "bay", []))).toEqual(["brandon"]);
    expect(ids(findSpots(spots, "inse", []))).toEqual(["inch"]);
    expect(ids(findSpots(spots, "ker", []))).toEqual(["brandon", "inch"]);
  });

  it("lets go of accents and case", () => {
    expect(ids(findSpots(spots, "TRA NA", []))).toEqual(["tra"]);
  });

  it("puts a name that starts with the words first, then a starred place, then by name", () => {
    expect(ids(findSpots(spots, "b", []))).toEqual([
      "brandon",
      "bunbeg",
      "keel",
    ]);
    expect(ids(findSpots(spots, "b", ["keel", "bunbeg"]))).toEqual([
      "bunbeg",
      "brandon",
      "keel",
    ]);
  });
});
