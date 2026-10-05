# Masthead

The header every page that is read shares (`ui/Masthead.tsx`,
`mastheadStyles`, `MastheadMark`): the site menu, the nameplate with its
section in the mono label, and the section's few actions set right, over the
broadsheet's double rule.

## Anatomy

- Root: `.wf-masthead` — a sticky `header` at the top, at
  `sem.z-index.header`, on `sem.color.ground` with `sem.texture.grain`, its
  top padding `sem.space.x2` or the notch's inset, whichever is larger.
- Bar: `.wf-masthead__bar` — a flex row at least `sem.space.x14` tall,
  `sem.space.x3` gaps, `sem.space.x2` under, the `sem.rule.double` ink rule
  along its foot only.
- Menu: the site menu's trigger, a Button `--raised --icon --sm` (the square
  instrument) with an aria-label.
- Brand: `.wf-masthead__brand` — the caller's link, holding a Wordmark `--md`
  with `.wf-masthead__mark` and, where the page is not the map's own, the
  section.
- Section: `.wf-masthead__section` — the mono label in `sem.color.ink-muted`
  after a `sem.rule.hairline` in `sem.color.line`, `sem.space.x3` clear of it:
  MARKET, COMMUNITY.
- Actions: `.wf-masthead__actions` — set right, `sem.space.x2` apart: the one
  filled action, Sign in.

## Variants

- From 720px (`sem.breakpoint.wide`) the name and the section sit side by side.
- Under 720px the section stands under the name with no hairline, the
  wordmark steps to `sem.font.size.lead`, the bar's gaps close to
  `sem.space.x2` and the actions' to `sem.space.x1`, so the menu, the name and
  two actions share 390px. `.is-narrow` on the root holds this layout at any
  width for the catalog; the product reaches it through the media query only.

## States

- Focus: the brand link draws the one ring, `sem.ring.width` of
  `sem.color.focus`, `sem.ring.offset` clear, round its `sem.radius.control`
  corners (`.is-focus` holds it in the demo).
- The menu and actions keep their Button states.
- The demo holds the masthead in place (`position: static`), as the product's
  own gallery does; on a page it sticks to the top.

## Usage

- Every page that is read starts with it: market, community, the spot page.
  The map has its own head and does not use it.
- The brand link is the section's own, because each router takes a link over
  in its own way; the classes and the mark inside it are these.
- One filled action at most in the actions, usually none.
- Load the Button and Wordmark CSS beside it.

## Accessibility

- A `header` landmark; the actions in a `nav` with its own `aria-label`
  ("Marketplace").
- The brand link carries an `aria-label` naming where it goes ("wingfoil.ie
  Market, home"); the menu button an `aria-label` ("Site menu").
- The section label is `sem.color.ink-muted`, 5.8:1 on paper.
