# Checkbox

One thing that is either so or not, with the words that say which
(`ui/Checkbox.tsx`, `checkboxStyles`). The platform's own box and tick, the
words part of the target.

## Anatomy

- Row: `.wf-checkbox` on a `<label>` — an inline row at least
  `sem.size.touch` tall, `sem.space.x2` between box and words, Newsreader at
  `sem.font.size.prose` in `sem.color.ink`. The whole row turns the box on.
- Box: `.wf-checkbox__input` on an `<input type="checkbox">` — the
  platform's box, `sem.space.step` × 4.5 (18) square, no margin, its fill
  and tick in `accent-color: sem.color.inverse`.
- Words: `.wf-checkbox__label` on a `<span>` — may wrap, never pushes the
  box out (`min-width: 0`).

## Variants

- One. A row of them is a ruled list or a plain column, as the chart's
  layers panel draws them.

## States

- Checked: the platform's tick on an ink fill; unchecked, the platform's
  empty box. The tick is what says checked, a mark that is there or not.
- Focus: `:focus-visible` draws the one ring round the box —
  `sem.ring.width` of `sem.color.focus`, `sem.ring.offset` clear
  (`.is-focus` in the demo).
- Disabled: the row's words and the box go to `sem.color.ink-disabled`,
  default cursor, no fade.
- Hover: the platform's own; the kit adds none.

## Usage

- For a setting that is on or off and takes effect at once (a layer on the
  chart), or a yes in a form.
- The words name the thing that is so ("Depth tints"), not an instruction
  ("Show depth tints").
- The fill is ink, never the accent: a checkbox is never the view's one
  filled action, and never magenta.
- One of a few, all exclusive, is a Segmented, not a column of checkboxes.

## Accessibility

- A real checkbox inside its `<label>`: the words name it and are part of
  the target, so the row is touch tall even though the box is 18.
- Space toggles it; the platform announces checked and unchecked.
- Disabled words in `ink-disabled` are below the words' floor on purpose:
  they are not there to be read.
