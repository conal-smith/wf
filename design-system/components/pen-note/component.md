# PenNote

The pen's handwriting in the margin (`ui/Pen.tsx` `PenNote`,
`penNoteStyles`): the verdict in a few words, as somebody would write it.
"Go 13:00–16:00. Four stars on a 6 m."

## Anatomy

- `.wf-pen-note` — a paragraph (or a span inside a line), no margin, in
  `sem.font.family.hand` (Kalam), `sem.font.weight.normal`, leading
  `sem.font.line.tight`, in `sem.color.pen-ink`, turned a degree off the level
  about its top left corner.

## Variants

- `--md` (the default) — `sem.font.size.lead`: the verdict.
- `--sm` — `sem.font.size.prose`: the figures in the margin ("WSW 14 g22 ·
  cross-shore · HW 13:25").

## States

- None. A PenUnderline may sit inside it under the word that carries it.

## Usage

- The verdict in a sentence or two, never a paragraph.
- Kalam is for the pen and nothing else.
- The Almanac speaks here, plainly, in British and Irish spelling; the Puffin
  may sign it.

## Accessibility

- Real text, read in order. Pen-ink is 4.9:1 on paper, so it reads as words
  where the pen's strokes need only be seen.
- The degree's turn is small enough not to hurt reading; do not turn it more.
