# Count

A number in a badge (`ui/Count.tsx`, `countStyles`), drawn as the chart draws
a spot's light: a figure in a ring.

## Anatomy

- Ring: `.wf-count` — `sem.space.x5` tall and at least as wide, `sem.space.x1`
  either side, a `sem.rule.hairline` ink border, a full capsule
  (`sem.radius.full`).
- Figure: `sem.font.family.mono` at `sem.font.size.caption`, line-height 1,
  `sem.font.weight.semibold`, tabular digits.
- Label: `.wf-count__label` — optional, visually hidden: what is counted, so
  a screen reader hears "4 unread".

## Variants

- **Strong** (`.wf-count`, the default) — filled in `sem.color.inverse`,
  `sem.color.ink-inverse` figure: unread, loud.
- **Quiet** (`--quiet`) — `sem.color.card` with an ink figure: a tally, or
  unread below the threshold that makes it loud.

## States

- Zero: nothing is drawn.
- Over 99: "99+". Past that the number stops being read, so it stops being
  counted.

## Usage

- Beside the thing counted: a channel in the rail, the bell.
- Strong is said in fill and weight together, so it survives greyscale; do not
  colour a count.
- Never magenta, never warm: a count is not the best of anything, and not
  degraded.

## Accessibility

- With a label, the badge reads as "4 unread". Without one it is
  `aria-hidden`, for a control whose own label already says the number.
- Paper on ink 14.6:1; ink on paper 14.6:1.
