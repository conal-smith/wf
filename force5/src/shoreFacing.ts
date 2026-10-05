// Which way each riding place's shore looks out to sea, for the stars. Its own
// module, apart from src/locations.ts, so a page that only needs the bearing
// (the spot page) does not carry every location source the map merges.
import shore from "../../data/locations/shore-facing.json";

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
