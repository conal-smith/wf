// Which way each riding place's shore looks out to sea, for the stars. Its own
// module, apart from src/locations.ts, so a page that only needs the bearing
// (the spot page) does not carry every location source the map merges. The
// MCP server reads it too, in Node, which wants the import attribute.
import shore from "../../data/locations/shore-facing.json" with { type: "json" };

/**
 * The seaward bearing the stars rate a place's shore against: a hand
 * correction where there is one, else the computed facing where it was clear
 * enough to publish, else null and the place is rated on the wind alone.
 */
export function shoreFacing(id: string): number | null {
  if (isOnWater(id)) return null;
  const overrides: Record<string, number | null> = shore.overrides;
  if (id in overrides) return overrides[id];
  const places: Record<string, { facing: number | null }> = shore.places;
  return places[id]?.facing ?? null;
}

const onWater = new Set<string>(shore.onWater);

/**
 * Whether a place is a spot on the water rather than a beach: riders launch
 * and ride out in the middle of an estuary or lagoon (Malahide Estuary), so
 * no one shore's facing applies and the stars rate the wind alone. The
 * owner's list, `onWater` in shore-facing.json.
 */
export const isOnWater = (id: string) => onWater.has(id);

/**
 * What a place's shore is to the stars: a beach with a facing, a spot on the
 * water, or a beach whose facing is not known well enough to rate against.
 * The stars treat the last two alike, on the wind alone.
 */
export type ShoreType = "beach" | "on-water" | "unknown";

export function shoreType(id: string): ShoreType {
  if (isOnWater(id)) return "on-water";
  return shoreFacing(id) === null ? "unknown" : "beach";
}
