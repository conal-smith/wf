/**
 * The water at the launch: the seabed under the spot, read from the foil-depth
 * archive the map draws (force5/src/foilProbe.ts), less nothing but the tide.
 * Where the spot's point is on the sand above every tide, the launch is taken
 * at the water's edge: the first surveyed pixel seaward along the way the
 * beach faces, within LAUNCH_SEARCH_METRES.
 */
import {
  FOIL_INDEX_PATH,
  areaAt,
  validateFoilManifest,
  waterLevelAt,
  type FoilArea,
  type FoilManifest,
} from "../../../force5/src/foilDepth";
import { PMTiles } from "pmtiles";
import {
  foilPoint,
  terrariumHeight,
  tilePixel,
  type FoilPoint,
} from "../../../force5/src/foilDepth";
import { forecastUrl } from "../../../force5/src/urls";

export const LAUNCH_SEARCH_METRES = 400;
const STEP_METRES = 20;

export interface LaunchBed {
  /** The seabed, metres above LAT; -Infinity where it is deeper than the survey. */
  z: number;
  area: FoilArea;
}

let index: Promise<FoilManifest | null> | null = null;
function foilIndex() {
  index ??= fetch(`${import.meta.env.BASE_URL}${FOIL_INDEX_PATH}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => (json ? validateFoilManifest(json as FoilManifest) : null))
    .catch(() => null);
  return index;
}

/**
 * The seabed under a point, as force5/src/foilProbe.ts reads it, without the
 * map's archive registry: that module reaches MapLibre, and the spot page's
 * bundle must not (tests/bundle-isolation.test.ts).
 */
const archives = new Map<string, PMTiles>();
async function elevationAt(
  area: FoilArea,
  url: string,
  lon: number,
  lat: number,
  manifest: FoilManifest,
): Promise<FoilPoint> {
  let archive = archives.get(url);
  if (!archive) archives.set(url, (archive = new PMTiles(url)));
  const at = tilePixel(lon, lat, area.maxzoom, area.tileSize);
  const tile = await archive.getZxy(at.z, at.x, at.y);
  if (!tile?.data) return manifest.deepMetres === undefined ? null : "none";
  const bitmap = await createImageBitmap(
    new Blob([tile.data], { type: "image/webp" }),
    { colorSpaceConversion: "none", premultiplyAlpha: "none" },
  );
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, -at.px, -at.py);
  bitmap.close();
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return foilPoint(
    terrariumHeight(r, g, b),
    manifest,
    b,
    area.dryCeilingMetres,
  );
}

/** A point `metres` along `bearing` from another, near enough on a flat earth. */
export function stepFrom(
  lon: number,
  lat: number,
  bearing: number,
  metres: number,
) {
  const r = (bearing * Math.PI) / 180;
  const dLat = (metres * Math.cos(r)) / 111_320;
  const dLon =
    (metres * Math.sin(r)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lon: lon + dLon, lat: lat + dLat };
}

export async function launchBed(
  spot: { lon: number; lat: number },
  facing: number | null,
): Promise<LaunchBed | null> {
  const manifest = await foilIndex();
  if (!manifest) return null;
  const area = areaAt(manifest.areas, spot.lon, spot.lat);
  if (!area) return null;
  const url = new URL(
    manifest.base
      ? forecastUrl(`${manifest.base}${area.url}`)
      : `${import.meta.env.BASE_URL}${area.url}`,
    window.location.href,
  ).href;
  const steps = facing === null ? 1 : LAUNCH_SEARCH_METRES / STEP_METRES + 1;
  for (let i = 0; i < steps; i++) {
    const at = stepFrom(spot.lon, spot.lat, facing ?? 0, i * STEP_METRES);
    let point;
    try {
      point = await elevationAt(area, url, at.lon, at.lat, manifest);
    } catch {
      return null;
    }
    if (typeof point === "number") return { z: point, area };
    if (point && typeof point === "object" && "estimate" in point)
      return { z: point.estimate, area };
    if (point === "deep") return { z: -Infinity, area };
    if (point === "unsurveyed" || point === "none") return null;
  }
  return null;
}

/** The water over the launch at a time, from the tide at the spot. */
export function launchDepth(
  bed: LaunchBed,
  tideAt: (time: number) => number | null,
  time: number,
): number | null {
  const level = waterLevelAt(bed.area, tideAt, time);
  return level === null ? null : Math.max(0, level - bed.z);
}
