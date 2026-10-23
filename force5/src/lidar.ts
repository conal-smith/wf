/**
 * The LiDAR layer: the ground's height above the lowest tide (LAT), shaded,
 * where we hold a LiDAR survey (scripts/lidar): Dublin's north coast and
 * Dublin Bay, Tralee and Brandon Bays, Lough Foyle and Northern Ireland's
 * river-basin flights. Sandbars, channels, the beach's shape and the reefs
 * show as the tide leaves them.
 *
 * Off by default, and nothing of it is loaded until it is turned on: this
 * module (imported dynamically by src/useLidar.ts and WindMap), its index
 * (shipped with the site, naming the set's `base` on the data host), the
 * archive's header and the outline. The archive is one raster PMTiles of
 * baked colour and shade, z9 to z14, read a tile at a time by range; under
 * z9 the coverage's outline alone says where it is.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { archiveUrl } from "./archives";

/** Under the site's BASE_URL. */
export const LIDAR_INDEX_PATH = "lidar/index.json";

export interface LidarSource {
  id: string;
  name: string;
  kind: "bathymetric" | "topographic";
  /** "2008", "2007–2012". */
  flown: string;
  resolution: string;
  by: string;
  licence: string;
  bounds: [number, number, number, number];
}

export interface LidarIndex {
  schemaVersion: 1;
  kind: "lidar";
  datum: "LAT";
  /** The set's folder on the data host, e.g. "lidar/v0123456789ab/". */
  base: string;
  /** The archive and the outline, beside each other under `base`. */
  url: string;
  coverage: string;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: 256 | 512;
  /** The colours the tiles were drawn with: [metres above LAT, "#rrggbb"], by height. */
  ramp: [number, string][];
  sources: LidarSource[];
  areaKm2?: number;
  attribution: string;
}

/** What the map draws: the archive's and the outline's absolute URLs. */
export interface LidarView {
  url: string;
  coverageUrl: string;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  attribution: string;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const validBox = (b: unknown): b is [number, number, number, number] =>
  Array.isArray(b) &&
  b.length === 4 &&
  b.every(finite) &&
  b[0] < b[2] &&
  b[1] < b[3];

const fileName = (v: unknown, ending: string) =>
  typeof v === "string" && new RegExp(`^[a-z0-9-]+\\.${ending}$`).test(v);

/** The index as the site serves it, or an error naming what is wrong. */
export function validateLidarIndex(m: unknown): LidarIndex {
  const s = m as LidarIndex;
  const ok =
    !!s &&
    s.schemaVersion === 1 &&
    s.kind === "lidar" &&
    s.datum === "LAT" &&
    typeof s.base === "string" &&
    /^lidar\/v[0-9a-f]+\/$/.test(s.base) &&
    fileName(s.url, "pmtiles") &&
    fileName(s.coverage, "json") &&
    validBox(s.bounds) &&
    Number.isInteger(s.minzoom) &&
    Number.isInteger(s.maxzoom) &&
    s.minzoom <= s.maxzoom &&
    (s.tileSize === 256 || s.tileSize === 512) &&
    Array.isArray(s.ramp) &&
    s.ramp.length >= 2 &&
    s.ramp.every(
      (stop) =>
        Array.isArray(stop) &&
        finite(stop[0]) &&
        typeof stop[1] === "string" &&
        /^#[0-9a-f]{6}$/i.test(stop[1]),
    ) &&
    s.ramp.every((stop, i) => i === 0 || stop[0] > s.ramp[i - 1][0]) &&
    Array.isArray(s.sources) &&
    s.sources.every(
      (src) =>
        typeof src.id === "string" &&
        typeof src.name === "string" &&
        typeof src.flown === "string" &&
        typeof src.resolution === "string" &&
        typeof src.licence === "string" &&
        validBox(src.bounds),
    ) &&
    typeof s.attribution === "string";
  if (!ok) throw new Error("The LiDAR data's index is not valid.");
  return s;
}

/**
 * The index, fetched and checked; `resolve` makes a path on the data host
 * absolute (force5/src/urls.ts's forecastUrl, against the page).
 */
export async function loadLidar(
  indexUrl: string,
  resolve: (path: string) => string,
  signal?: AbortSignal,
): Promise<{ index: LidarIndex; view: LidarView }> {
  const response = await fetch(indexUrl, { signal });
  if (!response.ok) throw new Error("The LiDAR data is missing.");
  const index = validateLidarIndex(await response.json());
  return {
    index,
    view: {
      url: resolve(`${index.base}${index.url}`),
      coverageUrl: resolve(`${index.base}${index.coverage}`),
      bounds: index.bounds,
      minzoom: index.minzoom,
      maxzoom: index.maxzoom,
      tileSize: index.tileSize,
      attribution: index.attribution,
    },
  };
}

/** The map's layers for it, bottom to top. */
export const LIDAR_LAYERS = ["lidar", "lidar-cover", "lidar-edge"] as const;

/**
 * The layer on the map: made the first time, shown after. Over the depth
 * tints, the satellite image, the contours and the foilable depth (it is
 * what the rider turned on to look at), under the rivers, the coast's ink and
 * every name. Under the archive's first zoom, where its tiles would be a
 * few pixels across, a faint fill marks where it is; the outline is drawn at
 * every zoom.
 */
export function showLidar(map: MapLibreMap, view: LidarView) {
  const before = map.getLayer("rivers") ? "rivers" : undefined;
  if (!map.getSource("lidar")) {
    map.addSource("lidar", {
      type: "raster",
      // Read by range only, as the satellite imagery (archives.ts).
      url: archiveUrl(view.url, { rangesOnly: true }),
      tileSize: view.tileSize,
      bounds: view.bounds,
      minzoom: view.minzoom,
      maxzoom: view.maxzoom,
      attribution: view.attribution,
    });
    map.addSource("lidar-coverage", {
      type: "geojson",
      data: view.coverageUrl,
    });
  }
  if (!map.getLayer("lidar")) {
    const ink =
      getComputedStyle(map.getContainer())
        .getPropertyValue("--color-ink")
        .trim() || "black";
    map.addLayer(
      {
        id: "lidar",
        type: "raster",
        source: "lidar",
        // MapLibre rounds a raster's zoom: half a zoom under the archive's
        // first is where its tiles start.
        minzoom: Math.max(0, view.minzoom - 0.5),
        paint: { "raster-opacity": 0.95, "raster-fade-duration": 150 },
      },
      before,
    );
    map.addLayer(
      {
        id: "lidar-cover",
        type: "fill",
        source: "lidar-coverage",
        maxzoom: view.minzoom,
        paint: { "fill-color": ink, "fill-opacity": 0.18 },
      },
      before,
    );
    map.addLayer(
      {
        id: "lidar-edge",
        type: "line",
        source: "lidar-coverage",
        paint: {
          "line-color": ink,
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 12, 1.2],
          "line-dasharray": [3, 2],
        },
      },
      before,
    );
  }
  for (const id of LIDAR_LAYERS)
    map.setLayoutProperty(id, "visibility", "visible");
}
