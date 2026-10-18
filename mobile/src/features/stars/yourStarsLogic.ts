/**
 * "Your star rating" under a finger: which handle or dot a touch takes, where
 * on a scale or the web it is, and which square of the grid. The rating's own
 * arithmetic, the units and the web's geometry are the site's
 * (spot/web/yourStars.ts, force5/src/stars.ts); this is only the touch.
 */
import type { CustomRating, DirectionKey } from "../../../../force5/src/stars";
import {
  GUST_TOP,
  WEB_DIRS,
  WIND_TOP,
  knotsOf,
  polar,
  webRadius,
  type UnitScale,
} from "../../../../spot/web/yourStars";

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));

/** Knots at `x` points along a scale `width` wide that ends at `top` knots, snapped to the rider's unit. */
export function knAtX(x: number, width: number, top: number, unit: UnitScale): number {
  if (width <= 0) return 0;
  return knotsOf(clamp(x / width, 0, 1) * top * unit.perKn, unit);
}

/**
 * The handle a drag takes: the nearest to where the finger went down. Handles
 * a finger cannot tell apart (within `tieKn` of the nearest) go by the way it
 * moves: right takes the upper one, left the lower, so two handles side by
 * side can always be pulled apart.
 */
export function grabHandle<K extends string>(
  keys: readonly K[],
  values: Record<K, number>,
  kn: number,
  dx: number,
  tieKn: number,
): K {
  const dist = (k: K) => Math.abs(values[k] - kn);
  const nearest = keys.reduce((best, k) => (dist(k) < dist(best) ? k : best), keys[0]);
  const ties = keys.filter((k) => dist(k) <= dist(nearest) + tieKn);
  if (ties.length < 2 || dx === 0) return nearest;
  return dx > 0 ? ties[ties.length - 1] : ties[0];
}

/**
 * The direction whose dot is under (x, y), in the web's units, within `reach`:
 * the picked direction first, since its dot is drawn on top, then the nearest.
 */
export function dotAt(
  x: number,
  y: number,
  off: CustomRating["direction"],
  picked: DirectionKey,
  reach: number,
): DirectionKey | null {
  const hits = WEB_DIRS.flatMap((d) =>
    d.at.map((a) => {
      const [dx, dy] = polar(a, webRadius(off[d.key]));
      return { key: d.key, dist: Math.hypot(x - dx, y - dy) };
    }),
  )
    .filter((h) => h.dist <= reach)
    .sort((a, b) => Number(b.key === picked) - Number(a.key === picked) || a.dist - b.dist);
  return hits[0]?.key ?? null;
}

/** The "Together" grid's frame, in its own units (spot/web/YourStarsDialog.tsx). */
export const GRID = { left: 30, width: 360, height: 230 } as const;

/** The hour a tap on the grid reads: whole knots, the gust never under the wind. */
export function gridPick(x: number, y: number): [number, number] {
  const { left, width, height } = GRID;
  const windKn = clamp(((x - left) / width) * WIND_TOP, 0, WIND_TOP - 0.01);
  const gustKn = clamp(((height - y) / height) * GUST_TOP, 0, GUST_TOP - 0.01);
  return [Math.round(windKn), Math.max(Math.round(gustKn), Math.round(windKn))];
}
