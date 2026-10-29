# Lift

The one thing on a view that matters, lifted off the page on raised paper
(`ui/Lift.tsx` `Lift`): a reply's name, a count of new posts, "new" on a
listing. The dock's chosen hour stands on the same card (`src/dock.css`
`.tt-card`), and the chart lifts the open spot's light (`src/map.css`
`.lt.sel`, here `wf-spot-light--sel`).

## Anatomy

- Words: `.wf-lift` — an inline-block round them, `sem.space.x0-5` by
  `sem.space.x1-5` in, `sem.radius.control` round, `sem.color.card` under the
  grain and `sem.gradient.float`, `sem.shadow.float` under it, a pixel up.
- Card: `.wf-lift-card` — laid absolutely under a run of columns, which the
  pattern places and sizes; `sem.gradient.raised` with `sem.shadow.raised`
  and `sem.shadow.float`, and an ink tab at its foot. It sits at z-index -1
  inside its isolated table, so the figures stay over it.

## Variants

- None. It takes the size of what it lifts.

## States

- Moving: the dock's card springs from hour to hour on its transform, and the
  chart's light springs up when the spot is opened. Under reduced motion each
  is simply there.

## Usage

- One lift on a view, two at most, on the thing that matters: the chosen
  hour, the open spot.
- Nothing is circled or framed by hand any more (2026-10-29).
- Never a control: nothing about it is pressed, and it takes no focus.

## Accessibility

- The card is `aria-hidden`; the words it lifts are read as they are, and
  say the same thing without it.
- Its edge is a shadow, not a colour: it is decoration over words that are
  already there.
