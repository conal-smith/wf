/**
 * The seabed's height under one point, read straight out of an area's
 * archive: the tile at the archive's finest zoom, decoded, one pixel read.
 * The map does not keep its DEM tiles where the page can reach them, and a
 * tap is rare, so one small request per tap is the simpler price.
 */
import { archive } from "./archives";
import {
  foilPoint,
  terrariumHeight,
  tilePixel,
  type FoilArea,
  type FoilPoint,
  type FoilReserved,
} from "./foilDepth";

/**
 * What the archive says under a point (FoilPoint): metres above LAT;
 * `{ estimate }` where no survey reached and the build estimated the bed
 * (the index's `estimateBlue`); "unsurveyed" where an older set says the
 * water is there at every tide but its depth is not known; "deep" where it
 * is deeper than the index's floor; null where there is no water (land, and
 * the land the build pads beside the water); "none" where the archive has
 * no tile there (it leaves out the tiles with nothing to draw: land, or
 * deep water). foilPoint (foilDepth.ts) reads the pixel.
 */
export async function elevationAt(
  area: Pick<FoilArea, "maxzoom" | "tileSize" | "dryCeilingMetres">,
  url: string,
  lon: number,
  lat: number,
  manifest: FoilReserved,
): Promise<FoilPoint> {
  const at = tilePixel(lon, lat, area.maxzoom, area.tileSize);
  // The map's own archive: on a host without ranges, the file it already has.
  const tile = await archive(url).getZxy(at.z, at.x, at.y);
  if (!tile?.data) return manifest.deepMetres === undefined ? null : "none";
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
  return foilPoint(
    terrariumHeight(r, g, b),
    manifest,
    b,
    area.dryCeilingMetres,
  );
}
