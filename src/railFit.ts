/** A box on the screen, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How tall the layers' rail may stand, from its top, and stay clear of what
 * is below it on the chart: the spot's tools on the dock's edge, the dock,
 * Gust, the foot of the window. Only what shares its column counts (the
 * dock's tools stand at the right, as the rail does; the small print at the
 * left does not). Clear by `gap`, so the two never touch.
 */
export function railRoom(
  rail: Box,
  below: readonly Box[],
  windowHeight: number,
  gap: number,
): number {
  let floor = windowHeight;
  for (const box of below) {
    const beside = box.right > rail.left && box.left < rail.right;
    if (beside && box.top > rail.top) floor = Math.min(floor, box.top);
  }
  return Math.max(0, floor - gap - rail.top);
}

/** Whether the rail, at its full height, stands clear of what is below it. */
export function railFits(
  rail: Box,
  below: readonly Box[],
  windowHeight: number,
  gap: number,
): boolean {
  return rail.bottom - rail.top <= railRoom(rail, below, windowHeight, gap);
}
