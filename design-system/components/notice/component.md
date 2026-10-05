# Notice

Something the reader should know, said in place (`ui/Notice.tsx`,
`noticeStyles`). Set off as the broadsheet sets off a note: a heavy rule down
its edge. A warning interrupts.

## Anatomy

- Container: `.wf-notice` — a row, top-aligned, `sem.space.x3` gap,
  `sem.space.x3` by `sem.space.x4` inset; a `sem.rule.edge` rule down the left
  edge and none elsewhere; sentences in `sem.font.family.body` at
  `sem.font.size.prose`.
- Icon: `.wf-notice__icon` — a 16px lucide icon in `currentColor` (Info, or
  AlertTriangle for a warning), `sem.space.x0-5` down onto the first line,
  never shrinking.
- Body: `.wf-notice__body` — the words; free to wrap.

## Variants

- **Info** (`.wf-notice`, the default) — `sem.color.sunken` behind,
  `sem.color.ink-2` words, an ink rule, the Info icon.
- **Warn** (`--warn`) — `sem.color.warn-ground` behind, `sem.color.warn` words
  and rule, the triangle.

## States

- None of its own. It appears, says its piece, and is removed by whatever put
  it there.

## Usage

- A sentence, two at most: what happened and, where there is one, what to do.
- Warm means degraded or an error, never "look here": a notice that is only
  news is info.
- Inside a form or a panel, near what it is about, not as a toast.

## Accessibility

- Info carries `role="status"` (polite); warn carries `role="alert"`, so it
  is read the moment it appears.
- The warning is told three ways: colour, its own icon and its words. The icon
  is `aria-hidden`; the words carry the meaning.
- Warn on warn-ground is 4.8:1, ink-2 on sunken 8.9:1.
