# Shore compass

Which way the beach faces, and how the wind meets it. The mockup's
`compassSVG` and `shoreSVG` (`design/chart/1-the-chart.html`); no `ui/`
primitive yet.

## Anatomy

- Compass: `.wf-shore-compass`, an SVG on viewBox -10 -10 20 20.
- `__disc`: r 8.8, `sem.color.card` ringed in ink at 0.9.
- `__north`: a short ink tick at the top (`M0 -8.8V-6.4`), so the reader
  knows which way is up.
- `__face`: a group turned by `rotate(var(--facing))`, holding `__sea` (a
  wedge in `sem.color.depth` pointing out to sea) and `__beach` (a heavy ink
  line, 1.7, round caps, across the wedge's foot). `--facing` is set inline:
  `style="--facing: 247deg"`.
- Shore wind: `.wf-shore-compass--wind`, an SVG on viewBox -9 -9 18 18.
- `__land`: the beach below, a band in `sem.color.land`, with `__hatch`
  (fine diagonals in `sem.color.line-strong`) over it and `__shore`, an ink
  line along its top.
- `__wind` holding `__arrow`: the downwind arrow a little above the beach,
  turned by `rotate(calc(var(--from) - var(--facing) + 180deg))`, so it is
  drawn as the wind meets this beach, not as north-up. Set both angles
  inline: `style="--facing: 247deg; --from: 22deg"`.

## Variants

- Compass sizes: `--sm` 16 (the popup's head), md 18 (default), `--lg` 20
  (the dock's head).
- Shore-wind sizes: `--sm` 14 (a dock cell), md 16 (the popup), `--lg` 18
  (the spot page).
- Shore relation, on the shore-wind glyph: `--onshore`, `--cross-on`,
  `--cross`, `--cross-off`, `--offshore`. The relation is the angle between
  the wind and the facing: under 30° onshore, under 70° cross-on, under 110°
  cross, under 150° cross-off, else offshore.
- `--offshore` and `--cross-off` draw the arrow in `sem.color.pen`: the wind
  takes you out, not in.

## States

- None. Both are read-only glyphs; they draw what they are given.

## Usage

- The compass sits beside a spot's name or county (the popup's meta line, the
  dock's head, the spot page's line "SE 123°"). It describes the beach and
  never changes with the hour.
- The shore-wind glyph sits beside a wind reading (the dock's FROM row, the
  popup's wind line, the spot page's SHORE column) and changes with the hour.
- Write the shore word beside it where there is room ("cross-offshore"); the
  pen's colour is a mark, not the message.
- The pen here is the strike's sibling on the map's light: use it for
  offshore and cross-off only, never to decorate an onshore arrow.

## Accessibility

- Both glyphs carry `role="img"`, an `aria-label` and a `<title>` for the
  pointer: "Beach faces WSW, 247°"; the shore wind's words, "onshore",
  "cross-onshore", "cross-shore", "cross-offshore", "offshore".
- Inside a figure that already says the relation in its own label (the
  popup's wind line), the glyph's label is not read twice: the parent's
  `role="img"` makes it presentational.
- The arrow's red is never the only signal: the relation is in the label and,
  where the layout allows, in words beside it.
