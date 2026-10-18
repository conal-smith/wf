/**
 * The seabed under a tapped point, read straight out of an area's archive
 * (force5/src/foilProbe.ts, for the app): the tile at the archive's finest
 * zoom, decoded by Skia, one pixel read. A tap is rare, so one small request
 * per tap is the simpler price.
 */
import { AlphaType, ColorType, Skia } from "@shopify/react-native-skia";
import {
  foilPoint,
  terrariumHeight,
  tilePixel,
  type FoilArea,
  type FoilPoint,
  type FoilReserved,
} from "../../../../force5/src/foilDepth";
import { archiveAt } from "./pmtiles";

export async function elevationAt(
  area: Pick<FoilArea, "maxzoom" | "tileSize" | "dryCeilingMetres">,
  url: string,
  lon: number,
  lat: number,
  manifest: FoilReserved,
): Promise<FoilPoint> {
  const at = tilePixel(lon, lat, area.maxzoom, area.tileSize);
  const bytes = await archiveAt(url).tile(at.z, at.x, at.y);
  if (!bytes?.length) return manifest.deepMetres === undefined ? null : "none";
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) return null;
  // The bytes are heights, not a picture: read unpremultiplied, as stored.
  const pixel = image.readPixels(at.px, at.py, {
    width: 1,
    height: 1,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  image.dispose?.();
  if (!pixel || pixel.length < 3) return null;
  // The blue byte flags an estimate (the index's estimateBlue).
  return foilPoint(terrariumHeight(pixel[0], pixel[1], pixel[2]), manifest, pixel[2], area.dryCeilingMetres);
}
