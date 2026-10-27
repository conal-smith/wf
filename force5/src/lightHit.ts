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

/** An arrow key's way across the chart. */
export type Way = "left" | "right" | "up" | "down";

const WAYS: Record<Way, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * The light an arrow key goes to from `from`, as the keys walk the lights on
 * the screen: the nearest that way, a step straight along it counting for
 * less than one off to the side, so Right goes along the coast rather than
 * up it. Lights drawn on the same spot are taken in their order in `lights`,
 * Right and Down forward, Left and Up back. Null where there is none that
 * way.
 */
export function nextLight(
  lights: readonly LightCentre[],
  from: LightCentre,
  way: Way,
): string | null {
  const [wx, wy] = WAYS[way];
  const forward = wx + wy > 0;
  const at = lights.findIndex((light) => light.id === from.id);
  let best: string | null = null;
  let bestScore = Infinity;
  lights.forEach((light, i) => {
    if (light.id === from.id) return;
    const dx = light.x - from.x;
    const dy = light.y - from.y;
    const along = dx * wx + dy * wy;
    const across = Math.abs(dx * wy - dy * wx);
    // On the very spot: the next or the one before in the list's order.
    const same = !dx && !dy && (forward ? i > at : i < at);
    if (along <= 0 && !same) return;
    // Of the lights on the spot, the nearest in the list's order.
    const score = same ? Math.abs(i - at) / lights.length : along + 2 * across;
    if (score < bestScore) {
      best = light.id;
      bestScore = score;
    }
  });
  return best;
}
