# Text area

A box to write a few sentences in (`ui/TextArea.tsx`,
`controlStyles({ kind: "area" })`): the text input's box, three large
controls tall, growing downward.

## Anatomy

- Box: `.wf-control.wf-control--area` — the shared field box (hairline in
  `sem.color.line-strong`, `sem.radius.control`, `sem.color.card`,
  `sem.space.x3` across), its contents held to the top instead of the middle.
- Element: `.wf-control__input` on a `<textarea>` — at least
  `sem.space.step` × 34.5 tall (138, three large controls) before anything
  is written, `sem.space.x3` above and below the words, Newsreader at
  `sem.font.size.prose` on `sem.font.line.normal`, resizable vertically only.
- Shared: the box, the element and every state are the `.wf-control` classes
  owned by `components/text-input/component.css` (the product's
  `controlStyles` in `ui/control.ts`). This component links that file and
  adds only `.wf-control--area`.

## Variants

- One kind. A text area is never a filter, so it is never `--active`.

## States

- Hover: the border goes to `sem.color.ink` (`.is-hover` in the demo).
- Focus: the one ring round the box (`:focus-within`, `.is-focus` in the
  demo): `sem.ring.width` of `sem.color.focus`, `sem.ring.offset` clear.
- Invalid: `sem.color.warn` border on `sem.color.warn-ground`, from
  `aria-invalid="true"` or a Field carrying `data-invalid`.
- Disabled: `sem.color.sunken`, a `sem.color.line` border,
  `sem.color.ink-disabled` text.
- Placeholder: italic, `sem.color.ink-muted`.
- Coarse pointer: the text steps to `sem.font.size.input` (16); the leading
  stays `normal`.

## Usage

- Inside a Field, for a note, a listing's description, a post: sentences,
  not figures.
- A placeholder asks the question ("What was it like?"); it is not the label.
- Keep the words few; a figure belongs in a text input beside it.

## Accessibility

- A real `<textarea>`, named by its Field's `<label for>` or `aria-label`.
- Invalid sets `aria-invalid="true"`; the Field's message carries
  `role="alert"`.
- The resize handle is the platform's, and vertical only, so a reader can
  give themselves room without breaking the column.
