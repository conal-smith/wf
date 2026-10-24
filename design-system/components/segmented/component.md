# Segmented

One of a few, all in view (`ui/Segmented.tsx`, `segmentedStyles`): the
chart's switch, as the dock's TABLE | RIBBON. One capsule ruled in ink, the
words in mono capitals, the one that is on filled in ink.

## Anatomy

- Group: `.wf-segmented` on a `role="group"` with an `aria-label` — an
  inline row in a `sem.rule.hairline` capsule (`sem.radius.full`) of
  `sem.color.ink`, on `sem.color.card`.
- Item: `.wf-segmented__item`, a `<button type="button">` with
  `aria-pressed` — `sem.size.control.sm` tall, `sem.space.x3` across,
  `sem.space.x1` between an icon and the words, itself a capsule so the
  filled one sits round inside the rule. IBM Plex Mono at
  `sem.font.size.label`, `sem.font.weight.label`, tracked
  `sem.font.tracking.label`, uppercase, `sem.color.ink`.

## Variants

- **Row** (the default) — the capsule, as the dock's switch.
- **Stack** (`.wf-segmented--stack`) — a column of choices: the group
  becomes a box ruled in ink (`sem.radius.surface`), clipping its square rows
  to its corner, its items
  `sem.size.control.md` tall rows, `sem.space.x4` across, words to the left,
  divided by `sem.rule.hairline` in `sem.color.line` (none under the last).
  One row filled.

## States

- On (`aria-pressed="true"`): filled in `sem.color.inverse`, words in
  `sem.color.ink-inverse` and `sem.font.weight.semibold` — filled and
  heavier, never colour alone. It stays filled under the pointer.
- Hover: `sem.color.sunken` under an item that is off (`.is-hover` in the
  demo).
- Focus: `:focus-visible` draws the one ring on the item — `sem.ring.width`
  of `sem.color.focus`, `sem.ring.offset` clear (`.is-focus` in the demo).
- Disabled: `sem.color.ink-disabled` words, default cursor, no fade, no
  hover.
- Coarse pointer: an item is never shorter than `sem.size.touch`.

## Usage

- Two to four short choices, all in view, exactly one on: how to show the
  hours (TABLE | RIBBON), how to draw the wind.
- Name each choice in a word; the group's `aria-label` says what is being
  chosen ("Show the hours as").
- Not an action: pressing an item changes the view, never sends anything.
  The view's one filled action is still the ink pill beside it.
- Use the stack in a narrow panel, or when the words are longer than a word.

## Accessibility

- A `role="group"` of real buttons, each exposing `aria-pressed`; the
  group's `aria-label` is required by the product's types.
- Each item is in the tab order and pressed with Space or Enter.
- On is said by fill and weight, so it survives greyscale; paper on ink is
  14.6:1.
