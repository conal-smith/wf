import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mergeLocations,
  ridingLocations,
  spotFromSearch,
} from "../src/locations";
import type { Spot } from "../force5/src/weather";

const bundles = ["failte-ireland", "openstreetmap", "web-research"].map(
  (name) => JSON.parse(readFileSync(`data/locations/${name}.json`, "utf8")),
);
const records = bundles.flatMap((bundle) => bundle.records);

describe("saved Irish wind-sport coordinates", () => {
  it("publishes riding places without operator advertising or island-wide pins", () => {
    const spots = ridingLocations(
      JSON.parse(readFileSync("public/spots.json", "utf8")),
    );
    expect(spots).toHaveLength(141);
    expect(spots.every((s) => s.kind === "spot" && !s.website)).toBe(true);
    expect(spots.find((s) => s.id === "kilcrea")).toMatchObject({
      name: "Kilcrea — Malahide Estuary",
      lat: 53.4690824,
      lon: -6.1755492,
    });
    expect(
      spots.some((s) => /Watersports|School|Club|Resort/.test(s.name)),
    ).toBe(false);
  });
  it("opens on the riding place a link names, and where it always has for any other", () => {
    const spots = ridingLocations(
      JSON.parse(readFileSync("public/spots.json", "utf8")),
    );
    expect(spotFromSearch("?spot=kilcrea", spots)?.name).toBe(
      "Kilcrea — Malahide Estuary",
    );
    expect(spotFromSearch("?model=gfs&spot=keel", spots)?.id).toBe("keel");
    expect(spotFromSearch("", spots)).toBeUndefined();
    expect(spotFromSearch("?spot=", spots)).toBeUndefined();
    expect(spotFromSearch("?spot=atlantis", spots)).toBeUndefined();
    // An operator's own id is not a place the public layer holds.
    expect(spotFromSearch("?spot=osm-blast-kilcrea", spots)).toBeUndefined();
  });
  it("retains all collected research records while preserving original forecast IDs and coordinates", () => {
    const original = JSON.parse(readFileSync("public/spots.json", "utf8"));
    const merged = mergeLocations(original);
    expect(merged).toHaveLength(168);
    expect(new Set(merged.map((s) => s.id)).size).toBe(168);
    for (const spot of original)
      expect(merged.find((s) => s.id === spot.id)).toMatchObject(spot);
    for (const row of records)
      expect(
        merged.some((s) =>
          s.locationSources?.some(
            (source) =>
              source.name === row.name &&
              source.lat === row.lat &&
              source.lon === row.lon,
          ),
        ),
      ).toBe(true);
    expect(merged.find((s) => s.id === "osm-blast-kilcrea")?.aliases).toContain(
      "Donabate",
    );
  });
  it("keeps unique source-backed coordinates in Ireland with explicit location types", () => {
    expect(records).toHaveLength(46);
    expect(new Set(records.map((record) => record.id)).size).toBe(
      records.length,
    );
    expect(new Set(records.map((record) => record.county)).size).toBe(14);
    for (const record of records) {
      expect(record.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(record.lat)).toBe(true);
      expect(Number.isFinite(record.lon)).toBe(true);
      expect(record.lat).toBeGreaterThan(51);
      expect(record.lat).toBeLessThan(56);
      expect(record.lon).toBeGreaterThan(-11);
      expect(record.lon).toBeLessThan(-5);
      expect(new URL(record.sourceUrl).protocol).toBe("https:");
      expect(["spot", "operator", "club", "area"]).toContain(record.kind);
      expect(record.coordinateType).toBeTruthy();
      expect(record.sportsEvidence).toBeTruthy();
      expect(record.licence).toBeTruthy();
      expect(record.verificationStatus).toBe("source-located");
      expect(record.launchVerified).toBe(false);
    }
  });

  it("keeps source licensing separate and saves Blast's actual mapped coordinate", () => {
    expect(
      bundles[0].records.every(
        (r: { licence: string }) => r.licence === "CC-BY-4.0",
      ),
    ).toBe(true);
    expect(bundles[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      bundles[1].records.every(
        (r: { licence: string }) => r.licence === "ODbL-1.0",
      ),
    ).toBe(true);
    expect(records.find((r) => r.id === "osm-blast-kilcrea")).toMatchObject({
      lat: 53.4690824,
      lon: -6.1755492,
      kind: "operator",
      sourceId: "node/10816824305",
    });
  });

  it("exports every record to the CSV without losing coordinate or source fields", () => {
    const csv = readFileSync(
      "data/locations/irish-wind-sport-locations.csv",
      "utf8",
    )
      .trimEnd()
      .split("\n");
    const columns = csv[0].split(",");
    const expected = records
      .map((record) =>
        columns
          .map((key) => {
            const value = Array.isArray(record[key])
              ? record[key].join(";")
              : (record[key] ?? "");
            return `"${String(value).replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .sort();
    expect(csv.slice(1).sort()).toEqual(expected);
  });
});

const places = JSON.parse(
  readFileSync("data/locations/riding-places.json", "utf8"),
);
const facing = JSON.parse(
  readFileSync("data/locations/shore-facing.json", "utf8"),
);

describe("riding places placed on OpenStreetMap", () => {
  const spots = ridingLocations(
    JSON.parse(readFileSync("public/spots.json", "utf8")),
  );
  it("adds over a hundred places, each a unique id the map did not already hold", () => {
    expect(places.records).toHaveLength(116);
    const ids = places.records.map((record: { id: string }) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const record of [...bundles.flatMap((b) => b.records)])
      expect(ids).not.toContain(record.id);
  });
  it("keeps every place on the island, on a cited OpenStreetMap feature", () => {
    expect(places.licence).toBe("ODbL-1.0");
    for (const record of places.records) {
      expect(record.lat).toBeGreaterThan(51);
      expect(record.lat).toBeLessThan(56);
      expect(record.lon).toBeGreaterThan(-11);
      expect(record.lon).toBeLessThan(-5);
      expect(["IE", "UK-NI"]).toContain(record.jurisdiction);
      expect(record.kind).toBe("spot");
      expect(record.launchVerified).toBe(false);
      expect(record.sports.length).toBeGreaterThan(0);
      expect(record.licence).toBe("ODbL-1.0");
      expect(record.sourceId).toMatch(/^(node|way|relation)\/\d+$/);
      expect(record.sourceUrl).toBe(
        `https://www.openstreetmap.org/${record.sourceId}`,
      );
    }
  });
  it("puts no new pin on top of a place already on the map", () => {
    const km = (a: Spot, b: Spot) => {
      const rad = Math.PI / 180;
      const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
      const y = (b.lat - a.lat) * rad;
      return Math.hypot(x, y) * 6371;
    };
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        expect(km(spots[i], spots[j])).toBeGreaterThan(0.9);
  });
  it("gives every public place a shore facing entry, published only where it is clear", () => {
    for (const spot of spots) {
      const place = facing.places[spot.id];
      expect(place).toBeDefined();
      expect(place.facing === null || place.strength >= 0.15).toBe(true);
      expect(spot.facing).toBe(
        spot.id in facing.overrides ? facing.overrides[spot.id] : place.facing,
      );
    }
  });
});
