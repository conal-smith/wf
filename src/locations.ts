import failte from "../data/locations/failte-ireland.json";
import osm from "../data/locations/openstreetmap.json";
import web from "../data/locations/web-research.json";
import places from "../data/locations/riding-places.json";
import owner from "../data/locations/owner-places.json";
import type { Spot } from "../force5/src/weather";
import { shoreFacing } from "../force5/src/shoreFacing";

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
  const research = mergeLocations(original).flatMap((spot): Spot[] => {
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
  return withOwnerPlaces(research);
}

/** Where the site's owner put a place, as `npm run spots:owner` records it. */
interface OwnerOverride {
  status: "moved" | "ok" | "remove";
  lat?: number;
  lon?: number;
  note?: string;
}
const ownerSource = {
  name: "Placed by the wingfoil.ie site owner",
  url: "https://wingfoil.ie/",
  licence: "AGPL-3.0-only",
};
const ownerNote =
  "Spot reference. Position placed by the site's owner from their own time on the water; check local access and launch arrangements.";

/**
 * The owner's own positions are the most trusted there are, so they win over
 * every researched coordinate: a move puts the place where the owner put it
 * (same id, so links and published series keep their name), `remove` takes it
 * off the map, and the owner's added places join the public set.
 */
export function withOwnerPlaces(spots: Spot[]): Spot[] {
  const overrides = owner.overrides as Record<string, OwnerOverride>;
  const placed = spots.flatMap((spot): Spot[] => {
    const override = spot.id ? overrides[spot.id] : undefined;
    if (!override) return [spot];
    if (override.status === "remove") return [];
    const moved =
      override.status === "moved" &&
      override.lat !== undefined &&
      override.lon !== undefined;
    if (!moved && !override.note) return [spot];
    const lat = moved ? override.lat! : spot.lat;
    const lon = moved ? override.lon! : spot.lon;
    return [
      {
        ...spot,
        lat,
        lon,
        note: [moved ? ownerNote : spot.note, override.note]
          .filter(Boolean)
          .join(" "),
        locationSources: moved
          ? [...(spot.locationSources || []), { ...ownerSource, lat, lon }]
          : spot.locationSources,
      },
    ];
  });
  for (const row of owner.records)
    placed.push({
      id: row.id,
      name: row.name,
      county: row.county,
      lat: row.lat,
      lon: row.lon,
      kind: "spot",
      aliases: row.aliases,
      sports: row.sports,
      note: [ownerNote, row.note].filter(Boolean).join(" "),
      locationSources: [{ ...ownerSource, lat: row.lat, lon: row.lon }],
      facing: shoreFacing(row.id),
    });
  return placed;
}

export { shoreFacing };

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
    ...places.records,
  ]) {
    const source = {
      name: row.name,
      url: row.sourceUrl,
      licence: row.licence,
      lat: row.lat,
      lon: row.lon,
    };
    const sources = [source];
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
