/**
 * The chart's marks as signed-distance images, so MapLibre can draw every
 * light's arrow, dashed ring and strike in any colour (`icon-color`) from one
 * image each, on the GPU: the site's light (force5/src/lights.ts, src/map.css)
 * drawn in its own 60-unit box, the pen's loop, the tapped point's mark, and
 * the wind's arrow.
 *
 * Each image is white with its alpha the distance to the shape's edge, as
 * MapLibre's own glyphs are (TinySDF: 255 at the centre of a stroke, 191 on
 * its edge, an eighth less per pixel out). Made once, in a few milliseconds.
 */
import { pngDataUri } from "./png";

type Point = readonly [number, number];

export type Shape =
  /** A stroked polyline with round caps and joins. */
  | { kind: "stroke"; points: readonly Point[]; width: number }
  /** A filled polygon. */
  | { kind: "fill"; points: readonly Point[] }
  /** A dashed ring round the centre: `dash` on, `space` off, in units along it. */
  | { kind: "ring"; r: number; width: number; dash?: number; space?: number };

const RADIUS = 8;
const CUTOFF = 0.25;

function segmentDistance(px: number, py: number, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function insidePolygon(px: number, py: number, points: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance, in units, from a point to a shape: negative inside. */
export function shapeDistance(shape: Shape, x: number, y: number): number {
  if (shape.kind === "stroke") {
    let d = Infinity;
    for (let i = 1; i < shape.points.length; i++)
      d = Math.min(d, segmentDistance(x, y, shape.points[i - 1], shape.points[i]));
    if (shape.points.length === 1) d = Math.hypot(x - shape.points[0][0], y - shape.points[0][1]);
    return d - shape.width / 2;
  }
  if (shape.kind === "fill") {
    let d = Infinity;
    for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++)
      d = Math.min(d, segmentDistance(x, y, shape.points[j], shape.points[i]));
    return insidePolygon(x, y, shape.points) ? -d : d;
  }
  const { r, width, dash, space: gap } = shape;
  const radial = Math.abs(Math.hypot(x, y) - r);
  if (!dash || !gap) return radial - width / 2;
  // Whole dashes round the ring, as near the asked-for lengths as fit.
  const around = 2 * Math.PI * r;
  const n = Math.max(1, Math.round(around / (dash + gap)));
  const period = around / n;
  const on = (dash / (dash + gap)) * period;
  let s = Math.atan2(y, x) * r;
  s = ((s % period) + period) % period;
  if (s <= on) return radial - width / 2;
  // Past a dash: the nearer of the two ends round it.
  const angle = Math.atan2(y, x);
  const start = angle - s / r;
  const ends = [start + on / r, start + period / r];
  let d = Infinity;
  for (const a of ends) d = Math.min(d, Math.hypot(x - r * Math.cos(a), y - r * Math.sin(a)));
  return d - width / 2;
}

/** The SDF image's RGBA, `size` units square at `scale` pixels a unit, centred on 0, 0. */
export function sdfPixels(shapes: readonly Shape[], size: number, scale: number): Uint8Array {
  const px = Math.round(size * scale);
  const out = new Uint8Array(px * px * 4);
  for (let j = 0; j < px; j++)
    for (let i = 0; i < px; i++) {
      const x = (i + 0.5) / scale - size / 2;
      const y = (j + 0.5) / scale - size / 2;
      let d = Infinity;
      for (const shape of shapes) d = Math.min(d, shapeDistance(shape, x, y));
      const value = 255 - 255 * ((d * scale) / RADIUS + CUTOFF);
      const o = (j * px + i) * 4;
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = Math.max(0, Math.min(255, Math.round(value)));
    }
  return out;
}

/* ---- the marks ---------------------------------------------------------- */

/** The light's box, as the site's SVG viewBox (60 units, the ring's centre at 0, 0). */
export const LIGHT_BOX = 48;

/** The arrow blowing downwind, drawn pointing up (lights.ts LIGHT_SVG). */
export const ARROW: Shape[] = [
  {
    kind: "stroke",
    width: 1.7,
    points: [
      [0, -9.6],
      [0, -20.5],
    ],
  },
  {
    kind: "stroke",
    width: 1.7,
    points: [
      [-3.4, -16.6],
      [0, -21],
      [3.4, -16.6],
    ],
  },
];

/** The ring at no stars: dashed (src/map.css `stroke-dasharray: 2 1.6`). */
export const RING_DASHED: Shape[] = [{ kind: "ring", r: 7.6, width: 1.1, dash: 2, space: 1.6 }];
/** The ring not yet rated: dotted (`1 2`). */
export const RING_DOTTED: Shape[] = [{ kind: "ring", r: 7.6, width: 1.1, dash: 1, space: 2 }];

/** The pen's strike through an offshore light. */
export const STRIKE: Shape[] = [
  {
    kind: "stroke",
    width: 1.6,
    points: [
      [-5.6, 5.6],
      [5.6, -5.6],
    ],
  },
];

/** The site's star (design-system/glyphs/star-*.svg) on its 12 box. */
export const STAR: Shape[] = [
  {
    kind: "fill",
    points: [
      [0, -5],
      [1.47, -2.02],
      [4.76, -1.55],
      [2.38, 0.77],
      [2.94, 4.05],
      [0, 2.5],
      [-2.94, 4.05],
      [-2.38, 0.77],
      [-4.76, -1.55],
      [-1.47, -2.02],
    ],
  },
];

/**
 * The pen's loop: an ellipse drawn once round by hand, a little past where it
 * started and a little out of round (ui/penPaths.ts `loopPath`, 24 × 18).
 */
export function loopShape(rx = 22, ry = 16.5, width = 2.2): Shape[] {
  const points: Point[] = [];
  const start = -Math.PI * 0.62;
  const sweep = Math.PI * 2.18;
  const steps = 72;
  for (let k = 0; k <= steps; k++) {
    const t = start + (sweep * k) / steps;
    const wobble = 1 + 0.045 * Math.sin(3 * t + 0.8) + 0.07 * (k / steps);
    points.push([rx * wobble * Math.cos(t), ry * wobble * Math.sin(t) - 1.5 * (k / steps)]);
  }
  return [{ kind: "stroke", width, points }];
}

/** A point tapped on the open map: a ring with its cross (src/map.css `.pick-mark`). */
export const PICK: Shape[] = [
  { kind: "ring", r: 8.25, width: 1.5 },
  {
    kind: "stroke",
    width: 1.5,
    points: [
      [0, -9],
      [0, 9],
    ],
  },
  {
    kind: "stroke",
    width: 1.5,
    points: [
      [-9, 0],
      [9, 0],
    ],
  },
];

/** The wind, an arrow on the water pointing where it blows (drawn pointing up). */
export const WIND_ARROW: Shape[] = [
  {
    kind: "stroke",
    width: 1.5,
    points: [
      [0, 7.5],
      [0, -8],
    ],
  },
  {
    kind: "stroke",
    width: 1.5,
    points: [
      [-3, -4],
      [0, -8.4],
      [3, -4],
    ],
  },
];

export interface IconImage {
  source: { uri: string; scale: number };
  sdf: true;
}

const icon = (shapes: readonly Shape[], size: number, scale: number): IconImage => ({
  source: { uri: pngDataUri(Math.round(size * scale), Math.round(size * scale), sdfPixels(shapes, size, scale)), scale },
  sdf: true,
});

let made: Record<string, IconImage> | null = null;

/** Every mark the chart draws, by the name its layers use. */
export function chartIcons(scale = 3): Record<string, IconImage> {
  if (made) return made;
  made = {
    "lt-arrow": icon(ARROW, LIGHT_BOX, scale),
    "lt-dash": icon(RING_DASHED, 20, scale),
    "lt-dot": icon(RING_DOTTED, 20, scale),
    "lt-strike": icon(STRIKE, 16, scale),
    "lt-star": icon(STAR, 12, scale),
    "pen-loop": icon(loopShape(), 56, 2),
    "pick-mark": icon(PICK, 24, scale),
    "wind-arrow": icon(WIND_ARROW, 20, scale),
  };
  return made;
}
