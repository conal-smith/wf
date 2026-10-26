# The chart: wingfoil.ie's brand

An Admiralty chart crossed with an old broadsheet weather report. Paper and
ink, the chart's magenta, and a red pen that circles the one hour worth going
for and writes why in the margin. The owner's words: "original… unique… keeps
that kind of look and feel of old kind of weather report."

**The reference is the mockup**, `design/chart/1-the-chart.html` in the
`wingfoil-design` worktree, with its kit `design/chart/chart-kit.js` and its
screenshots `design/chart/shots/1-*.jpg`. Open it and use it before you
draw anything. Where this file and the mockup disagree on a look, the mockup
wins. Where they disagree on a rule (contrast, tap targets, one filled
action), this file and [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md) win.

Every value below lives in `ui/theme.css` and nowhere else
(`npm run ui:lint` enforces it). The gallery at `/ui` (dev only) shows all
of it.

## The rules

1. **Very little text.** A page says what it has to in figures, a few words
   in the mono label, and at most a line or two of sentences. If a sentence
   can be a figure, make it one. If a label can go, it goes.
2. **Figures over prose.** `14 g22 · WSW · 6.5 m`, not "fourteen knots
   gusting twenty-two from the west-south-west". Figures are set in the mono
   face with tabular digits (`Figure`, or `font-mono tabular-nums`).
3. **Mobile first.** Draw it at 390×844 first, then let it open out at 720
   (`wide:`) and 900 (`rail:`). Nothing pressed is shorter than 44px on a
   finger. A field is 16px on a touch device.
4. **The pen is for the one thing that matters.** One mark on a view, two at
   most: a loop round the chosen spot or hour, a line at now, a strike
   through what is off. It marks and does not comment: no verdict beside the
   mark ("Go 13:00–16:00" is not written; see the information rule in
   DESIGN_PRINCIPLES.md). The pen is never a fill, a control or a status.
5. **One filled action per view.** The ink pill (`Button variant="primary"`),
   magenta under the pointer. Everything else is ruled in ink, or quiet.
6. **Rules, not surfaces.** One paper. Things are set apart by an ink rule
   round them or under them, not by a lighter card on a darker ground. Most
   of a page is sections under a heavy rule; boxes are for what stands alone.
7. **Plain, clear English.** Every word is written for a rider with no
   technical knowledge who is learning the site. Say what a thing is and
   what it does, in full everyday sentences: "Take a 30-second tour of how
   the site works." No riddles, puns, wordplay, metaphors, clipped or
   poetic phrasing, and no jargon a newcomer would not know (no "MCP",
   "server", "blend", "model run" in a sentence a rider reads). Read every
   line aloud: if it needs a second read, rewrite it plainer. British and
   Irish spelling.
8. **The puffin is a picture, not a speaker.** It may sit on a view, one at
   most, but no words are signed by or credited to "the Almanac", and the
   name is not used in anything a rider reads.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| `ground`, `card`, `solid` | `#f3eee3` | The paper. One value: the page, a box, the fallback for glass. |
| `sunken` | `#ede6d6` | The paper's second sheet: a well, a tinted row, the current menu row. |
| `glass` | `#f3eee3eb` | Paper over a photograph only (`Chip tone="glass"`). Never over the map. |
| `ink` | `#1a1d21` | Text, rules, the filled action, the inverse fill. 14.6:1. |
| `ink-2` | `#3b3c3e` | Secondary text. 9.5:1. |
| `ink-muted` | `#5b5c5b` | The floor for words: labels, small print. 5.8:1, 5.4:1 on `sunken`. |
| `line` | ink at 20% | The hairline between rows. |
| `line-strong`, `ink-disabled` | `#7c7b78` | A field's box, a disabled icon. Strokes only, 3.7:1. |
| `chart-magenta` | `#b0186a` | The best of something (a five-star light, the selected spot), a quantity's bar (`wash`), the focus ring, the filled action hovered. |
| `pen` | `#d43a2c` | The pen's strokes: loops, underlines, strikes. 4.1:1, a mark. |
| `pen-ink` | `#bf3125` | The pen's handwriting. 4.9:1, reads as words. |
| `warn`, `now` / `warn-ground` | `#b02a1f` / `#efd8cd` | Degraded, an error, the present instant. Not the pen. |
| `ok` | `#2a7046` | One liveness mark. |
| `buoy` | `#e9b200` | The puffin's beak, a light on the chart. Never text. |
| `sea` | `#d5e6ea` | The ground the map floats on. |
| `sea-1` … `sea-4` | `#a9cbd8` … `#ecf0ea` | Depth tints, shallow to deep (under 1 m, ~3 m, ~10 m, 30 m+). |
| `depth` | `#5f8c9c` | Contours and soundings. |
| `land`, `relief` | `#ede3c8`, `#b59e74` | Land buff, and its relief lines. |
| `basemap-water`, `basemap-land` | `#e5edea`, `#ede3c8` | What WindMap paints over the basemap. |
| `wind-k00` … `wind-k65` | unchanged | Wind speed and nothing else. |
| `weather-sun` | `#e9b200` | The sun, a thunderbolt: the buoy's own yellow. A fill, never text. |
| `weather-rain` | `#3a7fb0` | Rain: a drop, a shower's streaks, the rain row's tint. 3.75:1, a mark, never words. |
| `weather-cloud`, `weather-night` | `#d6d0c2`, `#e7dcb4` | A cloud's grey and the moon's pale fill, inside an ink outline only. |
| `stars-1` … `stars-5` | `#e28bb3` … `#7c0f55` | A rider's stars as colour, pale pink to deep magenta: a filled star, a day's rideable line. The spot finder only, for now. Never text, never the wind. |

**Colour, only here.** The weather's state (sun, rain, cloud, night), the
wind-speed scale, a rider's stars on the spot finder's cards, the chart's
magenta for the best of something, and the warm red for a warning. Everything else is ink on paper. A glyph carries colour as
a chart draws a buoy: an ink outline, and the colour inside it.

## Type

Four faces, self-hosted from `ui/fonts.css`, each with one job:

| Class | Face | Job |
| --- | --- | --- |
| `font-display` | Fraunces (optical size axis) | Names, headings, the wordmark, a headline. Its italic for a spot's name in a list. |
| `font-body` | Newsreader | The few sentences there are; a field's text; italic for placeholders and hints. |
| `font-mono` | IBM Plex Mono | Every figure, and every label in tracked capitals. |
| `font-hand` | Kalam | The pen's notes. Nothing else. |

Headings (`h1`–`h4`) take the display face from the site's reset; any
utility on the heading still wins. A step is a size with its own leading, and
its weight and tracking where it has one; the face is named beside it:

| Step | Size | Typical pairing |
| --- | --- | --- |
| `text-eyebrow` | 10, 500, 0.14em | `font-mono uppercase`: the mono label (`Kicker`, `MONO_LABEL`). |
| `text-caption` | 11 | `font-mono`: small figures; the small print. |
| `text-label` | 11, 500, 0.09em | `font-mono uppercase`: a control's words (every `Button`). |
| `text-body` | 13 | `font-body`: secondary sentences. |
| `text-prose` | 15 | `font-body`: sentences. |
| `text-input` | 16 | A field on a touch device. |
| `text-lead` | 19, 600 | `font-display`: a section's heading, a card's name. |
| `text-figure` | 19, 600, −0.02em | `font-mono`: the number a row is about. |
| `text-title` | 30, 700 | `font-display`: a page's head where there is no headline. |
| `text-headline` | 44, 700, −0.035em | `font-display optical-display`: one a page (`Headline`). Steps to `title` under 720. |
| `text-reading` | 48 | `font-mono`: the wind reading, one a view. |

`optical-display` sets Fraunces at its high-contrast display cut whatever its
size: the wordmark and the headline use it. Elsewhere the browser picks the
optical size from the font size.

## Shape, rules and paper

- **Spacing** is the 4px step (`p-4` is 16px).
- **Rules.** `border border-ink` frames a box; `border-b border-line` divides
  rows; `border-b-2 border-ink` heads a section; the double rule is
  `border-0 border-b-3 border-double border-ink` along an edge (the masthead,
  the dock) or `border border-ink inset-shadow-frame` round a box (the
  chart's box). **Write `border-0` before `border-double`**: there is no
  reset, so a border style set on all four sides draws all four at the
  browser's 3px.
- **Radius** (mixed and rounded, 2026-10-24). A control is 10px
  (`rounded-control`), a box 14px (`rounded-surface`), a sheet 18px
  (`rounded-dialog`: a dialog, the dock, a menu); anything pressed is still a
  capsule (`rounded-full`). Print rules stay square.
- **Shadow.** By elevation, soft and stacked, after the frame:
  `inset-shadow-frame shadow-card` for a card on a page,
  `shadow-float` for anything over the map, `shadow-sheet` for a dialog,
  `shadow-dock` for the dock. A small control has its own (`shadow-control`
  under `sheen-ink`, `shadow-raised` under `sheen-raised`). A rule casts none.
- **Paper grain.** `paper-grain` is a background image only; pair it with
  the fill (`bg-ground paper-grain`). Every section root, the masthead, a
  card Pane, a Surface and a Dialog carry it. Do not lay it over the map.
  A small box over the chart takes `paper-float` instead: the grain over the
  faintest light from above.
- **Night.** `hatch` is the fine diagonal ink hatch for the dark hours.
- **Motion.** `animate-ink` (the pen drawing in, on a path with
  `pathLength="1" strokeDasharray="1"`), `animate-bob` (the puffin), always
  with `motion-reduce:animate-none`.
- **Focus.** One ring: 2px of magenta, 2px clear (`RING` in `ui/tv.ts`).
- **Hover** is for a mouse. `hover:` only applies under
  `(hover: hover) and (pointer: fine)`, so a finger's tap never leaves a pill
  inked; a hover in plain CSS goes inside the same `@media` (the map's
  stylesheets do, and `tests/ui-theme.test.ts` checks them).

## The kit

Import from `ui/` (`import { Button } from "../../ui"`). Each component
exports its recipe (`buttonStyles`, …) for a link a router owns.

| Component | What it is | Notes |
| --- | --- | --- |
| `Button` | Mono capitals. `primary` ink pill · `pill` ruled capsule · `quiet` · `raised` the square instrument over the map · `link` the underlined "← Chart" · `danger` | `pressed`, `icon` (needs `aria-label`), `size` sm/md/lg, `href` makes it a link. |
| `Segmented` | A ruled capsule of choices, the one that is on filled in ink (the satellite's in Layers) | `stack` for a ruled column of choices. |
| `Surface` | The chart's box over the map: opaque paper, grain, double rule | `rule="single"` inside another box. |
| `Pane` | A box on a page | `kind` card (one ink rule) · sunken · ruled (a heavy rule above, the broadsheet's section); `double`; `standing`. |
| `Dialog`, `ConfirmDialog` | The chart's box as a modal; title in the display face | Unchanged API. |
| `Field`, `TextInput`, `TextArea`, `Select`, `Checkbox` | Mono label, body-face text, italic placeholder, ruled box | Unchanged API. |
| `SearchField` | A rule to write on, italic placeholder | `size` md/lg/hero. |
| `Chip` | A mono tag on the second sheet, hairline capsule | `tone` neutral/warn/glass, `eyebrow`. Never pressed. |
| `Count` | A figure in a ring, like a chart's light | `tone` strong/quiet. |
| `Avatar` | A monogram in Fraunces italic, in an ink ring | Unchanged API. |
| `Notice`, `Empty`, `Pager`, `Skeleton`, `Link` | Restyled; same APIs | `Notice` is set off by a heavy rule down its edge. |
| `Wordmark` | "wingfoil" heavy, ".ie" magenta italic | `size` sm (19) / md (30) / lg (44). |
| `Masthead`, `MastheadMark`, `mastheadStyles` | The shared header: menu, name, section, actions, double rule | See below. |
| `Kicker` | The mono label as an element | `as`, `tone` muted/ink/pen. `MONO_LABEL` in `ui/tv.ts` is the same classes. |
| `SectionHeading` | A heading on a rule, its figures set right | `as`, `size` lead/title/kicker, `rule` thin/thick/double, `aside`. |
| `Headline` | One a page; `headlineStyles().soft()` for the italic tail, `.mark()` for a magenta colon | `as` h1/h2. |
| `Figure` | The number first, a gust raised, the unit small | `value`, `sup`, `unit`, `size` sm/md/lg, `alarm` (sup in the pen's ink), `label`. |
| `StarGlyphs` | Solid, faded (the wind alone), dots to five; `null` is the dark | `stars`, `potential`, `size`, `slots` five/potential, `tone` ink/inverse/magenta, `label`. |
| `BeaufortGlyph` | A wind in Force as the old charts drew it: a staff with a half feather a force, a pennant for ten, the force's number beside it | `force`, `size` (17 by a table's figure, 10 for a gust written small), `bare` (no number), `label` ("Force 5" by default). `beaufortPath` is its geometry, for any SVG (the loupe's foot box). |
| `RatingTip` | An hour's stars as a button; hover, focus or tap opens the chart's box saying why | `label`, `detail`, `size` md (the spot page) / sm (the map's dock and card). The one explanation on the site. |
| `PenLoop`, `PenUnderline`, `PenStrike` | The pen's marks round their children, drawn in once | Decoration (`aria-hidden`): say the same thing in words. `seed` picks the hand. |
| `PenNote` | The pen's handwriting | `size` sm/md, `as`. |
| `loopPath`, `underlinePath`, `strikePath`, `framePath`, `stemPath`, `arrowPath` | The pen's geometry, for any SVG (the map's overlay; the dock's frame round the chosen hour, its line at now and the arrow to it) | Pure functions, seeded: the same seed draws the same hand. |
| `Puffin` | The Almanac's bird | `size`, `bob`, `title` (decorative without). |

**The masthead.** Every page that is read starts with it; the brand link is
the section's own, because each router takes a link over in its own way:

```tsx
<Masthead>
  <SiteMenu current="market" size="sm" ground="content" />
  <Link to={paths.browse()} className={mastheadStyles().brand()}
    aria-label="wingfoil.ie Market, home">
    <MastheadMark section="Market" />
  </Link>
  <nav className={mastheadStyles().actions()} aria-label="Marketplace">…</nav>
</Masthead>
```

### Do

- Lead with a figure, then the mono label that names it.
- Use `Pane kind="ruled"` and `SectionHeading` for most sections; keep boxes
  for what stands alone.
- Set a spot's name in `font-display italic font-semibold` in a list, as the
  mockup does.
- Use `chart-magenta` for the best of something, once.
- Draw stars with `StarGlyphs`, and leave the dark unrated.
- Draw a wind in Force with `BeaufortGlyph` where a figure stands: the
  glyph and the force together. Where only text fits (a label, a tooltip,
  what a screen reader hears) write "Force 5", or "F5" in a line of figures.
- Draw a glyph from the set (`shared/web/glyphSet.ts`, drawn by `ChartGlyph`
  in `shared/web/ChartGlyph.tsx`, `glyphs` from `src/chartGlyphs.tsx` on the
  map, and `SetGlyph` in the app) before reaching for lucide:
  the weather, the wind and the blend, the dock's rows, the chart's symbols.
- Pass `strokeWidth={1.5}` to lucide icons beside mono labels; the default 2
  reads heavy against the thin rules.

### Don't

- Don't write a colour, a px or a font name outside `ui/theme.css`.
- Don't use the pen for emphasis, status or decoration; don't put two loops
  on a view.
- Don't lay a translucent or blurred panel over the map; it is paper.
- Don't round a box, or square a capsule.
- Don't set sentences in the mono face, or figures in the body face.
- Don't put a second filled action on a view.
- Don't use the wind ramp for anything but wind speed, the weather's
  colours for anything but the weather, or the stars' for anything but stars.

## For each section

**The map (`src/`, `force5/src/`, `companion/web/`).** The map's own CSS
(`src/styles.css`, `compact.css`, `dock.css`, `force5/src/brand.css`) reads the
theme through `var(--color-*)`, so it has already moved to paper and ink, but
its glass (`.glass`, `--glass`, `--glass-shadow`, the `backdrop-filter`s) and
its pills are still the old shapes; turn them into the chart's boxes
(`Surface`, or the same rules in CSS) and the dock's top into a double rule.
The basemap colours are re-pointed; the depth tints, contours and soundings
are new tokens for the chart-kit's bathymetry. The top-left is the mockup's
head: the menu, the wordmark (`Wordmark size="sm"`), and "Find a spot…" as a
`SearchField`. Spot lights are the mockup's `.lt`: a figure in a ring (ink at
3–4 stars, magenta at 5, dashed at none, struck through in the pen when
offshore). In the dock the pen goes twice round the chosen hour and rules a
line at the time now, with nothing written by it; the dock's tools (the star,
the name that opens the spot's page, the blend, the fold, the close) stand on
the chart in a box like the map's controls, and on a phone are the head of
the dock's sheet. `StarGlyphs` in `src/StarsRows.tsx` already draws through the kit;
it keeps the dock's narrow width with `slots="potential"`. Gust is still the
ink blob with a magenta wing; whether he becomes the puffin is the owner's
call. The Force5 logo in the top bar is the old brand. The map visual
baseline (`npm run map:shots`) needs regenerating at the end.

**The marketplace (`market/web/`).** The header is the shared masthead. The
category pills and filters are already in the mono label. The seller's
ratings (`ratingStyles`) still draw lucide stars in `accent` (now ink) over
`line-strong`, and want the chart's star shape from `StarGlyphs`. Listing
cards should be `Pane`s (one ink rule, grain) and a price a `Figure`; photos
stand on paper in a hairline frame;
the glass badges over them are paper now. The visual baseline
(`npm run market:shots`) needs regenerating at the end.

**The community (`community/web/`).** The header is the shared masthead. The
rail is a ruled list (`border-b border-line`, the current channel set as the
menu sets it: italic, heavier, on `sunken`); threads are sections under a
rule rather than cards, with the opening post the one `Pane`; names in the
display face, times and counts in the mono face. Avatars are monograms.

**Everyone.** The spot page is on the masthead already but otherwise
untouched. The AI page has the spot finder's header (`PageHeader`) over a
list of the apps, one button each. `community/web/components/Composer.tsx` still sets its
field at `pointer-coarse:text-lead` (19px, fine, but `text-input` is the
step for it now).
