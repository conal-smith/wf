# PenLoop

The red pen's loop round the one thing on a view that matters
(`ui/Pen.tsx` `PenLoop`, `ui/penPaths.ts` `loopPath`): somebody with the
forecast in front of them, circling the hour worth going for.

## Anatomy

- Wrap: `.wf-pen-loop` — an inline-block round the words, positioned.
- Mark: `.wf-pen-loop__mark` — an SVG laid absolutely 12px out across and 8px
  out down (`sem.space.x3`, `sem.space.x2`), its viewBox the words' box plus
  that pad, so one unit is one pixel; `aria-hidden`, no pointer events.
- Stroke: `.wf-pen-loop__stroke` — `loopPath(w / 2, h / 2, box.w / 2 + 7,
  box.h / 2 + 6, seed)`: a wobbly ring that runs a little past a full turn and
  grows as it goes, so its end crosses its start. No fill, `sem.color.pen`,
  `sem.rule.heavy` wide, round caps and joins, at `sem.opacity.pen`.

## Variants

- Seed: which hand. The same seed draws the same loop every time; 3 is the
  default.

## States

- Drawing in: the path carries `pathLength="1"` and `stroke-dasharray="1"`,
  and `sem.animate.ink` runs its dash offset from 1 to 0 once.
- Reduced motion: no animation; the loop is simply there.

## Usage

- One mark on a view, two at most, and on the thing that matters: the best
  window, the best hour.
- Never a fill, a control, a status or emphasis.
- The demo draws the paths statically for its words' measured boxes; the
  product measures the box and redraws on resize.

## Accessibility

- Decoration over words that already say the same thing: the looped hour is
  also the best window in the text beside it. The mark is `aria-hidden` and
  `focusable="false"`.
- The pen is a stroke (4.1:1), not words.
