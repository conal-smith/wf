// Spot squares: the 2° × 2° key every spot-shaped file is cut by
// (docs/TILING_DESIGN.md, decision 6). A square is named by its south-west
// corner on even degrees, the way SRTM names elevation tiles: `n52w010` covers
// 52–54° N and 10–8° W. The same rule is `spot_square` in
// force5/ingest/squares.py, and both are held to tests/fixtures/squares.json.
//
// Dependency-free, so the forecast server (mcp/api, compiled on its own) and
// the blend job read squares exactly as the site does.

/** How wide a spot square is, in degrees of latitude and of longitude. */
export const SQUARE_DEGREES = 2;

/** A square's name: `n`/`s`, two digits, `e`/`w`, three digits. */
export const SQUARE_NAME = /^[ns]\d{2}[ew]\d{3}$/;

const pad = (value: number, width: number) =>
  String(Math.abs(value)).padStart(width, "0");

/**
 * The square holding a point. Floor, not truncation, so 0.5° S is in `s02`
 * (2° S to the equator); longitude wraps, so 180° E is the square at 180° W;
 * a latitude of exactly 90° belongs to the top row.
 */
export function spotSquare(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90)
    throw new Error(`No square for ${lat}, ${lon}.`);
  const lat0 = Math.min(
    Math.floor(lat / SQUARE_DEGREES) * SQUARE_DEGREES,
    90 - SQUARE_DEGREES,
  );
  const lon0 =
    ((((Math.floor(lon / SQUARE_DEGREES) * SQUARE_DEGREES + 180) % 360) + 360) %
      360) -
    180;
  return `${lat0 >= 0 ? "n" : "s"}${pad(lat0, 2)}${lon0 >= 0 ? "e" : "w"}${pad(lon0, 3)}`;
}

/** The sorted, distinct squares a list of places falls in. */
export const squaresFor = (
  places: readonly { lat: number; lon: number }[],
): string[] =>
  [...new Set(places.map((place) => spotSquare(place.lat, place.lon)))].sort();
