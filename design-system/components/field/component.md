# Field

A label, the control it names, and what is wrong with it if anything is
(`ui/Field.tsx`, `fieldStyles`). The label names the thing as a chart's
legend does: in tracked mono capitals.

## Anatomy

- Root: `.wf-field` — a grid, `sem.space.x2` between label, control and
  message, never wider than its column (`min-width: 0`).
- Label: `.wf-field__label` on a `<label for>` — IBM Plex Mono at
  `sem.font.size.eyebrow`, `sem.font.weight.eyebrow`, tracked
  `sem.font.tracking.eyebrow`, uppercase, `sem.color.ink-muted`, at
  `sem.font.line.tight`. A flex row: the words left, the hint right, on one
  baseline.
- Optional hint: `.wf-field__hint` on a `<small>` inside the label —
  Newsreader italic at `sem.font.size.body`, normal weight, no tracking,
  sentence case, `sem.color.ink-muted`, set right, keeping the label's tight
  leading.
- Control: any of the field controls (text input, text area, select). They
  share the `.wf-control` box owned by `components/text-input/component.css`;
  the demo links that file.
- Optional error: `.wf-field__error` — Newsreader italic at
  `sem.font.size.body` in `sem.color.warn`, `role="alert"`.

## Variants

- Label only; label with a hint; with an error.

## States

- Invalid: an error sets `data-invalid` on `.wf-field`, and the control
  inside turns warm (`sem.color.warn` border on `sem.color.warn-ground`).
  The rule is the control's (`.wf-field[data-invalid] .wf-control`, the
  product's `group-data-invalid/field`), so it lives in the text input's
  CSS beside the box it styles.
- Focus, hover, disabled: the control's own; the field draws none.

## Usage

- Name the thing in a word or two: SPOT, PRICE, WING SIZE. A label never
  says a sentence.
- A hint is a unit or a short rule ("whole euro", "m²"), not instructions.
- An error says what to do, briefly ("Write it as 6.5"). Wrong is said in
  words as well as warm, never colour alone.
- Fields in a form sit in `sem.grid.fields` columns.

## Accessibility

- The `<label for>` names the control, and taking it focuses the control.
- The hint is inside the label, so it is read with the name.
- The error carries `role="alert"`, so it is announced when it appears; tie
  it to the control with `aria-describedby` and set `aria-invalid="true"` on
  the control.
- Label and hint are `ink-muted`, 5.8:1 on paper; the error is `warn`,
  5.7:1 on paper.
