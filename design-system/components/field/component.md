# Field

A label, the control it names, a hint, and what is wrong if anything is
(`ui/Field.tsx`, `fieldStyles`).

## Anatomy

- Field: `.wf-field`, a grid with `sem.space.x2` between its parts.
- Label: `.wf-field__label`, a `<label for>` above the control, Inter at
  `sem.font.size.body`, `sem.font.weight.medium`, in `sem.color.ink-2`, in
  sentence case. Never capitals, never tracked.
- Control: a [Text input](../text-input/component.md),
  [Select](../select/component.md), [Text area](../text-area/component.md),
  [Slider](../slider/component.md) or
  [Number field](../number-field/component.md).
- Hint (optional): `.wf-field__hint`, a line under the control in
  `sem.color.ink-muted`.
- Error (optional): `.wf-field__error`, what is wrong in words, in
  `sem.color.warn`, under the control.
- Grid (optional): `.wf-field-grid`, fields side by side where there is room
  (`sem.grid.fields`).

## Variants

- **Invalid** (`.wf-field--invalid`, the product's `data-invalid`): the error
  line shows and the control inside turns warm.

## States

- The field itself has none; the control carries hover, focus and disabled.

## Usage

- Every control on a form sits in a field with a visible label. The one
  exception is a search, which says what it is with its icon and
  placeholder and carries an `aria-label`.
- Label in a word or a few, in sentence case: "Weight", "Asking price", "Your
  home spot".
- A hint says what the value is for or how to write it; it is not the error.
- Write the error as what to do: "Give a price in euro".

## Accessibility

- The label's `for` names the control's `id`.
- The hint is tied to the control with `aria-describedby`; the error too, and
  the control carries `aria-invalid="true"`.
- The error is announced as it appears (`role="alert"`) and is said in words
  as well as the warm colour.
- Contrast: label 10.4:1 (light) and 10.8:1 (dark); hint 5.2:1 and 6.1:1;
  error on the ground 6.6:1 and 7.0:1.
