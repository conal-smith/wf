# Number field

A number moved in steps (`ui/NumberField.tsx`, `numberFieldStyles`): minus,
the value with its unit, plus, in a filled capsule.

## Anatomy

- Capsule: `.wf-number-field`, 44px tall (`sem.size.touch`), on
  `sem.color.well`, round-ended, `sem.space.x1` in from each end.
- Steps: `.wf-number-field__step`, two round 36px buttons (touch-sized on a
  coarse pointer) holding a minus and a plus (`__icon`, 18px, stroke 1.75).
- Value: `.wf-number-field__value`, a `role="spinbutton"` that takes the
  focus: Inter at `sem.font.size.lead`, semibold, tracked a little tight
  (`sem.font.tracking.figure`), tabular figures, at least 70px wide; its unit
  `__unit` small in `sem.color.ink-muted`.

## Variants

- None. The steps' names and the unit are the page's ("Lighter", "Heavier";
  kg).

## States

- Hover: a step goes to `sem.color.line` (`.is-hover` in the demo).
- Focus: the one ring on a step or on the value (`.is-focus`).
- At the end of the range: that step is disabled, in
  `sem.color.ink-disabled`.

## Usage

- For an exact number moved in small steps: a rider's weight, a wing's size.
  A value along a range where the feel matters is a
  [Slider](../slider/component.md).
- Under a [Field](../field/component.md) label, with a hint if the number
  needs one.

## Accessibility

- The value is a spin button with `aria-valuenow`, `aria-valuemin`,
  `aria-valuemax` and an `aria-label` ("Weight"); the arrow keys step it, Home
  and End go to the ends. Give it `aria-valuetext` where the number alone is
  not it ("75 kilograms").
- Each step is a button named for what it does (`aria-label="Lighter"`); the
  icons are `aria-hidden`.
- Contrast: the value 17.3:1 (light) and 16.0:1 (dark) on the capsule.
