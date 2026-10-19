/**
 * A satellite picture of each riding place, for the top of its page: cut from
 * the map's own Sentinel-2 composites at high and at low tide
 * (scripts/satellite/spots.py), one WebP a place and tide, north up and
 * centred on the place, published beside the map's archives under a
 * content-versioned folder on the data host (publish.py --spots).
 *
 * The site ships the list of what is pictured (public/satellite/spots.json,
 * written by publish.py); the page reads it, and only then the one picture,
 * as an image the browser loads lazily. Until a set is published there is no
 * list, and the page draws no picture and leaves no gap.
 */
import { forecastUrl } from "../../force5/src/urls";

/** Where the list is served from, under the site's BASE_URL. */
export const SPOT_PICTURES_PATH = "satellite/spots.json";

export type PictureTide = "high" | "low";

export interface SpotPictureEntry {
  id: string;
  /** The point the picture is centred on. */
  lonLat: [number, number];
  high: string;
  low: string;
}

export interface SpotPictures {
  schemaVersion: 1;
  kind: "satellite-spots";
  /** The set's folder on the data host, e.g. "satellite/v0123456789ab/". */
  base: string;
  /** The pictures' scale, as a 256-pixel tile's zoom. */
  zoom: number;
  width: number;
  height: number;
  attribution: string;
  spots: SpotPictureEntry[];
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const pictureName = (v: unknown) =>
  typeof v === "string" && /^[a-z0-9-]+\.webp$/.test(v);

/** The list as the site serves it, or null for anything else. */
export function parseSpotPictures(json: unknown): SpotPictures | null {
  const m = json as SpotPictures;
  const ok =
    !!m &&
    m.schemaVersion === 1 &&
    m.kind === "satellite-spots" &&
    typeof m.base === "string" &&
    /^satellite\/v[0-9a-f]+\/$/.test(m.base) &&
    finite(m.zoom) &&
    Number.isInteger(m.width) &&
    m.width > 0 &&
    Number.isInteger(m.height) &&
    m.height > 0 &&
    typeof m.attribution === "string" &&
    Array.isArray(m.spots) &&
    m.spots.every(
      (s) =>
        !!s &&
        typeof s.id === "string" &&
        Array.isArray(s.lonLat) &&
        s.lonLat.length === 2 &&
        s.lonLat.every(finite) &&
        pictureName(s.high) &&
        pictureName(s.low),
    );
  return ok ? m : null;
}

let shared: Promise<SpotPictures | null> | null = null;

/**
 * The list, read once a page. A host with no list (none published yet), one
 * that answers with something else (Pages' fallback page) or no network all
 * come to null: no picture.
 */
export function loadSpotPictures(
  load: typeof fetch = (input, init) => fetch(input, init),
): Promise<SpotPictures | null> {
  return (shared ??= load(`${import.meta.env.BASE_URL}${SPOT_PICTURES_PATH}`)
    .then((response) => (response.ok ? response.json() : null))
    .then(parseSpotPictures)
    .catch(() => null));
}

/** Forget the list read, for a test. */
export function resetSpotPictures() {
  shared = null;
}

/** A point's pixel in Web Mercator at a 256-pixel tile's zoom. */
export function worldPixel(lon: number, lat: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  };
}

/** Metres a pixel of the picture covers on the ground, at its latitude. */
export function metresPerPixel(lat: number, zoom: number) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

export interface SpotPicture {
  urls: Record<PictureTide, string>;
  width: number;
  height: number;
  /** Where the place is in the picture, as fractions of its width and height. */
  at: { x: number; y: number };
  metresPerPixel: number;
  attribution: string;
}

/**
 * The place's picture, with where the place is in it: at its centre, unless
 * the place has been moved since the picture was cut. A place moved so far
 * that it would sit near the picture's edge, or out of it, has no picture
 * until the set is cut again.
 */
export function spotPicture(
  pictures: SpotPictures,
  spot: { id: string; lat: number; lon: number },
): SpotPicture | null {
  const entry = pictures.spots.find((s) => s.id === spot.id);
  if (!entry) return null;
  const centre = worldPixel(entry.lonLat[0], entry.lonLat[1], pictures.zoom);
  const here = worldPixel(spot.lon, spot.lat, pictures.zoom);
  const x = 0.5 + (here.x - centre.x) / pictures.width;
  const y = 0.5 + (here.y - centre.y) / pictures.height;
  if (x < 0.15 || x > 0.85 || y < 0.15 || y > 0.85) return null;
  const url = (name: string) => forecastUrl(`${pictures.base}${name}`);
  return {
    urls: { high: url(entry.high), low: url(entry.low) },
    width: pictures.width,
    height: pictures.height,
    at: { x, y },
    metresPerPixel: metresPerPixel(spot.lat, pictures.zoom),
    attribution: pictures.attribution,
  };
}

/**
 * The picture as a frame of `width` x `height` screen pixels shows it,
 * covered and centred (CSS `object-fit: cover`): where the place is, in
 * screen pixels from the frame's corner, and the metres a screen pixel is.
 * A phone's frame is taller than the picture, so its sides are cut off.
 */
export function inFrame(picture: SpotPicture, width: number, height: number) {
  const k = Math.max(width / picture.width, height / picture.height);
  return {
    x: width / 2 + (picture.at.x - 0.5) * picture.width * k,
    y: height / 2 + (picture.at.y - 0.5) * picture.height * k,
    metresPerScreenPixel: picture.metresPerPixel / k,
  };
}

const SCALE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

/**
 * The scale bar: the longest round distance whose bar is no longer than
 * `maxPixels` on the screen, at `metresPerScreenPixel`.
 */
export function scaleBar(metresPerScreenPixel: number, maxPixels: number) {
  const fits = SCALE_STEPS.filter((m) => m / metresPerScreenPixel <= maxPixels);
  const metres = fits.at(-1) ?? SCALE_STEPS[0];
  return {
    metres,
    pixels: metres / metresPerScreenPixel,
    label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m`,
  };
}

/**
 * The credit under the picture: the imagery's own clause of the list's
 * attribution ("Contains modified Copernicus Sentinel data 2017–2026,
 * composited for wingfoil.ie"); the whole of it is in the sources at the
 * foot of the page.
 */
export function pictureCredit(attribution: string) {
  return attribution.split(";")[0].trim();
}
