/**
 * The red pen's strokes, as path data: pure geometry, so an SVG anywhere can
 * draw them — the kit's `PenLoop` round a word, the map's overlay round a spot
 * at its coordinates, the dock's round a run of hours.
 *
 * The loop is the chart mockup's (design/chart/chart-kit.js `loopPath`): a
 * wobbly closed ring that overshoots its own start the way a pen does, seeded
 * so the same mark is drawn the same way every time it is drawn.
 */

/** A seeded generator in [0, 1): the same seed gives the same hand. */
function hand(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/**
 * A hand-drawn loop round (cx, cy) with radii rx and ry, in user units.
 * It runs a little past a full turn and grows a little as it goes, so its end
 * crosses its start rather than meeting it.
 */
export function loopPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed = 1,
): string {
  const rnd = hand(seed);
  const start = rnd() * Math.PI * 2;
  const turns = 1.12 + rnd() * 0.1;
  const steps = 48;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = start + (i / steps) * turns * Math.PI * 2;
    const wob =
      1 + 0.06 * Math.sin(t * 3 + seed) + 0.03 * Math.sin(t * 7 + seed * 2);
    const grow = 1 + 0.08 * (i / steps);
    const x = cx + Math.cos(t) * rx * wob * grow;
    const y = cy + Math.sin(t) * ry * wob * grow - (i / steps) * ry * 0.08;
    d += (i ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  return d;
}

/** A quick underline from (x, y), `width` long, bowed up a little in the middle. */
export function underlinePath(x: number, y: number, width: number): string {
  return `M${x.toFixed(1)} ${y.toFixed(1)} q${(width / 2).toFixed(1)} -4 ${width.toFixed(1)} 1`;
}

/** A stroke through a box of `width` by `height`, rising left to right. */
export function strikePath(width: number, height: number): string {
  const x0 = width * 0.04;
  const x1 = width * 0.96;
  return `M${x0.toFixed(1)} ${(height * 0.72).toFixed(1)} L${x1.toFixed(1)} ${(height * 0.3).toFixed(1)}`;
}
