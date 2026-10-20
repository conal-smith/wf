/**
 * Which light a tap or a click meant. A light's button reaches past its ring
 * (`.lt::before`, src/map.css: 44 px across on a touch screen, as Apple's and
 * Google's guides ask), so on a busy coast the reach of several lights
 * overlaps. The one on top is whichever the page happened to draw last; the
 * one meant is the nearest, so that is the one chosen.
 */
export interface LightCentre {
  id: string;
  x: number;
  y: number;
}

/**
 * The light nearest `(x, y)` among those within `reach` pixels of it, or
 * null where none is.
 */
export function nearestLight(
  lights: Iterable<LightCentre>,
  x: number,
  y: number,
  reach: number,
): string | null {
  let best: string | null = null;
  let bestD = reach;
  for (const light of lights) {
    const d = Math.hypot(light.x - x, light.y - y);
    if (d <= bestD) {
      best = light.id;
      bestD = d;
    }
  }
  return best;
}
