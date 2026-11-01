# Text area

Several lines of writing (`ui/TextArea.tsx`, on `ui/control.ts`): the kit's
filled box, taller.

## Anatomy

- Box: `.wf-text-area`, 14px in from each side, `sem.radius.control`, on
  `sem.color.well`, a transparent hairline edge that the states colour.
- Text area: `.wf-text-area__input`, the bare `<textarea>`, 138px tall before
  anything is written (three large controls), `sem.space.x3` above and below
  the words, Inter at `sem.font.size.prose` with `sem.font.line.normal`
  (`sem.font.size.input` on a touch screen). It grows downward only
  (`resize: vertical`).

## Variants

- None.

## States

- Focus: the ink edge and a soft ring of the accent round the box
  (`.is-focus` in the demo).
- Invalid: `aria-invalid="true"`, or inside an invalid Field: the warm edge
  and ground.
- Disabled: words in `sem.color.ink-disabled`, the box at 60%.

## Usage

- Inside a [Field](../field/component.md) with a visible label; a hint says
  how long or what to cover ("What's included, its condition, where it can be
  collected").
- For a listing's description, a report, a message. One line of text is a
  [Text input](../text-input/component.md).

## Accessibility

- Named by the Field's `<label for>`; hint and error tied with
  `aria-describedby`.
- Contrast: written words 17.3:1 (light) and 16.0:1 (dark); placeholder 4.8:1
  and 5.6:1.
