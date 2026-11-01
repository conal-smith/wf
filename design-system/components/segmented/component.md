# Segmented

One of a few short options, all in view (`ui/Segmented.tsx`,
`segmentedStyles`): a grey well with the chosen option lifted out of it.
Five options at most.

## Anatomy

- Well: `.wf-segmented`, a `role="group"` with an `aria-label`, on
  `sem.color.well` (the soft grey on the ground, the card's second grey `sem.color.raised` on a soft card), round-ended, 3px of padding round the options. It
  scrolls sideways with no scrollbar if it ever runs out of room.
- Option: `.wf-segmented__item`, a `<button>` 30px tall, `sem.space.x3`
  across, round-ended. Inter at `sem.font.size.body`,
  `sem.font.weight.medium`, in `sem.color.ink-2`.
- Chosen: `aria-pressed="true"`, lifted onto `sem.color.ground` with
  `sem.shadow.control` and in `sem.color.ink`. In dark, where the ground is
  darker than the well, it is a lighter grey (`sem.color.line` over the well)
  with no shadow.

## Variants

- **Sizes**: `--sm` (26px, `sem.font.size.label`) for a tool over the map or
  inside a dock; md (30px, the default); `--lg` (38px, `sem.font.size.prose`)
  for a question with a few answers, as in a wizard.
- **Full** (`--full`): across the whole width it is given, each option an
  equal share.
- An option may carry a small icon before its words.

## States

- Hover: the words go to `sem.color.ink` (`.is-hover` in the demo).
- Focus: the one ring on the option, `sem.ring.width` of `sem.color.focus`.
- Disabled option: `sem.color.ink-disabled`, default cursor.

## Usage

- Exactly one option is on. For several that can be on at once, use chips.
- Short words: Graph and Table; Knots, Beaufort, m/s; Best first, Nearest, A to
  Z. Model names keep their own spelling (HARMONIE, ICON-EU): they are names,
  not labels in capitals.
- On a soft card the well takes the card's second grey (`on-card`), so it
  shows there too.
- The parts of one page or dialog, each with its own panel, are
  [Tabs](../tabs/component.md), not a segmented control.

## Accessibility

- A group of toggle buttons, each with `aria-pressed`; the group is named for
  what is being chosen ("Units").
- The chosen option differs by fill and lift as well as colour.
- Contrast: unchosen words 10.4:1 (light) and 10.8:1 (dark) on the well;
  chosen 18.8:1 and 16.0:1.
