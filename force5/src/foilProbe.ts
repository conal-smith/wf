/**
 * The seabed's height under one point, read straight out of an area's
 * archive: the tile at the archive's finest zoom, decoded, one pixel read.
 * The map does not keep its DEM tiles where the page can reach them, and a
 * tap is rare, so one small request per tap is the simpler price.
 */
import { archive } from "./archives";
import {
  terrariumHeight,
  tilePixel,
  type FoilArea,
  type FoilManifest,
} from "./foilDepth";

/**
 * Metres above LAT under a point; "unsurveyed" where the water is there at
 * every tide but its depth is not known; null where there is no water (land)
 * or no tile.
 */
export async function elevationAt(
  area: FoilArea,
  url: string,
  lon: number,
  lat: number,
  manifest: Pick<FoilManifest, "noSurveyMetres" | "landMetres">,
): Promise<number | "unsurveyed" | null> {
  const at = tilePixel(lon, lat, area.maxzoom, area.tileSize);
  // The map's own archive: on a host without ranges, the file it already has.
  const tile = await archive(url).getZxy(at.z, at.x, at.y);
  if (!tile?.data) return null;
  const bitmap = await createImageBitmap(
    new Blob([tile.data], { type: "image/webp" }),
    // The bytes are heights, not a picture: no colour management.
    { colorSpaceConversion: "none", premultiplyAlpha: "none" },
  );
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, -at.px, -at.py);
  bitmap.close();
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  const z = terrariumHeight(r, g, b);
  if (z >= manifest.landMetres - 1) return null;
  if (Math.abs(z - manifest.noSurveyMetres) < 1) return "unsurveyed";
  return z;
}
