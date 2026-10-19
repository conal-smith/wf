import { describe, expect, it } from "vitest";
import {
  POINT_SOURCE_KM,
  nearestSpotOnWater,
  pointSourceNote,
} from "./pointSource";

// Real riding places (public/riding-locations.json).
const spots = [
  { id: "dollymount", name: "Dollymount", lat: 53.367583, lon: -6.144748 },
  { id: "seapoint", name: "Seapoint", lat: 53.2973278, lon: -6.1588509 },
  {
    id: "lough-neagh-antrim",
    name: "Lough Neagh — Antrim",
    lat: 54.7161331,
    lon: -6.2408518,
  },
  {
    id: "oxford-island",
    name: "Lough Neagh — Oxford Island",
    lat: 54.489371,
    lon: -6.3668812,
  },
  { id: "portrush", name: "Portrush", lat: 55.2043, lon: -6.6529 },
];
const freshwater = new Set(["lough-neagh-antrim", "oxford-island"]);
const sea = { lake: false, freshwater };
const lake = { lake: true, freshwater };

describe("a point's nearest riding place", () => {
  it("lends its rows within the limit, and says whose they are", () => {
    // Off Poolbeg, in Dublin Bay.
    const found = nearestSpotOnWater(spots, 53.33, -6.1, sea);
    expect(found.source?.spot.id).toBe("dollymount");
    expect(found.source?.distanceKm).toBeCloseTo(5.1, 1);
    expect(pointSourceNote(found)).toBe(
      "Waves, weather and sea from Dollymount, 5.1 km",
    );
  });
  it("keeps to the same water: a lake's for a lake, the sea's for the sea", () => {
    // In the middle of Lough Neagh: Oxford Island, never a sea spot.
    const neagh = nearestSpotOnWater(spots, 54.6, -6.45, lake);
    expect(neagh.source?.spot.id).toBe("oxford-island");
    // Off Antrim's shore of the lough, but called the sea: the lough's spots
    // are not the sea's, and Portrush is 60 km off.
    const off = nearestSpotOnWater(spots, 54.7, -6.27, sea);
    expect(off.source).toBeNull();
    expect(off.nearest?.spot.id).toBe("portrush");
    // With no tide manifest to tell the lakes, distance alone.
    expect(
      nearestSpotOnWater(spots, 54.7, -6.27, { lake: false, freshwater: null })
        .source?.spot.id,
    ).toBe("lough-neagh-antrim");
  });
  it("says how far the nearest is when it is beyond the limit", () => {
    // The middle of the Irish Sea, east of Dublin.
    const found = nearestSpotOnWater(spots, 53.35, -5.6, sea);
    expect(found.source).toBeNull();
    expect(found.nearest?.spot.id).toBe("dollymount");
    expect(pointSourceNote(found)).toBe(
      `No waves or weather here: the nearest riding place, Dollymount, is 36 km away, beyond ${POINT_SOURCE_KM} km`,
    );
    expect(pointSourceNote(nearestSpotOnWater([], 53, -6, sea))).toBe(
      "No waves or weather here: no riding place on this water",
    );
  });
  it("breaks an exact tie by id", () => {
    const twins = [
      { id: "b", name: "B", lat: 53, lon: -5.9 },
      { id: "a", name: "A", lat: 53, lon: -6.1 },
    ];
    expect(
      nearestSpotOnWater(twins, 53, -6, { lake: false, freshwater: null })
        .source?.spot.id,
    ).toBe("a");
  });
});
