# PenUnderline

A quick stroke of the red pen under the word that carries a note
(`ui/Pen.tsx` `PenUnderline`, `ui/penPaths.ts` `underlinePath`), bowed up a
little in the middle.

## Anatomy

- Wrap: `.wf-pen-underline` — an inline-block round the word, positioned.
- Mark: `.wf-pen-underline__mark` — an SVG the word's width and
  `sem.space.x2` tall, hung from the foot of the line box and tucked back up
  `sem.space.x1`, because a line box hangs below the letters; viewBox
  `0 0 w 8`; `aria-hidden`, no pointer events.
- Stroke: `.wf-pen-underline__stroke` — `underlinePath(0, 3, w)`, in
  `sem.color.pen`, `sem.rule.heavy` wide, round caps, at `sem.opacity.pen`.

## Variants

- None. It takes the size of whatever it is under: a word in a PenNote, a
  spot's name.

## States

- Drawing in once with `sem.animate.ink` (`pathLength="1"`,
  `stroke-dasharray="1"`); simply there under reduced motion.

## Usage

- Under the one word in the pen's note that carries it ("Four stars").
- Counts as the view's pen mark: one, two at most.
- Never emphasis in running text, never a link's underline.

## Accessibility

- The mark is `aria-hidden`; the word says the same thing without it.
