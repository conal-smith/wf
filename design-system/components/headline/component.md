# Headline

One a page, on a page that is read, saying the verdict in a line
(`ui/Headline.tsx`, `headlineStyles`): "Donabate: a three-star Friday morning
on a 5.5 m".

## Anatomy

- Base: `.wf-headline` — an `h1` (or `h2`), no margin,
  `sem.font.family.display` at the headline step (`sem.font.size.headline`,
  its line, `sem.font.weight.headline`, `sem.font.tracking.headline`), Fraunces
  held at its display cut (`"opsz" 144`), balanced, in `sem.color.ink`.
- Soft: `.wf-headline__soft` — an `em` for the soft tail of the line, in
  `sem.font.weight.normal` italic, still set tight.
- Mark: `.wf-headline__mark` — a span for the colon after a name, in
  `sem.color.chart-magenta`.

## Variants

- From 720px (`sem.breakpoint.wide`) the headline step (44); under it, the
  title step (30, its line, weight and tracking). `.is-narrow` holds the phone
  step for the catalog; the product reaches it through the media query only.
- With or without the mark: a page about a place has the colon; "How the
  stars work" does not.

## States

- None; it is not interactive.

## Usage

- One a page, and only on a page that is read. A page without one heads
  itself with a SectionHeading `--title`.
- Say the verdict in a line; the soft tail carries what qualifies it.
- The magenta mark is that page's one "best of"; do not use magenta again in
  the headline.

## Accessibility

- The page's `h1`. The soft tail is an `em`, which is what it means.
- Ink on paper 14.6:1; the magenta colon 5.7:1, and it carries no meaning
  alone.
