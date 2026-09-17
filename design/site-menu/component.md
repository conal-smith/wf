# Site menu

The three lines. wingfoil.ie is two apps on one origin — the wind map and the
second-hand gear marketplace — and this is the one control that says so and
moves between them. It is chrome that floats over the map and sits in the
marketplace header, so it is the same component in both, never two.

It is a disclosure, not a menubar: a button that reveals a short `<nav>` of
links. Every link is a real `href`, because the two sections are separate
bundles chosen at load time and crossing between them is a page load.

## Anatomy

- `.f5-site-menu` — the positioning context. Nothing else.
- `.f5-site-menu__trigger` — a `.f5-button--icon` with the three lines, and on a
  coarse pointer a hit area padded out to `--sem-control-height-touch`.
- `.f5-site-menu__panel` — a `.f5-surface` hung below the trigger at
  `--sem-z-panel`, padded `--sem-space-gap-tight` so the rows carry the padding.
- `.f5-site-menu__list` — an unstyled list, one row per section.
- `.f5-site-menu__link` — a full-width `.f5-button` at
  `--sem-control-height-touch`, icon then label, left aligned.

## Variants

- `.f5-site-menu` — the only one of its own. Two sections is not a shape that
  needs variants: the menu always hangs from the left edge of its trigger, and
  the trigger always sits at the start of the chrome it belongs to, on both
  apps. A right-hung panel is the obvious next variant and is deliberately not
  here until something needs it.
- The trigger takes the button's own sizes — `.f5-button--sm` beside a row of
  small pills, the default beside 40px chrome — because the menu has to sit in
  scale with whatever header it is in. The hit area does not shrink with it.

## States

- `.f5-site-menu__trigger[aria-expanded="false"]` — closed. The three lines.
- `.f5-site-menu__trigger[aria-expanded="true"]` — open. The three lines become
  a close mark, so the state is not carried by the panel's presence alone. The
  label does not change with it: `aria-expanded` is what says open or closed,
  and a name that moves under a reader is worse than one that does not.
- `.f5-site-menu__trigger:hover` — the quiet button's hover fill.
- `.f5-site-menu__trigger:focus-visible` — the ring, unmodified.
- `.f5-site-menu__link:hover` — `--sem-color-action-quiet-hover`.
- `.f5-site-menu__link:focus-visible` — the ring, unmodified.
- `.f5-site-menu__link[aria-current="page"]` — the section you are already in:
  raised and filled, like a pressed button.

## Usage

Do give every row a real `href`. The sections are separate bundles and a client
router cannot cross between them.
Do mark the current section with `aria-current="page"`; the CSS hangs off that
attribute, so the paint cannot drift from the accessibility tree.
Do keep the list to the site's sections. This is wayfinding, not a command
palette: a row that does something rather than going somewhere belongs in the
header beside the menu.
Do not put a second way to reach the same section beside the menu. One control
per destination; a footer link at the other end of the page is not beside it.
Do not use it as a `role="menu"`. These are links in a `<nav>`, so a screen
reader announces them as links and arrow keys are not hijacked.
Do give the panel `--sem-color-surface-solid` and no backdrop filter when the
trigger sits inside another glass surface. The system does not stack glass, and
a panel that hangs out of a glass pill is otherwise two blurs deep.

## Accessibility

The trigger is a real `<button>` carrying `aria-expanded`, `aria-controls` and
`aria-haspopup`, and an `aria-label` because it has no text. The panel is a
`<nav aria-label="Site">` holding a list of links, which is what it is.

Opening moves focus to the first row; Escape closes and returns focus to the
trigger; moving focus out of the menu closes it, so there is no trap. The
product must make sure Escape with the menu open closes only the menu — on the
map that means capturing the key before the app's own global handler sees it.

The current section is in the tree as `aria-current="page"` and in the paint as
elevation plus fill, never as colour alone. On a coarse pointer the trigger's
hit area is `--sem-control-height-touch` and every row is that tall, so nothing
here is under the target floor. The panel's entry animation is dropped under
`prefers-reduced-motion: reduce`.
