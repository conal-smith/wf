/**
 * Foilable depth: where the water over the bottom is deep enough for a foil's
 * mast at a given tide, round the coast of Ireland (scripts/foildepth).
 *
 * The seabed and foreshore are a static elevation model, metres above Lowest
 * Astronomical Tide (LAT), served as Terrarium-encoded raster-dem tiles in one
 * PMTiles archive per area: the coast is cut into one region per tide station
 * (the station's Voronoi cell), and a few pilot areas with finer surveys win
 * where they are. Only the water a rider needs is kept: from the dry ceiling
 * down to 5 m under LAT; deeper is deep enough at every tide and is drawn as
 * nothing (the chart's tints carry it). The tide is the Marine Institute's
 * prediction at the area's station, also above LAT. So the water over a point
 * is simply `tide − z`, and the map colours every pixel by rebuilding a
 * `color-relief` ramp whose stops move with the tide.
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

/**
 * Where the index is served from, under the site's BASE_URL: it ships with
 * the site. The archives it names are under its `base`, on the data host
 * (force5/src/urls.ts), in an immutable versioned folder.
 */
export const FOIL_INDEX_PATH = "foildepth/index.json";

/**
 * How far above the floor the deep colour fades in, in metres: the edge of
 * what is drawn (5 m under LAT) is a short fade into the chart's own tints,
 * not a hard line that reads as a feature of the seabed.
 */
export const FOIL_FADE_METRES = 1;

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
  /**
   * "region": one tide station's stretch of the national coast; "pilot": a
   * finer area (or a basin of one) that wins where it is. Absent in an index
   * of pilots only.
   */
  kind?: "pilot" | "region";
  name: string;
  /**
   * The archive: under the index's `base` (e.g. "tide-howth.pmtiles"), or in
   * an index without one, a path under BASE_URL.
   */
  url: string;
  /** West, south, east, north in degrees. */
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  /** The Marine Institute station whose predictions drive the colours. */
  station: string;
  /**
   * A region's station, lon/lat: a region's box overlaps its neighbours',
   * and a point belongs to the region whose station is nearest.
   */
  stationLonLat?: [number, number];
  /**
   * Heights above this are not intertidal: land, drawn as nothing. Highest
   * Astronomical Tide at the station plus a margin.
   */
  dryCeilingMetres: number;
  /**
   * Water held up behind a weir (the Malahide lagoon behind its viaduct):
   * its level is not the station's tide but follows it, damped and late.
   * Absent for open water.
   */
  level?: FoilLevel;
  sources: FoilSource[];
}

/**
 * A basin's water level from the sea's tide (basinLevel). Heights above LAT.
 */
export interface FoilLevel {
  /** The weir's crest: the basin cannot drain below it. */
  floorLat: number;
  /** How much of the sea's rise above the crest the basin follows, 0 to 1. */
  rangeFactor: number;
  /** How far the basin's level runs behind the sea's, in hours. */
  lagHours: number;
}

export interface FoilManifest {
  /** 1: pilots only, beside the index; 2: under `base`, with `deepMetres`. */
  schemaVersion: 1 | 2;
  kind: "foildepth";
  generatedAt: string;
  datum: "LAT";
  encoding: "terrarium";
  /**
   * Schema 2: the archives' folder on the data host, e.g.
   * "foildepth/v0123456789ab/" (force5/src/urls.ts's forecastUrl).
   */
  base?: string;
  /**
   * Heights are kept from this up (5 m under LAT). Schema 1 clamped anything
   * deeper to it; schema 2 writes it as `deepMetres`.
   */
  floorMetres: number;
  /**
   * Schema 2: water deeper than the floor, deep enough at every tide, drawn
   * as nothing (a tap still tells it from land).
   */
  deepMetres?: number;
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
    (m.schemaVersion === 1 ||
      (m.schemaVersion === 2 &&
        typeof m.base === "string" &&
        /^[a-z0-9-]+\/(v[0-9a-f]+\/)?$/.test(m.base) &&
        finite(m.deepMetres) &&
        m.deepMetres < m.floorMetres - 1)) &&
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
        (a.kind === undefined || a.kind === "pilot" || a.kind === "region") &&
        (a.stationLonLat === undefined ||
          (Array.isArray(a.stationLonLat) &&
            a.stationLonLat.length === 2 &&
            a.stationLonLat.every(finite))) &&
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
        (a.level === undefined ||
          (finite(a.level.floorLat) &&
            finite(a.level.rangeFactor) &&
            a.level.rangeFactor >= 0 &&
            a.level.rangeFactor <= 1 &&
            finite(a.level.lagHours) &&
            a.level.lagHours >= 0)) &&
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

/* ---- a basin's level -------------------------------------------------------- */

/**
 * The water behind a weir, from the sea's tide `lagHours` earlier. Below the
 * crest the sea cannot reach in and the basin stands at it (it drains no
 * lower); above, the basin follows only a share of the sea's rise, as the
 * opening under the weir lets it. So Malahide's lagoon, with its crest at
 * 3.06 m and a factor of 0.6, sits at 3.06 m through every low water and
 * rises about 0.7 m on a 4.2 m spring tide.
 */
export const basinLevel = (level: FoilLevel, seaTide: number) =>
  level.floorLat + level.rangeFactor * Math.max(0, seaTide - level.floorLat);

/**
 * The water level over an area at a time: the station's tide for open
 * water, a basin's own level (basinLevel) behind a weir. `tideAt` is the
 * station's prediction (tides.ts), null outside its curve.
 */
export function waterLevelAt(
  area: Pick<FoilArea, "level">,
  tideAt: (time: number) => number | null,
  time: number,
): number | null {
  if (!area.level) return tideAt(time);
  const sea = tideAt(time - area.level.lagHours * 3_600_000);
  return sea === null ? null : basinLevel(area.level, sea);
}

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
 * Stops, rising: with a `deep` value (schema 2), nothing from it up to the
 * floor, then the deep colour fading in over `fade` metres; without one, deep
 * from below the floor. Then deep up to tide − clearance; shallow from just
 * above that to the tide; dry from just above the tide to the dry ceiling;
 * nothing above it (land, and the archive's no-water value); and, apart,
 * the archive's no-survey value in its own colour, whatever the tide.
 *
 * The map interpolates heights between pixels, so between the last height
 * kept and a deep pixel the values run down through the fade: the edge of
 * what is drawn is soft, and passes through no colour that is not there.
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
    /** The archive's deeper-than-the-floor value, drawn as nothing. */
    deep?: number;
    /** The deep colour's fade above the floor, metres (0: a clean edge). */
    fade?: number;
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
  if (opts.deep !== undefined) {
    const fade = Math.max(opts.fade ?? FOIL_FADE_METRES, EDGE);
    push(opts.deep - 1, CLEAR);
    push(opts.floor, CLEAR);
    // The fade ends short of the deep colour's top, however low the tide.
    push(Math.min(opts.floor + fade, deepTop - EDGE), colours.deep);
  } else push(Math.min(opts.floor, deepTop) - 1, colours.deep);
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

/** Kilometres between two points, on a sphere. */
export function distanceKm(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) *
      Math.cos(lat2 * r) *
      Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * The archives that may hold a point, in the order to read them. A pilot
 * wins where it is: if one's box holds the point, only the pilots' boxes are
 * tried, in the index's order (a basin's box lies inside its area's and comes
 * first; each archive has water only on its own side of the weir, so the
 * first one with water under the point is it). Else the one region whose
 * station is nearest, as the regions were cut (scripts/foildepth/national.py).
 */
export function areasAt<
  T extends Pick<FoilArea, "bounds" | "kind" | "stationLonLat">,
>(areas: readonly T[], lon: number, lat: number): T[] {
  const boxes = areas.filter((a) => inBounds(a.bounds, lon, lat));
  const pilots = boxes.filter((a) => a.kind !== "region");
  if (pilots.length) return pilots;
  let best: T | null = null;
  let distance = Infinity;
  for (const a of boxes) {
    const at = a.stationLonLat;
    const d = at ? distanceKm(lon, lat, at[0], at[1]) : Infinity;
    if (!best || d < distance) {
      best = a;
      distance = d;
    }
  }
  return best ? [best] : [];
}

/** The area under a point (areasAt's first), or null. */
export function areaAt(
  areas: readonly FoilArea[],
  lon: number,
  lat: number,
): FoilArea | null {
  return areasAt(areas, lon, lat)[0] ?? null;
}

/**
 * The areas worth drawing over a view: those whose box meets it, from half a
 * zoom under their min zoom (MapLibre rounds a raster's zoom to the nearest
 * whole one, so that is where their tiles start). Any archive's box will do:
 * the satellite imagery's and the intertidal heights' are read the same way.
 */
export function areasInView<
  T extends {
    bounds: readonly [number, number, number, number];
    minzoom: number;
  },
>(
  areas: readonly T[],
  view: { west: number; south: number; east: number; north: number },
  zoom: number,
): T[] {
  return areas.filter(
    (a) =>
      zoom >= a.minzoom - 0.5 &&
      a.bounds[0] <= view.east &&
      a.bounds[2] >= view.west &&
      a.bounds[1] <= view.north &&
      a.bounds[3] >= view.south,
  );
}

/**
 * The area under a point (areasAt's first), else the one whose box is
 * nearest it, for the legend.
 */
export function nearestArea(
  areas: readonly FoilArea[],
  lon: number,
  lat: number,
): FoilArea | null {
  const under = areaAt(areas, lon, lat);
  if (under) return under;
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
 * The level the colours are drawn for: "tide 3.1 m above LAT at Howth", or
 * behind a weir, where `sea` is the station's tide and `tide` the basin's
 * own level, "water 3.2 m above LAT behind the weir (tide 0.8 m at Howth)".
 */
export function levelLine(tide: number, station: string, sea?: number) {
  return sea === undefined
    ? `tide ${one(tide)} m above LAT at ${station}`
    : `water ${one(tide)} m above LAT behind the weir (tide ${one(sea)} m at ${station})`;
}

/**
 * What a tapped point's archive says is there: a height above LAT; water of
 * unsurveyed depth; water deeper than the floor ("deep"); land (null); or,
 * where the archive has no tile at all, nothing drawn ("none": land, or deep).
 */
export type FoilPoint = number | "unsurveyed" | "deep" | "none" | null;

/**
 * A tapped point, as the legend says it: "~2.3 m of water at 18:00 (tide
 * 3.1 m at Howth)", or that it is dry, land, deep at any tide, or water no
 * survey has sounded. Behind a weir `tide` is the basin's level and `sea`
 * the station's tide. `floor` is the depth cut (the index's floorMetres).
 */
export function foilReadout(
  z: FoilPoint,
  tide: number,
  clock: string,
  station: string,
  clearance = FOIL_CLEARANCE_METRES,
  sea?: number,
  floor = -5,
): string {
  const at =
    sea === undefined
      ? `at ${clock} (tide ${one(tide)} m at ${station})`
      : `at ${clock} (water ${one(tide)} m above LAT behind the weir; tide ${one(sea)} m at ${station})`;
  if (z === null) return `Not in the water at any tide ${at}.`;
  if (z === "deep")
    return `More than ${-floor} m deep at the lowest tide: deep enough at any tide ${at}.`;
  if (z === "none")
    return `Nothing drawn here: dry land, or more than ${-floor} m deep at the lowest tide ${at}.`;
  if (z === "unsurveyed") return `Wet at every tide, depth not surveyed ${at}.`;
  const water = waterOver(z, tide);
  const cls = foilClass(z, tide, clearance);
  if (cls === "dry") return `Dry, ${one(-water)} m above the water ${at}.`;
  return `~${one(water)} m of water ${at}${cls === "shallow" ? ", too shallow to foil" : ""}.`;
}

/** The survey line for the caveat, e.g. "INFOMAR 2018, GSI LiDAR 2020". */
export const surveyLine = (area: FoilArea) =>
  area.sources.map((s) => `${s.name} ${s.years}`.trim()).join(", ");
