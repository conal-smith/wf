# Slider

A value along a range (`ui/Slider.tsx`, `sliderStyles`, drawn by the theme's
`range-kit`): a thin track filled in the ink colour up to a round white
thumb, and the value said beside it with its unit.

## Anatomy

- Row: `.wf-slider`, the track then the value, `14px` apart.
- Track: `.wf-slider__input`, a native `<input type="range">`, 28px tall for
  the pointer, the visible track 4px (`sem.space.x1`) and round-ended: filled
  in `sem.color.ink` up to the thumb, `sem.color.line-strong` after it. The
  page sets `--wf-slider-fill` (the product's `--range-fill`) to the value's
  share of the range.
- Thumb: a 22px white circle with a faint edge and a soft shadow, white on
  either ground.
- Value: `.wf-slider__value`, Inter at `sem.font.size.prose`, semibold, with
  tabular figures, at least 54px wide so the track does not move as it
  changes; its unit `__unit` small in `sem.color.ink-muted`.

## Variants

- None. The value can be written as the page likes ("25", "1.2"), with or
  without a unit.

## States

- Focus: the one ring round the track, `sem.ring.width` of
  `sem.color.focus` (`.is-focus` in the demo).
- Disabled: the platform's own.

## Usage

- For a value where the feel of the range matters more than the exact number:
  the wind you like, how far you will drive. An exact number moved in small
  steps (a weight) is a [Number field](../number-field/component.md).
- Under a [Field](../field/component.md) label, which says what it is.

## Accessibility

- A native range input: the arrow keys, Page Up and Down, Home and End work,
  and a screen reader hears the value in its range.
- The value beside the track is `aria-hidden`; set `aria-valuetext` on the
  input where the number alone does not say it ("25 knots").
- Name it with the Field's `<label for>` or an `aria-label`.
