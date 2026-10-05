/**
 * When the film's words come and go, in seconds on the film's clock. The
 * shots themselves are in intro/scene/camera.ts; these follow them: the
 * letterbox opens as the camera turns to the sun, the name comes up over the
 * sunset, then the way in.
 */
export const TIMELINE = {
  skipFrom: 1.2,
  letterboxOpen: [22.5, 26.5],
  title: [24.2, 26.2],
  menu: [26.2, 27.6],
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => x * x * (3 - 2 * x);

/** 0 before the span, 1 after it, eased in between. */
export function progress([from, to]: readonly [number, number], t: number): number {
  return ease(clamp01((t - from) / (to - from)));
}
