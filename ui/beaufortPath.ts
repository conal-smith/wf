/*
 * A force as the old charts drew it: a short staff with feathers at its top, a
 * half feather for each force, whole feathers first from the tip (Force 5 is
 * two whole and a half). Past Force 9 the feathers would run down the whole
 * staff, so Force 10 is a pennant, as the charts drew ten: Force 11 a pennant
 * and a half, Force 12 a pennant and a whole. Force 0 is the bare staff.
 *
 * Geometry only, in pixels of a box `height` tall: the kit's BeaufortGlyph
 * draws it in React, the map's loupe (force5/src/WindMap.tsx) in its own SVG.
 * Strokes and the pennant's fill are currentColor's, so a red gust is drawn
 * red.
 */
export interface BeaufortDrawing {
  /** The box: draw in `0 0 width height`. */
  width: number;
  height: number;
  /** The staff and the feathers, stroked. */
  stroke: string;
  /** The pennant, filled (and stroked, so its corners match the feathers'). Empty below Force 10. */
  fill: string;
  strokeWidth: number;
}

const r = (n: number) => Math.round(n * 100) / 100;

export function beaufortPath(force: number, height = 14): BeaufortDrawing {
  const f = Math.min(12, Math.max(0, Math.round(force)));
  const h = height;
  // Thinner at the table's 10px, where the feathers stand closest.
  const strokeWidth = h > 16 ? 1.8 : h >= 13 ? 1.4 : 1.15;
  const width = r(h * 0.72);
  const x = r(strokeWidth / 2 + 0.6);
  const full = width - x - strokeWidth / 2;
  const half = full * 0.55;
  // A feather rises as it leaves the staff, like a flag blown out.
  const rise = h * 0.15;
  // Never closer than a stroke and a hair, so they stay apart at 10px.
  const step = Math.max(h * 0.17, strokeWidth + 0.65);
  const top = r(rise + strokeWidth / 2);
  let stroke = `M${x} ${r(h - strokeWidth / 2)}V${top}`;
  let fill = "";
  let y = top;
  let left = f;
  if (left >= 10) {
    // The pennant: a flag from the tip, as deep as two feathers' spacing.
    const deep = step * 1.5;
    fill = `M${x} ${r(y)}L${r(x + full)} ${r(y - rise)}L${x} ${r(y + deep)}Z`;
    y += deep + step * 0.6;
    left -= 10;
  }
  for (let i = 0; i < Math.floor(left / 2); i++, y += step)
    stroke += `M${x} ${r(y)}l${r(full)} ${r(-rise)}`;
  if (left % 2) {
    // A lone half feather stands a little down from the tip, as the charts set it.
    if (f === 1) y += step * 0.6;
    stroke += `M${x} ${r(y)}l${r(half)} ${r(-rise * 0.6)}`;
  }
  return { width, height: h, stroke, fill, strokeWidth };
}
