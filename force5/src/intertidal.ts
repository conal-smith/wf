/**
 * Intertidal heights from Sentinel-2 (scripts/satellite): per 10 m pixel of
 * foreshore, the tide level at its station at which it covers and uncovers,
 * read off the looks of 2017–2026 at known tides. One Terrarium archive per
 * tide station's region, cut as the foilable-depth regions are and in their
 * encoding, metres above LAT.
 *
 * The foil layer draws them over its own regions, with the same ramp at the
 * same tide: on most of the coast the foil archives' foreshore is a surface
 * interpolated between three waterlines, and these are measured pixel by
 * pixel. Where they have no height (the reserved values below) nothing is
 * drawn, and the foil archive under them shows. Loaded (this module and the
 * index) only once the foil layer is on and the map is zoomed in to the
 * shore (useIntertidal.ts), so the first load carries none of it.
 *
 * The index lists every published set's areas, each under its own immutable,
 * content-versioned `base` (scripts/satellite/publish.py --area): Great
 * Britain is more areas in the index, not a change here.
 */

/** One tide station's region of one published set. */
export interface IntertidalArea {
  /** e.g. "tide-howth": the foil region's id where there is one. */
  id: string;
  /** The published set it is from, e.g. "ireland". */
  set: string;
  kind: "region";
  /** The set's folder on the data host, e.g. "intertidal/v0123456789ab/". */
  base: string;
  /** The archive under `base`, e.g. "tide-howth.pmtiles". */
  url: string;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  /** The tide station whose levels the heights are in (tides.ts's id). */
  station: string;
  /** A point belongs to the region whose station is nearest (areasAt). */
  stationLonLat: [number, number];
  /** The lowest and highest tides the looks were taken at. */
  lowestSeenMetres: number;
  highestSeenMetres: number;
}

export interface IntertidalManifest {
  schemaVersion: 1;
  kind: "intertidal";
  datum: "LAT";
  encoding: "terrarium";
  /** Reserved heights, as the foil archives write theirs. */
  deepMetres: number;
  landMetres: number;
  noSurveyMetres: number;
  /** Wet in every look: under the lowest tide seen, so no height. */
  belowSeenMetres: number;
  areas: IntertidalArea[];
  attribution: string;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const validArea = (a: IntertidalArea) =>
  !!a &&
  typeof a.id === "string" &&
  /^[a-z0-9-]+$/.test(a.id) &&
  typeof a.set === "string" &&
  a.kind === "region" &&
  typeof a.base === "string" &&
  /^[a-z0-9-]+\/v[0-9a-f]+\/$/.test(a.base) &&
  typeof a.url === "string" &&
  /^[a-z0-9-]+\.pmtiles$/.test(a.url) &&
  Array.isArray(a.bounds) &&
  a.bounds.length === 4 &&
  a.bounds.every(finite) &&
  a.bounds[0] < a.bounds[2] &&
  a.bounds[1] < a.bounds[3] &&
  Number.isInteger(a.minzoom) &&
  Number.isInteger(a.maxzoom) &&
  a.minzoom <= a.maxzoom &&
  (a.tileSize === 256 || a.tileSize === 512) &&
  typeof a.station === "string" &&
  Array.isArray(a.stationLonLat) &&
  a.stationLonLat.length === 2 &&
  a.stationLonLat.every(finite) &&
  finite(a.lowestSeenMetres) &&
  finite(a.highestSeenMetres) &&
  a.lowestSeenMetres < a.highestSeenMetres;

/** The index as the site serves it, or an error naming what is wrong. */
export function validateIntertidalManifest(m: unknown): IntertidalManifest {
  const s = m as IntertidalManifest;
  const ok =
    !!s &&
    s.schemaVersion === 1 &&
    s.kind === "intertidal" &&
    s.datum === "LAT" &&
    s.encoding === "terrarium" &&
    finite(s.deepMetres) &&
    finite(s.landMetres) &&
    finite(s.noSurveyMetres) &&
    finite(s.belowSeenMetres) &&
    Array.isArray(s.areas) &&
    s.areas.every(validArea) &&
    // Every height a pixel can have lies between the deep value and the
    // reserved ones above it, so the ramp can leave those clear.
    s.areas.every(
      (a) =>
        a.lowestSeenMetres - 1 > s.deepMetres &&
        a.highestSeenMetres + 1 < s.belowSeenMetres,
    ) &&
    new Set(s.areas.map((a) => a.id)).size === s.areas.length &&
    typeof s.attribution === "string";
  if (!ok) throw new Error("The intertidal heights' index is not valid.");
  return s;
}

/**
 * A height read under a point, as the foil probe returns it (foilProbe.ts),
 * when it is one: the reserved values (under the lowest tide seen, no fit,
 * land, another region's water) are not.
 */
export const isIntertidalHeight = (
  manifest: Pick<IntertidalManifest, "belowSeenMetres">,
  z: unknown,
): z is number => finite(z) && z < manifest.belowSeenMetres - 1;
