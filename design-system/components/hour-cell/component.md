# Hour cell

One hour's column of the dock's table: the hour, its stars, the wind, where
it comes from against the beach, and the wing to take. The mockup's
`table.tt` (`design/chart/1-the-chart.html`); no `ui/` primitive yet.

## Anatomy

- Dock: `.wf-hour-cell__dock`, the strip that scrolls sideways (no visible
  scrollbar), a region with a label and `tabindex="0"` so a keyboard can
  scroll it; its focus ring is drawn inside.
- Table: `.wf-hour-cell__table`, a real `<table>`, collapsed, fixed layout,
  mono with tabular digits. A `<colgroup>` sets the row-label column
  (`__col-label`, 64px) and one `<col>` per hour: 52px on a phone, 62px from
  `sem.breakpoint.wide`.
- Row labels: `.wf-hour-cell__label`, a `<th scope="row">` in the mono label
  (`eyebrow`, tracked capitals, `ink-muted`) that stays put while the hours
  scroll; a unit beside it in lower case, `__unit` ("kn", "m²").
- Rows, each `.wf-hour-cell__row` with a modifier:
- `--day`: the day's head, "Mon 5" (the day in the display face at `body`,
  the date small), a hairline under it.
- `--hour`: the hour, "17", at `caption` semibold, an ink rule under the row;
  these cells are `<th scope="col">`.
- `--stars`: `__stars`, the hour's five places drawn with the chart's STAR path
  as `ui/StarGlyphs` draws it, 9.5px a star (8.6 on a phone): `__star`
  solid, `__star--faded` an outline at `sem.opacity.faded` (what the wind
  alone gives), `__star--dot` at `sem.opacity.dot` for each not reached.
- `--wind`: `.wf-wind-figure--cell`, "14 g22".
- `--from`: `__from`, the downwind arrow (12px), the compass point, and the
  shore-wind glyph (`.wf-shore-compass--wind --sm`).
- `--wing`: the wing in m², `body` semibold.
- Cell: `.wf-hour-cell`, centred, 20px tall (the hour row 18).

## Variants

- None: one column is one hour. Its state is a set of classes repeated on
  every cell of the column.

## States

- Selected (`--sel`): the column on `sem.color.sunken`; the hour cell filled
  in ink with paper figures, and `aria-current="time"` on it.
- Night (`--night`): the hatch (`sem.color.hatch`, 135°), the hour in
  `ink-muted` at normal weight, no stars and no wing. The wind is still
  shown.
- Past (`--past`): the column at `sem.opacity.past`.
- First hour of a day (`--day-start`): a `sem.rule.heavy` ink rule on its
  left, through the day's head and every row.
- Now (`--now`): the present-hour cursor, a `sem.rule.heavy` line of
  `sem.color.pen` at `sem.opacity.pen` down the middle of the column, run up
  through the day's head, with `__flag` at its top: "Mon 17:00" in mono
  semibold at `caption`, paper words (`sem.color.ink-inverse`) on the pen.
  The flag sits in the hour's header cell. In the dock the cursor stays in
  the middle and the hours scroll under it, so the selected hour is the
  cursor's.
- Hover: a cell not selected goes to `sem.color.sunken`.

## Usage

- Load `components/wind-figure/component.css` and
  `components/shore-compass/component.css` beside this one.
- The dock's day runs 07 to 20; a dark hour is never left blank and never
  rated.
- The cursor and the "Best" loop are the dock's pen marks: no other pen on the
  strip but the shore glyph's offshore arrow.
- Keep the row labels to a word and a unit: STARS, WIND kn, FROM, WING m².

## Accessibility

- A real table: hours are column headers (`<th scope="col">`), the row labels
  row headers (`<th scope="row">`), so a screen reader announces "17, Wind,
  12 knots gusting 20".
- The stars carry `role="img"` with "3 of 5 stars, 4 on the wind alone"; a
  dark hour has no stars to read, and its hour is still announced.
- The selected hour is `aria-current="time"`. The flag is `aria-hidden`: the
  time it shows is already the column's header and the day's head.
- The flag is set on the pen's handwriting ink (`sem.color.pen-ink`), where
  paper reads at 4.9:1; on the stroke red (`sem.color.pen`) it would be 4.1:1,
  below 4.5:1 for small text. The line itself stays in `sem.color.pen`. The selected hour also differs
  in fill, not in colour alone.
- The strip scrolls with arrow keys once focused; the focus ring is drawn
  inside its edge.
