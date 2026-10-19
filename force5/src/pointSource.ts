// Where a tapped point's waves, weather and sea come from. The wave and weather
// bundles publish a series per riding place and no map frames to sample (their
// frames are optional, variables.ts), so a point borrows the nearest riding
// place's, on the same water and close enough to say something about it, and
// the dock says whose they are.
import { distanceKm } from "./foilDepth";

/**
 * Whether the basemap's water under a tap is a lake, from the classes of the
 * water polygons there. OpenMapTiles classes its water: the sea, inside OSM's
 * coastline, is "ocean", and a lough or reservoir "lake" (a pond "pond").
 * Rivers are not asked about: an estuary's tide runs up them. The site's map
 * and the app's read it the same way.
 */
export const isLakeWater = (classes: readonly unknown[]) =>
  !classes.includes("ocean") &&
  classes.some((c) => c === "lake" || c === "pond");

/** How far a riding place may be from a point and still lend it its sea. */
export const POINT_SOURCE_KM = 15;

export interface PointSource<S> {
  spot: S;
  distanceKm: number;
}

export interface PointSources<S> {
  /** The riding place lending its rows, or null when none is near enough. */
  source: PointSource<S> | null;
  /** The nearest on the same water, however far; null when there is none. */
  nearest: PointSource<S> | null;
}

/**
 * The nearest riding place on the same water as a point: a freshwater
 * lake's for a point on a lake, a sea spot's for one on the sea (the tide
 * manifest's `noTide` spots, `freshwaterSpots`, are the lakes; with no tide
 * manifest every spot is a candidate). It lends its rows only within
 * `maxKm`. A tie goes to the first id.
 */
export function nearestSpotOnWater<
  S extends { id: string; lat: number; lon: number },
>(
  spots: readonly S[],
  lat: number,
  lon: number,
  water: { lake: boolean; freshwater: ReadonlySet<string> | null },
  maxKm = POINT_SOURCE_KM,
): PointSources<S> {
  let nearest: PointSource<S> | null = null;
  for (const spot of spots) {
    if (water.freshwater && water.freshwater.has(spot.id) !== water.lake)
      continue;
    const km = distanceKm(lon, lat, spot.lon, spot.lat);
    if (
      !nearest ||
      km < nearest.distanceKm ||
      (km === nearest.distanceKm && spot.id < nearest.spot.id)
    )
      nearest = { spot, distanceKm: km };
  }
  return {
    source: nearest && nearest.distanceKm <= maxKm ? nearest : null,
    nearest,
  };
}

const km = (distance: number) =>
  distance < 10 ? distance.toFixed(1) : String(Math.round(distance));

/**
 * What the dock says about a point's waves, weather and sea: whose they are
 * and how far off, or why there are none.
 */
export function pointSourceNote<S extends { name: string }>(
  found: PointSources<S>,
  maxKm = POINT_SOURCE_KM,
): string {
  if (found.source)
    return `Waves, weather and sea from ${found.source.spot.name}, ${km(found.source.distanceKm)} km`;
  if (found.nearest)
    return `No waves or weather here: the nearest riding place, ${found.nearest.spot.name}, is ${km(found.nearest.distanceKm)} km away, beyond ${maxKm} km`;
  return "No waves or weather here: no riding place on this water";
}
