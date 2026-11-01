# Spot light

A spot on the chart, drawn as the chart's light: a ring with the hour's stars
in it and an arrow blowing downwind, the spot's name beside it with the wind
under it. Drawn by the map (`src/map.css`, `.lt`, and the phone's map
lights); no `ui/` primitive yet.

## Anatomy

- Target: `.wf-spot-light`, a `<button>` 20px round (`sem.space.x5`), with no
  fill or border of its own. On a coarse pointer an invisible
  `sem.size.touch` disc grows the target; the glyph stays the same size.
- Glyph: `.wf-spot-light__glyph`, an SVG drawn at 60px round the target
  (viewBox -30 -30 60 60), and inside it:
  - `__wind` holding `__arrow`, stroked in the ink colour at 1.7, turned by
    `rotate(calc(var(--from) + 180deg))` so it points where the wind blows
    to. `--from` is set inline (`style="--from: 247deg"`).
  - `__ring`: r 7.6, `sem.color.card` ringed in the ink colour at 1.1.
  - `__n`: the hour's star count, Inter semibold at `sem.font.size.caption`,
    tabular.
  - `__strike`: a line of `sem.color.pen` through the ring, shown only when
    offshore.
- Label: `.wf-spot-light__label`, beside the target, on a halo of
  `sem.color.ground` (a soft text-shadow). `__name` is Inter semibold at
  `sem.font.size.body`; `__line` is the wind under it at
  `sem.font.size.caption`, medium, in `sem.color.ink-muted`: "4★ WSW 14".

## Variants

- `--s0`: a dashed ring in `sem.color.ink-disabled`, the figure grey at medium
  weight. Nothing to ride.
- `--s1`, `--s2`: the open ring (the default).
- `--s3`, `--s4`: filled in `sem.color.inverse`, the figure in
  `sem.color.ink-inverse`.
- `--s5`: filled in the accent (`sem.color.chart-magenta`): the best, the one
  place on the chart that colour says it.
- `--dark`: not rated. The ring faintly shaded (`sem.color.hatch`) and ringed
  in `sem.color.ink-disabled`, no figure, the arrow faint; the line starless
  ("WSW 13").
- `--off`: offshore. Struck through in `sem.color.pen`, the ring and arrow in
  the same red, the figure and the line in `sem.color.pen-ink`, and the line
  ends "· offshore". Struck, red and worded: never colour alone. Combine with
  the star class (`--s2 --off`).
- `--xoff`: cross-offshore. The arrow in the warm red, the line grey, ending
  "· cross-off".
- `--named`: the label shown (a featured spot, or the chart zoomed in far
  enough to name every light).

## States

- Selected (`--sel`, with `aria-pressed="true"`): the label is shown and the
  light rises a size over its neighbours.
- In focus: a container with `.wf-spot-light-field--focus` dims every light
  but the selected one to `sem.opacity.dot` and hides their labels, so the
  spot in view stands alone.
- Hover and focus: the glyph scales 1.18 (`sem.duration.fast`); held still in
  the demo with `.is-hover` and `.is-focus`. Reduced motion drops the
  transition.
- Focus-visible: the one ring, `sem.ring.width` of `sem.color.focus`, with
  `sem.space.x1-5` clear, so it rounds the glyph rather than the 20px target.

## Usage

- One per spot on the map, positioned by the map at the spot's centre.
- The ring's fill says the stars and nothing else. Do not tint a light by wind
  speed.
- The accent only at five stars. Do not use `--s5` to mean "selected": the
  selected light is `--sel`, which keeps its stars' fill.
- Names in Inter, never in the serif and never italic.
- The line is figures: stars, compass point, knots, and the shore word only
  when the wind is off the beach.

## Accessibility

- A real `<button type="button">`; the glyph and the visual label are
  `aria-hidden`, and the button carries the whole reading in its
  `aria-label`: "Rusheen Bay: 4 stars, WSW 14 knots", "Brandon Bay: 2 stars,
  ENE 12 knots, offshore", "Keel Beach: dark, WSW 13 knots".
- The selected light exposes `aria-pressed="true"`.
- Offshore is said three ways: the strike, the red and the word.
- The label's halo keeps the words readable over sea and land; the grey line
  is 5.2:1 (light) and 6.1:1 (dark) on the ground.
- Touch: the coarse-pointer target is `sem.size.touch` across.
