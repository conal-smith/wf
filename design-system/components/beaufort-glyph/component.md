# BeaufortGlyph

A wind in Force (Beaufort) as the old charts drew it (`ui/BeaufortGlyph.tsx`,
`beaufortGlyphStyles`; its geometry is `ui/beaufortPath.ts`): a short staff
with feathers at its top, a half feather for each force, and the force's
number beside it so nobody has to count. Used wherever the rider's wind is
shown and they read it in Force.

## Anatomy

- Root: `.wf-beaufort-glyph`, an inline flex row, centred, 1px apart, aligned
  to the middle of the text it sits in.
- Glyph: `.wf-beaufort-glyph__glyph`, an SVG `0.72 × size` wide and `size`
  tall, `overflow: visible`.
- Staff: `.wf-beaufort-glyph__staff`, one stroked path in `currentColor`, round
  caps: the staff from the foot to the tip, then the feathers leaving it up
  and to the right, whole ones first from the tip, the half last.
- Pennant: `.wf-beaufort-glyph__pennant`, a filled triangle from the tip, for
  ten. Force 11 adds a half feather under it, 12 a whole one.
- Number: `.wf-beaufort-glyph__number`, the force in the text's own face, size
  and weight.

## Variants

- Size: 17 beside a table's figure (the spot page's hour rows, the level
  cards), 16 in the dock's wind cell, 14 the default, 10 for a gust written
  small after "g". The number is the text's size, not the glyph's.
- Bare: the glyph alone, where the number is written beside it already.
- Force 0 is the bare staff; 1 a half feather set a little down from the tip,
  as the charts set it; 10 to 12 fly the pennant.

## States

- None of its own. It is `currentColor`: in a gust in the pen's ink (the
  wind figure's alarm) it is red; on an ink fill it is paper.

## Usage

- Draw a wind in Force with this wherever a figure stands: the dock's cell,
  the spot page's rows, the loupe's foot box (the map draws `beaufortPath` in
  its own SVG), the wizard's preview and handles.
- Where only text fits, write it: "Force 5" in words and for a screen reader,
  "F5" in a line of figures (a map light's label, a tooltip's line).
- A scale has no forces to draw along: a chart's axis, a range ring, a tidal
  stream read Force in knots, and a scale's ticks stand where each force
  starts, named by its number.
- The feathers are the old notation, not a wind barb: never draw a knot barb
  (a feather for ten knots) with it.

## Accessibility

- The root carries `role="img"` and `aria-label="Force 5"`; the SVG and the
  number are `aria-hidden`. An empty label hides it all, for a place whose
  words already say the force.
- The number carries the reading; the feathers repeat it. Colour carries
  nothing of its own.
