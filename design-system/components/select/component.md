# Select

A native select in the kit's filled box (`ui/Select.tsx`, on
`ui/control.ts`): the platform's own picker, the soft grey, a chevron at the
right.

## Anatomy

- Box: `.wf-select`, at least 44px tall (`sem.size.touch`), 14px in from each
  side, `sem.radius.control`, on `sem.color.well`, a transparent hairline
  edge that the states colour.
- Select: `.wf-select__input`, the bare native `<select>` with its own arrow
  taken off, Inter at `sem.font.size.prose` (`sem.font.size.input` on a touch
  screen), room on the right for the chevron.
- Chevron: `.wf-select__chevron`, a 16px chevron in `sem.color.ink-muted`,
  `aria-hidden`.

## Variants

- **Active** (`--active`): an ink edge, for a filter narrowing the results
  ("County: Dublin" rather than "Any county").

## States

- Focus: the ink edge and a soft ring of the accent round the box
  (`.is-focus` in the demo).
- Invalid: `aria-invalid="true"`, or inside an invalid Field: the warm edge
  and ground.
- Disabled: words in `sem.color.ink-disabled`, the box at 60%.

## Usage

- Inside a [Field](../field/component.md) with a visible label.
- For a choice from many (a county, a model, a sort order with more than five
  answers). Up to five short answers that fit on one line read better as a
  [Segmented](../segmented/component.md) control.
- The first option says what nothing chosen means: "Any county".

## Accessibility

- A native `<select>`: the platform's picker, keys and screen reader support.
- Named by the Field's `<label for>`; the chevron is decoration.
- Contrast: the chosen words 17.3:1 (light) and 16.0:1 (dark) on the grey.
