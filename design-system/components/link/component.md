# Link

A link in text (`ui/Link.tsx`, `linkStyles`): a plain `<a href>` in the ink
colour, underlined in running text, the accent under the pointer.

## Anatomy

- Link: `.wf-link` on an `<a href>`, in the surrounding face and size, in
  `sem.color.quiet`, with `sem.radius.control` so the focus ring takes a
  control's corner.
- Underline (the default): a `sem.rule.hairline` line in
  `sem.color.line-strong`, 3px under the words.

## Variants

- **Underlined** (the default): in running text, where colour alone does not
  say "link".
- **Plain** (`--plain`): no underline, for a list of nothing but links: a
  footer, a menu, a row of spot names.

## States

- Hover: the words go to `sem.color.chart-magenta`, and the underline with
  them (`.is-hover` in the demo).
- Focus: `:focus-visible` draws the one ring, `sem.ring.width` of
  `sem.color.focus`, `sem.ring.offset` clear (`.is-focus`).
- Visited: no look of its own.

## Usage

- Underlined wherever a link sits among other words; plain only where every
  item is a link.
- The words say where it goes ("tide table", "Rusheen Bay"), never "here".
- A way back or on that sits with buttons is a Button `--link`, not this.
- In the product a section's router takes the link over with its own click
  handler; it still opens in a new tab when asked to.

## Accessibility

- A real `<a href>`: announced as a link, followed with Enter, openable in a
  new tab.
- The underline means a link in text is not said by colour alone; a plain link
  relies on its place in a list of links.
- Contrast: the words 18.8:1 (light) and 17.5:1 (dark); under the pointer
  6.6:1 and 6.8:1.
