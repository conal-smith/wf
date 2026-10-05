# StarGlyphs

An hour's stars as the chart draws them (`ui/StarGlyphs.tsx`,
`starGlyphsStyles`): solid for what the hour is worth for this rider, an
outline for what the wind alone would give, and a dot for each of the five it
does not reach. The dark is not rated.

## Anatomy

- Root: `.wf-star-glyphs` — an inline SVG, `overflow: visible`, aligned to the
  middle, `size` px tall and `count × size + (count − 1) × gap` wide, where the
  gap is `max(1, floor(size / 6))`.
- Solid: `.wf-star-glyphs__solid` — the chart's five-point star (radius 5),
  translated to the slot's centre plus 0.4 down and scaled by `size / 10.4`,
  filled `currentColor`.
- Faded: `.wf-star-glyphs__faded` — the same star, outlined in
  `currentColor` at `0.95 / scale`, at `sem.opacity.faded`.
- Dot: `.wf-star-glyphs__dot` — a circle of `size × 0.07` at the slot's
  centre, filled `currentColor` at `sem.opacity.dot`.
- Geometry lives in the SVG; paint lives in the CSS.

## Variants

- Tone: none (the text's own colour), `--ink`, `--inverse`
  (`sem.color.ink-inverse`, on an ink fill: a selected column, a light),
  `--magenta` (`sem.color.chart-magenta`, the best of the week, once).
- Slots: five (the default, the chart's way) or potential (stops at the last
  outline, for a cell too narrow for five; the dark still takes five).
- Size: 9.5, 10 (the dock), 12 (the default), 14.

## States

- Stars 0 to 5, with the potential at or above them.
- The dark (`null`): an empty SVG of the same width, so a row of hours stays
  in line; its row is hatched (`sem.color.hatch`), never rated.

## Usage

- Draw stars with this, never with an icon set's stars.
- Shape carries the difference between solid and outline; tone only repeats
  it.
- Magenta for the one best, once a view.

## Accessibility

- `role="img"` with a label: "3 of 5 stars, 4 on the wind alone", or "Dark: not
  rated".
- The outline at half opacity is a mark beside a solid one, never the only
  carrier of a figure; the label says it in words.
