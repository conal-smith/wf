# SectionHeading

The broadsheet's section head (`ui/SectionHeading.tsx`,
`sectionHeadingStyles`): the name in the display face, a rule under it, and on
the same line, set right, the figures that sum the section up. The rule is
what divides the page; the section needs no box.

## Anatomy

- Root: `.wf-section-heading` — a wrapping flex row, baseline-aligned, the
  title and the aside pushed apart (`sem.space.x3` across, `sem.space.x1`
  down), `sem.space.x1` above the rule. Every side is zeroed first; only the
  foot is ruled, in `sem.color.ink`.
- Title: `.wf-section-heading__title` — an `h2` by default (`h1`–`h4`), no
  margin, `sem.font.family.display` in `sem.color.ink`.
- Aside: `.wf-section-heading__aside` — a flex row `sem.space.x2` apart, in
  `sem.font.family.mono` at the caption step, tabular, `sem.color.ink-muted`:
  a day's stars and best window, a count.

## Variants

- Size: lead (the default; `sem.font.size.lead`, a day, a section of a page),
  `--title` (`sem.font.size.title` with its weight and tracking, a page's own
  head where there is no headline), `--kicker` (the mono label in muted ink, a
  group in a list or a menu).
- Rule: `--thin` (`sem.rule.hairline`), thick (the default,
  `sem.rule.heavy`), `--double` (`sem.rule.double`, a page's foot or the head
  of what follows a masthead).

## States

- None; it is not interactive.

## Usage

- Most of a page is this, not boxes.
- The aside is figures, not a sentence: `★★★☆ 12–13`, `48`, `Best Mon`.
  StarGlyphs inside it take the aside's muted ink unless given `--ink`, which is
  how the chart sets a day's stars.
- Pair kicker with thin, title with double; lead with thick.

## Accessibility

- Choose the heading level for the page's outline, not for its size.
- Stars in the aside carry their own `role="img"` label ("3 of 5 stars, 4 on
  the wind alone").
