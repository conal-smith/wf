# Notice

Something the reader should know (`ui/Notice.tsx`, `Notice` and
`NoticeMark`): a weather warning, a bathing-water notice, something that went
wrong. A quiet card with a coloured square and its sign, a plain title that
says the level in words, a second line, and a chevron that opens the
details. The notice mark, the same square small with a word beside it, is
documented here too, because it carries the same levels.

## Anatomy

- Card: `.wf-notice`, `sem.color.sunken` carrying `on-card`, `sem.radius.surface`, 14px by
  `sem.space.x4` inside; a three-column grid (`sem.grid.notice`): the square,
  the words, the end.
- Square: `.wf-notice__mark`, 36px with a box's corner, the level's colour
  with its sign (`__icon`, 18px, stroke 1.75): an info sign, a warning
  triangle, or a drop for water. `aria-hidden`.
- Title: `.wf-notice__title`, Inter semibold at `sem.font.size.prose`,
  saying the level in words: "Orange wind warning for Kerry", "Bathing is
  prohibited".
- Second line: `.wf-notice__meta`, when, and what it does to the stars, in
  `sem.color.ink-2`.
- End: `.wf-notice__end`, either the chevron (a quiet small icon
  [Button](../button/component.md) with `__chevron`) or an action in its place
  ("Try again").
- Details (optional): `.wf-notice__details`, what the chevron opens, under the
  words.
- Notice mark: `.wf-notice-mark`, the square (`__square`, 16px with
  `sem.radius.mark`; 28px with `--md`) and a word beside it (`sem.font.size.body`,
  medium). Used where a notice takes the place of the stars: an hour in the
  table, the Your stars card.

## Variants

Levels (`--<level>` on the notice, the same on the mark):

- **info**: an info sign in `sem.color.ink-2` on `sem.color.raised`.
- **warn**: a warning triangle in `sem.color.pen-ink` on
  `sem.color.warn-ground`. Something went wrong.
- **yellow**, **orange**, **red**: Met Éireann's warning colours
  (`sem.color.met-yellow`, `-orange`, `-red`), the same on either ground; the
  sign near-black on yellow, white on orange and red.
- **water**: a drop in `sem.color.pen-ink` on `sem.color.warn-ground`.
  Bathing is prohibited.
- **water-advice**: a drop in `sem.color.depth` on `sem.color.raised`.
  Advice against bathing.

The notice mark comes in **sm** (the default) and **md** (`--md`).

## States

- Details closed and open: the chevron button carries `aria-expanded` and
  turns over when open; the details are `hidden` when closed.
- Reduced motion: the chevron turns without the animation.

## Usage

- The title says the level in words, in sentence case. Never a capital chip
  ("ORANGE"), never a coloured bar down the side, never a frame.
- One notice a subject. Several warnings stack, `sem.space.x2` apart, the most
  severe first.
- An action replaces the chevron only for something the reader can fix there:
  "Try again" when the forecast could not load.
- Where a notice takes the place of the stars, show a notice mark with a word
  ("Water", "Orange warning"), not the full notice.

## Accessibility

- A warning that was there when the page came is plain content. Something that
  went wrong just now is `role="alert"` (the product's `alert`), so a screen
  reader is interrupted.
- The level is in the title's words; the colour and sign are
  `aria-hidden` decoration.
- The chevron is a button named "Details" (the product's `detailsLabel`
  renames it where a page has several: "Details of the orange warning"), with
  `aria-expanded` and `aria-controls` pointing at the details.
- Contrast: title 17.3:1 (light) and 16.0:1 (dark); second line 10.4:1 and
  10.8:1. The signs: near-black on yellow 12.1:1, white on red 5.9:1, white
  on orange 3.1:1 (a sign, above the 3:1 a graphic needs).
