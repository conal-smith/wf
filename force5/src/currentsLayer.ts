// The map's Currents layer: one GeoJSON source and one symbol layer, an arrow
// per point, rotated to where the water runs and sized by its speed. MapLibre
// thins the arrows itself (they do not overlap), strongest first, so the
// density suits every zoom from one decimated grid; the tidal stream sites go
// first of all. Imported by WindMap only once the layer is turned on.
//
// The arrows are the Admiralty chart's: the model's a plain arrow in the
// depth ink, a channel's flood stream feathered and its ebb plain, in ink,
// with the rate beside it.
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { CHART_FONT } from "./chartStyle";
import type { CurrentFeature } from "./currents";

export const CURRENTS_LAYER = "currents";
const SOURCE = "currents";
/** Pixels per CSS pixel the icons are drawn at, so they stay sharp. */
const RATIO = 2;
/** The icons' CSS size: tall enough for the feathers, narrow for the grid. */
const WIDTH = 14;
const HEIGHT = 30;

interface Colours {
  ink: string;
  depth: string;
  paper: string;
}

function colours(map: MapLibreMap): Colours {
  const style = getComputedStyle(map.getContainer());
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    ink: read("--color-ink"),
    depth: read("--color-depth"),
    paper: read("--color-ground"),
  };
}

/**
 * One arrow pointing up the canvas (north, before MapLibre rotates it):
 * a shaft, a narrow head, and for a flood stream two feathers at the tail.
 * A paper edge under it keeps it readable on the tints and on satellite.
 */
function arrow(
  colour: string,
  paper: string,
  feathered: boolean,
  weight: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * RATIO;
  canvas.height = HEIGHT * RATIO;
  const g = canvas.getContext("2d")!;
  g.scale(RATIO, RATIO);
  const mid = WIDTH / 2;
  const path = () => {
    g.beginPath();
    g.moveTo(mid, HEIGHT - 2);
    g.lineTo(mid, 3);
    g.moveTo(mid - 3.6, 9.5);
    g.lineTo(mid, 2);
    g.lineTo(mid + 3.6, 9.5);
    if (feathered)
      for (const y of [HEIGHT - 3, HEIGHT - 7]) {
        g.moveTo(mid, y - 4);
        g.lineTo(mid - 4.5, y);
      }
  };
  g.lineCap = "round";
  g.lineJoin = "round";
  path();
  g.strokeStyle = paper;
  g.lineWidth = weight + 2;
  g.stroke();
  path();
  g.strokeStyle = colour;
  g.lineWidth = weight;
  g.stroke();
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

/** A small ring for a channel at slack water. */
function ring(colour: string, paper: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 12 * RATIO;
  const g = canvas.getContext("2d")!;
  g.scale(RATIO, RATIO);
  g.beginPath();
  g.arc(6, 6, 3.5, 0, Math.PI * 2);
  g.fillStyle = paper;
  g.fill();
  g.strokeStyle = colour;
  g.lineWidth = 1.4;
  g.stroke();
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

function addImages(map: MapLibreMap) {
  if (map.hasImage("cur-model")) return;
  const c = colours(map);
  const options = { pixelRatio: RATIO };
  map.addImage("cur-model", arrow(c.depth, c.paper, false, 1.4), options);
  map.addImage("cur-flood", arrow(c.ink, c.paper, true, 1.8), options);
  map.addImage("cur-ebb", arrow(c.ink, c.paper, false, 1.8), options);
  map.addImage("cur-slack", ring(c.ink, c.paper), options);
}

/** Draw the hour's arrows, making the source and layer the first time. */
export function drawCurrents(map: MapLibreMap, features: CurrentFeature[]) {
  const data = { type: "FeatureCollection" as const, features };
  const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else {
    addImages(map);
    // Each hour is a new set of points, not a moving one: nothing to tile
    // beyond what MapLibre does by default, and no clustering.
    map.addSource(SOURCE, { type: "geojson", data, buffer: 32 });
  }
  if (!map.getLayer(CURRENTS_LAYER)) {
    const c = colours(map);
    const model: ExpressionSpecification = ["==", ["get", "kind"], "model"];
    map.addLayer(
      {
        id: CURRENTS_LAYER,
        type: "symbol",
        source: SOURCE,
        layout: {
          "icon-image": ["concat", "cur-", ["get", "kind"]],
          "icon-rotate": ["get", "towards"],
          "icon-rotation-alignment": "map",
          // Slow water a short arrow, a fast channel a long one.
          "icon-size": [
            "interpolate",
            ["linear"],
            ["get", "speed"],
            0,
            0.45,
            0.5,
            0.8,
            1.5,
            1.15,
            3,
            1.45,
          ],
          "icon-padding": 3,
          "symbol-sort-key": ["get", "rank"],
          // The model's figures only once there is room for them; a
          // channel's always. Never at the cost of its arrow.
          "text-field": [
            "step",
            ["zoom"],
            ["case", model, "", ["get", "label"]],
            10.5,
            ["get", "label"],
          ],
          "text-font": CHART_FONT,
          "text-size": ["case", model, 10, 11.5],
          "text-anchor": "top",
          "text-offset": [0, 1.3],
          "text-optional": true,
        },
        paint: {
          "text-color": ["case", model, c.depth, c.ink],
          "text-halo-color": c.paper,
          "text-halo-width": 1.5,
        },
      } as LayerSpecification,
      // Under the place names, over the sea's tints, contours and foil.
      map.getLayer("places") ? "places" : undefined,
    );
  }
  map.setLayoutProperty(CURRENTS_LAYER, "visibility", "visible");
}

/** Hide the layer; its source stays for the next time it is turned on. */
export function hideCurrents(map: MapLibreMap) {
  if (map.getLayer(CURRENTS_LAYER))
    map.setLayoutProperty(CURRENTS_LAYER, "visibility", "none");
}
