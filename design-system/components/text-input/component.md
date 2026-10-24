# Text input

A box to write in (`ui/TextInput.tsx` over `ui/control.ts`, `controlStyles`).
Body-face text, an italic placeholder, a hairline box ruled at the stroke's
3:1, at a control's corner (`sem.radius.control`, 10px).

## Anatomy

- Box: `.wf-control` (the `box` slot) — at least `sem.size.touch` tall,
  `sem.space.x3` across, `sem.space.x2` between its parts, a
  `sem.rule.hairline` border in `sem.color.line-strong`, `sem.radius.control`,
  `sem.color.card`. The box is what is drawn: it takes the border, the hover
  and the ring, so a prefix sits inside the same outline as the text.
- Element: `.wf-control__input` (the `input` slot) — bare, no border, no
  fill, no ring of its own; Newsreader at `sem.font.size.prose`, normal
  weight, in the box's ink.
- Optional prefix: `.wf-control__adornment` — a currency sign or a unit, a
  figure's companion, so IBM Plex Mono at `sem.font.size.caption` in
  `sem.color.ink-muted`.
- Shared: this file owns `.wf-control`, `.wf-control__input`,
  `.wf-control__adornment` and `.wf-control--active` for all three field
  controls, as `controlStyles` does in the product. Text area and select link
  `../text-input/component.css` and add only `--area` and `--select` in their
  own files.

## Variants

- **Text** (the default) — one line, an optional prefix.
- **Active** (`.wf-control--active`) — a filter that is narrowing the results,
  as opposed to sitting at "any": the border in `sem.color.accent.primary`
  and a second hairline inside it (an inset ring), so it is not said by
  colour alone. A line, not a fill, so it never rivals the one filled action.

## States

- Hover: the border goes to `sem.color.ink` (`.is-hover` holds it in the
  demo); an active box keeps its accent.
- Focus: the box draws the one ring when its element holds the focus
  (`:focus-within`, `.is-focus` in the demo): `sem.ring.width` of
  `sem.color.focus`, `sem.ring.offset` clear.
- Invalid: `sem.color.warn` border on `sem.color.warn-ground`, reached by
  `aria-invalid="true"` on the element or by a Field carrying
  `data-invalid`. The Field's message says what is wrong in words.
- Disabled: `sem.color.sunken` ground, `sem.color.line` border,
  `sem.color.ink-disabled` text, default cursor; hover changes nothing.
- Placeholder: italic, `sem.color.ink-muted`, full opacity.
- Coarse pointer: the text steps to `sem.font.size.input` (16) so a phone
  does not zoom the page when the field takes the focus.

## Usage

- Always inside a Field, which names it in the mono label.
- A placeholder is an example ("Rusheen Bay, Galway"), never the label.
- Use the prefix for a currency or a unit, so the figure stays a figure.
- Active only on a filter; a form field is never active.

## Accessibility

- The element is a real `<input>`, named by its Field's `<label for>` or by
  `aria-label`.
- Invalid sets `aria-invalid="true"` on the element; the Field announces the
  message with `role="alert"`.
- The ring is on the box, so a prefix is inside what the focus outlines.
- Contrast: the box's `line-strong` is 3.7:1 on paper (a stroke); placeholder
  `ink-muted` 5.8:1 on paper. A disabled field's `ink-disabled` is below the
  words' floor on purpose: it is not there to be read.
