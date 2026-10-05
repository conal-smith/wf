# Principles

The rules of the chart that tokens cannot carry. Tokens decide what a value is;
these decide when you may reach for it. Read before drawing anything this
system does not already cover.

wingfoil.ie is drawn as **an Admiralty chart crossed with an old broadsheet
weather report**: paper and ink, the chart's magenta, a red pen used sparingly,
four faces, thin ink rules and double-rule frames, and the puffin. The site is a
map with tools over it, and pages that are read (the spot page, the
marketplace, the community). On the map, the map is the product, and everything
else earns the pixels it covers the sea with.

The product's single source of design values is `ui/theme.css` (Tailwind v4
`@theme`), and its primitives are `ui/*.tsx`. This bundle is a faithful
restatement of both, held equal by the project's drift check
(`scripts/lint-design-tokens.mjs`). Where this file and the signed-off mockup
(`design/chart/1-the-chart.html`) disagree on a look, the mockup wins; where they
disagree on a rule (contrast, tap targets, one filled action), this file wins.

## The accent rule

**One filled action per view.** `sem.color.accent.primary` is the filled action:
the ink pill, magenta under the pointer (`sem.color.accent.hover`). A view has
one, or none. Everything else that can be pressed is quiet, ruled in ink, or a
link. A destructive confirmation is a dialog of its own, and its one filled
button is the warm `danger` pill.

**The chart's magenta** (`sem.color.chart-magenta`) marks **the best of
something, once**: a five-star light, the spot in view, a quantity's bar
(`sem.color.wash`, drawn faint), `.ie` in the wordmark, a link under the
pointer. And it is **the focus ring** (`sem.color.focus`): 2px, 2px clear, the
same on every control.

**The red pen** (`sem.color.pen`, its words `sem.color.pen-ink`) marks **the one
thing that matters in a view**: a loop round the best hour, an underline under
the word that carries the note, a strike through what is off (offshore, sold),
and the note itself in Kalam. One mark on a view, two at most. It is never a
fill, never a control, never a status, never emphasis.

**Warm is not an accent.** `sem.color.warn`, `sem.color.now` and
`sem.color.warn-ground` mean *this instant* or *this is degraded*, and nothing
else. The warm red is not the pen's red.

**Wind colours mean wind speed.** The fourteen `sem.color.wind.*` stops are
speed bands and nothing else, and they do not re-theme: 35 knots is the same
colour on any paper, night included.

## What structure is made of

**Rules, not surfaces.** One sheet of paper: `sem.color.ground`,
`sem.color.card` and `sem.color.solid` are the same value. A thing is set apart
by an ink rule round it or under it, as a chart boxes its title and a broadsheet
heads its columns.

- `sem.rule.hairline` in `sem.color.ink` frames a box.
- `sem.rule.hairline` in `sem.color.line` divides rows inside it, and nothing
  heavier.
- `sem.rule.heavy` in ink heads a section (`Pane kind="ruled"`,
  `SectionHeading`). Most of a page is this, not boxes.
- `sem.rule.double` (a CSS `double` border) runs along an edge: the masthead's
  foot, the dock's top, a page's foot. Write the other three sides to zero
  first.
- **The double rule round a box** is a 1px ink border plus `sem.shadow.frame`
  (three of paper, then one of ink, inset): the chart's box, for a dialog,
  anything over the map, a popup.

**Four kinds of box, told apart by their rules, not their fill**: the pane (one
rule), the chart's box (the double rule), the pill (a capsule, for what is
pressed) and the dock (a double rule along its top). A new thing that fits none
of them should be a section under a rule.

**Over the map, paper is opaque.** Glass (`sem.color.glass`) survives only as a
badge over a photograph, and goes solid for a reader who asks for less
transparency.

**Shadows are small and warm**: `sem.shadow.control`, `marker`, `surface`,
`dock`. Paper lifts off paper; it does not float. Everything at one layer casts
the same shadow. No drop shadow beyond these four.

**The paper's grain** (`sem.texture.grain`) is a background image beside the
paper fill on a section root, the masthead, a card pane, a Surface and a
Dialog. Never over the moving map.

**The dark hours** are shaded with the hatch (`sem.color.hatch`, a fine 135°
diagonal), never left blank and never rated.

## Ceilings

**Type.** Four faces, each with one job: `sem.font.family.display` (Fraunces:
names, headings, the wordmark), `body` (Newsreader: the few sentences),
`mono` (IBM Plex Mono: every figure, tabular, and every label in tracked
capitals), `hand` (Kalam: the pen, and nothing else). Eleven steps:

- `eyebrow` 10px is the floor, for the mono label in tracked capitals only.
- `caption` 11px is the floor for sentence case.
- Per surface: **one `title`** (30). Per page: **one `headline`** (44), and only
  on a page that is read; it steps to `title` under 720px. Per view: **one
  `reading`** (48), the wind speed.
- A map panel (the popup, a Surface, the dock's head) tops out at `lead` (19):
  the spot's name. Its figures are `figure` (19) or less.
- A field on a coarse pointer is `input` (16), so a phone does not zoom.
- Five weights; `extrabold` (800) is the wordmark's alone.

**Radius.** Square, as print is: `sem.radius.surface` and `sem.radius.dialog`
are 0. A field keeps `sem.radius.control` (2px), so it reads as a box to write
in. Anything pressed is a capsule (`sem.radius.full`). A rounded box is a
mistake; so is a squared capsule. The one exception is the instrument over the
map (Button `raised`): a square box, on purpose.

**Tap targets.** Nothing pressed is shorter than `sem.size.touch` (44px) on a
coarse pointer. A control drawn smaller grows its hit area instead.

**Contrast.** `sem.color.ink-muted` is the floor for words. `line-strong` and
`ink-disabled` are a stroke's 3:1, never text. The pen's marks are `pen`, its
words `pen-ink`.

## Little text, figures over prose

A view says what it has to in figures, a few words of mono label, and a line or
two of sentences at most. If a sentence can be a figure, make it one: `14 g22 ·
WSW · 6.5 m`, not "fourteen knots gusting twenty-two". A figure leads, its unit
small after it, a gust raised over the mean (`Figure`). Labels name a thing in
a word or two and never say a sentence. The Almanac (the house voice) speaks in
the pen's notes and the odd line of small print, plainly, in British and Irish
spelling; the puffin signs it, one a view at most.

## Mobile first

Draw at 390×844 first, then let it open at 720 (`sem.breakpoint.wide`) and 900
(`sem.breakpoint.rail`). The dock, the popup and the spot page are phone
layouts that widen, not desktop layouts that shrink. Demos and patterns in
this bundle are drawn at phone width unless they say otherwise.

## Don't

- Don't write a colour, a px, a radius or a duration that a token holds. A
  missing value is a missing step: add it to `ui/theme.css` and to
  `tokens.tokens.json`, together.
- Don't put a second filled action on a view.
- Don't use the pen for more than the one thing that matters, or as a fill, a
  control, a status or emphasis.
- Don't use magenta for "best" twice on one view, or as body text.
- Don't use warm to make something stand out.
- Don't use the wind ramp for anything but wind speed.
- Don't lay a translucent or blurred panel over the map.
- Don't round a box, or square a capsule.
- Don't add a drop shadow, a gradient fill or a glow. Structure is rules.
- Don't set sentences in the mono face, or figures in the body face.
- Don't restyle the focus ring.
- Don't let colour alone carry a state: pressed is filled *and* heavier; offshore
  is struck through *and* red; warn has an icon *and* words.
- Don't draw a second puffin, or a second headline.

## Gaps, recorded rather than invented

- **The faces.** The bundle names Fraunces, Newsreader, IBM Plex Mono and
  Kalam; it does not ship them. The product self-hosts them (`ui/fonts.css`).
  The Studio door and the catalog draw them only where they are installed, and
  fall back to Georgia, the system monospace and a cursive otherwise.
- **The tide curve's line.** The mockup strokes it in `#3F6E7E`, a darker teal
  than `sem.color.depth`, which has no token; the bundle draws it in `depth`
  over a `sea` fill until the product rules on it.
- **The wind-range bar** of the mockup's spot page (models and ensembles) uses
  hues that are not in the theme; it is left out of the bundle.
- **Hover on the map's lights** (the mockup scales the glyph 1.18×) is not in
  the product yet; the light component shows it as the mockup draws it.

## Rulings

Dated, because an undated rule cannot be told from an opinion. Carried over
from `docs/DESIGN_PRINCIPLES.md`, restated in this bundle's names, then this
bundle's own.

- **2026-09-14 — The ramp is derived from the product, not invented.** Every
  colour literal in the map's sources was harvested and clustered.
- **2026-09-14 — A legend is generated from `PALETTE`, never restated.**
- **2026-09-14 — Shape carries kind on the map; colour carries the reading.**
  A light says what kind of place by its shape; colour on it means stars or
  wind, never both.
- **2026-09-16 — Model identity hues stay out of the theme**, inside the
  forecast chart and the display filter's swatches only.
- **2026-09-16 — Two type steps for pages that are read: `lead` and `prose`.**
- **2026-09-17 — A page that is read stands on `ground`, its boxes on `card`.**
  Since 2026-10-05 the two are one paper.
- **2026-09-20 — Tailwind is the system.** `ui/theme.css` is the only source of
  design values; arbitrary values and colour literals are refused by
  `npm run ui:lint`.
- **2026-09-21 — The map's filled action stays on the accent** (D13).
- **2026-09-21 — An active filter is a line, not a fill** (a border and an inset
  ring in the accent), so it does not rival the one filled action.
- **2026-10-05 — The chart.** Paper (`#f3eee3`) and ink (`#1a1d21`), structure
  in rules, opaque paper over the map, square boxes, the focus ring in the
  chart's magenta, four self-hosted faces on eleven steps, and the red pen with
  its own rule. Measured on paper: ink 14.62:1, ink-2 9.54:1, ink-muted 5.80:1
  (5.40:1 on sunken), line-strong 3.66:1, chart-magenta 5.70:1, warn 5.68:1,
  pen 4.09:1 (a stroke), pen-ink 4.93:1 (words), paper on the hovered accent
  5.70:1.
- **2026-10-05 — No dark mode in the product: the chart is paper.** The
  product ships light only (D9). A **night chart** (as a chart is read under a
  red light on a night passage) is a possible later mode. The Studio's Design
  door requires a bundle to declare both modes, so this bundle carries a
  restrained night chart as a **proposal**: warm dark ink paper (`#1d1c19`,
  never blue-shifted), paper-coloured ink, magenta lifted to `#e6609f` (4.9:1+)
  and the pen to `#ef5f4f`, the wind ramp, the now-marker, the gust cap and the
  buoy unchanged. No product surface reads it. It needs its own contrast pass
  and a dark basemap before it is offered.
- **2026-10-05 — The bundle's names are the product's.** A sem colour is the
  Tailwind name unchanged (`--color-ink-muted` is `--sem-color-ink-muted`),
  except the accent, which is a group. A handful of `interop` aliases
  (`sem.color.bg.app`, `text.primary`, `font.family.ui`, …) exist only so the
  Studio's catalog and door draw in the brand; components never use them.
- **2026-10-05 — The map's vocabulary is part of the system.** The spot's
  light, the shore compass, the wind-and-gust figure, the tide label and the
  dock's hour cell repeat across the map, the dock, the popup and the spot
  page, and are components here, drawn as the mockup draws them.
