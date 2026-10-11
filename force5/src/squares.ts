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
export const SQUARE_NAME = /^[ns][0-9]{2}[ew][0-9]{3}$/;

const pad = (value: number, width: number) =>
  String(Math.abs(value)).padStart(width, "0");

/**
 * The square holding a point. Floor, not truncation, so 0.5° S is in `s02`
 * (2° S to the equator); 180° E is the square at 180° W; a latitude of exactly
 * 90° belongs to the top row. A point past 90° of latitude or 180° of
 * longitude is refused, not wrapped: in a catalogue it is a typo, and wrapped
 * it would file the place in some other square.
 */
export function spotSquare(lat: number, lon: number): string {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
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

/** A square's south-west corner, or null for a name that is not a square's. */
export function squareCorner(
  square: string,
): { lat: number; lon: number } | null {
  const match = /^([ns])(\d{2})([ew])(\d{3})$/.exec(square);
  if (!match) return null;
  return {
    lat: (match[1] === "s" ? -1 : 1) * Number(match[2]),
    lon: (match[3] === "w" ? -1 : 1) * Number(match[4]),
  };
}

/**
 * What the map shows, in degrees, as MapLibre gives it: west may be less than
 * -180 and east more than 180 where the view crosses the antimeridian or shows
 * more than one copy of the world.
 */
export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * How far past each edge of the view its squares are read, as a fraction of
 * the view's width and height: a third, the margin the wind's wash paints
 * (docs/TILING_DESIGN.md, decision 7), so a small pan finds its lights ready.
 */
export const VIEW_MARGIN = 1 / 3;
/**
 * The most squares one view reads. Ireland's riding places are in ten; a view
 * of a continent would otherwise read every square on it, so past this it
 * reads the ones nearest the view's centre and the rest wait to be looked at.
 */
export const VIEW_SQUARE_LIMIT = 36;

/**
 * The squares of `listed` (the ones a run publishes) that a view needs: those
 * overlapping the view grown by `margin` on every side, at most `limit` of
 * them (the nearest the view's centre), sorted by name. A square the run does
 * not list is never named, so a view of open ocean, or of a country with no
 * places, asks for nothing.
 */
export function squaresInView(
  bounds: ViewBounds,
  listed: Iterable<string>,
  { margin = VIEW_MARGIN, limit = VIEW_SQUARE_LIMIT } = {},
): string[] {
  const { west, south, east, north } = bounds;
  const width = east - west;
  const height = north - south;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    width < 0 ||
    height < 0
  )
    return [];
  const left = west - width * margin;
  const span = width * (1 + 2 * margin);
  const bottom = Math.max(-90, south - height * margin);
  const top = Math.min(90, north + height * margin);
  const centreLat = (south + north) / 2;
  const centreLon = (west + east) / 2;
  const across = Math.cos((centreLat * Math.PI) / 180);
  const found: { square: string; distance: number }[] = [];
  for (const square of new Set(listed)) {
    const corner = squareCorner(square);
    if (!corner) continue;
    if (corner.lat >= top || corner.lat + SQUARE_DEGREES <= bottom) continue;
    // How far east of the grown view's west edge the square's own west edge
    // is, once round the globe: inside the view, or just short of it with its
    // east edge reaching in.
    const offset = (((corner.lon - left) % 360) + 360) % 360;
    if (span < 360 && offset >= span && offset <= 360 - SQUARE_DEGREES)
      continue;
    const dLat = corner.lat + SQUARE_DEGREES / 2 - centreLat;
    const dLon =
      ((((corner.lon + SQUARE_DEGREES / 2 - centreLon) % 360) + 540) % 360) -
      180;
    found.push({ square, distance: Math.hypot(dLat, dLon * across) });
  }
  return found
    .sort((a, b) => a.distance - b.distance || (a.square < b.square ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map((hit) => hit.square)
    .sort();
}

/**
 * The squares the map's lights read, of the ones `listed`: those in view
 * (`squaresInView`; none before the map has a view), and those of `places`
 * wherever they are — the open spot, which the dock reads, and the reader's
 * own, which the panel of their spots reads. Sorted, distinct.
 */
export function squaresToRead(
  view: ViewBounds | null,
  listed: Iterable<string>,
  places: readonly { lat: number; lon: number }[],
): string[] {
  const known = new Set(listed);
  const wanted = new Set(view ? squaresInView(view, known) : []);
  for (const place of places) {
    const square = spotSquare(place.lat, place.lon);
    if (known.has(square)) wanted.add(square);
  }
  return [...wanted].sort();
}
