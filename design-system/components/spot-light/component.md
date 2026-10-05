# Spot light

A spot on the chart, drawn as the chart draws a light: a ring with the hour's
stars in it and an arrow blowing downwind, the spot's name beside it. The
mockup's `.lt` (`design/chart/1-the-chart.html`); no `ui/` primitive yet.

## Anatomy

- Target: `.wf-spot-light`, a `<button>` 20px round (`sem.space.x5`), with no
  fill or border of its own. On a coarse pointer an invisible
  `sem.size.touch` disc grows the target; the glyph stays the same size.
- Glyph: `.wf-spot-light__glyph`, an SVG drawn at 60px round the target
  (viewBox -30 -30 60 60), and inside it:
- `__wind` holding `__arrow`: the path `M0 -9.6V-20.5M-3.4 -16.6L0 -21L3.4 -16.6`,
  ink at 1.7, turned by `rotate(calc(var(--from) + 180deg))` so it points
  where the wind blows to. `--from` is set inline (`style="--from: 247deg"`).
- `__ring`: r 7.6, paper ringed in ink at 1.1.
- `__n`: the hour's star count, mono semibold at the `eyebrow` step (10px;
  the mockup's 9.5), tabular.
- `__strike`: the pen's line through the ring, shown only when offshore.
- Label: `.wf-spot-light__label`, absolutely placed beside the target, on a
  paper halo (a text-shadow of `sem.color.ground`). `__name` is Fraunces
  italic semibold at the `body` step (13px; the mockup's 12); `__line` is the
  chart's line in mono medium at the `caption` step (11px; the mockup's 10,
  but 11 is the floor for anything not in tracked capitals), in
  `sem.color.chart-magenta`: "4★ WSW 14".

## Variants

- `--s0`: a dashed ring in `ink-disabled`, the figure in `ink-muted` at medium
  weight. Nothing to ride.
- `--s1`, `--s2`: the paper ring (the default).
- `--s3`, `--s4`: filled in ink (`sem.color.inverse`), the figure in paper.
- `--s5`: filled in `sem.color.chart-magenta`: the best, the one place on the
  chart that colour says it.
- `--dark`: not rated. The ring shaded with `sem.color.hatch` and ringed in
  `ink-disabled`, no figure, the arrow faint; the line muted and starless
  ("WSW 13").
- `--off`: offshore. Struck through in `sem.color.pen`, the ring and arrow in
  the pen, the figure and the line in `sem.color.pen-ink` (the pen's words),
  and the line ends "· offshore". Struck and red and worded: never colour
  alone. Combine with the star class (`--s2 --off`).
- `--xoff`: cross-offshore. The arrow in the pen, the line in `ink-muted`
  ending "· cross-off".
- `--named`: the label shown (a featured spot, or the chart zoomed in far
  enough to name every light).

## States

- Selected (`--sel`, with `aria-pressed="true"`): the label is shown and the
  light rises over its neighbours.
- In focus: a container with `.wf-spot-light-field--focus` dims every light
  but the selected one to `sem.opacity.dot` and hides their labels, so the
  spot in view stands alone.
- Hover and focus: the glyph scales 1.18 (`sem.duration.fast`); held still in
  the demo with `.is-hover` / `.is-focus`. Reduced motion drops the
  transition.
- Focus-visible: the one ring, `sem.ring.width` of `sem.color.focus`, with
  `sem.space.x1-5` clear (the mockup's 6px), so it rounds the ring rather
  than the 20px target.

## Usage

- One per spot on the map, positioned by the map at the spot's centre.
- The ring's fill says the stars and nothing else: shape carries the kind,
  colour carries the reading. Do not tint a light by wind speed.
- Magenta only at five stars. Do not use `--s5` to mean "selected": the
  selected light is `--sel`, which keeps its stars' fill.
- The line is figures: stars, compass point, knots, and the shore word only
  when the wind is off the beach.
- The arrow's angle is the only inline style, and it is not a colour.

## Accessibility

- A real `<button type="button">`; the glyph and the visual label are
  `aria-hidden`, and the button carries the whole reading in its
  `aria-label`: "Rusheen Bay: 4 stars, WSW 14 knots" or "Brandon Bay: 2
  stars, ENE 12 knots, offshore", "Keel Beach: dark, WSW 13 knots".
- The selected light exposes `aria-pressed="true"`.
- Offshore is said three ways: the strike, the pen's colour and the word.
- Contrast: paper on ink 14.6:1, paper on magenta 5.7:1, pen-ink on paper
  4.9:1. The label's halo keeps the words readable over sea and land.
- Touch: the coarse-pointer target is `sem.size.touch` across.
