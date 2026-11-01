# Empty

Where a list would be, when there is nothing to list (`ui/Empty.tsx`,
`emptyStyles`): nothing found, not found, could not load. Centred, with no
frame round it.

## Anatomy

- Block: `.wf-empty`, a centred column, `sem.space.x14` above and below,
  `sem.space.x2-5` between its parts.
- Icon: `.wf-empty__icon`, a 56px circle on `sem.color.sunken` holding a 24px
  line icon in `sem.color.ink-2` (a magnifier unless the page gives another).
  `aria-hidden`.
- Title: `.wf-empty__title`, Inter semibold at `sem.font.size.lead`, in
  sentence case. An `<h2>` by default; an `<h1>` where it is the page's own
  (a 404), a `<p>` inside a panel.
- Body (optional): `.wf-empty__body`, a line or two in `sem.color.ink-2`, no
  wider than `sem.container.reading`: what to do about it.
- Actions (optional): `.wf-empty__actions`, at most two buttons.

## Variants

- None. What changes is the icon, the words and the buttons: "No riding place
  at this address" with Dollymount and All places; "Nothing on sale yet" with
  Sell.

## States

- None of its own.

## Usage

- No frame, no card, no dashed box round it; it stands in the space the list
  would take.
- The title says what happened in plain words; the body says what to do.
- At most two buttons: the likely way on as the one filled button if the view
  has none, the other outlined. Or a single outlined button.
- A failure the reader can retry inside a page is better as a
  [Notice](../notice/component.md) with "Try again"; Empty is for a whole list
  or page that has nothing.

## Accessibility

- The title is a real heading where it heads the page or the panel, so it is
  found by heading navigation.
- The icon is decoration.
- Contrast: title 18.8:1 (light) and 17.5:1 (dark); body 11.3:1 and 11.9:1.
