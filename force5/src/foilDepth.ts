/**
 * Foilable depth: where the water over the bottom is deep enough for a foil's
 * mast at a given tide, in the pilot areas built by scripts/foildepth.
 *
 * The seabed and foreshore are a static elevation model, metres above Lowest
 * Astronomical Tide (LAT), served as Terrarium-encoded raster-dem tiles in one
 * PMTiles archive per area (public/foildepth/). The tide is the Marine
 * Institute's prediction at the area's station, also above LAT. So the water
 * over a point is simply `tide − z`, and the map colours every pixel by
 * rebuilding a `color-relief` ramp whose stops move with the tide.
 *
 * Approximate: astronomical tide only (no surge, no waves), and the survey is
 * as old as it is. Not for navigation.
 */
import type { ExpressionSpecification } from "maplibre-gl";

/**
 * A metre of water. Up and flying on a 90 cm to 1 m mast, the board rides
 * above the surface and the wing sits well inside a metre; 1.5 m painted
 * water a local rider knows is fine to ride as too shallow.
 */
export const FOIL_CLEARANCE_METRES = 1;

/** Where the elevation index for the pilot areas is served from, under BASE_URL. */
export const FOIL_INDEX_PATH = "foildepth/index.json";

export type FoilClass = "deep" | "shallow" | "dry";

export interface FoilSource {
  /** e.g. "INFOMAR", "GSI LiDAR", "EMODnet". */
  name: string;
  /** What it covers here, e.g. "channels", "foreshore", "fallback". */
  role: string;
  /** Survey years as written, e.g. "2018" or "2008–2016". */
  years: string;
  resolution: string;
  licence: string;
}

export interface FoilArea {
  id: string;
  name: string;
  /** Archive path under BASE_URL, e.g. "foildepth/dublin-north.pmtiles". */
  url: string;
  /** West, south, east, north in degrees. */
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  /** The Marine Institute station whose predictions drive the colours. */
  station: string;
  /**
   * Heights above this are not intertidal: land, drawn as nothing. Highest
   * Astronomical Tide at the station plus a margin.
   */
  dryCeilingMetres: number;
  sources: FoilSource[];
}

export interface FoilManifest {
  schemaVersion: 1;
  kind: "foildepth";
  generatedAt: string;
  datum: "LAT";
  encoding: "terrarium";
  /**
   * The archives clamp anything deeper than this to it: always deep enough
   * for any sensible clearance, and far smaller to store.
   */
  floorMetres: number;
  /** Height written where there is no water (land, or ground cut off from the sea). */
  landMetres: number;
  /**
   * Height written where the water is there at every tide (under the
   * satellite LAT line) but no survey says how deep: its own class.
   */
  noSurveyMetres: number;
  areas: FoilArea[];
  attribution: string;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function validateFoilManifest(m: FoilManifest): FoilManifest {
  const ok =
    !!m &&
    m.schemaVersion === 1 &&
    m.kind === "foildepth" &&
    m.datum === "LAT" &&
    m.encoding === "terrarium" &&
    finite(m.floorMetres) &&
    finite(m.landMetres) &&
    finite(m.noSurveyMetres) &&
    m.noSurveyMetres < m.landMetres &&
    Array.isArray(m.areas) &&
    m.areas.length > 0 &&
    m.areas.every(
      (a) =>
        typeof a.id === "string" &&
        /^[a-z0-9-]+$/.test(a.id) &&
        typeof a.url === "string" &&
        typeof a.station === "string" &&
        Array.isArray(a.bounds) &&
        a.bounds.length === 4 &&
        a.bounds.every(finite) &&
        a.bounds[0] < a.bounds[2] &&
        a.bounds[1] < a.bounds[3] &&
        Number.isInteger(a.minzoom) &&
        Number.isInteger(a.maxzoom) &&
        a.minzoom <= a.maxzoom &&
        (a.tileSize === 256 || a.tileSize === 512) &&
        finite(a.dryCeilingMetres) &&
        a.dryCeilingMetres < m.noSurveyMetres - 1 &&
        Array.isArray(a.sources),
    );
  if (!ok) throw new Error("Invalid foilable-depth index.");
  return m;
}

/* ---- datums ---------------------------------------------------------------- */

/**
 * OD Malin to LAT. force5/ingest/fetch_tides.py publishes, per station,
 * `odMalinOffsetMetres` = height above LAT − height above OD Malin, so a
 * level on Malin is that much higher above LAT.
 */
export const malinToLat = (zMalin: number, odMalinOffsetMetres: number) =>
  zMalin + odMalinOffsetMetres;
export const latToMalin = (zLat: number, odMalinOffsetMetres: number) =>
  zLat - odMalinOffsetMetres;

/* ---- the three classes ----------------------------------------------------- */

/** Metres of water over a bottom at `z` (above LAT) with the tide at `tide`. */
export const waterOver = (z: number, tide: number) => tide - z;

/**
 * What a point at `z` metres above LAT is at a tide of `tide` metres above
 * LAT: deep enough (z ≤ tide − clearance), wet but too shallow
 * (tide − clearance < z ≤ tide), or dry (z > tide).
 */
export function foilClass(
  z: number,
  tide: number,
  clearance = FOIL_CLEARANCE_METRES,
): FoilClass {
  if (z <= tide - clearance) return "deep";
  if (z <= tide) return "shallow";
  return "dry";
}

export interface FoilColours {
  deep: string;
  shallow: string;
  dry: string;
  /** Wet at every tide, depth not surveyed. */
  unsurveyed: string;
}

/** The three colours off the theme (ui/theme.css, the map's banner). */
export function foilColours(
  root: Pick<CSSStyleDeclaration, "getPropertyValue">,
): FoilColours {
  const read = (name: string) => root.getPropertyValue(name).trim();
  return {
    deep: read("--map-foil-deep"),
    shallow: read("--map-foil-shallow"),
    dry: read("--map-foil-dry"),
    unsurveyed: read("--map-foil-unsurveyed"),
  };
}

const CLEAR = "rgba(0, 0, 0, 0)";
/** The width of the blend between two classes: crisp, but not aliased. */
const EDGE = 0.02;

/**
 * The `color-relief-color` for a tide. MapLibre wants literal stops, so the
 * ramp is rebuilt (and set with setPaintProperty) as the tide moves; that is a
 * small texture upload, not a re-tile.
 *
 * Stops, rising: deep from the floor up to tide − clearance; shallow from just
 * above that to the tide; dry from just above the tide to the dry ceiling;
 * nothing above it (land, and the archive's no-water value); and, apart,
 * the archive's no-survey value in its own colour, whatever the tide.
 */
export function foilRamp(
  tide: number,
  colours: FoilColours,
  opts: {
    clearance?: number;
    dryCeiling: number;
    floor: number;
    /** The archive's no-survey height, drawn as `unsurveyed`; none if absent. */
    noSurvey?: number;
  },
): ExpressionSpecification {
  const clearance = Math.max(opts.clearance ?? FOIL_CLEARANCE_METRES, EDGE * 2);
  const deepTop = tide - clearance;
  const stops: [number, string][] = [];
  const push = (z: number, colour: string) => {
    const last = stops[stops.length - 1];
    // Stops must rise strictly: a later one at or under the last is dropped,
    // the earlier one standing for both.
    if (last && z <= last[0]) return;
    stops.push([z, colour]);
  };
  push(Math.min(opts.floor, deepTop) - 1, colours.deep);
  push(deepTop, colours.deep);
  push(deepTop + EDGE, colours.shallow);
  if (opts.dryCeiling > tide + EDGE) {
    push(tide, colours.shallow);
    push(tide + EDGE, colours.dry);
    push(opts.dryCeiling, colours.dry);
    push(opts.dryCeiling + EDGE, CLEAR);
  } else {
    // A tide over the dry ceiling (a surge the ramp is not told of, or a
    // ceiling set too low): wet to the ceiling, nothing above it.
    push(opts.dryCeiling, colours.shallow);
    push(opts.dryCeiling + EDGE, CLEAR);
  }
  if (opts.noSurvey !== undefined) {
    push(opts.noSurvey - 2 * EDGE, CLEAR);
    push(opts.noSurvey - EDGE, colours.unsurveyed);
    push(opts.noSurvey + EDGE, colours.unsurveyed);
    push(opts.noSurvey + 2 * EDGE, CLEAR);
  }
  return [
    "interpolate",
    ["linear"],
    ["elevation"],
    ...stops.flat(),
  ] as unknown as ExpressionSpecification;
}

/* ---- areas and tiles ------------------------------------------------------- */

export const inBounds = (
  b: readonly [number, number, number, number],
  lon: number,
  lat: number,
) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

/** The area under a point, or null. */
export function areaAt(
  areas: readonly FoilArea[],
  lon: number,
  lat: number,
): FoilArea | null {
  return areas.find((a) => inBounds(a.bounds, lon, lat)) ?? null;
}

/** The area whose box is nearest a point (zero inside it), for the legend. */
export function nearestArea(
  areas: readonly FoilArea[],
  lon: number,
  lat: number,
): FoilArea | null {
  let best: FoilArea | null = null;
  let distance = Infinity;
  for (const a of areas) {
    const [w, s, e, n] = a.bounds;
    const dx = Math.max(w - lon, 0, lon - e) * Math.cos((lat * Math.PI) / 180);
    const dy = Math.max(s - lat, 0, lat - n);
    const d = Math.hypot(dx, dy);
    if (d < distance) {
      distance = d;
      best = a;
    }
  }
  return best;
}

/** The tile, and the pixel in it, under a point at a zoom (Web Mercator). */
export function tilePixel(
  lon: number,
  lat: number,
  zoom: number,
  tileSize: number,
) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return {
    z: zoom,
    x: tx,
    y: ty,
    px: Math.min(tileSize - 1, Math.floor((x - tx) * tileSize)),
    py: Math.min(tileSize - 1, Math.floor((y - ty) * tileSize)),
  };
}

/** Mapbox's Terrarium: metres = R·256 + G + B/256 − 32768. */
export const terrariumHeight = (r: number, g: number, b: number) =>
  r * 256 + g + b / 256 - 32768;
export function terrariumRgb(metres: number): [number, number, number] {
  const v = Math.max(0, Math.min(65535.996, metres + 32768));
  const whole = Math.floor(v);
  return [whole >> 8, whole & 255, Math.floor((v - whole) * 256)];
}

/* ---- words ------------------------------------------------------------------ */

const one = (m: number) => (Math.round(m * 10) / 10).toFixed(1);

/**
 * A tapped point, as the legend says it: "~2.3 m of water at 18:00 (tide
 * 3.1 m at Howth)", or that it is dry, land, or water no survey has sounded.
 */
export function foilReadout(
  z: number | "unsurveyed" | null,
  tide: number,
  clock: string,
  station: string,
  clearance = FOIL_CLEARANCE_METRES,
): string {
  const at = `at ${clock} (tide ${one(tide)} m at ${station})`;
  if (z === null) return `Not in the water at any tide ${at}.`;
  if (z === "unsurveyed") return `Wet at every tide, depth not surveyed ${at}.`;
  const water = waterOver(z, tide);
  const cls = foilClass(z, tide, clearance);
  if (cls === "dry") return `Dry, ${one(-water)} m above the water ${at}.`;
  return `~${one(water)} m of water ${at}${cls === "shallow" ? ", too shallow to foil" : ""}.`;
}

/** The survey line for the caveat, e.g. "INFOMAR 2018, GSI LiDAR 2020". */
export const surveyLine = (area: FoilArea) =>
  area.sources.map((s) => `${s.name} ${s.years}`.trim()).join(", ");
