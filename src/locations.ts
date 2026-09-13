import failte from "../data/locations/failte-ireland.json";
import osm from "../data/locations/openstreetmap.json";
import web from "../data/locations/web-research.json";
import type { Spot } from "../force5/src/weather";

export const locationKindLabel = (kind: Spot["kind"]) =>
  ({
    spot: "Spot reference",
    operator: "School / operator",
    club: "Club",
    area: "Area reference",
  })[kind || "spot"];

// Preserve original coordinates/IDs: bundled spot forecasts refer to those exact points.
const existingIds: Record<string, string> = {
  "fi-inchydoney-east-beach": "inchydoney",
  "web-keel-beach-guide": "keel",
};
export function mergeLocations(original: Spot[]): Spot[] {
  const result = original.map((spot) => ({
    ...spot,
    kind: spot.kind || ("spot" as const),
  }));
  for (const row of [...failte.records, ...osm.records, ...web.records]) {
    const source = {
      name: row.name,
      url: row.sourceUrl,
      licence: row.licence,
      lat: row.lat,
      lon: row.lon,
    };
    const existing = result.find(
      (spot) => spot.id === (existingIds[row.id] || row.id),
    );
    if (existing) {
      existing.locationSources = [...(existing.locationSources || []), source];
      existing.aliases = [...(existing.aliases || []), row.name];
      continue;
    }
    const kind = row.kind as Spot["kind"];
    result.push({
      id: row.id,
      name: row.name,
      county: row.county,
      lat: row.lat,
      lon: row.lon,
      kind: kind || "spot",
      aliases: "aliases" in row ? row.aliases : [],
      note: `${locationKindLabel(kind)}. Source-listed coordinate, not a verified launch. ${"note" in row ? row.note : "Access and suitability for wingfoiling have not been checked."}`,
      locationSources: [source],
    });
  }
  return result;
}
