# Design principles

What the theme cannot decide. `ui/theme.css` holds every design value the site
draws with, and `ui/` holds the components built from it; this file holds the
rules that say how to use them, and the dated rulings behind those rules. What
the site looks like, and the kit's parts, are in [BRAND.md](BRAND.md).

wingfoil.ie is a map with tools over it, a Spot finder and a page for each
spot, and content sections (Use with AI, the marketplace, the community) that
are pages rather than chrome. On the map, the map is the product, and
everything else has to earn the pixels it covers the sea with.

Since November 2026 the site is premium, modern and flat: dark by default and
white as the other theme, Inter for everything, sentence case, structure by
space and soft cards (ruling of 2026-11-01).

---

## The accent rule

**One filled button per view.** `bg-accent` is the filled action, and a view
gets one at most: Play in the dock, Sell in the marketplace's bar, Retry in an
error state, never two at once. A second filled button does not add emphasis,
it removes it. In the kit it is `<Button variant="primary">`, filled in ink
(white in the dark theme), and the kit writes the accent fill nowhere else.

Everything else that can be pressed is outlined (the default), soft (a grey
fill, a second action in a card) or quiet (no edge until the pointer is over
it). Over moving water this is not timidity: a screen of filled buttons over
the map is unreadable. A pressed toggle or chip is filled in ink as well as
marked `aria-pressed`, and that is not a second filled action.

A destructive confirmation is a dialog, a view of its own, and its answer is
`variant="danger"`, red words in an outlined button, because what it confirms
cannot be taken back.

## The warm rule

**Warm is not an accent.** `now`, `warn` and `warn-ground` mean one of two
things and nothing else: _this instant_ (the now-marker) or _this is degraded_
(a stale snapshot, a failed fetch, an error, a field that is wrong, a
destructive answer). Warm is never used to make something stand out.

Met Éireann's yellow, orange and red (`met-*`) mean their warning levels and
nothing else: the square of a `Notice` or a `NoticeMark`, always with the
level in words beside it.

## The mark rule

**The thing shown is marked flat, and nothing else.** The chosen hour is
outlined inside its column, the open spot's light stands a size up, a red line
marks the time now, and a spot that is offshore is struck through or tagged in
red. Nothing is lifted on a card, circled, or drawn or written by hand (see
2026-11-01). A mark does not write a verdict beside it (the information rule).
The red accent is never a fill, never a control, never a status: a warning is
`warn`, a different red that means degraded. Its strokes are `pen`; its words
are `pen-ink`.

## The information rule

**Present information, don't comment on it.** The chart, the dock, the Spot
finder and the spot page show the wind, the stars, the hours, the figures and
plain labels, and leave the reading of them to the rider. No verdict or advice
in the house voice: not "Go after lunch: four stars on a 5 m", not "Go 13–16,
shallow after 3". Highlighting the key hours is fine (the stars, the outline
round the chosen hour, the line at now, a tint), and so is a label that says
what a figure is ("14.4 °C, M3 weather buoy, 50 km from here").

## The wind rule

**Wind colours mean wind speed and nothing else.** The fourteen
`--color-wind-k*` stops are the `PALETTE` in `force5/src/weather.ts`. They are
speed bands, not safety ratings and not ability ratings, and they are the only
way colour may describe wind. No other element, state or category borrows them.
They are the same for every rider: the stars are the rider's, the colours are
not (2026-10-19).

They do not re-theme. A colour that means 35 knots means 35 knots in white and
in dark, as the now-marker, the gust cap, the weather's colours and Met
Éireann's levels do not.

A legend is generated from those stops, never restated: a legend that copies
the ramp by hand is how the legend and the map drifted apart before.

On the map, **shape carries kind and colour carries the reading.** A spot
marker says riding spot, operator, club or area by its shape (round, squared,
dashed); colour on a marker only ever means wind, or on the Spot finder's map
a rider's stars. There a spot is a round-ended pill, its wind and gust in it,
filled in its stars' colour (dashed at none, a red arrow offshore); a weather
station or buoy is a squarer, smaller pill in the buoy's gold, its wind as it
was measured. A forecast is never gold, and a reading never wears the stars.

## What structure is made of

Structure is **space and soft cards** (ruling of 2026-11-01). A page is the
ground; sections are kept apart by space, under a `Heading` with no rule;
things that belong together sit in a soft card (`Card`, `bg-sunken
rounded-surface`), and cards are kept apart by space too. Inside a card,
division is `border-line`, the hairline, and nothing heavier. A list of named
things with a value is `Rows`.

**Over the map, a box floats and is opaque**: the ground, a card's corner and
`shadow-float` (`Card kind="float"`), with a faint edge in dark. A translucent
panel over a moving map is a second, blurred map, and the blur costs a phone
every frame. Glass survives only as a badge over a photograph
(`Tag tone="glass"`), and goes solid for a reader who asks for less
transparency.

**Four kinds of box, told apart by their place, not by a frame**: the soft
card on a page, the floating box over the map, the sheet (a dialog, the dock,
the menu: a sheet's corner and a deeper shadow) and the capsule, for what is
pressed. If a new thing fits none of them, the answer is usually that it
should be a section under a heading instead.

None of them has a frame, a double, heavy or ink rule, a paper grain, a sheen
or a gradient.

## Ceilings

**Type.** Two faces under three names: `font-body` Inter for everything,
headings included; `font-mono`, Inter too, for figures and small labels at
even width; `font-display` Fraunces for the wordmark and a spot's name as the
title of its own page, and nothing else. Every word is in sentence case;
nothing is set in capitals with its letters spaced. Named steps from 11px to
48px: `caption` 11, `eyebrow` and `label` 12, `body` 13, `prose` 15, `input`
16, `lead` 19, `figure` 19, `big` 40 (32 on a phone), `reading` 48.

- 11px (`text-caption`) is the floor, for small figures and the small print.
- One page heading per page (`Heading level="page"`). One `reading` per view:
  the wind speed is the number the product exists to show, and a second thing
  that size competes with it.
- `prose` is the few sentences there are, a card's heading and a row's name;
  `lead` is a section's heading or a dialog's title; `figure` is the number a
  row is about.
- A field on a coarse pointer is set at `input` (`pointer-coarse:text-input`,
  as `ui/control.ts`, `SearchField` and `SpotSearch` do): a phone zooms into a
  focused field whose text is under 16px.
- Five weights: 400, 500, 600, 700, and 800 (`font-extrabold`) for the
  wordmark's weight alone.

**Radius.** Three corners by size, and the capsule (ruling of 2026-10-24,
kept): `control` is 10 (a field, a tooltip, a key), `surface` is 14 (a card, a
box on the chart), `dialog` is 18 (a sheet: a dialog, the dock, the menu; a
sheet on the foot of the screen rounds its top corners only, the menu its
facing edge), and `pill` and `full` are a capsule, for what is pressed:
buttons, chips, tags, segmented controls and search fields. `mark` (5) is the
small square of a `NoticeMark`.

**Elevation.** Only what floats casts a shadow: `shadow-float` (anything on the
map, a popover, a tooltip), `shadow-sheet` (a dialog, the menu, a level
deeper) and `shadow-dock` (the sheet's stack cast upward, for the dock on the
foot of the screen). `shadow-marker` lifts a light or a small floating button;
`shadow-control` is the chosen segment's lift and a switch's thumb. A card on a
page casts none. Everything at the same height casts the same shadow.

**Colour.** Ink on the ground and the soft grey of a card are the structure;
the chart's magenta marks the best of something (and the focus ring); the red
accent marks the time now and what is off. The sea tints, the land and the
depth ink draw the map itself. The only other families are warm (now or
degraded), green (`ok`, one liveness mark), Met Éireann's warning levels, the
weather's state, the stars and the wind. A further family is a design change,
not an implementation detail.

**Text contrast.** At least 4.5:1 for every word, in both themes. `ink-muted`
is the floor for text, on the ground and on `sunken`. `line-strong` and
`ink-disabled` (the same step) are for strokes, icons and disabled controls,
where 3:1 is the bar, and are never used for text that is merely low priority:
disabled means unavailable. The red accent's marks are `pen` (a stroke); its
words are `pen-ink`. Rain's blue and the stars' colours are marks, never
words.

**Tap targets.** Nothing that is pressed is shorter than 44px on a coarse
pointer (`min-h-touch`). A control drawn smaller keeps its drawn size and grows
its hit area instead, down the block axis only when its neighbours are close
along the inline one.

**Focus.** One ring, for the keyboard only: 2px of `focus`, the chart's
magenta, 2px clear of the control (`RING` in `ui/tv.ts`), on every control. A
field whose box holds the focus takes an ink edge and a soft ring of the
accent instead; a search field only lifts a step (`raised`), with no edge or
ring. Nothing wears the ring by default: a dialog, the menu's drawer opened
with a mouse or a finger, and the tour's card take the focus themselves as
they open, so nothing in them is ringed before a key is pressed.

**Motion.** Short and functional: a dialog arriving, a sheet rising, the menu
sliding in, a placeholder breathing. Every one is skipped for a reader who asks
for less motion (`motion-reduce:`, or `prefers-reduced-motion` in the theme's
utilities), and the scrim's blur goes solid for one who asks for less
transparency.

**Hover** is for a mouse. `hover:` only applies under
`(hover: hover) and (pointer: fine)`, so a finger's tap never leaves a control
inked; a hover in plain CSS goes inside the same `@media` (the map's
stylesheets do, and `tests/ui-theme.test.ts` checks them).

## Don't

- Don't write a colour, a px, a radius or a duration into product markup or
  CSS. A missing value is a missing step in a scale: add it to `ui/theme.css`
  with a name that says what it is, pin it in `ui/tv.test.ts`, and use it by
  name. `npm run ui:lint` refuses arbitrary values and colour literals; the one
  escape is `ui-lint-allow: <reason>`, and it needs a real reason.
- Don't put a second filled button on a view.
- Don't use the wind ramp for anything that is not wind speed.
- Don't use warm to make something stand out.
- Don't lay a translucent panel over the map.
- Don't draw a frame, a double, heavy or ink rule, a paper grain, a sheen or a
  gradient, or a hairline between cards or under a heading.
- Don't set a heading or a list's names in Fraunces, anything but the
  wordmark's ".ie" in an italic serif, or a label in spaced capitals.
- Don't use the red accent as a fill or a status, and don't lift, circle or
  hand-draw a mark.
- Don't write a verdict or advice on the chart, the dock, the finder or the
  spot page. Highlight the hours that matter and say what the figures are; the
  rider reads them.
- Don't restyle a focus ring.
- Don't let colour be the only carrier of a state. Status says the status in
  words (a notice says its level); markers carry kind as shape; a pressed
  control is filled as well as coloured; the current page is on a pill as well
  as marked `aria-current`.
- Don't restyle a control locally. A component that nearly fits is the right
  component: add a variant to it in `ui/`, rather than a class beside it.
- Don't go below 44px for a tap target on a touch device.
- Don't design a view in one theme only.

---

## Rulings

Dated, because an undated rule cannot be told from an opinion and gets
relitigated. A new design question settled in review is written here, with its
date. A ruling a later design overturned is removed rather than kept beside
the new one.

**2026-09-14 — The ramp is derived from the product, not invented.** Every
colour literal in the map's sources was harvested and clustered; the ramp was
that cluster, regularised. Its values have since been redrawn (2026-10-19), so
the record of how it was made stands and the first figures do not.

**2026-09-14 — The legend is generated from `PALETTE`, never restated.** The
legend had carried eight stops while the map painted fourteen different ones,
telling the reader a scale the map does not use.

**2026-09-14 — Shape carries kind on the map; colour carries the reading.** Two
colour meanings on one marker is one too many.

**2026-09-16 — Per-model identity hues are permitted only inside the forecast
chart and the display filter's swatches; they never colour wind speed.** A
model hue may stroke a faint line on the forecast chart and fill a swatch beside
that model's name, and nothing else: not an area, a number, the map or a chip.
The hues live in `MODEL_CATALOG` (`force5/src/manifests.ts`), not in the theme.

**2026-09-17 — On a content page the bar's Sell is the filled button, unless
the page brings its own.** Browse and a seller's page have no primary of their
own, so Sell is filled there; on a listing, the sell form and the account pages
it drops back to an outlined button.

**2026-09-20 — Tailwind is the system** (plan 14, D1, D2, D4, D6). Tailwind 4,
configured in CSS through `@tailwindcss/vite`; `ui/theme.css`'s `@theme` is the
only source of design values, with Tailwind's stock palette, type scale, radii,
shadows and fonts cleared, so a class that names a value the theme does not hold
produces nothing; components are React and `tailwind-variants` in `ui/`;
arbitrary values and colour literals are refused by `npm run ui:lint`. The
marketplace was converted whole (D7) and the old design bundle retired last
(D8), which is why this file exists. The bundle's "tokens only, never a
literal" became "the theme only, never an arbitrary value".

**2026-10-11 — The map has no default place.** It used to open every first
visit on Brandon Bay, which told a rider in Donegal where to go before they had
asked. Now the dock opens on the spot in the link (`?spot=`, focused, as a
shared link always was), else none (`src/openingSpot.ts`; narrowed by the
ruling of 2026-10-19 below). With none, the chart is the whole of Ireland with
every light. A point tapped on the open map is read in the dock but not
remembered: it is not a riding place.

**2026-10-19 — No dock until a spot is chosen, and the dock is its hours.**
A remembered spot or a star no longer opens the dock as the page loads: on a
phone it took the foot of the screen before the reader had asked for anything.
Only a link that names a spot (`?spot=`) opens on it; otherwise the chart has
the whole screen until a spot, light or point is tapped (`src/openingSpot.ts`;
the store still keeps the visits and stars for your spots). A phone's rows are
drawn tight, and a week with no hour worth rating leaves out the stars and the
wing. The phone's dock went from 232 px to 128, the desktop's from 205 to 172.
(The dock's top row and the marks for the chosen hour and the time now are as
the rulings of 2026-10-26 and 2026-11-01 below have them.)

**2026-10-19 — One wind scale for every rider.** The map's wash and coloured
arrows had a scale of their own (`--ride-*`), its stops at the rider's
minimum, sweet spot and maximum, so each level coloured the same forecast
differently. That was a second way for colour to describe wind, which the wind
rule forbids, and it confused: the same 20 knots was green for one rider and
orange for another. They are drawn on `PALETTE` now, as the dock and the spot
page already were, and the palette was redrawn as the common wind forecast
sites draw theirs: pale blue in a calm, deepening to 10 kn; greens from 10 to
20; yellow by the high 20s; orange to red from 30 to 40; red to purple by 50;
dark purple to nearly black past 60. The rider's settings move the stars, the
wedge and the lights, never the colour. The map's key (`src/KnotScale.tsx`) is
generated from the same stops.

**2026-10-19 — The map never draws one hour under another's reading.** Past
the map model's run (HARMONIE ends about 60 hours out) the map used to keep the
last frame it had painted, while the lights, the dock and a light's label read
the selected hour from the blend: a rider saw streaks from the south-west under
arrows saying "S 10" days later, and took it for a wrong direction. Now the
map never draws an hour no run it can draw reaches; it says so where it names
its model. (The hand-over of 2026-10-21 below took over the rest of this
ruling.)

**2026-10-19 — The loupe is a ride rose, at a true distance.** The glass
round the chosen spot framed it and said nothing. Now it shows the headings
this rider can hold at the dock's hour: the no-go hatched, the tack out washed
in the ground's colour with ink edges (so it reads over satellite), the tack
home dashed, the drift downwind. The rim carries the offshore winds in red,
the wind's needle and a box at its foot. The wind's colour is on the needle
alone, and the red only marks danger: the offshore winds, and the drift when
it heads out to sea. Its rim is a distance, half a nautical mile or a
kilometre in the rider's units, so the fans measure the water before the
rocks. Bearings are rounded to 5° and the key says "about": it is not a polar.
The angles and their sources are in [RIDE_ROSE.md](RIDE_ROSE.md).

**2026-10-19 — The stars come from one model, the rider's choice.** "Why are
ECMWF and GFS contributing towards the stars? It's supposed to only take
whatever the user has configured. We don't use more than one model." Every
hour's stars, on every surface (the lights, the dock, the spot page, the app,
the alerts, the MCP tools and Gust), are one model's own wind, gust and
direction: the rider's model (HARMONIE unless they choose another) while it
reaches the hour, then ECMWF past the end of its run. Never a median or a
blend. (Since 23 October 2026 that is one choice, the model the rider sees on
the map, with no setting for the fallback and no model of a spot's own;
docs/STAR_RATINGS.md.) The other models are context: their agreement is shown
beside the stars and takes nothing off, and the wind bar is the one model's
mean to its gust, the others at most faint ticks in its card. Where the stars
are shown, the model is named. The rule, the surfaces and the published
blend's part in it are in [STAR_RATINGS.md](STAR_RATINGS.md).

**2026-10-20 — A tap away shuts what is open, then lets go of what is
chosen** (#109). A tap on the chart picked a point wherever it fell: with the
layers open it shut them and moved the spot as well, and with a spot chosen it
moved the spot to the tap. Now a tap on the chart, like Escape, does one thing
at a time. With a panel or a menu open over the chart (the layers, your spots,
the options, the site menu, the search's list) it shuts that, and picks and
chooses nothing, a light included. With nothing open and a spot or point
chosen, it lets go of it: the chart's focus goes, the dock keeps the forecast
until another is chosen or it is closed. Only with nothing chosen does a tap
pick the point under it. A light still chooses its spot at one tap, and a
double tap still zooms and does neither.

**2026-10-21 — Past the reader's model, the map hands over.** With the map
blank past HARMONIE's 60 hours, most of a fifteen-day slider showed no wind,
and readers took it for the wind lines not working beyond HARMONIE (issue
#122). Now, at an hour the chosen model does not reach, the map draws the model
the dock's column comes from (ECMWF, or GFS), says so where it names its model
("ECMWF on the map from Sat 09:00"; on a phone "ECMWF from Sat 09:00"), and
goes back to the chosen model when the hour is inside its run again. The
choice itself is never changed, which is what made switching on a far click a
trap: the reader is not left on a coarse grid after scrolling back. The jump in
detail at the seam (2.5 km to 0.25°) is the honest one; the label is there so
it does not read as a fault. The stars and the lights stay on their own model.

**2026-10-22 — The site menu is the one way in to the chart's options.** The
top right held zoom, the layers, your spots, the display options and the "i",
beside a site menu: two places to look, and five instruments on the chart for
a reader who came for the wind. Now the chart's own corner is zoom and the
layers alone (it moves the chart and says what it draws), and the chart's
options are rows of the site menu (2026-10-29). The rows carry drawn glyphs,
single line at a stroke of 1.5, in one module (src/chartGlyphs.tsx) that the
tidal streams and a survey's lines draw from too, so a row reads at a glance.
"Foilable depth" is "Tidal depth" now, and the wash is "Coloured wind": the
names say what a reader sees, not what the layer is for.

**2026-10-23 — The glyphs take a little colour, and only where it means
something.** One 24-unit grid, one 1.5 stroke (1.6 at 18 pixels and under),
round ends, each drawn as a line in ink with a colour inside only where the
colour says something. The weather's state takes four tokens: the sun
(`weather-sun`), rain a sea-blue (`weather-rain`), a cloud's grey
(`weather-cloud`) and the moon's pale fill (`weather-night`). With the wind
ramp, the chart's magenta for the best and the warm red for a warning, that is
all the colour there is. Rain is a mark and never words, so the rain row's
figures stay in ink over a rain-blue tint. None re-themes, but the pale fills
are redrawn for the dark ground. The set is data (`shared/web/glyphSet.ts`)
that the site (`ChartGlyph`) and the app (`SetGlyph`) both draw, so the dock's
row labels, its sky (the moon in the dark hours) and the blend's switch are
the same on both, and the spot page's sky draws from the same set. The set and
`ChartGlyph` sit in shared/web, which the map and the spot page may both
import, since neither may import the other.

**2026-10-23 — Present information, don't comment on it; a phone's dock is a
sheet.** "It's okay if we highlight the key times, but I don't want this
commentary because I just think it looks crap." The dock writes nothing beside
its marks: the time now is the red line alone, and where the stars hand over
to the next model is a dashed line alone, the head naming the model that rates
the hour in hand. The rule is the information rule above. The water's
temperature left the dock's head, where on a phone "14.4 °C · 50 km" was the
most central thing on the screen: it is one measurement, often from a buoy far
offshore, and it is said on the spot's page with its station, its kind, its
distance and its age. On a phone the dock is a bottom sheet: its head (the
name and the tools) is inside it, not floating on the chart, and it is swiped
between three heights, peek (the head alone), half (the hours and the wind)
and full (with the waves, sky, air and rain), and closed from peek. A sideways
swipe is still the hours'. The handle is a button for a keyboard and a screen
reader, and the glide is skipped for a reader who asks for less motion.

**2026-10-24 — The current is a row of the dock.** "I'm on the currents layer
but it's not showing me the current speed anywhere." The rows below the fold
gain one, under the waves: the surface current's speed in the rider's wind
unit, to a tenth, with an arrow where the water runs to (a current is named
for where it goes, the wind and the waves for where they come from); water
has no forces, so a rider in Force reads it in knots. Its unit stands under
its glyph, as the wind's does. A riding place's is the series
the currents ingest publishes for it in the run's spot squares; a tapped
point's is its own, from the nearest water in the map's frames, not a nearby
place's. Where the model has nothing, the row says so once, as the waves'
does; past the run's three days, a dash. It is read only once the rows are
open, as the waves and the weather are.

**2026-10-24 — The LiDAR layer is off.** Its surveys reach Dublin's coast,
Tralee and Brandon Bays, Lough Foyle and Northern Ireland's coast, so on the
rest of the map it drew nothing and looked broken. The site has no LiDAR
layer and serves none of it; the pipeline and what it would take to bring
the layer back (wider coverage) are in scripts/lidar/README.md.

**2026-10-25 — The wind in two layers, Coloured wind and Particles.** "Let's
get rid of ink. So we should have colored wind and particles... two separate
layers." The wind was one style of three (Ink, Coloured wind, Coloured
arrows); it is two switches now, either, both or neither. Coloured wind is the
speed as a wash on the sea and nothing more. Particles are the moving lines,
drawn in the ink colour so they read over the colour; the arrows tinted by
speed are gone. A first visit has the particles alone. A rider's older choice
is read into the layers once (force5/src/windLayers.ts `parseWindLayers`): Ink
is the particles, Coloured wind the colour alone, Coloured arrows both. The
app has the same two switches in its Layers sheet and reads its own older
choice the same way; with Reduce Motion on, its particles are still arrows.

**2026-10-25 — Stars have colours of their own.** `stars-1` … `stars-5`
(ui/theme.css), pale pink to deep magenta on white, the chart's magenta paled
and deepened, one step plainer than the next with each star and the one-star
end 2:1 on the ground; on dark they run the other way, deep to bright. Never
the wind's colours, and no stars has none. `StarGlyphs coloured` draws them,
the earned in their colour and the rest of the five outlined. The Spot finder
and the spot page take them.

**2026-10-25 — The spot finder's cards keep one time between them.** The
owner: "effectively one time setting across all of the cards that keeps them
all in sync and shows a little dotted line where I'm hovering". One day and
one hour for the whole list. A mouse (or a pen) over a card's hours draws a
thin dotted line at that time on the same day on every card, and the time
beside it on the card it is over; it goes when the pointer leaves. A finger
has no hover: a tap picks. The line moves straight in the page once a frame
(src/finder/hover.ts), never drawing a card again.

**2026-10-25 — One site menu, the same on every page.** "The menu for
SpotFinder and for the main chart page is different. This menu should be the
same across all pages." The menu opens on the site's navigation wherever it
is opened, in one order and one wording (the groups are as 2026-10-29 has
them). The page you are on is marked `aria-current="page"`, on a soft pill
(2026-11-01); a spot's page is none of the menu's rows, so nothing is. Settings
from a page that is not the map's is the home page with Settings open
(`/?settings`); from a page over the map, the map as it was with Settings over
it (`force5/src/siteNav.ts` `SITE_NAV`, `force5/src/SiteMenu.tsx`). The menu's
rows say where they go: Chart is always the chart and Spot finder always the
finder.

**2026-10-25 — Today is kept whole, and yesterday is not.** The owner: "Keep
the forecast for the full day so we don't just immediately discard it, but we
do discard yesterday's forecast; we don't want to keep that. Somebody may want
to go back and look at what the conditions were when they were wing foiling
earlier." The dock and the spot finder's today run from Irish midnight, not from
the newest HARMONIE run's first hour: each hourly blend keeps today's earlier
hours from the blend before it, so each hour is the most recent run that
covered it (`carryToday`, src/spotBlend.ts), and where no run is kept — the
first run of a day, a rider who rates from another model — the long-range run's
steps fill the morning rather than leaving it empty (`dockColumns`,
force5/src/timeline.ts). Past hours stay drawn as past (the dock's faded
`past` columns, the finder's faded gone hours). Nothing before today's
midnight is kept (docs/LIVE_FORECAST_PIPELINE.md, "Today, kept whole").

**2026-10-25 — One star rating, ours, made your own in four numbers.** There
are no levels (Learning, Riding, Advanced) anywhere: everyone starts from
ours, and a rider makes it their own in Settings. They set four numbers under
"Wind strength" — too light, the sweet spot's two ends, too much in gusts
(ours 11 · 15–22 · 35 kn) — and our model does the rest: a star a knot from
too light, five through the sweet spot, one star 5 kn under too much and none
3 kn under it; a gust past too much is no stars, and otherwise is read 5 kn
lighter, the hour taking the lower. There is no gust setting and no
gust-factor penalty. Offshore is never, locked, with "We don't recommend going
out in an offshore wind."; cross-offshore costs a star by default, and the web
moves in whole stars. "Can you ride upwind?" starts at "Not yet", straight
across, with the course's downwind edge a second angle (10° below across);
past it the picture says the rider drifts and loses ground; it moves no star.
Wings and weight never cost a star. Outline stars mean only stars lost to the
gusts or the shore; an orange or red warning still replaces the stars. "Reset
to ours" shows only once something differs from ours (weight and units
aside). Old stored settings are read without fault and start from ours
(docs/STAR_RATINGS.md).

**2026-10-26 — Plain, clear English everywhere, and no Almanac in the words.**
The owner, on the tour: "very, very bad copy. It doesn't make sense … we don't
need cryptic language or puns, just state things plain and simple." "Take a
30-second tour of how the site works" is the model: "exactly the type of
language we want." BRAND.md's rule 8 says so: every sentence is everyday
English a newcomer reads once, and nothing is signed by or credited to "the
Almanac". This is the second time the owner has asked ("It reads like cryptic
riddles", of the first Customise), so it is a rule for every page, not a fix
for one.

**2026-10-26 — Settings, one dialog on one page.** "What we should have is a
settings page and then settings brings up a modal with all the configuration
that you can do... one modal, so people don't have to keep clicking through
this thing. And we don't need to have the favourites in there." The menu's
Customise is Settings now, and it opens one dialog (src/Settings.tsx) in four
parts, each a heading and one plain line of help: About you (weight and
units), Wind strength (the four handles and the stars under them), Wind
direction (the web and its list) and Riding upwind (the three answers, the
picture and the two angles). On a desktop the four sit two by two; under
1000px wide they are one column, and on a phone the dialog is the whole screen
and scrolls. It edits a draft: Save keeps it, and Cancel, the close button,
Escape and the backdrop keep nothing; "Reset to ours" stays in the foot.
`/?settings` opens it from another page, and the old `/?customise` still does.
Every word is everyday English a newcomer reads once: "1 star off" and "No
stars" rather than "−1★" and "never", "Too strong in gusts", and "Onshore",
"Cross-on" on the web rather than "ON", "X-ON".

**2026-10-26 — The dock's top row: the star, the name, Blend and one
arrow** (#238). Everywhere the dock appears (src/ForecastDock.tsx), its top
row is the star, the spot's name in full, the Blend glyph and a downward
arrow that closes the dock. The name is not cut short: a long one goes over
two lines, and it is the way to the spot's page. Blend is its glyph alone,
named "Blend" for a screen reader and in its tooltip. There is no separate
button for more rows: on a wide screen the dock's top edge is dragged up for
more rows, down for fewer and down again to close the dock, and a small faint
grip in the middle of that edge is a button for a click and the keys (Up for
more, Down for fewer). On a phone the sheet is swiped as before, and swiped
down from its head alone it closes.

**2026-10-26 — The spot finder is the home page, with the chart beside it**
(#238). The site's root (`/`) is the spot finder, and from 1100 pixels wide
the real chart stands beside the list in a box on the right, the full height
of the page under the top bar. The chart there shows only the listed spots,
at the hour the cards show, with the rider's place as a blue dot; it is
fitted to the list as the page opens and when the list changes, and at no
other time. A card under the pointer marks its spot on the chart, moving the
chart only if the spot is near the edge or off it; a spot under the pointer
outlines its card, and a press on one scrolls the list to its card. The full
chart is the same map in a bigger box, never made twice (src/App.tsx). Its
address is `/?map`, pushed, so Back is the list again; a spot's link
(`/?spot=keel`) opens it on that spot with its dock. The top bar's Chart and
Spots button moves between the two (2026-11-01), as do Escape and the
collapse button above the zoom. Under 1100 pixels the list is alone; on a
phone the map is made the first time it is asked for and kept. The old
addresses are put right: `/spots` is the root, and `/?chart` is `/?map`. The
root is always the list.

**2026-10-26 — A first visit opens on Near you, and it is never empty.**
The finder opens on Favourites once the rider has starred a spot, and on Near
you before that. Round the rider's own place Near you is every spot within
30 km, and says "No spots within 30 km of you." when there are none. Without
the rider's place it lists the 12 spots nearest where the chart was last
looked at, or the middle of Ireland, however far, with no distances on the
cards and one line above them saying so. The chart beside the list is fitted
to whatever it shows.

**2026-10-27 — The finder finds, sorts and filters, and asks for the
location only when the rider says so** (#246, #228, #229, #248; PRs #255
and #257). Find a spot is the kit's dialog (a sheet on a phone): a name typed
lists the places it names from every spot, not only the tab's, and under it,
with no heading, are the order (best first; nearest, once the rider's place
is known; A to Z), the fewest stars (on the day shown, since 2026-11-03) and the model the stars
are rated from. Each has four or fewer short options, so they are segmented
controls and a row of chips rather than closed selects, one tap to change
(2026-11-01). The model is
the rider's own, the one the display options and the spot page set. The tab
is in the address once one is chosen (`/?tab=favourites`, `/?tab=near`). An
empty Favourites points to the search, Near you and every spot's page. Near
you does not ask the browser as it opens: without the rider's place it says
why the place is wanted, with a "Use my location" button, over the spots
nearest where the chart was, which give no distances. A place kept from an
earlier yes is read again quietly, and a no is never asked again.

**2026-10-27 — A phone's sheet names its rows in words.** On a phone the
dock's rows were glyphs alone, labels at 8.5px and units at 8px, figures at
11px (#221): a rider at arm's length on a beach could not read them, nor tell
the gust factor from the tide. Each row is now named in a small label
(`eyebrow`), its unit under it ("Wind kn", "Waves m", "Current kn", "Rain
mm/h"), in a column that stands while the hours slide. The figures are at
`body` (13px), the wind at 14px and its gust at `caption`; "25 g32" still fits
a column. A wide screen keeps its glyphs. The warnings strip on a phone is one
line, the highest level's mark, "3 warnings" and their kinds, cut with an
ellipsis, and a press opens every warning in full, one under the other (#220):
a strip that scrolled sideways showed one half-sentence and hid a gale warning
past the screen's edge.

**2026-10-27 — The finder's hours keep their words readable, and its cards
hold their shape while they load** (#245, #247, #249). A gone hour and a dark
one were faded whole, their figures with them: a gust came to 1.9:1 on a gone
hour and 1.6:1 on the hatched dusk. Now only the marks fade (the sky, the
arrow, the stars); the band behind the gone and dark hours is paled under a
veil of the ground, and their figures stay at 4.5:1 or better. While the
places are read, the list is the cards' shapes, each the height a card will
be, the first saying "Loading the spots…"; while a place's hours are worked
out, they are the shapes of their figures, with "Loading the forecast…", and
the dock's wind row the same, not dashes that read as no forecast
(ui/Skeleton).

**2026-10-29 — One menu in four groups, and the layers are the rail.** The
owner: the old Layers panel ("What the chart draws", its tiles and its
dialog) goes, and the layers are the rail of small round glyphs by the zoom,
on a phone as on a desktop (src/LayerRail.tsx); there is no Layers row in the
menu. On a phone the rail stands under the zoom, down the right edge, and
wherever it would run into the dock it scrolls in the room above it; a tap
names the layer and whether it is on, for a moment. What a layer cannot draw
just now (the tidal depth out too far, the currents past their hours) is a
small dot on its button and a line under its name. The model is chosen in
the display options. The site menu is the same on every page, in four
groups: Chart and Spot finder; Settings and Display options; About and Take
the tour; then the site's other sections, Use with AI last. From a page that
is not the map's, Display options, About and the tour are the home page's
address with a word on it (`/?options`, `/?about`, `/?tour`), which the map
answers, opening the chart first where the thing is the chart's.

**2026-10-31 — Modern white and dark** (the spot page and Spot finder
designs). The owner found the off-white paper "a bit gross" and asked for "a
premium modern white and a dark black mode", fewer typefaces, and no small
grey text on every figure. It replaced the paper's values, not its rules (one
filled action per view, warm means now, wind colours mean wind): the ground is
white (`#ffffff`, a second sheet `#f5f5f7`), the ink near-black (`#111114`),
lines a hairline of ink at 12%, and controls flat, with no paper gradient or
lit lip. A dark theme sits beside it under `<html data-theme="dark">`
(`#0c0c0e`, ink `#f2f2f4`, the magenta and the red accent lifted to read on
black); since 2026-11-01 dark is the default. The type is two faces: Fraunces
for a spot's name and the wordmark, Inter for everything else, figures at even
width; labels are in sentence case, untracked, at 12px.

Measured, not assumed, on white: `ink` 18.85:1, `ink-2` 11.30:1, `ink-muted`
5.86:1 (5.39:1 on `sunken`, 4.71:1 on `raised`, a control's fill on a card),
`line-strong` 3.38:1 (a stroke's bar, not
text's), `chart-magenta` 6.59:1, `warn` 6.57:1, `pen` 4.73:1 and `pen-ink`
5.70:1. White on the hovered accent is 6.59:1. On black: `ink` 17.48:1,
`ink-2` 11.86:1, `ink-muted` 6.10:1 (5.58:1 on `sunken`), `line-strong`
3.70:1, `chart-magenta` 6.82:1, `pen` 6.38:1, `pen-ink` 7.84:1, `warn`
6.96:1.

**2026-11-01 — Premium, modern and flat: one kit, one top bar.** The owner:
"We're changing the brand entirely": premium, modern, high quality. The old
look went from the code, not only from view: the paper frames and double
edges, the paper grain and its float, the sheens and gradients, the heavy,
double and ink rules, Fraunces for headings and for names in lists, the italic
serif, uppercase letter-spaced labels and the puffin. Dark is the default
theme, white the other, and the rider picks Light, Dark or Auto. Headings are
Inter, in sentence case. Structure is space and soft cards (`bg-sunken
rounded-surface`), with hairlines only inside a card; a box over the map
floats on its shadow. The corners of 2026-10-24 (10, 14, 18 and the capsule)
stay. The kit was rebuilt to match (BRAND.md): four buttons, of which one
filled a view; chips that are pressed and tags that are words; segmented and
tabs; a switch for what takes effect at once; rows in a soft card; notices
with a coloured square and the level in words; an empty state with no frame;
a dialog that is a bottom sheet under 640px. `Pane`, `Surface`, `Masthead`,
`PageHeader`, `Kicker`, `Headline`, `SectionHeading` and `Puffin` are gone.
Every page with a head has the one top bar: the wordmark at the left, the spot
search, a section's own actions, one outlined button for the other view
(Chart, or Spots on the chart), light or dark, and the menu at the far right;
on a phone the search folds into a round button and light or dark moves into
the menu. The button replaces the black List and Map buttons at the foot of
the chart and the finder (2026-10-26). The site menu is a drawer from the
right, where its button is: no rule under its head, its groups named in grey,
the current page on a soft pill with "You're here", Light, Dark or Auto at its
foot.

**2026-11-01 — No pen and no lift.** The owner: the new site has no pen
drawings anywhere, and the lifted card belongs to the old paper look. The red
pen's loops, hand-drawn frames, handwriting, underline and strike are gone
from the kit, with the handwriting face and its animation. The dock's chosen
hour is outlined flat in ink inside its column (`.tt-shown`), as the Spot
finder outlines the hour shown, and slides from hour to hour; its hour is set
in ink, a size up. The line at now is straight and red, fading down the hours,
and the model's handover a straight dashed line. The open spot's light stands
a size up with no shadow. The tour rings its target in the focus colour. A
sold price is struck through in `ink-muted`; "new" on a listing and a count of
new posts are marks of the kit; a reply's name is plain. The red stays as the
accent (`pen`, `pen-ink`) for the line at now and what is off. The phone app
(`mobile/`) follows separately.

**2026-11-01 — One Settings, and no ring until a key is pressed.** The owner:
"a single settings page is enough". The display options (units, the hours,
the model and the blend's models) are gone as a dialog, a menu row and a
glyph; Settings took them in as its fifth part, Forecast, across the foot of
the dialog on a desktop, saved with the rest by its Save. The menu's middle
group is Settings alone, and the old address `/?options` opens Settings. The
owner also did not want the magenta ring round the first row of the menu, a
dialog's close button or the search box the moment they appeared: the boxes
hold the focus themselves (see Focus, above), and the search lifts a step
instead of taking an edge.

**2026-11-01 — A scrub bar in place of the dock, and no chart frame.** The
owner: the chart's dock was a table to read, and the spot page already reads
a spot's hours better; the chart wants "something minimal where a rider can
really easily scrub back and forward and see how the wind or wave or tide
changes". The dock is gone, and with it the Blend view, the fold of rows under
it and the phone's sheet. In its place a bar the full width of the map
(`src/ScrubBar.tsx`): the controls in one row (the spot, Full forecast, the
close, play and step, Wind | Waves | Tide, the key, Now), and under them the
strip, a week at a time, sliding on through the fortnight. A playhead is
dragged smoothly, not hour by hour; the column nearest it is the map's. Under
the curve one thin row is the stars as colour, and a pill over the playhead
reads the moment. With no spot chosen it is a plain timeline that still moves
the map. Everything the dock's rows held (the gust factor, the waves' period
and direction, the current, the sky, the rain, each model's own line) is on
the spot page, which also opens at an hour (`?at=`) and has a page for a point
on the open water (`/spot/@lat,lon`). The neatline, the chart's black and
white frame with its degrees, is gone too: the map meets the top bar and the
floating boxes directly. And a count of stars has one colour wherever stars
are drawn: the stars' own shades, `stars-1` … `stars-5`, on the glyphs too
(`ui/StarGlyphs`), a seller's rating alone staying in ink.

**2026-11-02 — The data alone in the scrub bar, a still readout, fewer
layers.** The owner, from the site on a phone: the bar's controls crowded the
data to its foot, and its Now sat over the Wind | Waves | Tide switch. The
bar is now the data alone: no name, no close, no play or step, no switch, no
key, no Now. Over the strip the moment is read out in cells that keep their
places as the playhead moves (the time, the wind, the stars, the waves, the
tide), a reading an hour lacks saying "–"; the strip draws the wind and the
stars, and under them a lane each for the waves and the tide. The spot's name
beside its light on the map opens its page (a tapped point has its name beside
its mark too); a tap off the spot lets it go, the bar's forecast with it, and
the next tap picks a point. The spot page's readout over its graph is cells in
fixed places too, held in view on a phone, where the band names float over the
hours instead of taking a column and the hours scrolled under a playhead are
the hour read out. The layers' rail lost what does not change a rider's day,
so it stands whole in a column on a phone: the chart's own parts (depth
tints, contours, relief, names) are always drawn, the satellite is one button
from high tide to low to none, and the loupe is on or off, the range ring in
its stead. On the spot finder a card opens its spot's page wherever it is
pressed, its picture too; the list's head is one row, Favourites or Nearby, how
many and a filter button that opens the stars, the order and the model in a
sheet. Light, dark or auto left the foot of the site menu for the first part
of Settings.

**2026-11-02 — A spot card in the AI apps.** An AI app that supports MCP
Apps draws get_spot_forecast's answer as a card beside its reply
(`mcp/app/`): the wordmark, the place from above with the hour's wind blowing
across it in its own colour, a pin with its name, wind and stars, the day's
hours in the site's colours with a tab per day, and "Open on wingfoil.ie".
The site's look, not a look of its own: its colours are read from
`ui/theme.css` as the card is built, light and dark as the app is; the
wordmark is the site's own Fraunces cut into outlines; and the words take the
app's system face. One HTML file of about 20 KB with no fonts and no library,
so it opens at once in a chat. An app without MCP Apps reads the answer's
text as it always has.

**2026-11-02 — The AI page as a scene.** The owner: the page was a bland
line over a list. Now "wingfoil.ie is fully compatible with your bots" types
itself, a phone rises with an AI app on it, someone asks where to wing foil
on Saturday and the app answers with a little wind chart from wingfoil.ie;
then the phone slides over and the apps come in beside it (`ai/web/scene.ts`,
`ai/web/ai.css`). On a phone's width the line sits over a smaller phone and
the list follows straight under it. Any scroll, tap or key skips to the end,
as does less motion. Each app is shown by its maker's own mark, unaltered, from
its brand page (`public/logos/`), with no line under it until a press has
something to say; one-colour marks take the ink, black on light and white on
dark, as their makers ask. A line under the list says the marks are their
owners' and that none of them endorses the site. Le Chat is Mistral Vibe since
Mistral renamed it. Claude is listed with its Spark in Clay, as Anthropic's
press kit gives it, once Anthropic had approved its mark here.

**2026-11-03 — The spot finder steps through the days, and after dark opens
on tomorrow.** The owner, at 19:59 on a November evening: every card's tick
sat on 18:00, the map said "Stars at 19:00 today", and there was no way to
look at tomorrow, so the page was no use once the day was over. Under the
list's head is the day, ‹ Today ›: an arrow either side steps a day at a
time through today and the five days after it, each arrow off at its end,
the arrow keys stepping too, and the day said as Today, Tomorrow, then the
weekday, with its date in grey. Every card's bars, the list's order and the
fewest stars its filter asks for are the day's, and so are the chart's
lights and pill beside it ("Stars at 13:00 tomorrow"). Once the hour now is
past the end of today's rows (the hour after last light) at every spot
listed, the finder opens on tomorrow, at its early afternoon. Today, the
hour now is the nearest hour, as a clock is read (19:59 is 20:00), on the
cards and the pill alike; an hour off either end of the day's row is ticked
nowhere, never on the last hour in its stead.

**2026-11-03 — The depths are a layer, off by default.** The owner: a first
visit read the figures in the water before anything else, and could not say
what they were. The depth tints, contours, their figures, the soundings and
the land's relief, all from the one survey archive, are one switch, Depths,
under the Sea on the layers' rail, and off until a rider turns it on. This
reverses the ruling of 2026-11-02 that they are always drawn; the names still
are. While it is off nothing of the archive is read, not even its header
(`force5/src/chartStyle.ts`), and a rider's old stored choice of the three
parts is dropped, so everyone starts with it off once.

**2026-11-03 — The hours after dark, shown or left out everywhere.** The
owner: some riders do not care about the night and do not want to see it at
all; it is a distraction. Settings has one choice for it, Hours: "Day and
night" or "Daylight only", in its Forecast part, day and night by default (`nightHours`, kept on the
device with the other preferences and read before the first frame). After
dark is from last light to first light, the sun 6° below the horizon; an hour
is after dark when its time falls there (`shared/web/afterDark.ts`, one rule
for every view). Off, the night is left out, not shaded: the spot page's
graph and the chart's scrub bar draw each day's hours from first light to
last, the days side by side with the thin line between them, every band
breaking at the line rather than running across the night. The readout, the
playhead, the keys and a wheel move from one day's last light straight to
the next one's first, and now, after dark, is the next first light. The
twilight either side of sunrise and sunset stays, drawn as the day is and
not rated, its stars read as "Twilight"; nothing says "Dark". The spot
page's day cards and hour table, and the spot finder's stars, already count
the daylight alone. The "Now" cards over the week still say the light now,
and the app keeps its own settings.

**2026-11-03 — Spots as pills beside the list, and the wind as measured.**
The owner: the readings of the weather stations and buoys should be shown,
on the map too, and the spots on the Spot finder's small map should be pills
with the wind, not circles. Beside the list each spot is a pill with its
wind and gust at the cards' hour, filled in its stars' colours (dashed at
none, a red arrow offshore), its name beside it from the regional zoom in;
the full chart keeps its rings. The Live wind layer draws each Met Éireann
station and Marine Institute buoy as a smaller, squarer pill in the buoy's
gold (`buoy`, its figures in `buoy-ink`) at the wind it last measured, faded
past three hours and gone past twelve, with a card under the pointer or a
tap: the station, its network, the wind, gust and direction, when it was
measured and whose data it is. It is always on beside the list; on the full
chart it is a switch under Wind in Layers, off until asked for, so the
forecast is the chart's first word there.

**2026-11-03 — The measured wind beside the forecast, on every timeline.**
The owner: the current conditions should be on the timelines too, and at
Now the readout should say them, not the forecast. Each place is paired with
its nearest weather station or buoy (`force5/src/windObs.ts` `pairStation`):
within 25 km, an inland mast counted at twice its distance, so the coast's
or a buoy's is chosen unless the inland one is much nearer; none past that.
Wherever its readings are shown its name and distance go with them, so a
rider knows it is not the beach. On the spot page the wind band draws the
station's hours up to now in the buoy's gold (the mean a line with a dot an
hour, each gust a ring), each reading at the middle of the hour it
measured, with its own line in the Wind key; at Now the readout's wind,
gust and direction are the station's last reading, with "Belmullet 1 km,
21:00" quietly on the label's line, and every other hour, past ones too,
reads the forecast. The Wind now card above says the same reading, with the
same note after "Wind now" and the shore word for its direction, and so do
the picture's rose and its line at Now, so no two of them disagree
(`measuredNow`, the one answer all read); a reading with no direction has
no rose, so the picture keeps the forecast's then. A reading over
three hours old is not the wind now, so Now falls back on the forecast then, as it does with no station near. The
scrub bar's readout says the measured wind, with a gold square in place of
the wind's swatch and "Measured · Belmullet 1 km", with the playhead at now
or before it. A finder card on today has one quiet line under its county,
"Now 3 g5 kn · Belmullet 1 km" after a gold dot; other days, none.

**2026-11-04 — The spot page's graph on a phone: names beside the hours, and
a finger that drags.** The owner, from a phone: the band names floating over
the hours' left edge hid the first figures under them, the stars and a
warning's mark ran into the Gusts cell, the top of the graph looked cut off
under the readout, and a finger on the graph could not move it. The band
names now take a column of their own on a phone too, 60 px, in the caption's
size, so no figure is ever under one. With the readout held over the graph,
a band's name is held just below the readout's foot while any of its band is
still in view, and a hairline marks the foot once the graph runs under it, so
the graph reads as passing under the readout rather than as clipped. The
graph takes the browser's own touch handling: a sideways drag scrolls the
hours under the playhead and an upward one scrolls the page. It had been
held to sideways pans alone, so a drag whose first movement was upward, as a
finger's often is, moved nothing at all, and the page could only be scrolled
from above the graph. In the
readout the stars are two cells wide on a phone, with room for the mark. The
Models band is on the tens either side of the week's model winds, 52 px tall
rather than 72 px on a scale from calm to 36 kn, so its lines fill it instead
of a strip of mostly empty band.

**2026-11-04 — The spot page's graph in two sections, Wind and Waves, each
with its blend.** The owner picked the design. The graph is now two sections
on the same hours, scrolling as one: Wind (stars, wind, direction, wind blend,
gusts, sky, rain, tide, current) and then Waves (height, direction with
height, peak period, wave blend, then each swell and the wind sea the lead
model splits the sea into). The Models band is now **Wind blend**: each model
the rider blends as its own line, its blend in ink over the band from the
lowest model to the highest. Waves gets a **Wave blend** of its own: every
wave model's line through its own steps, the published wave blend in ink,
and a dotted mark where a model's run ends inside the graph. The headlines
stay one model's own, the wind's (and so the stars) as the stars rule picks
it and the waves' the finest wave model at each hour, or the one the rider
picks in Settings, handed on past its run; a blend is said in its own band,
its readout and its card, never in place of a headline. With no wave blend
published, the per-model lines and the leading model stand alone. Sea and
Waves left the wind's bands for the new section; the wind's readout keeps
the sea on one line. Sheltered water, which the open sea's waves do not
reach, has no Waves section, as its year has no waves.

The readouts stay apart: wind values and wave values never share a card. On
a phone one readout is held at the top, the wind's while the Wind section is
on screen and the waves' once the Waves section passes the middle of what the
readout leaves of the screen, with a Wind | Waves switch that takes the page
to each; each blend's models and the blend sit in it as a strip. On a desktop
each section has its own readout, and a card beside the pointer lists that
section's models and blend alone; a click holds the hour and the arrow keys
step it. Several crossing lines cannot all be told apart by colour, so the
global models' lines (ECMWF, GFS and their wave models) are dashed as well,
which also parts ECMWF's purple from ICON-EU's blue for a colour-blind rider.
The wave models have hues of their own in the theme (`--color-wave-*`), five
told apart side by side on both themes. The phone's band-name column is 68
px, room for "Wind blend". The graph reaches every day the data does, to
ECMWF's fifteen, the day cards with it.

**2026-11-04 — Blend as a choice, for the wind and the waves.** The owner
ruled that a rider may read the headline from the blend. Settings → Forecast
offers **Blend** after the wind models, and **Blend** after "Finest at each
hour" for the waves. A rider on the wind's blend has the wind, the gust, the
direction and the stars from the weighted blend of every model, the very line
the Wind blend row draws, so what they read is what they see; the map, which
draws one model's frames, draws HARMONIE's and says so. A rider on the
waves' blend has the median height, period and direction, with the swells of
the finest model that has the hour, never averaged; where no wave blend is
published, the finest model at each hour stands in. The defaults are
unchanged: HARMONIE then ECMWF for the wind, the finest wave model at each
hour for the waves, each blend drawn beside them.

---

## Still open

- **Preflight.** Tailwind's reset stays out (D3). Tried on 2026-09-22 with the
  map's colours all on the theme: the marketplace did not move, but all 36 map
  shots did (line heights, margins and box sizing through the dock and every
  panel). The map's stylesheets were written without a reset and lean on the
  browser's defaults; turning it on is a layout pass of its own.
- **`.legend-gradient`'s eight `rgb()` stops** in `src/styles.css` are a stale
  copy of an old wind ramp, in a rule nothing draws. Removing the rule is the
  owner's call.
- **Model hues are not theme values.** See the ruling of 2026-09-16. Whether
  they become theme values (a further family made official) or stay in
  `MODEL_CATALOG` beside the model list is undecided; they have not been checked
  for contrast or for telling apart, in either theme. Decide before the third
  ensemble lands.
- **The phone app** (`mobile/`) still draws from its own hand-written radius
  and shadow tokens in the old look; porting it is its own piece of work.
