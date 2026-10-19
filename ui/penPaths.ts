/**
 * The red pen's strokes, as path data: pure geometry, so an SVG anywhere can
 * draw them — the kit's `PenLoop` round a word, the map's overlay round a spot
 * at its coordinates, the dock's frame round the chosen hour and its line at
 * the time now.
 *
 * The loop is the chart mockup's (design/chart/chart-kit.js `loopPath`): a
 * wobbly closed ring that overshoots its own start the way a pen does, seeded
 * so the same mark is drawn the same way every time it is drawn.
 */

/** A seeded generator in [0, 1): the same seed gives the same hand. */
export function hand(seed: number): () => number {
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

/** A box the pen lifts over rather than cross: a figure, a glyph, a label. */
export interface KeepOut {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A hand-drawn rounded rectangle on the box (x, y, w, h), corner radius r:
 * the dock's frame round the chosen hour. It starts on the top edge left of
 * the middle and goes round clockwise riding the box's line, never more than
 * 0.7 px inside it so it hides nothing in the box, drifting a little outward
 * as it goes; it runs on past its start, so its end crosses its start the way
 * a pen's does. Where it would cross a box in `keepOut` the pen lifts, and
 * comes down again on the far side.
 */
export function framePath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  seed = 1,
  keepOut: readonly KeepOut[] = [],
): string {
  const rnd = hand(seed);
  r = Math.max(0.1, Math.min(r, w / 2, h / 2));
  const sw = w - 2 * r;
  const sh = h - 2 * r;
  const q = (Math.PI * r) / 2;
  const P = 2 * sw + 2 * sh + 4 * q;
  // A point on the box's outline at distance s round it, with its outward normal.
  const arc = (cx: number, cy: number, a: number) => [
    cx + Math.cos(a) * r,
    cy + Math.sin(a) * r,
    Math.cos(a),
    Math.sin(a),
  ];
  const at = (s: number): number[] => {
    s = ((s % P) + P) % P;
    if (s < sw) return [x + r + s, y, 0, -1];
    s -= sw;
    if (s < q) return arc(x + w - r, y + r, -Math.PI / 2 + s / r);
    s -= q;
    if (s < sh) return [x + w, y + r + s, 1, 0];
    s -= sh;
    if (s < q) return arc(x + w - r, y + h - r, s / r);
    s -= q;
    if (s < sw) return [x + w - r - s, y + h, 0, 1];
    s -= sw;
    if (s < q) return arc(x + r, y + h - r, Math.PI / 2 + s / r);
    s -= q;
    if (s < sh) return [x, y + h - r - s, -1, 0];
    s -= sh;
    return arc(x + r, y + r, Math.PI + s / r);
  };
  const start = (0.12 + rnd() * 0.3) * sw;
  const total = P + 9 + rnd() * 7;
  const k1 = (2 * Math.PI) / (70 + rnd() * 50);
  const k2 = (2 * Math.PI) / (18 + rnd() * 9);
  const p1 = rnd() * 6.283;
  const p2 = rnd() * 6.283;
  const grow = 1.1 + rnd() * 0.7;
  const lean = (rnd() - 0.5) * 2.4;
  const n = Math.ceil(total / 2.5);
  const inside = (px: number, py: number) =>
    keepOut.some(
      (k) => px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h,
    );
  let d = "";
  let down = false;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    let off =
      0.85 * Math.sin(k1 * s + p1) +
      0.35 * Math.sin(k2 * s + p2) +
      grow * (s / total);
    if (s < 6) off -= 0.5 * (1 - s / 6); // the pen lands
    if (total - s < 7) off += 1.2 * Math.pow(1 - (total - s) / 7, 2); // and lifts
    off = Math.max(-0.7, Math.min(2.8, off));
    const [px, py, nx, ny] = at(start + s);
    const lx = lean * ((py - y) / h - 0.5);
    const qx = px + nx * off + lx;
    const qy = py + ny * off;
    if (inside(qx, qy)) {
      down = false;
      continue;
    }
    d += `${down ? " L" : " M"}${qx.toFixed(1)} ${qy.toFixed(1)}`;
    down = true;
  }
  return d.trim();
}

/**
 * A line drawn down the page by hand from (x, y0) to y1: it wanders a pixel
 * either side of true and leans a little, as a ruled line drawn without a
 * ruler does.
 */
export function stemPath(x: number, y0: number, y1: number, seed = 1): string {
  const rnd = hand(seed);
  const len = y1 - y0;
  const lean = (rnd() - 0.5) * 1.6;
  const k1 = (2 * Math.PI) / (60 + rnd() * 40);
  const k2 = (2 * Math.PI) / (17 + rnd() * 8);
  const p1 = rnd() * 6.283;
  const p2 = rnd() * 6.283;
  const n = Math.max(2, Math.ceil(len / 4));
  let d = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const yy = y0 + t * len;
    const dx =
      0.7 * Math.sin(k1 * t * len + p1) +
      0.25 * Math.sin(k2 * t * len + p2) +
      lean * (t - 0.5);
    d += `${i ? " L" : "M"}${(x + dx).toFixed(1)} ${yy.toFixed(1)}`;
  }
  return d;
}

/**
 * A small pen arrow coming down to its tip at (tx, ty) from up and to one
 * side (+1 right, -1 left), `reach` across, with where it starts: the words
 * it points from go there.
 */
export function arrowPath(
  tx: number,
  ty: number,
  side: 1 | -1,
  seed = 1,
  reach = 16,
): { d: string; from: { x: number; y: number } } {
  const rnd = hand(seed);
  const sx = tx + side * (reach - 1 + rnd() * 3);
  const sy = ty - 9 - rnd() * 1.5;
  const cx = tx + side * (3 + rnd() * 2);
  const cy = sy + 1 + rnd() * 2;
  const a = Math.atan2(ty - cy, tx - cx);
  const hl = 4.6;
  const spread = 0.5 + rnd() * 0.12;
  const h1 = [
    tx + Math.cos(a + Math.PI - spread) * hl,
    ty + Math.sin(a + Math.PI - spread) * hl,
  ];
  const h2 = [
    tx + Math.cos(a + Math.PI + spread) * (hl - 0.8),
    ty + Math.sin(a + Math.PI + spread) * (hl - 0.8),
  ];
  const f = (v: number) => v.toFixed(1);
  return {
    d: `M${f(sx)} ${f(sy)} Q${f(cx)} ${f(cy)} ${f(tx)} ${f(ty)} M${f(h1[0])} ${f(h1[1])} L${f(tx)} ${f(ty)} L${f(h2[0])} ${f(h2[1])}`,
    from: { x: sx, y: sy },
  };
}
