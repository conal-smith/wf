// The Rain layer on the chart: one image source and one raster layer, the
// hour's rain (force5/src/rain.ts) coloured in the theme's blues. Loaded by
// WindMap.tsx the first time the layer has anything to draw.
//
// It lies over the chart's fills (the land, the sea, the depth tints, a
// satellite picture, the coloured wind) and under its ink: the relief's
// hachures, the rivers, the coast, the contours and every name, and the
// lights, which are drawn over the map. So a shower never hides the shore.
import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { rainImage, rainRamp, type RainView } from "./rain";

export const RAIN_LAYER = "rain";
/** What it lies under: the first of these the chart has. */
const UNDER = ["relief", "rivers"];

const painted = new WeakMap<MapLibreMap, string>();
const settling = new WeakSet<MapLibreMap>();
let canvas: HTMLCanvasElement | null = null;

const under = (map: MapLibreMap) => UNDER.find((id) => map.getLayer(id));

/**
 * Keep the layer straight under the ink. Layers added later under the same
 * one (a satellite picture, the coloured wind) would otherwise land over it.
 */
function settle(map: MapLibreMap) {
  const below = under(map);
  if (!below || !map.getLayer(RAIN_LAYER)) return;
  const order = map.getLayersOrder();
  // Moving a layer is itself a style change: only when it is out of place.
  if (order[order.indexOf(RAIN_LAYER) + 1] !== below)
    map.moveLayer(RAIN_LAYER, below);
}

/** Says on the map's box what it draws and what over, for the page's own tests. */
function mark(map: MapLibreMap, view: RainView | null) {
  const box = map.getContainer();
  if (view) {
    const order = map.getLayersOrder();
    box.dataset.rain = view.key;
    box.dataset.rainFrom = new Date(view.from).toISOString();
    box.dataset.rainTo = new Date(view.to).toISOString();
    box.dataset.rainUnder = order[order.indexOf(RAIN_LAYER) + 1] ?? "";
  } else {
    delete box.dataset.rain;
    delete box.dataset.rainFrom;
    delete box.dataset.rainTo;
    delete box.dataset.rainUnder;
  }
}

export function drawRain(map: MapLibreMap, view: RainView) {
  const shown = map.getLayer(RAIN_LAYER);
  if (painted.get(map) !== view.key || !shown) {
    const style = getComputedStyle(map.getContainer());
    const image = rainImage(
      view.grid,
      view.rates,
      rainRamp((token) => style.getPropertyValue(token)),
    );
    canvas ??= document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL();
    const source = map.getSource(RAIN_LAYER) as ImageSource | undefined;
    if (source) source.updateImage({ url, coordinates: image.coordinates });
    else
      map.addSource(RAIN_LAYER, {
        type: "image",
        url,
        coordinates: image.coordinates,
      });
    if (!map.getLayer(RAIN_LAYER))
      map.addLayer(
        {
          id: RAIN_LAYER,
          type: "raster",
          source: RAIN_LAYER,
          paint: {
            "raster-opacity": 1,
            "raster-fade-duration": 0,
            "raster-resampling": "linear",
          },
        },
        under(map),
      );
    painted.set(map, view.key);
  }
  map.setLayoutProperty(RAIN_LAYER, "visibility", "visible");
  if (!settling.has(map)) {
    settling.add(map);
    map.on("styledata", () => settle(map));
  }
  settle(map);
  mark(map, view);
}

export function hideRain(map: MapLibreMap) {
  if (map.getLayer(RAIN_LAYER))
    map.setLayoutProperty(RAIN_LAYER, "visibility", "none");
  mark(map, null);
}
