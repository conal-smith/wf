# Pager

Previous and next through a long list, with the page in view between them
(`ui/Pager.tsx`, `pagerStyles`). Its buttons are the Button component's small
outlined ones.

## Anatomy

- Container: `.wf-pager`, a `nav` labelled "Pages", a centred row
  `sem.space.x3` apart, `sem.space.x2` above.
- Previous: `.wf-button.wf-button--sm`, a 16px left chevron before its words.
- Status: `.wf-pager__status`, "Page 2 of 7" in Inter at
  `sem.font.size.caption`, tabular, `sem.color.ink-muted`.
- Next: the same button, a 16px right chevron after its words.

## Variants

- None. One page or none to turn to draws nothing at all: an empty list is one
  page.

## States

- First page: Previous disabled. Last page: Next disabled.
- Hover and focus: the outlined button's own (`.is-hover` and `.is-focus` in
  the demo).

## Usage

- Under a list of listings, threads or mentions, centred under its column.
- Count pages from one.
- No filled button here: the pager is never the view's one action.

## Accessibility

- A `nav` with `aria-label="Pages"`; the status carries `aria-current="page"`.
- The chevrons are `aria-hidden`; the words name the buttons.
- Disabled ends are real `disabled` buttons, skipped by the tab order; on a
  coarse pointer each button is at least `sem.size.touch` tall.
- Contrast: the status 5.2:1 (light) and 6.1:1 (dark).
