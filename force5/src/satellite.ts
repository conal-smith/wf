/**
 * Satellite imagery under the chart: the coast in natural colour from our own
 * Sentinel-2 composites (scripts/satellite), at high tide or at low tide.
 *
 * Round the coast, each pixel is the median of the clear looks taken when the
 * tide at its station was in the top fifth of the levels seen at Sentinel-2's
 * overpass (high), or the bottom fifth (low); inland both share one summer
 * composite, so only the water and the foreshore differ between them.
 *
 * This is the little the page needs before the image is asked for: the
 * Layers panel's choices and the credit. The index and everything that reads
 * it (satelliteIndex.ts) load the first time an image is chosen, so with the
 * layer off (the default) the first load carries none of it.
 */

/** Off, or which tide's image. */
export type SatelliteOption = "off" | "high" | "low";

export const SATELLITE_OPTIONS: readonly SatelliteOption[] = [
  "off",
  "high",
  "low",
];

/** The Layers panel's switch, under its "Satellite at tide" heading. */
export const SATELLITE_LABEL: Record<SatelliteOption, string> = {
  off: "Off",
  high: "High tide",
  low: "Low tide",
};

/**
 * Where the index is served from, under the site's BASE_URL: it ships with
 * the site, and names each area's archives under the area's `base` on the
 * data host.
 */
export const SATELLITE_INDEX_PATH = "satellite/index.json";

/**
 * The credit, until the index (which carries its own) is loaded: the sources'
 * information names it whether or not the image is on. The foreshore's
 * heights in the foil layer come from the same looks at the same tides.
 */
export const SATELLITE_ATTRIBUTION =
  "Contains modified Copernicus Sentinel data 2017–2026, composited for " +
  "wingfoil.ie; tide levels from the Marine Institute (CC BY 4.0), EOT20 " +
  "(DGFI-TUM, CC BY 4.0) and UK tide gauges via Copernicus Marine and " +
  "EMODnet Physics.";

/** The stored choice, or off for anything else (an older store, a typo). */
export function parseSatelliteOption(value: unknown): SatelliteOption {
  return SATELLITE_OPTIONS.includes(value as SatelliteOption)
    ? (value as SatelliteOption)
    : "off";
}

/** "≈4.6 m": a tide to the nearest tenth, as the key gives it. */
export function approxMetres(metres: number) {
  return `≈${metres.toFixed(1)} m`;
}

/**
 * The Layers panel's line under the switch, the same whichever image is
 * shown: the tides both images were taken at, at the station nearest the
 * map's centre (satelliteIndex.ts's SatelliteStation), each as the key gives
 * it. "Tide in the images at Galway: high ≈4.0 m, low ≈0.8 m".
 */
export function satelliteTidesLine(station: {
  name: string;
  high: number;
  low: number;
}) {
  return `Tide in the images at ${station.name}: high ${approxMetres(station.high)}, low ${approxMetres(station.low)}`;
}

/** What those figures are, under them. */
export const SATELLITE_TIDES_NOTE =
  "Above chart datum (LAT). Each image blends clear Sentinel-2 passes " +
  "from several years taken near that tide, so it is not one day's " +
  "picture, nor today's tide.";
