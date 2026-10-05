/**
 * The riding places as the companion rates them: the published list
 * (riding-locations.json, read through the forecast source like the MCP server
 * reads it) plus the shore facing the stars need, which that file does not
 * carry. The facing is the same committed table the map reads
 * (data/locations/shore-facing.json, see src/locations.ts shoreFacing), with
 * the same rule: a hand override wins, then the computed facing where it was
 * clear enough to publish, else null and the spot is rated on the wind alone.
 */
import shore from "../../data/locations/shore-facing.json" with { type: "json" };
import { loadSpots, type RidingSpot } from "../../mcp/api/forecast.js";
import type { ForecastSource } from "../../mcp/api/source.js";

export interface RatedSpot extends RidingSpot {
  /** Seaward bearing of the shore in degrees, or null where it is not known. */
  facing: number | null;
}

const overrides: Record<string, number | null> = shore.overrides;
const places: Record<string, { facing: number | null }> = shore.places;

export function shoreFacing(id: string): number | null {
  if (id in overrides) return overrides[id];
  return places[id]?.facing ?? null;
}

export async function ratedSpots(source: ForecastSource): Promise<RatedSpot[]> {
  const spots = await loadSpots(source);
  return spots.map((spot) => ({ ...spot, facing: shoreFacing(spot.id) }));
}
