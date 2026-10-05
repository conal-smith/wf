# Pager

Previous and next through a long list, with the page in view between them as a
figure (`ui/Pager.tsx`, `pagerStyles`). Its buttons are the Button
component's small ruled pills.

## Anatomy

- Container: `.wf-pager` — a `nav` labelled "Pages", a centred row
  `sem.space.x3` apart, `sem.space.x2` above.
- Previous: `.wf-button.wf-button--pill.wf-button--sm`, a 16px left chevron
  before its words.
- Status: `.wf-pager__status` — "Page 2 of 7" in `sem.font.family.mono` at
  `sem.font.size.caption`, tabular, `sem.color.ink-muted`.
- Next: the same pill, a 16px right chevron after its words.

## Variants

- None. One page or none to turn to draws nothing at all: an empty list is one
  page.

## States

- First page: Previous disabled (ink-disabled words on a line-coloured ring).
- Last page: Next disabled.
- Hover and focus: the pill's own (inverse under the pointer, the one magenta
  ring); `.is-hover` and `.is-focus` hold them in the demo.

## Usage

- Under a list of listings, threads or mentions, centred under its column.
- Count pages from one. The status is a figure, never a sentence.
- No filled action here: the pills stay ruled.

## Accessibility

- A `nav` with `aria-label="Pages"`; the status carries `aria-current="page"`.
- The chevrons are `aria-hidden`; the words name the buttons.
- Disabled ends are real `disabled` buttons, skipped by the tab order; on a
  coarse pointer each pill is at least `sem.size.touch` tall.
