# Hour cell

One hour's column of the dock's table: the hour, its stars, the wind, where it
comes from against the beach, and the wing to take. Drawn by the forecast dock
(`src/ForecastDock.tsx`, and the phone's `DockDay`); no `ui/` primitive yet.

## Anatomy

- Dock: `.wf-hour-cell__dock`, the strip that scrolls sideways (no visible
  scrollbar), a region with a label and `tabindex="0"` so a keyboard can
  scroll it; its focus ring is drawn inside. Room above the hours for the
  present hour's flag.
- Table: `.wf-hour-cell__table`, a real `<table>`, collapsed, fixed layout,
  Inter with tabular figures. A `<colgroup>` sets the row-label column
  (`__col-label`, 88px) and one `<col>` per hour: 46px on a phone, 56px from
  `sem.breakpoint.wide`.
- Row labels: `.wf-hour-cell__label`, a `<th scope="row">` in a small grey
  label (`sem.font.size.label`, `sem.color.ink-muted`, sentence case) that
  stays put while the hours scroll; a unit beside it, `__unit` ("kn", "m²").
- Rows, each `.wf-hour-cell__row` with a modifier:
  - `--day`: the day's head, "Mon 5" (the day semibold, the date grey).
  - `--hour`: the hour, "17", small and grey; these cells are
    `<th scope="col">`.
  - `--stars`: `__stars`, the hour's five places drawn with the site's star
    path as `ui/StarGlyphs` draws it: `__star` solid, `__star--faded` an
    outline at `sem.opacity.faded` (what the wind alone gives),
    `__star--dot` at `sem.opacity.dot` for each not reached.
  - `--wind`: `.wf-wind-figure--cell`, "14 g22".
  - `--from`: `__from`, the downwind arrow (12px), the compass point, and the
    shore-wind glyph (`.wf-shore-compass--wind --sm`).
  - `--wing`: the wing in m², in `sem.color.ink-2`.
- Cell: `.wf-hour-cell`, centred, 28px tall (the day and hour rows 24).
- No rules between rows: the dock is a floating card, and space separates.

## Variants

- None: one column is one hour. Its state is a set of classes repeated on
  every cell of the column.

## States

- Selected (`--sel`): the column on `sem.color.sunken`; the hour's own label
  filled in `sem.color.inverse` as a small pill with `sem.color.ink-inverse`
  figures, like a chosen chip, and `aria-current="time"` on it.
- Night (`--night`): faintly shaded (`sem.color.hatch`), no stars and no wing.
  The wind is still shown.
- Past (`--past`): the column at `sem.opacity.past`.
- First hour of a day (`--day-start`): a hairline of `sem.color.line` on its
  left, through the day's head and every row.
- Now (`--now`): a hairline of `sem.color.pen` down the middle of the column,
  with `__flag` over the hour: "Mon 17:00", a small pill of
  `sem.color.pen-ink` with `sem.color.ink-inverse` words.
- Hover: a cell not selected goes to `sem.color.sunken`.

## Usage

- Load `components/wind-figure/component.css` and
  `components/shore-compass/component.css` beside this one.
- The dock's day runs 07 to 20; a dark hour is never left blank and never
  rated.
- The present-hour line and its flag are the strip's only red, but for the
  shore glyph's offshore arrow.
- Keep the row labels to a word and a unit, in sentence case: Stars, Wind kn,
  From, Wing m².

## Accessibility

- A real table: hours are column headers (`<th scope="col">`), the row labels
  row headers (`<th scope="row">`), so a screen reader announces "17, Wind,
  12 knots gusting 20".
- The stars carry `role="img"` with "3 of 5 stars, 4 on the wind alone"; a
  dark hour has no stars to read, and its hour is still announced.
- The selected hour is `aria-current="time"`. The flag is `aria-hidden`: the
  time it shows is already the column's header and the day's head.
- The flag's words on its red: 5.7:1 (light) and 7.8:1 (dark). The selected
  hour differs by fill, not colour alone.
- The strip scrolls with the arrow keys once focused; the focus ring is drawn
  inside its edge.
