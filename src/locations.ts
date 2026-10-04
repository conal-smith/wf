import failte from "../data/locations/failte-ireland.json";
import osm from "../data/locations/openstreetmap.json";
import web from "../data/locations/web-research.json";
import guides from "../data/locations/spot-guides.json";
import shore from "../data/locations/shore-facing.json";
import type { Spot } from "../force5/src/weather";

export const locationKindLabel = (kind: Spot["kind"]) =>
  ({
    spot: "Spot reference",
    operator: "School / operator",
    club: "Club",
    area: "Area reference",
  })[kind || "spot"];

/** The public layer shows riding places, not free operator/business listings. */
export function ridingLocations(original: Spot[]): Spot[] {
  const places: Record<string, { id: string; name: string; note: string }> = {
    "osm-blast-kilcrea": {
      id: "kilcrea",
      name: "Kilcrea — Malahide Estuary",
      note: "North side of Malahide Estuary near Kilcrea Road. Reference coordinate from a mapped watersports operator; not a verified launch or confirmation of public access.",
    },
    "osm-newtownards-sc": {
      id: "newtownards",
      name: "Newtownards — Strangford Lough",
      note: "Strangford Lough's north-eastern shore. Reference coordinate from the sailing club site; check local access and launch arrangements.",
    },
  };
  return mergeLocations(original).flatMap((spot): Spot[] => {
    const place = places[spot.id];
    if (place)
      return [
        {
          ...spot,
          ...place,
          kind: "spot",
          website: undefined,
          aliases: [...(spot.aliases || []), spot.name],
          facing: shoreFacing(place.id),
        },
      ];
    if (spot.kind !== "spot") return [];
    return [{ ...spot, website: undefined, facing: shoreFacing(spot.id) }];
  });
}

/**
 * The seaward bearing the stars rate a place's shore against: a hand
 * correction where there is one, else the computed facing where it was clear
 * enough to publish, else null and the place is rated on the wind alone.
 */
export function shoreFacing(id: string): number | null {
  const overrides: Record<string, number | null> = shore.overrides;
  if (id in overrides) return overrides[id];
  const places: Record<string, { facing: number | null }> = shore.places;
  return places[id]?.facing ?? null;
}

/**
 * The place a link from elsewhere on the site opens the map on: `/?spot=keel`,
 * as the community's spot card writes it. An id the layer does not hold is no
 * place at all, and the map opens where it always has.
 */
export function spotFromSearch(
  search: string,
  spots: readonly Spot[],
): Spot | undefined {
  const id = new URLSearchParams(search).get("spot");
  return id ? spots.find((spot) => spot.id === id) : undefined;
}

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
  for (const row of [
    ...failte.records,
    ...osm.records,
    ...web.records,
    ...guides.records,
  ]) {
    const source = {
      name: row.name,
      url: row.sourceUrl,
      licence: row.licence,
      lat: row.lat,
      lon: row.lon,
    };
    // A place several guides list keeps every listing, each with its own pin.
    const sources =
      "listings" in row
        ? row.listings.map((listing) => ({
            name: listing.name,
            url: listing.url,
            licence: row.licence,
            lat: listing.lat,
            lon: listing.lon,
          }))
        : [source];
    const existing = result.find(
      (spot) => spot.id === (existingIds[row.id] || row.id),
    );
    if (existing) {
      existing.locationSources = [
        ...(existing.locationSources || []),
        ...sources,
      ];
      existing.aliases = [...(existing.aliases || []), row.name];
      if ("website" in row && row.website) existing.website = row.website;
      existing.sports = [
        ...new Set([...(existing.sports || []), ...row.sports]),
      ];
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
      website: "website" in row && row.website ? row.website : undefined,
      sports: row.sports,
      note: `${locationKindLabel(kind)}. Source-listed coordinate, not a verified launch. ${"note" in row ? row.note : "Access and suitability for wingfoiling have not been checked."}`,
      locationSources: sources,
    });
  }
  return result;
}
