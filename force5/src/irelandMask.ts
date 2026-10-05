import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The chart is of Ireland alone. public/mask/ireland.png (written once by
 * scripts/ireland-mask/build.mjs) is clear over Ireland, its islands and its
 * own waters, and opaque everywhere else: Britain, the Isle of Man, the open
 * ocean past the finest wind model's grid. Here it is tinted the sea's colour
 * and laid over the basemap, the depths and the wash, under the wind's lines
 * and the lights, and the camera is kept inside it.
 */

/** The image's corners: the build script writes over exactly these. */
export const MASK_BOUNDS: [[number, number], [number, number]] = [
  [-15, 48.5],
  [-1, 58.5],
];
export const MASK_PATH = "mask/ireland.png";
export const MASK_LAYER = "beyond";

const rad = Math.PI / 180;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));

/** How covered a place is, 0 clear to 1 hidden; 1 off the image. */
export type MaskAt = (lng: number, lat: number) => number;

export interface IrelandMask {
  /** Null until the image has loaded. */
  at: MaskAt | null;
}

/**
 * Tints the mask with `colour` and adds it to `map` on top of the style's own
 * layers, which must already be loaded. `onReady` gets the sampler, for
 * the wind's lines to stop where the sea is hidden.
 */
export function addIrelandMask(
  map: MapLibreMap,
  url: string,
  colour: string,
  onReady?: (at: MaskAt) => void,
): IrelandMask {
  const state: IrelandMask = { at: null };
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d", { willReadFrequently: true });
    if (!c) return;
    c.drawImage(image, 0, 0);
    const pixels = c.getImageData(0, 0, w, h);
    const alpha = new Uint8Array(w * h);
    const rgb = tint(colour);
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = pixels.data[i * 4 + 3];
      pixels.data[i * 4] = rgb[0];
      pixels.data[i * 4 + 1] = rgb[1];
      pixels.data[i * 4 + 2] = rgb[2];
    }
    c.putImageData(pixels, 0, 0);
    const [[west, south], [east, north]] = MASK_BOUNDS;
    const yN = merc(north);
    const yS = merc(south);
    const at: MaskAt = (lng, lat) => {
      const x = Math.floor(((lng - west) / (east - west)) * w);
      const y = Math.floor(((yN - merc(lat)) / (yN - yS)) * h);
      if (x < 0 || y < 0 || x >= w || y >= h) return 1;
      return alpha[y * w + x] / 255;
    };
    state.at = at;
    if (!map.getSource(MASK_LAYER)) {
      map.addSource(MASK_LAYER, {
        type: "image",
        url: canvas.toDataURL(),
        coordinates: [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      });
      map.addLayer({
        id: MASK_LAYER,
        type: "raster",
        source: MASK_LAYER,
        paint: {
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
        },
      });
    }
    onReady?.(at);
  };
  image.src = url;
  return state;
}

/** "#aabbcc" or "rgb(…)" to its channels; the theme gives hex. */
function tint(colour: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})/i.exec(colour.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = colour.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : [255, 255, 255];
}
