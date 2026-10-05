# Link

A link in text (`ui/Link.tsx`, `linkStyles`): a plain `<a href>` in the quiet
ink, underlined in running text, magenta under the pointer.

## Anatomy

- Link: `.wf-link` on an `<a href>` — the surrounding face and size, in
  `sem.color.quiet`, `sem.radius.control` so the focus ring sits square
  but for the field's 2px.
- Underline (the default): a `sem.rule.hairline` line in
  `sem.color.line-strong`, 3px under the words.

## Variants

- **Underlined** (the default) — in running text, where ink alone does not
  say "link".
- **Plain** (`.wf-link--plain`) — no underline, for a list of nothing but
  links: a footer, a menu, a row of spot names.

## States

- Hover: the words go to `sem.color.chart-magenta`, and the underline with
  them (`currentColor`); `.is-hover` holds it in the demo. The link under the
  pointer is one of magenta's few uses.
- Focus: `:focus-visible` draws the one ring — `sem.ring.width` of
  `sem.color.focus`, `sem.ring.offset` clear (`.is-focus` in the demo).
- Visited: no look of its own.

## Usage

- Underlined wherever a link sits among other words; plain only where every
  item is a link.
- The words say where it goes ("tide table", "Rusheen Bay"), never "here".
- A way back or on in the label face ("← Chart") is a Button `--link`, not
  this.
- In the product a section's router takes the link over with its own click
  handler; it still opens in a new tab when asked to.

## Accessibility

- A real `<a href>`: announced as a link, followed with Enter, and openable
  in a new tab.
- The underline means a link is not said by colour alone in text; a plain
  link relies on its place in a list of links.
- Contrast: `quiet` ink 14.6:1 on paper, magenta 5.7:1; the underline's
  `line-strong` is a stroke, 3.7:1.
