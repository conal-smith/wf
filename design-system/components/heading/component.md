# Heading

A heading (`ui/Heading.tsx`, `headingStyles`), in Inter and sentence case,
kept apart from what follows by space and never by a rule. It replaces the
old headline, section heading and kicker.

## Anatomy

- Row: `.wf-heading`, the title with an optional aside on the same line,
  wrapping on a narrow screen.
- Title: `.wf-heading__title`, an `<h1>`, `<h2>` or `<h3>`, Inter semibold in
  `sem.color.ink`, balanced across its lines.
- Aside (optional): `.wf-heading__aside`, at the right of the title's line, a
  link, a count or an action, in `sem.color.ink-muted`.
- Lead (optional, page step): `.wf-heading__lead`, the line under a page's
  heading, `sem.font.size.prose` in `sem.color.ink-2`, no wider than
  `sem.container.form`.

## Variants

- **Page** (`--page`): the page's own `<h1>`, 40px in the product (the
  nearest token here is `sem.font.size.headline`), `sem.font.size.title` on a
  phone, tracked tight; with a lead line under it.
- **Section** (`.wf-heading`, the default): an `<h2>` at
  `sem.font.size.lead` (19px), with a link or a count on the right ("All
  spots on the chart", "21 places").
- **Card** (`--card`): an `<h3>` at `sem.font.size.prose`, for a card's own
  title.

## States

- None.

## Usage

- Sentence case, always: "How the stars work", "The week". Never capitals,
  never tracked letters, never an eyebrow over the heading.
- No rule under a heading, and no frame round it: space separates it from what
  follows (`sem.space.x3` to `sem.space.x4` under a section heading).
- Inter for every heading. The only Fraunces on the site is the
  [Wordmark](../wordmark/component.md) and a spot's name as the title of its
  own page; that title is the spot page's, not this component's.
- The aside says something useful about the section: where to see all of it,
  how many there are. Not a second heading.

## Accessibility

- One `<h1>` a page; headings in order. Where the step's tag is wrong for the
  page's outline, the product sets `as` (`h2` styled as a card heading, say).
- The aside is outside the heading element, so it is not read as part of the
  title.
- Contrast: titles 18.8:1 (light) and 17.5:1 (dark); the lead 11.3:1 and
  11.9:1.
