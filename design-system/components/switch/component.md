# Switch

On or off, taking effect at once (`ui/Switch.tsx`, `switchStyles`): a flat
track that fills with the ink colour when on, a round thumb sliding across.

## Anatomy

- Track: `.wf-switch`, a `<button role="switch">` 44 by 26px, round-ended, on
  `sem.color.line-strong`; `sem.color.inverse` when on.
- Thumb: `.wf-switch__thumb`, a 20px circle on `sem.color.ground` with
  `sem.shadow.control`, 3px in from the edge; it slides 18px when on.
- Row (optional): `.wf-switch-row`, the words on the left
  (`__words`, a title and an optional `__detail` line in `sem.color.ink-2`)
  and the switch on the right, at least `sem.size.touch` tall.

## Variants

- None. One size.

## States

- Off and on (`aria-checked`); the thumb's position says which as well as the
  fill.
- Focus: the one ring, `sem.ring.width` of `sem.color.focus`
  (`.is-focus` in the demo).
- Disabled: the whole switch at 40%, the default cursor.
- Reduced motion: the thumb jumps, it does not slide.
- Coarse pointer: an invisible band makes the target touch-tall.

## Usage

- For a setting that takes effect the moment it is changed: Wind in colour,
  Live wind, Show tides. A choice that is only applied on Save is a
  [Checkbox](../checkbox/component.md).
- Name it in the row's words, in sentence case; never "On" and "Off" beside
  it.
- Rows of switches sit in one soft card, a hairline between them (see
  [Rows](../rows/component.md)).

## Accessibility

- `role="switch"` with `aria-checked`; Space and Enter toggle it, as a
  button's do.
- A switch has no words of its own: give it `aria-label`, or
  `aria-labelledby` pointing at the row's title.
- Contrast: the on track against the ground is 18.8:1 (light) and 17.5:1
  (dark); the off track 3.4:1 and 3.7:1, above the 3:1 a control's edge needs.
