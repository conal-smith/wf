/**
 * The wind on the chart, in two layers, each on or off by itself, as the site
 * draws it (force5/src/windLayer.ts):
 *
 *   wash       the coloured wind: the wind scale as a wash over the sea
 *   particles  lines in ink drifting with the forecast, light air thin and
 *              pale, a breeze bolder; with Reduce Motion on, still arrows in
 *              ink instead
 *
 * Either, both or neither: the particles read over the colour. The coloured
 * wind draws no lines of its own.
 *
 * Everything here is arithmetic over a sampler (`TiledField.sample`), so the
 * screen's field, the still arrows' grid and the wash's pixels are tested in
 * Node. The lines themselves move in particleSim.ts, on the UI thread.
 */
import type { Feature, FeatureCollection, Point } from "geojson";
import { WASH_STEP } from "../../../../force5/src/tiledField";
import { KNOTS } from "../../../../force5/src/units";
import { direction, windColor, type Grid, type Wind } from "../../../../force5/src/weather";
import { parseWindLayers, type WindLayers } from "../../../../force5/src/windLayers";
import { metresPerPoint, OLD_WIND_KEY, unproject, WIND_KEY, type Camera } from "./mapLogic";

export { DEFAULT_WIND, type WindLayers } from "../../../../force5/src/windLayers";

/** The wind's two layers in the order the layers sheet shows them, with its words (src/layerGroups.tsx). */
export const WIND_LAYERS: readonly { key: keyof WindLayers; name: string; sub: string }[] = [
  { key: "wash", name: "Coloured wind", sub: "Speed as colour" },
  { key: "particles", name: "Particles", sub: "Lines moving with it" },
];

/**
 * The rider's wind from the store (src/App.tsx): the two layers as saved, or
 * else the one style an older app kept read into them (ink the particles
 * alone, the coloured wind the colour alone, the arrows both), or else the
 * particles alone. The older value is left where it is; once a layer is
 * switched, the new key wins.
 */
export const readWind = (store: { get(key: string): string | null }): WindLayers =>
  parseWindLayers(store.get(WIND_KEY), store.get(OLD_WIND_KEY));

/** One of the two layers switched, the other as it was. */
export const switchWind = (wind: WindLayers, key: keyof WindLayers, on: boolean): WindLayers => ({ ...wind, [key]: on });

/** The zoom where the depths take over: the wash has faded out by here, and the tints are read instead. */
export const DEPTHS_ZOOM = 11;
export const WASH_FADE = 0.5;
const WASH_SEA = 0.72;
const WASH_LAND = 0.42;
const WASH_UNKNOWN = 0.55;

export type Sampler = (lat: number, lon: number) => Wind | null;

export const hexOf = (rgb: readonly number[]) =>
  `#${((1 << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]).toString(16).slice(1)}`;

/* ---- the field the lines drift on ---------------------------------------- */

/** Points a line moves per step per m/s at a zoom, so lines move at a pace that reads. */
export function paceOf(lat: number, zoom: number): number {
  return 18 / Math.max(metresPerPoint(lat, zoom), 1) ** 0.35 / 30;
}

/** The forecast resampled for the screen: u, v as points a step, and the speed, every `step` points. */
export interface ScreenField {
  w: number;
  h: number;
  step: number;
  /** u, v, speed (m/s) per node, row by row; NaN u where there is no wind. */
  data: number[];
}

export function screenField(camera: Camera, sample: Sampler, step = 10): ScreenField {
  const w = Math.ceil(camera.width / step) + 1;
  const h = Math.ceil(camera.height / step) + 1;
  const k = paceOf(camera.center[1], camera.zoom);
  const data = new Array<number>(w * h * 3).fill(NaN);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [lon, lat] = unproject(camera, x * step, y * step);
      const wind = sample(lat, lon);
      if (!wind || !Number.isFinite(wind.u + wind.v)) continue;
      const i = (y * w + x) * 3;
      data[i] = wind.u * k;
      data[i + 1] = -wind.v * k;
      data[i + 2] = Math.hypot(wind.u, wind.v);
    }
  return { w, h, step, data };
}

/* ---- the still arrows ----------------------------------------------------- */

export interface ArrowProps {
  /** The bearing it points to, downwind. */
  rot: number;
  kn: number;
}

/**
 * Reduce Motion's stand-in for the particles: arrows in ink on a grid over
 * the view and a quarter of it past each edge, `gap` points apart, each
 * pointing downwind, sized by its speed.
 */
export function arrowGrid(camera: Camera, sample: Sampler, gap = 46): FeatureCollection<Point, ArrowProps> {
  const features: Feature<Point, ArrowProps>[] = [];
  const mx = camera.width / 4;
  const my = camera.height / 4;
  for (let y = -my + gap / 2; y < camera.height + my; y += gap)
    for (let x = -mx + gap / 2; x < camera.width + mx; x += gap) {
      // Every other row offset half a gap: a field of arrows, not a grid of them.
      const sx = x + (Math.round((y + my) / gap) % 2 ? gap / 2 : 0);
      const [lon, lat] = unproject(camera, sx, y);
      const wind = sample(lat, lon);
      if (!wind || !Number.isFinite(wind.u + wind.v)) continue;
      const ms = Math.hypot(wind.u, wind.v);
      if (ms < 0.3) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          rot: Math.round((direction(wind.u, wind.v) + 180) % 360),
          kn: Math.round(ms * KNOTS),
        },
      });
    }
  return { type: "FeatureCollection", features };
}

/* ---- the wash ------------------------------------------------------------- */

export interface WashImage {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** The corners, [lon, lat]: top left, top right, bottom right, bottom left. */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** The wash's box: the view and a third of it past each edge, in pixels of `step` points. */
export function washBox(camera: Camera, step = WASH_STEP) {
  const mx = camera.width / 3;
  const my = camera.height / 3;
  const [west, north] = unproject(camera, -mx, -my);
  const [east, south] = unproject(camera, camera.width + mx, camera.height + my);
  const width = Math.max(2, Math.round((camera.width + 2 * mx) / step));
  const height = Math.max(2, Math.round((camera.height + 2 * my) / step));
  const yN = merc(north);
  const yS = merc(south);
  const toPixel = (lon: number, lat: number): [number, number] => [
    ((lon - west) / (east - west)) * width,
    ((yN - merc(lat)) / (yN - yS)) * height,
  ];
  return { west, north, east, south, width, height, yN, yS, toPixel };
}

/** The wash's colours, one per half knot up to the wind scale's last stop. */
const WASH_LUT = Array.from({ length: 131 }, (_, i) => windColor(i / 2));

/**
 * The wind scale painted over the box, a pixel per `step` points: over the
 * sea (`sea`, the basemap's water drawn into the same pixels) strongly, over
 * land faintly, and where the water is not known in between; the model's own
 * edge feathered rather than cut (windLayer.ts `paintWash`).
 */
export function washImage(
  camera: Camera,
  sample: Sampler,
  grid: Pick<Grid, "west" | "east" | "north" | "south" | "dx" | "dy">,
  sea: Uint8Array | null,
  step = WASH_STEP,
): WashImage {
  const box = washBox(camera, step);
  const { width: w, height: h, west, east, north, south, yN, yS } = box;
  const rgba = new Uint8Array(w * h * 4);
  const feather = Math.max(grid.dx, grid.dy) * 6;
  for (let y = 0; y < h; y++) {
    const lat = (2 * Math.atan(Math.exp(yN + ((yS - yN) * (y + 0.5)) / h)) - Math.PI / 2) * (180 / Math.PI);
    for (let x = 0; x < w; x++) {
      const lon = west + ((east - west) * (x + 0.5)) / w;
      const wind = sample(lat, lon);
      if (!wind) continue;
      const kn = Math.hypot(wind.u, wind.v) * KNOTS;
      const rgb = WASH_LUT[Math.min(WASH_LUT.length - 1, Math.max(0, Math.round(kn * 2)))];
      const edge = Math.max(
        0,
        Math.min(1, (lon - grid.west) / feather, (grid.east - lon) / feather, (lat - grid.south) / feather, (grid.north - lat) / feather),
      );
      const i = y * w + x;
      const alpha = (sea ? (sea[i] ? WASH_SEA : WASH_LAND) : WASH_UNKNOWN) * edge;
      rgba[i * 4] = rgb[0];
      rgba[i * 4 + 1] = rgb[1];
      rgba[i * 4 + 2] = rgb[2];
      rgba[i * 4 + 3] = Math.round(alpha * 255);
    }
  }
  return {
    width: w,
    height: h,
    rgba,
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

type Ring = readonly (readonly number[])[];
type WaterGeometry =
  | { type: "Polygon"; coordinates: readonly Ring[] }
  | { type: "MultiPolygon"; coordinates: readonly (readonly Ring[])[] };

/**
 * The basemap's water polygons drawn into a `w` × `h` mask (1 sea, 0 not),
 * non-zero winding so neighbouring tiles' overlapping buffers stay sea. One
 * scanline per pixel row, through each pixel's centre.
 */
export function waterMask(
  geometries: readonly { type: string; coordinates?: unknown }[],
  w: number,
  h: number,
  toPixel: (lon: number, lat: number) => [number, number],
): Uint8Array | null {
  const edges: number[] = []; // x0, y0, x1, y1 per edge
  for (const g of geometries) {
    const geometry = g as WaterGeometry;
    const polygons =
      geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const polygon of polygons)
      for (const ring of polygon) {
        let prev: [number, number] | null = null;
        for (const point of ring) {
          const p = toPixel(point[0], point[1]);
          if (prev) edges.push(prev[0], prev[1], p[0], p[1]);
          prev = p;
        }
      }
  }
  if (!edges.length) return null;
  const mask = new Uint8Array(w * h);
  const crossings: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    crossings.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const y0 = edges[e + 1];
      const y1 = edges[e + 3];
      if (y0 <= cy === y1 <= cy) continue;
      const t = (cy - y0) / (y1 - y0);
      crossings.push([edges[e] + t * (edges[e + 2] - edges[e]), y1 > y0 ? 1 : -1]);
    }
    crossings.sort((a, b) => a[0] - b[0]);
    let winding = 0;
    for (let c = 0; c < crossings.length; c++) {
      const before = winding;
      winding += crossings[c][1];
      if (before === 0 && winding !== 0) {
        const start = crossings[c][0];
        let end = w;
        for (let d = c + 1, wd = winding; d < crossings.length; d++) {
          wd += crossings[d][1];
          if (wd === 0) {
            end = crossings[d][0];
            break;
          }
        }
        const from = Math.max(0, Math.ceil(start - 0.5));
        const to = Math.min(w - 1, Math.floor(end - 0.5));
        for (let x = from; x <= to; x++) mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}
