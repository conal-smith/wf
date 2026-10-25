/**
 * The riding places as the companion rates them: the published list
 * (riding-locations.json, read through the forecast source like the MCP server
 * reads it) plus the shore facing the stars need, which that file does not
 * carry. The facing is the same committed table the map reads
 * (data/locations/shore-facing.json), read by the same force5/src/shoreFacing.ts:
 * a spot on the water has none, a hand override wins, then the computed facing
 * where it was clear enough to publish, else null and the spot is rated on the
 * wind alone.
 */
import { shoreFacing } from "../../force5/src/shoreFacing.js";
import { loadSpots, type RidingSpot } from "../../mcp/api/forecast.js";
import type { ForecastSource } from "../../mcp/api/source.js";

export interface RatedSpot extends RidingSpot {
  /** Seaward bearing of the shore in degrees, or null where it is not known. */
  facing: number | null;
}

export { shoreFacing };

export async function ratedSpots(source: ForecastSource): Promise<RatedSpot[]> {
  const spots = await loadSpots(source);
  return spots.map((spot) => ({ ...spot, facing: shoreFacing(spot.id) }));
}
