# Wind figure

The wind and its gust, as the site writes them: `12²¹ ↗ WSW` on the spot
page, `14 g22` in the dock, `→ 13 g26 W · 6.5 m` in the popup. It is
`ui/Figure.tsx` (value, sup, unit, alarm) with the mockup's downwind arrow
and compass point beside it.

## Anatomy

- Container: `.wf-wind-figure`, an inline flex row in mono with tabular
  digits, baseline-aligned, `sem.space.x0-5` apart (Figure's `gap-0.5`).
- `__value`: the mean knots. Figure size md: the `figure` step (19, semibold,
  tracked -0.02em).
- `__sup`: the gust, raised (aligned to the top) at the `caption` step,
  medium, `ink-muted`. Figure's `sup`.
- `__unit`: a small word after a figure at `caption`, `ink-muted`.
- `__dir`: the downwind arrow (`__arrow`, the mockup's arrowSVG on viewBox
  -7 -7 14 14, turned by `rotate(calc(var(--from) + 180deg))`, ink at 1.3)
  and `__point`, the compass point at the `eyebrow` step in `ink-muted`
  (capitals only, so the 10px floor holds).
- `__gust`: the dock's and popup's "g22", written on the line, not raised.
- `__wing`, `__sep`: the popup's wing figure and its "·".

## Variants

- Row (default): the spot page's wind cell. `12` at the figure step, `21`
  raised, then the arrow (16px) and "WSW".
- `--alarm`: the gust is a big jump over the mean. The raised figure turns to
  `sem.color.pen-ink` and semibold (Figure's `alarm`): weight and colour
  together.
- `--cell`: the dock's WIND row. The knots at the `body` step, semibold
  (Figure size sm; the mockup's 12.5px), then "g22" at the `caption` step in
  `ink-muted` (the mockup's 9.5px; 11 is the floor for lower case), a
  `sem.space.x1` apart.
- `--line`: the popup's wind line. Mono at the `body` step (the mockup's
  12.5): the arrow (13px), the knots semibold, "g26", the compass point, the
  shore-wind glyph (`.wf-shore-compass--wind`), "·", the wing semibold and
  " m", `sem.space.x1-5` apart.
- `--inverse`: on an ink fill, every part in `sem.color.ink-inverse`.

## States

- None of its own. In the dock the cell takes the column's state (past,
  selected, night) from `hour-cell`.

## Usage

- Write wind as figures: `14 g22 · WSW · 6 m`, never a sentence.
- The gust goes raised (row) where a figure leads a row, and on the line
  ("g22") where space is tight or the line is read left to right.
- Alarm only for a gust well over the mean; it is the pen's colour, so it
  counts towards a view's one or two pen marks.
- The arrow always points downwind (where the wind goes), as on the map.
- The `--line` form needs `components/shore-compass/component.css` loaded
  for its shore glyph.

## Accessibility

- The figure carries `role="img"` and an `aria-label` in words: "13 knots
  gusting 26 from the west"; the dock cell "14 knots gusting 22"; the popup
  line adds the shore and wing: "13 knots gusting 26 from the west,
  cross-offshore, 6.5 m wing".
- The arrow is `aria-hidden`; the compass point is spelt out in the label
  ("west-south-west"), not read as letters.
- Contrast: ink-muted gust 5.8:1, pen-ink alarm 4.9:1 on paper.
