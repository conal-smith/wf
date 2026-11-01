# Checkbox

One thing that is either so or not, with the words that say which
(`ui/Checkbox.tsx`, `checkboxStyles`). The platform's own box and tick, the
words part of the target.

## Anatomy

- Row: `.wf-checkbox` on a `<label>`, an inline row at least
  `sem.size.touch` tall, `sem.space.x2` between box and words, Inter at
  `sem.font.size.prose` in `sem.color.ink`. The whole row turns the box on.
- Box: `.wf-checkbox__input` on an `<input type="checkbox">`, the platform's
  box, 18px square, no margin, its fill and tick in
  `accent-color: sem.color.inverse` (ink in light, near-white in dark).
- Words: `.wf-checkbox__label` on a `<span>`; they may wrap and never push the
  box out.

## Variants

- One. A column of them sits in a soft card or a plain list.

## States

- Checked: the platform's tick on the ink fill; unchecked, its empty box.
- Focus: `:focus-visible` draws the one ring round the box,
  `sem.ring.width` of `sem.color.focus`, `sem.ring.offset` clear
  (`.is-focus` in the demo).
- Disabled: the words and the box in `sem.color.ink-disabled`, default
  cursor.
- Hover: the platform's own; the kit adds none.

## Usage

- For a yes in a form, or a choice that is only applied when the form is
  saved. A setting that takes effect the moment it changes is a
  [Switch](../switch/component.md).
- The words name the thing that is so ("Depth tints"), in sentence case, not
  an instruction ("Show depth tints").
- The fill is ink, never the accent: a checkbox is never the view's one
  filled action.
- One of a few, all exclusive, is a [Segmented](../segmented/component.md)
  control, not a column of checkboxes.

## Accessibility

- A real checkbox inside its `<label>`: the words name it and are part of the
  target, so the row is touch-tall although the box is 18px.
- Space toggles it; the platform announces checked and unchecked.
- Disabled words are below the reading floor on purpose: they are not there to
  be read.
