# Empty

Where a list would be, when there is nothing to list (`ui/Empty.tsx`,
`emptyStyles` laid over a card `paneStyles`). An icon in a ring, a line in the
display face's italic, and what to do about it.

## Anatomy

- Container: `.wf-empty` — a card Pane (a `sem.rule.hairline` ink border,
  `sem.color.card` with `sem.texture.grain`, the hairline inside the rule, a
  box's corner and the card's contact shadow), with a tall inset
  (`sem.space.x14` by `sem.space.x6`), everything centred in a grid
  `sem.space.x3` apart; sentences in `sem.font.family.body` at
  `sem.font.size.prose`, `sem.color.ink-muted`.
- Icon: `.wf-empty__icon` — a 58px ring (a large control and a gap across, 14.5
  steps), hairline, holding a 24px lucide icon in `currentColor`; the Image icon
  when none is given. Decoration, `aria-hidden`.
- Title: `.wf-empty__title` — a `p`, not a heading: the display face's italic
  at `sem.font.size.lead` and `sem.font.weight.lead`, in ink.
- Body: `.wf-empty__body` — optional; a grid up to `sem.container.reading`
  wide, centred: a sentence, and the button or link that mends it.

## Variants

- **Info** (the default) — the ring in ink on paper.
- **Warn** (`--warn`) — the ring in `sem.color.warn` on `sem.color.warn-ground`,
  for an empty list that is empty because something failed. Only the ring goes
  warm; the words stay muted and the title ink.

## States

- None of its own. The action inside has the Button's states.

## Usage

- Say why it is empty in the title ("No reviews yet", "Nothing matches that
  search"), and what mends it in one sentence.
- The action is a pill or a link. Use the primary pill only when it is the one
  filled action on the view.
- Pick an icon that names the list (search, photo, star); do not use the warm
  kind to draw the eye.

## Accessibility

- The title is a paragraph, so an empty list does not add a heading to the
  outline; the section that holds it has its own heading.
- The icon is decoration; a warning is said in words as well as the warm ring.
- Muted words on paper are 5.8:1.
