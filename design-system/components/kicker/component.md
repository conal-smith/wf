# Kicker

The mono label as an element (`ui/Kicker.tsx`, `kickerStyles`; `MONO_LABEL`
in `ui/tv.ts` is the same classes): tracked capitals in IBM Plex Mono, as a
chart names its parts and a broadsheet heads its columns.

## Anatomy

- `.wf-kicker` — no margin, `sem.font.family.mono` at the eyebrow step
  (`sem.font.size.eyebrow`, its line, `sem.font.weight.eyebrow`, tracked
  `sem.font.tracking.eyebrow`), uppercase.

## Variants

- Muted (the default) — `sem.color.ink-muted`: a label over a figure, a column
  head.
- `--ink` — `sem.color.ink`: a label that heads something.
- `--pen` — `sem.color.pen-ink`: the label of the one thing that matters
  ("Best of the week"), beside the pen's mark.

## States

- None; it is never pressed.

## Usage

- Names a thing in a word or two, and never says a sentence: STARS, WIND KN,
  BEST MON, LOW TIDE.
- A figure leads and the kicker names it, above or beside.
- A paragraph by default; a span in a row; a heading where it is one.
- The eyebrow step (10px) is the floor, and it is for this label only.

## Accessibility

- Write the words in sentence or title case; the capitals are CSS, so a screen
  reader does not spell them out.
- Muted is 5.8:1 on paper (5.4:1 on sunken); pen-ink 4.9:1.
