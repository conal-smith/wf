# Count

A number in a badge (`ui/Count.tsx`, `countStyles`): a small figure in a
capsule.

## Anatomy

- Capsule: `.wf-count`, 20px tall (`sem.space.x5`) and at least as wide,
  `sem.space.x1-5` either side, round-ended, no edge.
- Figure: Inter semibold at `sem.font.size.caption`, tabular. Past 99 it reads
  "99+"; nothing is drawn for zero.
- Label (optional): `.wf-count__label`, what is counted, for a screen reader
  only ("4 unread").

## Variants

- **Strong** (the default): `sem.color.ink-inverse` on `sem.color.inverse`.
  Unread.
- **Quiet** (`--quiet`): `sem.color.ink-2` on `sem.color.well`. A total.

## States

- None.

## Usage

- Beside the thing counted: a channel in the list, the bell in the top bar.
- Strong is said in fill and weight together, so it survives greyscale; do not
  colour a count.
- Never the accent, never red: a count is not the best of anything and not a
  warning.

## Accessibility

- With a label, the badge reads as "4 unread". Without one it is
  `aria-hidden`, for a control whose own label already says the number.
- Contrast: strong 18.8:1 (light) and 17.5:1 (dark); quiet 10.4:1 and 10.8:1.
