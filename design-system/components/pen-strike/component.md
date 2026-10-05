# PenStrike

A stroke of the red pen through what is off (`ui/Pen.tsx` `PenStrike`,
`ui/penPaths.ts` `strikePath`): offshore, sold, cancelled.

## Anatomy

- Wrap: `.wf-pen-strike` — an inline-block round the words, positioned.
- Mark: `.wf-pen-strike__mark` — an SVG over the words' own box, viewBox
  `0 0 w h`; `aria-hidden`, no pointer events.
- Stroke: `.wf-pen-strike__stroke` — `strikePath(w, h)`: from 4% in at 72%
  down, rising to 96% across at 30% down. `sem.color.pen`, `sem.rule.heavy`
  wide, round caps, at `sem.opacity.pen`.

## Variants

- None. It takes the size of whatever it strikes: a spot's name, a price.

## States

- Drawing in once with `sem.animate.ink` (`pathLength="1"`,
  `stroke-dasharray="1"`); simply there under reduced motion.

## Usage

- Through a spot that is offshore for this rider, a listing that is sold.
- Never colour alone: the word is struck *and* red, and the words beside it
  say why ("cross-off", SOLD).
- Counts as the view's pen mark.

## Accessibility

- The mark is `aria-hidden`, so the state must be said in words beside it
  (offshore, sold) or in the element's label.
