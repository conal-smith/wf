/**
 * The red pen's strokes, as path data: pure geometry, so an SVG anywhere can
 * draw them — the kit's `PenUnderline` under a word and `PenStrike` through
 * what is off.
 */

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
