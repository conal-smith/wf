# Figure

A number first and large, in Inter's tabular figures (`ui/Figure.tsx`,
`figureStyles`), its unit small after it and, where there is one, a second
figure raised after it the way the site writes a gust over the mean (14 g22
is 14²²).

## Anatomy

- Root: `.wf-figure`, an inline row on the baseline, `sem.space.x0-5` apart,
  Inter with tabular figures, never wrapping, in `sem.color.ink`.
- Value: `.wf-figure__value`, the number.
- Sup: `.wf-figure__sup`, the raised figure, set to the top of the row, at
  `sem.font.size.caption` and `sem.font.weight.medium`, in
  `sem.color.ink-muted`.
- Unit: `.wf-figure__unit`, kn, m, €, %, at `sem.font.size.caption` in
  `sem.color.ink-muted`.

## Variants

- `--sm`: the value at `sem.font.size.body`, semibold: a row's small figure.
- md (the default): the figure step (`sem.font.size.figure`, its line, weight
  and tracking): the number a row is about.
- `--lg`: the reading, `sem.font.size.reading`, semibold: the wind speed, one
  a view.
- `--alarm`: the raised figure is the one to watch (a gust well over the
  mean): semibold, in `sem.color.pen-ink`.

## States

- None; it is not interactive.

## Usage

- Say it as a figure, not a sentence: `14 g22`, `6 m`.
- One big figure a card (see [Card](../card/component.md)); `--lg` once a view.
- `--alarm` is a gust, not emphasis.

## Accessibility

- Where the digits alone do not say what the figure is, give the root
  `role="img"` and an `aria-label` ("14 knots gusting 22").
- The alarm is heavier as well as red, so it survives greyscale; its red is
  5.7:1 on the light ground and 7.8:1 on the dark.
