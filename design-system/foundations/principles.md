# Principles

The rules tokens cannot carry. Tokens decide what a value is; these decide
when you may reach for it. Read before drawing anything this system does not
already cover.

wingfoil.ie is **premium, modern and flat**: a near-black page (or a white
one), soft grey cards kept apart by space, one typeface for everything, and
colour only where it means something. The site is a map with tools over it,
and pages that are read (the spot page, the finder, the marketplace, the
community). On the map, the map is the product, and everything else earns the
pixels it covers the sea with.

The product's single source of design values is `ui/theme.css` (Tailwind v4
`@theme`), and its primitives are `ui/*.tsx`. This bundle restates both, held
equal by the project's drift check (`scripts/lint-design-tokens.mjs`).

## Two themes, dark first

**Dark is the default; light is the other.** The product opens dark unless the
rider has chosen light (or their device's setting); `shared/web/theme.ts` sets
`data-theme="dark"` on the page before the first paint. In this bundle
`foundations/tokens.css` carries light at `:root` and dark under
`[data-mode="dark"]`, so a surface that follows the product sets
`data-mode="dark"` on its root.

- Every surface works in both. Consume the semantic tokens and both come for
  free; never write a colour for one theme only.
- Dark is near-black (`sem.color.ground`), neutral greys, no blue shift; its
  soft card (`sem.color.sunken`) is a step lighter than the ground.
- Wind colours, Met Éireann's warning colours and the weather's marks mean the
  same on any ground and do not change between themes.

## Type: Inter for everything

- **Inter** (`sem.font.family.body`) sets every heading, label, figure and
  sentence. Figures are tabular.
- **Fraunces** (`sem.font.family.display`) is for two things only: the
  [wordmark](../components/wordmark/component.md), and a spot's name as the
  title of that spot's own page. Never a heading, a name in a list, a popup or
  the dock, a figure, or a demo's head.
- **Sentence case everywhere.** No capitals for labels, no letter-spaced
  eyebrows, no small caps. A name keeps its own spelling (HARMONIE, ECMWF,
  WSW) because it is a name.
- No italic serif. The only italic is ".ie" in the wordmark.
- Headings are [Heading](../components/heading/component.md): a page's (40px
  in the product, 32 on a phone, with a lead line), a section's
  (`sem.font.size.lead`, 19px) and a card's (`sem.font.size.prose`, 15px).
  One page heading a page.
- A small label is Inter at `sem.font.size.label` (12px) in
  `sem.color.ink-muted`, over or beside what it names.
- A field on a coarse pointer is `sem.font.size.input` (16px), so a phone does
  not zoom.

## Structure: space and soft cards

- **Space separates.** Sections sit apart by space (`sem.space.x8` and up),
  cards by `sem.space.x3` to `sem.space.x4`, a heading from its content by
  `sem.space.x3` to `sem.space.x4`.
- **Soft cards group.** A [Card](../components/card/component.md) is
  `sem.color.sunken` with `sem.radius.surface`, no border, no shadow. Do not
  nest a soft card in a soft card.
- **Two greys for controls: the well and the raised grey.** A control's fill
  (a soft button, a segmented control's well, a chip, a tag, a number field, a
  filled field, a search, the current tab) is `sem.color.well`: the soft grey
  on the ground. A soft card, [Rows](../components/rows/component.md) and a
  [Notice](../components/notice/component.md) carry `on-card` (`.wf-on-card`
  in this bundle), which sets the well to `sem.color.raised`, the second grey,
  inside them, so a control still shows on a card. Never fill a control with
  `sem.color.sunken` directly: that is the card's grey. A small square on a
  card that must stand out from it (a notice's info or water-advice sign) is
  `sem.color.raised`.
- **Hairlines only inside a card**: `sem.rule.hairline` of `sem.color.line`
  between [Rows](../components/rows/component.md), between the rows of a
  table, above a dialog's actions, under the top bar. Never round a card,
  never under a heading, never heavier than a hairline, never doubled.
- **Over the map, a box floats**: `sem.color.ground` with `sem.shadow.float`
  (the popup, the layers, the time bar) or `sem.shadow.dock` (the dock), and
  in dark a faint `sem.color.line` edge as well, because a shadow barely shows
  on a dark chart.
- **A sheet** (a dialog, a menu, the dock) has `sem.radius.dialog`; under
  640px a dialog becomes a sheet up from the foot of the screen, with a grabber
  and full-width actions.
- **Corners by size**: `sem.radius.control` (10px) for a field or a small box,
  `sem.radius.surface` (14px) for a card, `sem.radius.dialog` (18px) for a
  sheet. Anything pressed (a button, a chip, a segment, a search) is round-ended
  (`sem.radius.full`); an icon button is a circle.
- Glass (`sem.color.glass`) only for a tag over a photograph, solid for a
  reader who asks for less transparency.

## Flat

- No gradients on controls or boxes, no sheen, no raised shadow, no inset
  frame, no paper texture, no nudge when pressed.
- Shadows are for what floats over something else, and only the elevation
  tokens: `sem.shadow.float`, `sheet`, `dock`, and `sem.shadow.control` under a
  chosen segment or a switch's thumb.
- The dark hours are faintly shaded (`sem.color.hatch`), never left blank and
  never rated.

## Buttons, chips and tags

- **One filled button a view**, or none: `Button variant="primary"`, the next
  thing to do ("Show 12 spots", "Get started"). Everything else is outlined
  (the default), soft (a grey fill, a second action beside an outlined one),
  quiet (Reset, Clear, Skip, Close) or a link. If a view seems to need two filled buttons, the
  hierarchy is wrong.
- The destructive answer is `danger`, only inside a confirm dialog.
- **A chip is a choice you can press**: a soft capsule, filled in ink when it
  is on (`aria-pressed`), or a filter in use with a cross that removes it.
- **A tag is a word that describes** and cannot be pressed: Offshore, Unsure,
  now, new. Never make a tag look pressable or a chip look like a label.
- One of a few options, all in view, is a
  [Segmented](../components/segmented/component.md) control; the parts of one
  page are [Tabs](../components/tabs/component.md); a setting that takes effect
  at once is a [Switch](../components/switch/component.md).

## Colour means something

- **The ink colour** (`sem.color.ink`, near-white in dark, near-black in
  light) is the filled button, a chosen chip, a chosen segment's words, the
  selected hour.
- **The accent** (`sem.color.chart-magenta`, `sem.color.focus`) marks **the
  best of something, once** (a five-star light, the present hour on a tide
  curve, the letters found in a search, ".ie" in the wordmark) and is **the
  focus ring**: 2px, 2px clear, the same on every control. A field holding the
  focus takes the ink edge and a soft ring of the accent instead.
- **The warm red** (`sem.color.pen`, its words `sem.color.pen-ink`) marks the
  time now and what is off (offshore, a gust well over the mean, a destructive
  answer). It is never a fill for a control, a status or emphasis.
- **Warn** (`sem.color.warn`, `sem.color.warn-ground`) means *something is
  wrong*: an error under a field, a failed load.
- **Met Éireann's yellow, orange and red** are a weather warning's own
  colours, on a [Notice](../components/notice/component.md)'s square or a
  notice mark, with the level said in words.
- **Wind colours mean wind speed.** The fourteen `sem.color.wind.*` stops are
  speed bands and nothing else, the same for every rider.
- Never let colour alone carry a state: pressed is filled, offshore is struck
  and worded, a warning says its level in words.

## Little text, figures first

A view says what it has to in figures, a few short labels, and a line or two
of sentences at most. If a sentence can be a figure, make it one: `14 g22`,
`6.5 m`. One big figure and one short line a card. Labels name a thing in a
word or two. Every sentence is plain, everyday English for a rider with no
technical knowledge, in British and Irish spelling.

## Accessible by default

- **Contrast**: words at 4.5:1 or more in both themes; `sem.color.ink-muted`
  is the floor for words. `sem.color.line-strong` and
  `sem.color.ink-disabled` are a stroke's 3:1, never text.
- **Tap targets**: nothing pressed is shorter than `sem.size.touch` (44px) on
  a coarse pointer; a control drawn smaller grows its hit area instead.
- **Focus**: the one ring, never restyled, never removed without a
  replacement.
- **Motion**: every transition and animation stops for a reader who asks for
  reduced motion.

## Mobile first

Draw at 390 wide first, then let it open at 720 (`sem.breakpoint.wide`) and
900 (`sem.breakpoint.rail`). The dock, the popup and the spot page are phone
layouts that widen, not desktop layouts that shrink.

## Don't

- Don't write a colour, a px, a radius or a duration that a token holds. A
  missing value is a missing step: add it to `ui/theme.css` and to
  `tokens.tokens.json`, together.
- Don't put a second filled button on a view.
- Don't use Fraunces for anything but the wordmark and a spot's name as its
  page's title.
- Don't set a label in capitals or space its letters; don't use italic serif.
- Don't frame a box, draw a rule round a card, use a heavy or double rule, or
  put a rule under a heading.
- Don't add paper texture, a gradient, a sheen, a raised shadow or a glow.
- Don't draw anything by hand (a pen note, a scribble, a lifted card), and
  don't use a mascot.
- Don't use the accent for "best" twice on one view, or as body text; don't
  use the warm red as a control or emphasis.
- Don't use the wind ramp for anything but wind speed.
- Don't restyle the focus ring.

## Gaps, recorded rather than invented

- **The faces.** The bundle names Fraunces and Inter; it does not ship them.
  The product self-hosts them (`ui/fonts.css`). The catalog draws them only
  where they are installed, and falls back to Georgia and the system sans
  otherwise.
- **Type steps the tokens do not carry yet.** The product's page heading is
  40px (32 on a phone) and a spot's name on its page 54px (`text-big`,
  `text-big-sm`, `text-name` in `ui/theme.css`, under the spot report's
  banner); the token file has no step for them, so the bundle's
  [Heading](../components/heading/component.md) uses `sem.font.size.headline`
  (44) and `sem.font.size.title` (30) until they are added.
- **Theme-fixed colours.** The slider's white thumb and the signs on Met
  Éireann's colours (near-black on yellow, white on orange and red) are the
  same in both themes; no token is fixed across modes, so those few values are
  literals marked `ds-lint-allow`.
- **Translucent tints.** The soft focus ring round a field (the focus colour
  at 20%) has no token; it is a `color-mix()` marked `ds-lint-allow`.
- **A few dark-only rules.** The chosen segment, a floating card and a dialog
  differ in dark beyond their tokens (a lighter grey instead of the ground; a
  faint edge). The product writes these as `dark:` utilities; the bundle as a
  `[data-mode="dark"]` rule beside the light one.

## Rulings

Dated, because an undated rule cannot be told from an opinion.

- **2026-09-14 — The ramp is derived from the product, not invented.** Every
  colour literal in the map's sources was harvested and clustered.
- **2026-09-14 — A legend is generated from `PALETTE`, never restated.**
- **2026-09-14 — Shape carries kind on the map; colour carries the reading.**
  A light says what kind of place by its shape; colour on it means stars or
  wind, never both.
- **2026-09-16 — Model identity hues stay out of the theme**, inside the
  forecast chart and the display filter's swatches only.
- **2026-09-20 — Tailwind is the system.** `ui/theme.css` is the only source of
  design values; arbitrary values and colour literals are refused by
  `npm run ui:lint`.
- **2026-10-05 — The bundle's names are the product's.** A sem colour is the
  Tailwind name unchanged (`--color-ink-muted` is `--sem-color-ink-muted`),
  except the accent, which is a group. A handful of `interop` aliases
  (`sem.color.bg.app`, `text.primary`, `font.family.ui`, …) exist only so the
  catalog draws in the brand; components never use them.
- **2026-10-05 — The map's vocabulary is part of the system.** The spot's
  light, the shore compass, the wind-and-gust figure, the tide label and the
  dock's hour cell repeat across the map, the dock, the popup and the spot
  page, and are components here.
- **2026-11-01 — The new brand.** Premium, modern and flat. Dark is the
  default theme and light the other. Inter for everything; Fraunces only for
  the wordmark and a spot's name as its page's title. Sentence case. Structure
  by space and soft cards, hairlines only inside a card. One filled button a
  view; chips are pressable choices and tags are words. The paper, its
  texture, the frames and double rules, the hand-drawn marks and the mascot
  are gone, and so are the kit's parts that drew them (the masthead, the
  kicker, the old headline and section heading, the pane and the surface).
