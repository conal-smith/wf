# Chip

A choice you can press (`ui/Chip.tsx`, `chipStyles`): a soft grey capsule in
a row of them, filled in ink when it is on. Or a filter in use, with a cross,
that a press takes away. A word that only describes something is a
[Tag](../tag/component.md), not a chip.

## Anatomy

- Chip: `.wf-chip`, a `<button>` 32px tall (`sem.size.control.sm`),
  `sem.space.x3` across, round-ended, on `sem.color.well` (the soft grey on the ground, the card's second grey `sem.color.raised` on a soft card), no edge.
- Label: Inter at `sem.font.size.body`, `sem.font.weight.medium`, in
  sentence case.
- Remove mark (optional): `.wf-chip__remove`, a 14px cross after the words, at
  60% so the words lead.
- Row: `.wf-chip-row`, chips wrapping with `sem.space.x2` between them.

## Variants

- **Choice**: `aria-pressed="false"` or `"true"`. On is filled in
  `sem.color.inverse` with `sem.color.ink-inverse` words. A row of choices
  can have one on (a single choice) or several (filters).
- **Removable**: no `aria-pressed`; the cross says a press clears it ("Spots
  named 'Bally' ×"). Used for a filter in use, next to a quiet Clear.

## States

- Hover: `sem.color.line` under the pointer (`.is-hover` in the demo); a chip
  that is on stays filled.
- Focus: the one ring, `sem.ring.width` of `sem.color.focus`,
  `sem.ring.offset` clear.
- Disabled: words in `sem.color.ink-disabled`, default cursor.
- Coarse pointer: never shorter than `sem.size.touch`.

## Usage

- For a few short choices that sit in a row and wrap: Any stars, 3+ stars, 4+
  stars; Today, Tomorrow, Weekend.
- Five or fewer exclusive options that all fit on one line read better as a
  [Segmented](../segmented/component.md) control.
- Never in capitals, never with a heading or a label set inside it.
- A chip is never the one filled action on a view; on is a state, not a call
  to act.

## Accessibility

- A real `<button type="button">` with `aria-pressed` for a choice; on is said
  by the fill as well as the colour.
- A removable chip names what it takes away in its words; the cross is
  `aria-hidden`. Give the button an `aria-label` such as "Remove: spots named
  Bally" where the words alone do not say it.
- Contrast: words 17.3:1 on the light grey, 16.0:1 on the dark; on, 18.8:1
  and 17.5:1.
