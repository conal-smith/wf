/**
 * The satellite imagery's index, and what the map makes of it: loaded (with
 * this module) the first time an image is chosen, never before.
 *
 * The index lists areas: Ireland now, Great Britain to come. Each is one
 * national run of scripts/satellite, published under its own immutable,
 * content-versioned `base` on the data host (scripts/satellite/publish.py
 * --area), with one raster PMTiles archive per tide. So adding a country is
 * publishing its archives and an entry here, not a change to the app. Only
 * the areas whose box meets the view are drawn, so only theirs are read, and
 * those by range, a tile at a time.
 *
 * Each area also gives, per tide station, the median tide of the looks each
 * image is made of: the key says "Satellite: high tide (≈4.6 m)" for the
 * station nearest the map's centre.
 */
import { areasInView } from "./foilDepth";
import { approxMetres, type SatelliteOption } from "./satellite";

export type SatelliteTide = Exclude<SatelliteOption, "off">;

export interface SatelliteStation {
  id: string;
  name: string;
  lonLat: [number, number];
  /** Median tide, metres above LAT, of the looks the high-tide image is made of here. */
  high: number;
  low: number;
}

/** One national run's imagery. */
export interface SatelliteArea {
  /** e.g. "ireland": publish.py's --area, which a later run replaces. */
  id: string;
  name: string;
  /** The archives' folder on the data host, e.g. "satellite/v0123456789ab/". */
  base: string;
  bounds: [number, number, number, number];
  /**
   * Where its archives have tiles, as boxes (publish.py: the z8 tiles, run
   * by run along each row). The view must meet one for the area to be read:
   * Great Britain's box holds Dublin, its cover does not.
   */
  cover?: [number, number, number, number][];
  minzoom: number;
  maxzoom: number;
  tileSize: 256 | 512;
  options: Record<SatelliteTide, { url: string }>;
  stations: SatelliteStation[];
}

export interface SatelliteManifest {
  schemaVersion: 2;
  kind: "satellite";
  areas: SatelliteArea[];
  attribution: string;
}

/** An area's image, as the map draws it. */
export interface SatelliteLayer {
  /** The area's id. */
  id: string;
  /** The archive's path on the data host, e.g. "satellite/v…/high.pmtiles". */
  path: string;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: number;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const archiveName = (v: unknown) =>
  typeof v === "string" && /^[a-z0-9-]+\.pmtiles$/.test(v);

const validBox = (b: unknown): b is [number, number, number, number] =>
  Array.isArray(b) &&
  b.length === 4 &&
  b.every(finite) &&
  b[0] < b[2] &&
  b[1] < b[3];

const validArea = (a: SatelliteArea) =>
  !!a &&
  typeof a.id === "string" &&
  /^[a-z0-9-]+$/.test(a.id) &&
  typeof a.name === "string" &&
  typeof a.base === "string" &&
  /^[a-z0-9-]+\/v[0-9a-f]+\/$/.test(a.base) &&
  validBox(a.bounds) &&
  (a.cover === undefined ||
    (Array.isArray(a.cover) && a.cover.every(validBox))) &&
  Number.isInteger(a.minzoom) &&
  Number.isInteger(a.maxzoom) &&
  a.minzoom <= a.maxzoom &&
  (a.tileSize === 256 || a.tileSize === 512) &&
  !!a.options &&
  archiveName(a.options.high?.url) &&
  archiveName(a.options.low?.url) &&
  Array.isArray(a.stations) &&
  a.stations.every(
    (st) =>
      typeof st.id === "string" &&
      typeof st.name === "string" &&
      Array.isArray(st.lonLat) &&
      st.lonLat.length === 2 &&
      st.lonLat.every(finite) &&
      finite(st.high) &&
      finite(st.low),
  );

/** The index as the site serves it, or an error naming what is wrong. */
export function validateSatelliteManifest(m: unknown): SatelliteManifest {
  const s = m as SatelliteManifest;
  const ok =
    !!s &&
    s.schemaVersion === 2 &&
    s.kind === "satellite" &&
    Array.isArray(s.areas) &&
    s.areas.every(validArea) &&
    new Set(s.areas.map((a) => a.id)).size === s.areas.length &&
    typeof s.attribution === "string";
  if (!ok) throw new Error("The satellite imagery's index is not valid.");
  return s;
}

/** The images to draw over a view, at a tide: one per area in view. */
export function satelliteLayers(
  manifest: SatelliteManifest,
  option: SatelliteTide,
  view: { west: number; south: number; east: number; north: number },
  zoom: number,
): SatelliteLayer[] {
  const meets = (b: readonly number[]) =>
    b[0] <= view.east &&
    b[2] >= view.west &&
    b[1] <= view.north &&
    b[3] >= view.south;
  return areasInView(manifest.areas, view, zoom)
    .filter((a) => !a.cover || a.cover.some(meets))
    .map((a) => ({
      id: a.id,
      path: `${a.base}${a.options[option].url}`,
      bounds: a.bounds,
      minzoom: a.minzoom,
      maxzoom: a.maxzoom,
      tileSize: a.tileSize,
    }));
}

/** The station nearest a point, of every area's (equirectangular: the distances are short), or null. */
export function nearestSatelliteStation(
  areas: readonly Pick<SatelliteArea, "stations">[],
  lon: number,
  lat: number,
): SatelliteStation | null {
  const k = Math.cos((lat * Math.PI) / 180);
  let best: SatelliteStation | null = null;
  let distance = Infinity;
  for (const area of areas)
    for (const st of area.stations) {
      const d = Math.hypot((st.lonLat[0] - lon) * k, st.lonLat[1] - lat);
      if (d < distance) {
        distance = d;
        best = st;
      }
    }
  return best;
}

/**
 * The key's line for the image on the map: "Satellite: high tide (≈4.6 m)",
 * or without the height where no station is known; null when it is off.
 */
export function satelliteNote(
  option: SatelliteOption,
  station: SatelliteStation | null,
): string | null {
  if (option === "off") return null;
  const which = option === "high" ? "high tide" : "low tide";
  return station
    ? `Satellite: ${which} (${approxMetres(station[option])})`
    : `Satellite: ${which}`;
}
