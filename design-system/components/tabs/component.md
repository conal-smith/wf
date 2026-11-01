# Tabs

The parts of one page or dialog (`ui/Tabs.tsx`, `tabsStyles`): a row of words,
the current one on a soft pill. Down the side of a wide dialog, a column of
the same.

## Anatomy

- List: `.wf-tabs`, a `role="tablist"` with an `aria-label` and
  `aria-orientation`; it scrolls sideways with no scrollbar when it runs out
  of room.
- Tab: `.wf-tabs__tab`, a `<button role="tab">`, Inter at
  `sem.font.size.prose`, `sem.font.weight.medium`, in `sem.color.ink-2`,
  `sem.space.x2` by `sem.space.x3`, round-ended.
- Current: `aria-selected="true"`, on `sem.color.well` in
  `sem.color.ink`.
- Panel: the content each tab shows, a `role="tabpanel"` the tab points at
  with `aria-controls`.

## Variants

- **Horizontal** (the default): a row of words under a page's heading or a
  dialog's title.
- **Vertical** (`--vertical`): a column down the side of a wide dialog
  (Settings), each tab the column's width with a box's corner
  (`sem.radius.control`).

## States

- Hover: `sem.color.well` under the pointer (`.is-hover` in the demo).
- Focus: the one ring, `sem.ring.width` of `sem.color.focus`.
- Current: the soft pill and the ink colour.

## Usage

- For the parts of one thing, each with its own panel: Settings' Riding,
  Units, Display; a spot index's counties.
- One of a few values that changes what is shown in place (Graph or Table) is a
  [Segmented](../segmented/component.md) control, not tabs.
- No rule under the row and no underline under the current tab: the pill says
  which one it is.

## Accessibility

- The tab list pattern: only the current tab is in the tab order
  (`tabindex="0"`, the others `-1`); the arrow keys move between tabs
  (left and right, or up and down when vertical), Home and End go to the
  first and last, and Tab leaves the list.
- The current tab differs by fill as well as colour.
- Contrast: tab words 10.4:1 (light) and 10.8:1 (dark) on the ground.
