/**
 * A phone's dock as a bottom sheet: where a drag on it comes to rest. The
 * sheet has three heights: "peek", its head alone (the spot's name and its
 * tools), "half", the hours and the wind under them, and "full", with the
 * waves, sky, air and rain rows as well. Pulled down from peek it closes.
 *
 * Pure, so the thresholds are tested without a finger (sheetSnap.test.ts);
 * ForecastDock reads the pointer and moves the sheet.
 */
export type Snap = "peek" | "half" | "full";
export const SNAPS: readonly Snap[] = ["peek", "half", "full"];

/** How far a pointer moves before it is a drag rather than a tap, in px. */
export const SLOP = 8;
/** A release faster than this, px per ms, is a fling: one snap its way. */
export const FLING = 0.5;
/** How far past peek, in px, the sheet is pulled down to close it. */
export const CLOSE_PULL = 56;
/** How far ahead a slow release is carried, in ms of its own speed. */
const CARRY = 150;

/**
 * Whether a move that has gone past the slop is the sheet's: mostly up or
 * down. A sideways one is the hours' own scroll, which the browser has.
 */
export const isSheetDrag = (dx: number, dy: number) =>
  Math.hypot(dx, dy) >= SLOP && Math.abs(dy) > Math.abs(dx);

/**
 * The snap a released drag goes to. `dy` is how far the finger moved down
 * since it came down (up is negative), `velocity` its speed down at the
 * release in px per ms, `heights` the sheet's height at each snap.
 *
 * A fling moves one snap in its direction, whatever the distance: a flick
 * is as good as a long pull. Anything slower goes to the snap nearest where
 * the sheet would coast to. Only from peek does a pull down close the dock,
 * so a fling down from the hours tucks them away rather than losing the spot.
 */
export function settle(
  from: Snap,
  dy: number,
  velocity: number,
  heights: Readonly<Record<Snap, number>>,
): Snap | "close" {
  const at = SNAPS.indexOf(from);
  if (Math.abs(velocity) >= FLING && Math.sign(velocity) === Math.sign(dy)) {
    if (velocity > 0) return at === 0 ? "close" : SNAPS[at - 1];
    return SNAPS[Math.min(SNAPS.length - 1, at + 1)];
  }
  if (from === "peek" && dy >= CLOSE_PULL) return "close";
  const height = heights[from] - (dy + velocity * CARRY);
  let best: Snap = from;
  for (const snap of SNAPS)
    if (Math.abs(heights[snap] - height) < Math.abs(heights[best] - height))
      best = snap;
  return best;
}

/** One snap up or down from `from`, for the handle's arrow keys. */
export const step = (from: Snap, by: 1 | -1): Snap =>
  SNAPS[Math.max(0, Math.min(SNAPS.length - 1, SNAPS.indexOf(from) + by))];

/**
 * How far the sheet follows a finger: all the way between its snaps, and a
 * quarter as far past the last one each way, as if on elastic. `up` and
 * `down` are the room there is each way from where it started.
 */
export function follow(dy: number, up: number, down: number): number {
  if (dy < -up) return -up + (dy + up) * 0.25;
  if (dy > down) return down + (dy - down) * 0.25;
  return dy;
}

/** A finger's speed down, in px per ms, over its last moves. */
export function speed(samples: readonly { t: number; y: number }[]): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  // The moves in the last 100 ms: a finger held still before it lets go has
  // no speed, however fast it came.
  const first = samples.find((s) => last.t - s.t <= 100) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}
