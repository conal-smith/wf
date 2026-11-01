# Text input

A one-line text field (`ui/TextInput.tsx`, on the kit's control box in
`ui/control.ts`): filled with the soft grey, no rule round it.

## Anatomy

- Box: `.wf-text-input`, at least 44px tall (`sem.size.touch`), 14px in from
  each side, a box's corner (`sem.radius.control`), on `sem.color.well`,
  with a transparent hairline edge that the states colour.
- Input: `.wf-text-input__input`, the bare `<input>` filling the box, Inter
  at `sem.font.size.prose`; `sem.font.size.input` (16px) on a touch screen so
  a phone does not zoom. Placeholder in `sem.color.ink-muted`.
- Adornment (optional): `.wf-text-input__adornment`, a currency sign or a unit
  inside the box, in `sem.color.ink-muted`.

## Variants

- **Active** (`--active`): an ink edge, for a filter that is narrowing the
  results as opposed to sitting at "any".
- **With an adornment**: "€" ahead of a price, "kg" after a weight.

## States

- Focus: the ink edge and a soft ring of the accent round the box (the focus
  colour at 20%); the bare input draws no ring of its own (`.is-focus` in the
  demo).
- Invalid: `aria-invalid="true"` on the input, or inside an invalid
  [Field](../field/component.md): a `sem.color.warn` edge on
  `sem.color.warn-ground`.
- Disabled: words in `sem.color.ink-disabled`, the box at 60%.

## Usage

- Always inside a Field with a visible label.
- Placeholder text is an example, not the label: "e.g. Dollymount".
- No underline-only fields, no frames: the grey fill says "write here".
- The fill is `sem.color.well`: the soft grey on the ground, the card's second
  grey (`sem.color.raised`) inside a soft card, so a field shows on either.

## Accessibility

- The Field's label names the input; the hint and error are tied to it with
  `aria-describedby`.
- Wrong is said in the Field's words as well as the warm edge and ground.
- Contrast: typed words 17.3:1 (light) and 16.0:1 (dark); placeholder 4.8:1
  and 5.6:1.
