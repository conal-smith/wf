# Surface

The chart's box laid over the moving map (`ui/Surface.tsx`, `surfaceStyles`):
the search, the layers, the starred spots, a spot's popout. Opaque paper with
its grain, ruled in ink. On a page that is read, the box is a Pane.

## Anatomy

- Container: `.wf-surface` — `sem.space.x5` inset on every side,
  `sem.color.card` with `sem.texture.grain` over `sem.gradient.float` (the
  faintest light from above), `sem.color.ink` words.
- Rule: a `sem.rule.hairline` border in `sem.color.ink`, a box's corner
  (`sem.radius.surface`, 14px).
- Inner line: `sem.shadow.frame` (two of paper, then a hairline of ink at a
  quarter, inset), just inside the rule.
- Lift: `sem.shadow.float`, listed after the frame.
- Content is free: the Surface sets no face or size of its own.

## Variants

- **Double** (the default, `rule="double"`) — the chart's box: border plus
  hairline plus lift.
- **Single** (`--single`, `rule="single"`) — the border and the lift without
  the inner line, for a box that sits inside another or is small enough that two
  lines would be most of it.

## States

- None of its own. It is a box, not a control; what is inside carries focus,
  hover and disabled.

## Usage

- Over the map only. A page that is read uses Pane.
- Never translucent, never blurred: over the map, paper is opaque.
- Keep the hairline for the box that stands alone over the map; reach for
  `--single` before nesting one framed box inside another.
- Everything over the map casts the same `sem.shadow.float`; add no other
  shadow. A dialog or a sheet is a level deeper (`sem.shadow.sheet`).
- Tops out at `lead` type inside (the spot's name) and `figure` for figures.

## Accessibility

- A plain `div`. Give it a landmark or a label where it is a region of its own
  (`role="region"` with `aria-label`, or a `nav` for the site menu).
- Ink on paper is 14.6:1; the frame is decoration and carries no meaning.
- In the night chart (proposed) the frame inverts with the paper through the
  same tokens.
