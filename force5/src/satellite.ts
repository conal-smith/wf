/**
 * Satellite imagery under the chart: Ireland in natural colour from our own
 * Sentinel-2 composites (scripts/satellite), at high tide or at low tide.
 *
 * Round the coast, each pixel is the median of the clear looks taken when the
 * tide at its station was in the top fifth of the levels seen at Sentinel-2's
 * overpass (high), or the bottom fifth (low); inland both share one summer
 * composite, so only the water and the foreshore differ between them. One
 * raster PMTiles archive per option, on the data host under the index's
 * versioned `base`, as the foilable-depth archives are.
 *
 * The index also gives, per tide station, the median tide of the looks each
 * image is made of: the key says "Satellite: high tide (≈4.6 m)" for the
 * station nearest the map's centre.
 */

/** Off, or which tide's image. */
export type SatelliteOption = "off" | "high" | "low";

export const SATELLITE_OPTIONS: readonly SatelliteOption[] = [
  "off",
  "high",
  "low",
];

/** The Layers panel's switch, under its "Satellite" heading. */
export const SATELLITE_LABEL: Record<SatelliteOption, string> = {
  off: "Off",
  high: "High tide",
  low: "Low tide",
};

/**
 * Where the index is served from, under the site's BASE_URL: it ships with
 * the site, and names the archives under its `base` on the data host.
 */
export const SATELLITE_INDEX_PATH = "satellite/index.json";

/**
 * The credit, until the index (which carries its own) is loaded: the sources'
 * information names it whether or not the image is on.
 */
export const SATELLITE_ATTRIBUTION =
  "Contains modified Copernicus Sentinel data 2017–2026, composited for " +
  "wingfoil.ie; tide levels from the Marine Institute (CC BY 4.0), EOT20 " +
  "(DGFI-TUM, CC BY 4.0) and UK tide gauges via Copernicus Marine and " +
  "EMODnet Physics.";

export interface SatelliteStation {
  id: string;
  name: string;
  lonLat: [number, number];
  /** Median tide, metres above LAT, of the looks the high-tide image is made of here. */
  high: number;
  low: number;
}

export interface SatelliteManifest {
  schemaVersion: 1;
  kind: "satellite";
  /** The archives' folder on the data host, e.g. "satellite/v0123456789ab/". */
  base: string;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: 256 | 512;
  options: Record<Exclude<SatelliteOption, "off">, { url: string }>;
  stations: SatelliteStation[];
  attribution: string;
}

/** The stored choice, or off for anything else (an older store, a typo). */
export function parseSatelliteOption(value: unknown): SatelliteOption {
  return SATELLITE_OPTIONS.includes(value as SatelliteOption)
    ? (value as SatelliteOption)
    : "off";
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const archiveName = (v: unknown) =>
  typeof v === "string" && /^[a-z0-9-]+\.pmtiles$/.test(v);

/** The index as the site serves it, or an error naming what is wrong. */
export function validateSatelliteManifest(m: unknown): SatelliteManifest {
  const s = m as SatelliteManifest;
  const ok =
    !!s &&
    s.schemaVersion === 1 &&
    s.kind === "satellite" &&
    typeof s.base === "string" &&
    /^[a-z0-9-]+\/v[0-9a-f]+\/$/.test(s.base) &&
    Array.isArray(s.bounds) &&
    s.bounds.length === 4 &&
    s.bounds.every(finite) &&
    s.bounds[0] < s.bounds[2] &&
    s.bounds[1] < s.bounds[3] &&
    Number.isInteger(s.minzoom) &&
    Number.isInteger(s.maxzoom) &&
    s.minzoom <= s.maxzoom &&
    (s.tileSize === 256 || s.tileSize === 512) &&
    !!s.options &&
    archiveName(s.options.high?.url) &&
    archiveName(s.options.low?.url) &&
    Array.isArray(s.stations) &&
    s.stations.every(
      (st) =>
        typeof st.id === "string" &&
        typeof st.name === "string" &&
        Array.isArray(st.lonLat) &&
        st.lonLat.length === 2 &&
        st.lonLat.every(finite) &&
        finite(st.high) &&
        finite(st.low),
    ) &&
    typeof s.attribution === "string";
  if (!ok) throw new Error("The satellite imagery's index is not valid.");
  return s;
}

/** The station nearest a point (equirectangular: the island is small), or null. */
export function nearestSatelliteStation(
  stations: readonly SatelliteStation[],
  lon: number,
  lat: number,
): SatelliteStation | null {
  const k = Math.cos((lat * Math.PI) / 180);
  let best: SatelliteStation | null = null;
  let distance = Infinity;
  for (const st of stations) {
    const d = Math.hypot((st.lonLat[0] - lon) * k, st.lonLat[1] - lat);
    if (d < distance) {
      distance = d;
      best = st;
    }
  }
  return best;
}

/** "≈4.6 m": a tide to the nearest tenth, as the key gives it. */
export function approxMetres(metres: number) {
  return `≈${metres.toFixed(1)} m`;
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
