# Top bar

The one top bar, on every page that has a head (`ui/TopBar.tsx`,
`topBarStyles`): the finder, the chart, a spot's page, How the stars work, the
spot index, Use with AI.

## Anatomy

- Bar: `.wf-top-bar`, a `<header>` 64px tall (56 on a phone), on
  `sem.color.ground`, `sem.space.x6` in from the sides, with one
  `sem.rule.hairline` of `sem.color.line` under it and nothing heavier.
- Brand: `.wf-top-bar__brand`, a link home holding the
  [Wordmark](../wordmark/component.md), named "wingfoil.ie, the Spot finder".
- Search: `.wf-top-bar__search`, the [Spot search](../spot-search/component.md),
  18px after the wordmark.
- Gap: `.wf-top-bar__gap`, which pushes the rest to the right.
- Actions (optional): `.wf-top-bar__actions`, a section's own few actions (the
  marketplace's Sell, the community's bell).
- View: `.wf-top-bar__view`, one outlined [Button](../button/component.md)
  with an icon to the other view: "Chart" (a map icon) from the finder and the
  pages, "Spots" (a list icon) on the chart.
- Theme: `.wf-top-bar__theme`, a round outlined icon button showing what it
  switches to (the sun in dark, the moon in light).
- Menu: `.wf-top-bar__menu`, the site menu's round button at the far right.

## Variants

- **Computer** (the default) and **phone** (under `sem.breakpoint.wide`, by
  the width): 56px tall, the search folded into a round button after the
  wordmark, the view button a little narrower, light or dark moved into the
  menu. `--phone` draws it at any width for a static rendering.

## States

- None of its own; its links and buttons carry theirs.

## Usage

- Every page with a head uses this bar and no other; no page draws its own
  masthead, nameplate or title band.
- At most one outlined button for the other view and a few section actions.
  The bar holds no filled button: the page's one filled action is in the page.
- No second rule, no shadow, no tint: the hairline is the bar's only edge.

## Accessibility

- A `<header>` landmark. The wordmark link is named for where it goes.
- The view button carries a `title` ("The full chart", "The list of spots");
  icon-only buttons (theme, menu, search on a phone) carry `aria-label`.
- The search is reached by "/" from anywhere on the page that is not a field.
- Every target is at least `sem.size.touch` on a coarse pointer.
