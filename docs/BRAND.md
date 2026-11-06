# wingfoil.ie's brand

Premium, modern, high quality and flat. A plain ground, soft cards a shade
off it, one typeface for nearly everything, and colour kept for what it
means: the wind, the weather, a rider's stars and a warning. Nothing on the
site imitates paper, print or handwriting.

Every value below lives in `ui/theme.css` and nowhere else (`npm run ui:lint`
enforces it). The gallery at `/ui` (dev only) shows the kit in both themes.
The rules behind it, and the dated rulings, are in
[DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md).

## The rules

1. **Very little text.** A page says what it has to in figures, a few short
   labels and at most a line or two of sentences. If a sentence can be a
   figure, make it one. If a label can go, it goes.
2. **Figures over prose.** `14 g22 · WSW · 6.5 m`, not "fourteen knots
   gusting twenty-two from the west-south-west". Figures are set with
   even-width digits (`Figure`, or `font-mono tabular-nums`), so a column of
   them lines up.
3. **Mobile first.** Draw it at 390×844 first, then let it open out at 720
   (`wide:`) and 900 (`rail:`). Nothing pressed is shorter than 44px on a
   finger. A field is 16px on a touch device.
4. **Sentence case everywhere.** Headings, buttons, labels, tabs, tags and
   column heads. Nothing is set in capitals with the letters spaced out. Names
   keep their own spelling (HARMONIE, ICON-EU, ECMWF): they are names, not
   labels in capitals.
5. **One filled button per view.** `Button variant="primary"`. Everything
   else is outlined, soft or quiet.
6. **Structure by space and soft cards.** Sections are kept apart by space;
   things that belong together sit in a soft card (`bg-sunken
   rounded-surface`). A hairline (`border-line`) divides rows, and only
   inside a card.
7. **The thing shown is marked flat.** The chosen hour is outlined inside its
   column, the open spot's light stands a size up, the time now is a red line,
   and what is off is struck through or tagged in red. Nothing is lifted,
   circled, or drawn or written by hand. A mark does not comment: no verdict
   beside it (see the information rule in DESIGN_PRINCIPLES.md).
8. **Plain, clear English.** Every word is written for a rider with no
   technical knowledge who is learning the site. Say what a thing is and what
   it does, in full everyday sentences: "Take a 30-second tour of how the site
   works." No riddles, puns, wordplay, metaphors, clipped or poetic phrasing,
   and no jargon a newcomer would not know (no "MCP", "server", "blend",
   "model run" in a sentence a rider reads). Read every line aloud: if it
   needs a second read, rewrite it plainer. British and Irish spelling.

## Two themes

**Dark is the default**; white (light) is the other. The rider picks Light,
Dark or Auto (follow the device), and the choice is kept on the device
(`shared/web/theme.ts`). The page is painted in the theme before anything is
drawn, so a dark page never flashes white. Both themes use the same token
names: the light values sit in `@theme`, the dark ones re-declare them under
`<html data-theme="dark">`, and the `dark:` variant targets the same
attribute. Design and check every view in both.

## Colour

| Token | White / dark | Use |
| --- | --- | --- |
| `ground`, `card`, `solid` | `#ffffff` / `#0c0c0e` | The page, and a box floating over the map. |
| `sunken` | `#f5f5f7` / `#17171b` | The soft card: a card, a list of rows, a notice, the current menu row. |
| `raised` | `#e6e6eb` / `#26262c` | The second grey: a control's fill on a soft card, a plain notice's square. |
| `well` | `sunken`, or `raised` on a card | The fill every control takes (`bg-well`): a field, a chip, a tag, a segmented well, a soft button. On the ground it is the soft grey; inside a soft card, which carries the `on-card` utility, it is the second grey, so the control stays in sight. |
| `glass` | ground at 92% | A badge over a photograph only (`Tag tone="glass"`). Never over the map. |
| `ink` | `#111114` / `#f2f2f4` | Text, and the filled button's fill. |
| `ink-2` | `#3a3a40` / `#c9c9cf` | Secondary text, a label above a field. |
| `ink-muted` | `#64646c` / `#8f8f99` | The floor for words: hints, small print, a group's name. |
| `line` | ink at 12% | The hairline between rows inside a card, under the top bar, above a dialog's actions. |
| `line-strong`, `ink-disabled` | `#8b8b94` / `#6b6b74` | A disabled icon, a switch's empty track. Strokes only. |
| `accent`, `accent-ink` | ink, and the ground on it | The one filled button. |
| `chart-magenta`, `focus` | `#b0186a` / `#ff5aae` | The best of something (a five-star hour, the spot in view), a quantity's bar (`wash`), the `.ie` of the wordmark, and the focus ring. |
| `pen` / `pen-ink` | `#d43a2c` / `#ff5b4d`, words `#bf3125` / `#ff7d70` | The red accent: the line at now, offshore, an `off` tag. `pen` is the mark; words in red take `pen-ink`. |
| `warn`, `now` / `warn-ground` | `#b02a1f` / `#ff6a5e`, on `#fde8e4` / `#3a1e1b` | Degraded, an error, a field that is wrong, the present instant. |
| `ok` | `#2a7046` / `#4cc27a` | One liveness mark. |
| `met-yellow`, `met-orange`, `met-red` | `#f0c419`, `#e67322`, `#c3241c` | Met Éireann's warning levels: the square of a notice, nothing else. Do not re-theme. |
| `wind-k00` … `wind-k65` | `PALETTE` in `force5/src/weather.ts` | Wind speed and nothing else. Do not re-theme. |
| `buoy` / `buoy-ink` | `#e9b200`, on it `#1f1800` (9.1:1), both themes | A buoy's yellow: a light on the chart, and the wind measured at a weather station or buoy (the Live wind layer's pills). Words and marks on it take `buoy-ink`. Never text on the ground. |
| `weather-sun`, `-rain`, `-cloud`, `-night` | sun `#e9b200`, rain `#3a7fb0` | The sky's glyphs. Fills and marks, never words. |
| `stars-1` … `stars-5` | pale pink to deep magenta | A rider's stars as colour. Never text, never the wind. |
| `sea*`, `land`, `relief`, `depth`, `basemap-*` | per theme | The map itself. |

**Colour, only here.** The wind-speed scale, the weather's state, a rider's
stars, Met Éireann's warning levels, the chart's magenta for the best of
something and the red accent for now and what is off. Everything else is ink
on the ground and the soft grey of a card. A glyph carries colour inside a
line drawn in ink, and only where the colour says something.

## Type

Two faces, self-hosted from `ui/fonts.css`:

| Class | Face | Job |
| --- | --- | --- |
| `font-body` | Inter | Everything: headings, sentences, labels, buttons, fields. |
| `font-mono` | Inter too | Figures and small labels, its digits at even width. The name is kept for the recipes that ask for it. |
| `font-display` | Fraunces | The wordmark, and a spot's name as the title of its own page. Nothing else: no heading, no name in a list, no title of a dialog. |

Beyond the wordmark's ".ie" there is no italic serif, and there is no
handwriting face and no monospaced face.

The steps (each a size with its own leading, and its weight where it has
one):

| Step | Size | Use |
| --- | --- | --- |
| `text-caption` | 11 | Small figures, the small print. The floor. |
| `text-eyebrow`, `text-label` | 12, 500 | A column head, an axis tick, a tag, a small control's words (`MONO_LABEL` in `ui/tv.ts`). |
| `text-body` | 13 | Secondary sentences, a button's words, a row's second line. |
| `text-prose` | 15 | Sentences, a card's heading, a row's name. |
| `text-input` | 16 | A field on a touch device. |
| `text-lead` | 19, 600 | A section's heading, a dialog's title, an empty state's title. |
| `text-figure` | 19, 600 | The number a row is about. |
| `text-big`, `text-big-sm` | 40 / 32, 600 | A page's heading (`Heading level="page"`), 32 on a phone. |
| `text-reading` | 48 | The wind reading, one a view. |
| `text-wordmark` | 23 / 21 | The wordmark in the top bar, 21 on a phone. |

A spot's name on its own page is Fraunces at `text-headline`, `text-name`
from 720px, with `optical-display`.

## Shape and depth

- **Spacing** is the 4px step (`p-4` is 16px). Root font size is 14px.
- **Cards.** `Card` (`bg-sunken rounded-surface`, no border, no shadow) on a
  page; cards are kept apart by space, not by a rule. A soft card carries the
  `on-card` utility (`Card`, `Rows` and `Notice` do it themselves), which
  turns the controls inside it from the soft grey to the second grey
  (`bg-well` becomes `raised`): a field, a chip or a segmented well on a card
  never vanishes into it. A control is filled with `bg-well`, never
  `bg-sunken`, so it follows the card it stands on. Over the map a box
  floats instead (`Card kind="float"`: the ground, `shadow-float`, and in dark
  a faint `ring-line` edge so it separates from the chart).
- **Hairlines** (`border-line`) only inside a card: between rows, above a
  dialog's actions, and the one line under the top bar.
- **Radius.** A control that is not a capsule is 10px (`rounded-control`: a
  field, a tooltip, a key), a card 14px (`rounded-surface`), a sheet 18px
  (`rounded-dialog`: a dialog, the dock, the menu's facing edge). Buttons,
  chips, tags, segmented controls and search fields are capsules
  (`rounded-full`).
- **Shadow** only for what floats: `shadow-float` over the map, `shadow-sheet`
  for a dialog or the menu, `shadow-dock` for the dock, `shadow-control` for
  the chosen segment and a switch's thumb. A card on a page casts none.
- **Flat.** No gradients, sheens, lit edges, paper grain, frames or double,
  heavy or ink rules. A control does not nudge when pressed.
- **Night hours.** `hatch` is a fine diagonal hatch for the dark hours.
- **Icons** are one set of line icons at a 1.75 stroke, rounded (lucide), and
  the site's own glyph set (`shared/web/glyphSet.ts`, drawn by `ChartGlyph`)
  for the weather, the wind and the dock's rows.

## The kit

Import from `ui/` (`import { Button } from "../../ui"`). Each part exports its
recipe (`buttonStyles`, …) for a link a router owns. Don't restyle a part
locally: add a variant to it in `ui/`.

**Buttons.** Four styles, all flat, round-ended, in sentence case:

- `primary`, filled in ink (white in dark): the one thing to do next. At most
  one a view, and many views have none.
- `outline`, the default: a hairline round the words. The other view's button
  in the top bar is one, never filled.
- `soft`, a grey fill: a second action inside a card or a list.
- `quiet`, no edge: Reset, Clear, Skip, Close.

Then `link` for a way on in running text, and `danger`, red words in an
outlined button, for the destructive answer in a `ConfirmDialog` and nowhere
else. Sizes `sm` 32px, `md` 40, `lg` 48; `icon` makes a circle and needs an
`aria-label`. `pressed` fills a toggle in ink, so on is not said by colour
alone; `pressed="worded"` is for a toggle that renames itself (Save, Saved).

**Chips and tags.** A `Chip` is a choice you can press: a soft capsule,
filled in ink when `pressed`, or `removable` for a filter in use. A `Tag` is a
word that only describes something and cannot be pressed (Offshore, Unsure,
now, coming): `tone` neutral, `off` (red on its tint), `ok`, or `glass` over a
photograph. If it does nothing when pressed, it is a tag.

**Segmented and tabs.** `Segmented` picks one of two to five short options,
all in view, that change what is shown on the spot (a grey well, the chosen
one lifted out of it; `size` sm/md/lg, `full` for the whole width). `Tabs`
switch between the parts of one page or dialog (a row of words, the current on
a soft pill; `vertical` down the side of a wide dialog); the arrow keys move
between them. More than five options, or long ones: a `Select`.

**Switch, slider, number.** `Switch` is on or off, taking effect at once (a
layer, a model in the blend); a choice that waits for Save is a `Checkbox`.
`Slider` is a value along a range, its value and unit said beside it.
`NumberField` steps a number with minus and plus (weight).

**Fields.** `Field` puts the label above in grey and a hint under the control;
an error is said in words as well as in the warm ground. `TextInput`,
`TextArea`, `Select` and `SearchField` are filled in the soft grey, with no
rule round them; in focus they take an ink edge and a soft ring. `active`
gives a filter that narrows the results an ink edge.

**Rows.** `Rows` and `Row`: a list of rows in one soft card, a hairline
between them. The name in Inter semibold, a grey line under it, the value or
action on the right, a chevron when the row opens a page; `href` makes a row a
link and `onClick` a button. For a key, an index of spots, the models, a
setting with its value, the AI apps.

**Notices.** `Notice` is something the reader should know, in a soft card: a
coloured square with its sign, a plain title that says the level in words
("Orange wind warning", "Yellow small craft warning for all coasts of
Ireland"), a second line (when, and what it does to the stars), and a chevron
that opens the details, or an `action` such as Try again. `level` is info,
warn, yellow, orange, red, water or water-advice; Met Éireann's levels keep
their own colours. There is no capital chip and no bar down the side. Where a
notice takes the place of the stars (an hour in the table, the Your stars
card), `NoticeMark` is the same square with one word beside it ("Water",
"Orange warning"). `alert` is for something that went wrong just now; a
warning that was there when the page came is not one.

**Empty, missing and failed.** One state system, always inside the usual top
bar and the rider's theme. `Empty` stands where a list or a page would be
when there is nothing to show: centred, with no frame, a round grey icon, an
Inter title, a line or two, and at most two buttons. A page that is not
there, and a page that could not load (`alert`, with Try again), are `Empty`
too; the site's missing page and the forecast's failure are not pages of
their own. A part of a page that could not load is a `Notice` with Try again,
and the rest of the page stays; in a narrow column its action goes under the
words (`stacked`). Over the map it is the same notice, floating. The words
say what a rider can do, never what a developer would run.

**Dialog.** `Dialog` and `ConfirmDialog`: the ground with a sheet's corner
and the sheet's shadow, no frame and no rule under the title; the title in
Inter at `text-lead`, a quiet close button, a hairline above the actions
only; in dark a faint edge. Under 640px the same dialog is a bottom sheet with
a grabber and full-width actions within a thumb's reach; a long one
(Settings) fills the screen.

**Headings.** `Heading` in Inter, sentence case, never over a rule: `page`
(40px, 32 on a phone, with an optional `lead` line under it), `section` (with
an `aside` on the right: a link, a count) and `card`.

**Figures and stars.** `Figure` (the number first, a gust raised, the unit
small; `alarm` sets the gust in red), `StarGlyphs` (the stars drawn the same
way everywhere; `coloured` for the stars' own colours), `BeaufortGlyph` (a
wind in Force as a staff and feathers, with the force's number), `RatingTip`
(an hour's stars as a button that opens why).

**Also:** `Avatar` (a monogram on the soft grey), `Count` (a small figure in
a capsule; unread is filled), `Pager`, `Skeleton`, `Link` (underlined in
running text), `Backdrop`.

## The top bar

One bar on every page that has a head (`TopBar`): the Spot finder, the chart,
a spot's page, How the stars work, the spot index, Use with AI and the
sections. 64px tall, 56 on a phone, on the page's own ground, with one
hairline under it and nothing heavier: no frame, no double rule, no shadow. On
the chart it sits above the map, not floating on it.

From left to right:

1. **The wordmark** (`Wordmark`): "wingfoil" in Fraunces with ".ie" in the
   magenta italic, the bar's only serif. It goes home to the Spot finder, and
   it is the same size and 24px from the edge (16 on a phone) on every page,
   so it never jumps.
2. **The search** (`SpotSearch`): a soft grey pill beside the wordmark that
   finds a riding place as the rider types; "/" anywhere comes to it. The same
   search, and the same results, on every page.
3. A section's own few actions, where it has them (the marketplace's Sell).
4. **One button for the other view**: Chart (the map glyph) on the finder and
   a spot's page, Spots (the list glyph) on the chart. Outlined, never filled:
   the filled button is kept for the page's own main action.
5. **Light or dark**: a round button showing what it switches to, the sun in
   dark and the moon in white.
6. **The menu**, at the far right on every page.

On a phone the search folds into a round button that opens a full-width field
over the bar, and light or dark moves into the menu. Controls that belong to
the page stay on the page (the finder's Favourites and Near you head its
list; a spot's Star and Alert me stand by its name; the chart's controls stay
on the map).

**The site menu** is a drawer from the right, where its button is: the
facing edge rounded to the sheet's corner, one soft shadow, the page dimmed
under a scrim. Its head is the wordmark and a close button, with space, not a
rule, under it. The rows are in groups, each under a short grey name in
sentence case, unruled, 44px tall, with one line icon each. The current page
sits on a soft grey pill in semibold with "You're here" at its end, and the
same pill is the hover of the other rows. Light, Dark or Auto is at its foot,
on every width. A section switched off in the build is not drawn at all.

## Do

- Lead with a figure, then the short label that names it.
- Keep a page to space, headings and soft cards; reach for `Rows` for any
  list of named things with a value.
- Use `chart-magenta` for the best of something, once.
- Draw stars with `StarGlyphs`, and leave the dark unrated.
- Draw a wind in Force with `BeaufortGlyph` where a figure stands. Where only
  text fits (a label, a tooltip, what a screen reader hears) write "Force 5",
  or "F5" in a line of figures.
- Draw a glyph from the set (`shared/web/glyphSet.ts`, `ChartGlyph`; `glyphs`
  from `src/chartGlyphs.tsx` on the map; `SetGlyph` in the app) before
  reaching for lucide.

## Don't

- Don't write a colour, a px or a font name outside `ui/theme.css`.
- Don't put a second filled button on a view.
- Don't set a heading, a list's names or a dialog's title in Fraunces, or
  anything but the wordmark's ".ie" in an italic serif.
- Don't set a label in capitals or space its letters.
- Don't draw a frame, a double, heavy or ink rule, paper grain, a sheen or a
  gradient; don't put a hairline between cards or under a heading.
- Don't lift a mark on a card, circle it, or draw or write anything by hand.
- Don't lay a translucent or blurred panel over the map.
- Don't use the red accent for emphasis or decoration.
- Don't use the wind ramp for anything but wind speed, the weather's colours
  for anything but the weather, the stars' for anything but stars, or Met
  Éireann's for anything but their warnings.
