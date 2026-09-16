# Wind scale

The legend for the one thing this product measures. It is the only component that
may explain colour, because it is the only place the wind ramp is defined for the
reader.

## Anatomy

- A heading in `--sem-text-eyebrow-*` naming the unit.
- The ramp itself: a bar filled with `--sem-gradient-wind`.
- Ticks in `--sem-text-caption-*`, at the knot values the ramp is anchored on.

## Variants

- `.f5-wind-scale` - the default horizontal legend.
- `.f5-wind-scale--compact` - shorter bar and fewer ticks, for narrow viewports.

## States

- `.f5-wind-scale` - at rest. The legend is not interactive.
- `.f5-wind-scale[data-unit="ms"]` - ticks relabelled in metres per second. The
  ramp does not change; only the labels do.

## Usage

Do read the ramp from `--sem-gradient-wind`, which is generated from the same
fourteen stops `force5/src/weather.ts` paints the map with. Writing the stops out
again is how the legend and the map drifted apart in the first place.
Do show the unit in the heading, not only in the ticks.
Do not use the wind ramp for anything that is not wind speed. It is a data scale,
not a palette.
Do not re-theme the ramp in dark mode. The colours mean knots; a value that
changes with the theme means nothing.

## Accessibility

The ramp is decorative reinforcement: every wind value in the product is also
printed as a number, so no reading depends on distinguishing two stops. Ticks are
placed at the ramp's own anchors rather than at even intervals, so the labels tell
the truth about a scale that is not linear. The bar carries
`role="img"` and an `aria-label` stating the range, and the ticks are real text
rather than painted into the gradient.
