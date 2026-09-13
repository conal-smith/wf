import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeLocations } from "../src/locations";

const bundles = ["failte-ireland", "openstreetmap", "web-research"].map(
  (name) => JSON.parse(readFileSync(`data/locations/${name}.json`, "utf8")),
);
const records = bundles.flatMap((bundle) => bundle.records);

describe("saved Irish wind-sport coordinates", () => {
  it("connects all collected records to the app while preserving original forecast IDs and coordinates", () => {
    const original = JSON.parse(readFileSync("public/spots.json", "utf8"));
    const merged = mergeLocations(original);
    expect(merged).toHaveLength(52);
    expect(new Set(merged.map((s) => s.id)).size).toBe(52);
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
