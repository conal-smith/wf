# Tide label

A tide's turn, written beside its mark: "Low tide 13:25 · 1.7 m". The
mockup's `drawTideRow` and `tideGlyph` (`design/chart/1-the-chart.html`); no
`ui/` primitive yet.

## Anatomy

- Label: `.wf-tide-label`, an inline row: the turn's mark, then the words in
  mono medium at the `caption` step (11px; the mockup's 9.5, raised to the
  floor for sentence case), tabular, on a paper halo (a text-shadow of
  `sem.color.ground`).
- Mark: `__mark` holding `__dot`, r 2.6. High water is an ink dot (`--high`
  on the label, or `__dot--high` in SVG); low water is a paper dot ringed in
  ink.
- Curve: `__curve`, the dock's 40px tide row as SVG. `__sea` fills under the
  level in `sem.color.sea`; `__level` strokes it in `sem.color.depth` at 1.4;
  a `__dot` sits on each turn with `__text` beside it (below a high, above a
  low, anchored left unless it would run off the end); `__now` is a 3.4 dot
  in `sem.color.chart-magenta` at the present hour. In SVG the halo is a
  paper stroke painted under the letters (`paint-order: stroke`).
- Line: `--line`, the popup's tide: `__wave` (a 14 by 8 wave,
  `M0 5 Q3.5 0 7 4 T14 3`, in `sem.color.depth` at 1.3) and "4.1 m" in mono
  at the `body` step.

## Variants

- `--low` and `--high`: which turn the label names.
- `--line`: the popup's one line, no halo.

## States

- None. The curve's present-hour dot moves with the time the map is set to.

## Usage

- On the dock's tide row, one label per turn of the tide in the day's hours;
  on the spot page, the same marks on the day's curve, with the times and
  heights in a ruled table below.
- The words are figures: "High tide 13:25 · 4.2 m". No "approximately", no
  sentence.
- The magenta dot is the present hour on the curve, the chart's one magenta
  mark in the dock's tide row.
- With no tide station near, say so in the body face's italic instead of
  drawing a flat line.

## Accessibility

- The HTML label is text, read as written.
- The curve carries `role="img"` and an `aria-label` listing its turns and
  the present height: "Tide: low 07:05 2.2 m, high 13:25 4.2 m, low 20:10
  1.7 m; now 3.6 m".
- The popup's line is `role="img"` with "Tide 4.1 m"; the wave is decoration.
- High and low are told apart by shape (filled and open) and by the word,
  not by colour.
