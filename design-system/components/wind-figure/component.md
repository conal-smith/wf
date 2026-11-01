# Wind figure

The wind and its gust, as the site writes them: `12²¹ ↗ WSW` on a spot page,
`14 g22` in the dock, `→ 13 g26 W · 6.5 m` in a popup. It is `ui/Figure.tsx`
(value, sup, unit, alarm) with a downwind arrow and the compass point beside
it.

## Anatomy

- Container: `.wf-wind-figure`, an inline row in Inter with tabular figures,
  on the baseline, `sem.space.x0-5` apart.
- `__value`: the mean knots, at the figure step (`sem.font.size.figure`,
  semibold, tracked a little tight).
- `__sup`: the gust, raised, at `sem.font.size.caption`, medium, in
  `sem.color.ink-muted`.
- `__unit`: a small word after a figure, `sem.font.size.caption`, grey.
- `__dir`: the downwind arrow (`__arrow`, 16px, stroked in `currentColor`,
  turned by `rotate(calc(var(--from) + 180deg))`) and `__point`, the compass
  point at `sem.font.size.label` in `sem.color.ink-muted`.
- `__gust`: the dock's and popup's "g22", written on the line, not raised.
- `__wing`, `__sep`: the popup's wing figure and its "·".

## Variants

- **Row** (the default): a spot page's wind. `12` at the figure step, `21`
  raised, then the arrow and "WSW".
- **Alarm** (`--alarm`): the gust is a big jump over the mean. The raised
  figure turns to `sem.color.pen-ink` and semibold: weight and colour
  together.
- **Cell** (`--cell`): the dock's wind row. The knots at `sem.font.size.body`,
  semibold, then "g22" small and grey, `sem.space.x1` apart.
- **Line** (`--line`): a popup's wind line at `sem.font.size.body`: the arrow
  (13px), the knots semibold, "g26", the compass point, the shore-wind glyph
  (`.wf-shore-compass--wind`), "·", the wing semibold and "m",
  `sem.space.x1-5` apart.
- **Inverse** (`--inverse`): on an ink fill, every part in
  `sem.color.ink-inverse`.

## States

- None of its own. In the dock the cell takes the hour's state (past,
  selected, dark) from the [Hour cell](../hour-cell/component.md).

## Usage

- Write wind as figures: `14 g22`, never a sentence.
- The gust goes raised where a figure leads (a card, a row), and on the line
  ("g22") where space is tight or the line is read left to right.
- Alarm only for a gust well over the mean, never for emphasis.
- The arrow always points downwind (where the wind goes), as on the map.
- The compass point is a name and keeps its letters (WSW); nothing else here
  is in capitals.
- The `--line` form needs `components/shore-compass/component.css` loaded
  for its shore glyph.

## Accessibility

- The figure carries `role="img"` and an `aria-label` in words: "13 knots
  gusting 26 from the west"; the dock cell "14 knots gusting 22"; the popup
  line adds the shore and wing: "13 knots gusting 26 from the west,
  cross-offshore, 6.5 m wing".
- The arrow is `aria-hidden`; the compass point is spelt out in the label
  ("west-south-west"), not read as letters.
- Contrast: the grey gust 5.2:1 (light) and 6.1:1 (dark); the alarm 5.7:1 and
  7.8:1.
