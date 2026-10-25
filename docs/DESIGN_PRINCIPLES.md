# Design principles

What the theme cannot decide. `ui/theme.css` holds every design value the site
draws with, and `ui/` holds the components built from it; this file holds the
rules that say how to use them, and the dated rulings behind those rules.

It is distilled from the Force5 design bundle (`design/`, retired 2026-09-22):
its principles, its Don't list and its rulings, restated in the theme's names.
Where the bundle's rule survived unchanged it is carried here; where the site
has since ruled otherwise, the ruling below says so and when.

wingfoil.ie is a map with tools floating over it, and two content sections (the
marketplace and the community) that are pages rather than chrome. On the map,
the map is the product, and everything else has to earn the pixels it covers
the sea with. That one fact decides most of what follows.

Since 2026-10-05 the site is drawn as **the chart**: an Admiralty chart crossed
with a broadsheet weather report. What it looks like, and how to draw a page in
it, is [BRAND.md](BRAND.md); this file keeps the rules and the rulings.

---

## The accent rule

**One filled action per view.** `bg-accent` is the filled action, and a view
gets one: Play in the dock, Sell in the marketplace header, Retry in an error
state, never two at once. A second filled button does not add emphasis, it
removes it. In the kit it is `<Button variant="primary">`, and the kit writes
the accent fill nowhere else. On the chart the accent is the ink pill, which
turns magenta under the pointer.

Everything else that can be pressed is quiet: `text-quiet` with no fill until
the pointer is over it. Over moving water this is not timidity: a screen of
filled buttons over the map is unreadable.

A destructive confirmation is a dialog, a view of its own, and its one filled
button is `variant="danger"`, the warm fill, because what it confirms cannot be
taken back.

## The warm rule

**Warm is not an accent.** `now`, `warn` and `warn-ground` mean one of two
things and nothing else: _this instant_ (the now-marker) or _this is degraded_
(a stale snapshot, a failed fetch, an error, a destructive answer). Warm is
never used to make something stand out.

## The pen rule

**The red pen marks the one thing that matters, and nothing else.** A loop
round the chosen spot or hour, a line at the time now, a strike through a spot
that is offshore. One mark on a view, two at most. It marks; it does not
write a verdict beside the mark (the information rule). It is never a fill,
never a control, never a status: a warning is `warn`, a different red that
means degraded. The pen's strokes are `pen`; its handwriting is `pen-ink`,
which reads as words.

## The information rule

**Present information, don't comment on it.** The chart, the dock and the spot
page show the wind, the stars, the hours, the figures and plain labels, and
leave the reading of them to the rider. No verdict or advice in the house
voice: not "Go after lunch: four stars on a 5 m", not "Go 13–16, shallow after
3", in the pen's hand or in type. Highlighting the key hours is fine (the
stars, the pen's frame round the chosen hour, the line at now, a tint), and so
is a label that says what a figure is ("14.4 °C, M3 weather buoy, 50 km from
here").

## The wind rule

**Wind colours mean wind speed and nothing else.** The fourteen
`--color-wind-k*` stops are the `PALETTE` in `force5/src/weather.ts`. They are
speed bands, not safety ratings and not ability ratings, and they are the only
way colour may describe wind. No other element, state or category borrows them.
They are the same for every rider: the stars are the rider's, the colours are
not (2026-10-19).

They do not re-theme. A colour that means 35 knots means 35 knots at night and
on any palette: the Atlantic change left all fourteen at their values (D5, D12),
as it left the now-marker and the gust cap.

A legend is generated from those stops, never restated: a legend that copies
the ramp by hand is how the legend and the map drifted apart before.

On the map, **shape carries kind and colour carries the reading.** A spot
marker says riding spot, operator, club or area by its shape (round, squared,
dashed); colour on a marker only ever means wind.

## What structure is made of

Structure is **rules, not surfaces** (ruling of 2026-10-05). The site is one
sheet of paper: the ground, a card and a dialog are the same paper, and a thing
is set apart by an ink rule round it or under it, as a chart boxes its title
and a broadsheet heads its columns. Most of a page is sections under a heavy
rule (`Pane kind="ruled"`, `SectionHeading`), not boxes.

**A box is the chart's box**: paper with its grain, a 1px ink border, and just
inside it a gap of paper and a hairline of ink at a quarter
(`inset-shadow-frame`). Every box and sheet has both: a card on a page, a
Surface, a Dialog, a menu, the dock. Since 2026-10-24 (mixed and rounded,
below) a box also has a rounded corner and a soft shadow by its elevation.
Inside a box, division is `border-line`, the hairline, and nothing heavier.

**Over the map, paper is opaque.** A translucent panel over a moving map is a
second, blurred map, and the blur costs a phone every frame. `Surface` is solid
paper in a double rule. Glass survives only as a badge over a photograph
(`Chip tone="glass"`), and goes solid for a reader who asks for less
transparency.

**Four kinds of box, told apart by their size and their lift, not their
fill**: the card (`Pane`, on a page: the ink rule, its hairline, a contact
shadow), the chart's box (`Surface` and everything over the map: the same
edge, floating), the sheet (`Dialog`, the dock, a menu: a sheet's corner, a
level deeper) and the pill (a capsule, for what is pressed).
If a new thing fits none of them, the answer is usually that it should be a
section under a rule instead.

## Ceilings

**Type.** Four faces, each with one job (`font-display` Fraunces for names and
headings, `font-body` Newsreader for sentences, `font-mono` IBM Plex Mono for
every figure and label, `font-hand` Kalam for the pen), and eleven named steps,
10px to 48px: `eyebrow` 10, `caption` 11, `label` 11, `body` 13, `prose` 15,
`input` 16, `lead` 19, `figure` 19, `title` 30, `headline` 44, `reading` 48.

- 10px (`text-eyebrow`) is the floor, and only for the mono label: tracked
  capitals, a kicker, a column head, an axis tick. Never a sentence.
- 11px (`text-caption`) is the floor for anything in sentence case.
- One `title` per surface. One `headline` per page, and only on a page that is
  read. One `reading` per view: the wind speed is the number the product exists
  to show, and a second thing that size competes with it.
- `prose` is the few sentences there are; `lead` is a section's heading or a
  card's name, in the display face; `figure` is the number a row is about, in
  the mono face.
- A field on a coarse pointer is set at `input` (`pointer-coarse:text-input`,
  as `ui/control.ts` and `SearchField` do): a phone zooms into a focused field
  whose text is under 16px.
- Five weights: 400, 500, 600, 700, and 800 (`font-extrabold`) for the
  wordmark alone.

**Radius.** Three corners by size, and the capsule (ruling of 2026-10-24):
`control` is 10 (a field, a small chip, a tooltip, a layer tile, the
instrument button, a key in a box), `surface` is 14 (a box: a card on a page,
anything on the chart), `dialog` is 18 (a sheet: a dialog, the dock, a menu;
a sheet on the foot of the screen rounds its top corners only), and `pill` and
`full` are a capsule, for what is pressed, and stay one. A print rule is never
rounded: a heavy rule under a head, a double rule, a table or column rule, the
dock's day rules. A one-sided rule on a rounded box thins out into the corner,
so a section under a rule is `rounded-none`.

**Elevation.** Shadows by height, soft and stacked, the far one warm, always
listed after the frame: `shadow-card` (a card inside a page or a dialog: a
contact shadow only), `shadow-float` (anything sitting on the map: the zoom,
the spot's tools, the search, a menu, a popover, a tooltip), `shadow-sheet`
(a dialog or sheet, a level deeper) and `shadow-dock` (the sheet's stack cast
upward, for the dock on the foot of the screen). `shadow-marker` lifts a light
or a small floating button. A small control has its own: `shadow-control`
under a pressed or filled ink control, `shadow-raised` under a raised paper
one. Everything at the same height casts the same shadow; a print rule casts
none.

**Light.** Paper is flat. The faintest light from above (`paper-float`) is
allowed on a small box over the chart; a page, a dialog and the dock stay flat
(`paper-grain`). A sheen is for small controls only: `sheen-ink` under a
pressed or filled ink control, `sheen-raised` under a raised paper button (the
round menu button, a knob). A press nudges a lit control down a pixel.

**Colour.** Paper and ink are the structure; the chart's magenta marks the best
of something (and the focus ring, and the filled action under the pointer); the
pen is the one mark that matters. The sea tints, the land and the depth ink
draw the chart itself. The only other families are warm (now or degraded),
green (`ok`, one liveness mark) and wind (data). A further family is a design
change, not an implementation detail.

**Text contrast.** `ink-muted` is the floor for text. `line-strong` and
`ink-disabled` (the same step) are for strokes, icons and disabled controls,
where 3:1 is the bar, and are never used for text that is merely low priority:
disabled means unavailable. The pen's marks are `pen` (a stroke); its words are
`pen-ink`.

**Tap targets.** Nothing that is pressed is shorter than 44px on a coarse
pointer (`min-h-touch`). A control drawn smaller keeps its drawn size and grows
its hit area instead, down the block axis only when its neighbours are close
along the inline one.

## Don't

- Don't write a colour, a px, a radius or a duration into product markup or
  CSS. A missing value is a missing step in a scale: add it to `ui/theme.css`
  with a name that says what it is, pin it in `ui/tv.test.ts`, and use it by
  name. `npm run ui:lint` refuses arbitrary values and colour literals; the one
  escape is `ui-lint-allow: <reason>`, and it needs a real reason.
- Don't put a second filled action on a view.
- Don't use the wind ramp for anything that is not wind speed.
- Don't use warm to make something stand out.
- Don't lay a translucent panel over the map; it is solid paper.
- Don't round a print rule, shadow one, or light a large surface. Don't square
  a box or a capsule.
- Don't use the pen for more than the one thing that matters on a view, and
  never as a fill or a status.
- Don't write a verdict or advice on the chart, the dock or the spot page.
  Highlight the hours that matter and say what the figures are; the rider
  reads them.
- Don't restyle a focus ring. There is one: 2px of `focus`, the chart's
  magenta, 2px clear of the control (`RING` in `ui/tv.ts`), on every control.
- Don't let colour be the only carrier of a state. Status says the status in
  words; markers carry kind as shape; a pressed control is raised and heavier as
  well as filled; the section you are in is raised as well as marked
  `aria-current`.
- Don't restyle a control locally. A component that nearly fits is the right
  component: add a variant to it in `ui/`, rather than a class beside it.
- Don't go below 44px for a tap target on a touch device.

---

## Rulings

Dated, because an undated rule cannot be told from an opinion and gets
relitigated. A new design question settled in review is written here, with its
date.

**2026-09-14 — The ramp is derived from the product, not invented.** Every
colour literal in the map's sources was harvested and clustered; the ramp was
that cluster, regularised. The Atlantic ruling below replaced its values step
for step, so the record of how it was made stands and the teal figures do not.

**2026-09-14 — The legend is generated from `PALETTE`, never restated.** The
legend had carried eight stops while the map painted fourteen different ones,
telling the reader a scale the map does not use.

**2026-09-14 — 9px is the floor, and only for tracked uppercase.** Type at 6, 7
and 8px was retired; sentence-case text stops at 10px.

**2026-09-14 — Shape carries kind on the map; colour carries the reading.** Two
colour meanings on one marker is one too many.

**2026-09-16 — Per-model identity hues are permitted only inside the forecast
chart and the display filter's swatches; they never colour wind speed.** A
model hue may stroke a faint line on the forecast chart and fill a swatch beside
that model's name, and nothing else: not an area, a number, the map or a chip.
The hues live in `MODEL_CATALOG` (`force5/src/manifests.ts`), not in the theme.

**2026-09-16 — Two type steps for content pages: `lead` and `prose`.** The
marketplace was the first surface that is a page rather than chrome over the
map, and the scale had nothing between `body` (12px) and `title` (25px).

**2026-09-17 — A content page has its own ground and its own opaque surface.**
The sea is a mid-tone meant to be covered by a map, and muted text on it fails.
A page that is read stands on `bg-ground`, and its cards are `bg-card`.

**2026-09-17 — On a content page the header's Sell is the accent, unless the
page brings its own.** Browse and a seller's page have no primary of their own,
so Sell is filled there; on a listing, the sell form and the account pages it
drops back to a quiet pill.

**2026-09-20 — Atlantic: one neutral family and one accent** (plan 13, D5). The
teal was made to sit quietly over a map full of wind colour; on a page with no
map behind it, it read cold and still. "One hue" becomes one neutral family
(navy) and one accent (blue). The navy ramp runs `#f4f6fa` (`ground`) to
`#0a1f3c` (`ink`), with `#0b2545` for `inverse`, `quiet` and `focus`; the
accent is `#1463ff` (`accent`) with `#0d4fd1` for its hover, and it has one job,
the filled action. The accent rule itself does not change: one filled action per
view. Warm still means now or degraded, wind colours still mean wind, and warm,
green and all fourteen wind stops keep their values. The ink alphas (the
hairline, the shadows, the scrim) are based on `#0a1f3c`.

Measured, not assumed: on the solid panel ground `ink-muted` is 5.75:1 and
`line-strong` 3.22:1, so `ink-muted` is still the floor for text and the step
below it is still never text. `ink-muted` is 5.96:1 on the content ground and
6.45:1 on a card; white on `accent` is 4.93:1, and 6.87:1 hovered.

**2026-09-20 — Tailwind is the system** (plan 14, D1, D2, D4, D6). Plan 14 first
proposed Tailwind for the community alone, themed from the bundle's tokens,
beside the bundle's own component classes. The epic ruled further: Tailwind 4,
configured in CSS through `@tailwindcss/vite`; `ui/theme.css`'s `@theme` is the
only source of design values, with Tailwind's stock palette, type scale, radii,
shadows and fonts cleared, so a class that names a value the theme does not hold
produces nothing; components are React and `tailwind-variants` in `ui/`;
arbitrary values and colour literals are refused by `npm run ui:lint`. The
marketplace was converted whole (D7) and the bundle retired last (D8), which is
why this file exists. The bundle's "tokens only, never a literal" became "the
theme only, never an arbitrary value".

**2026-09-21 — The map's filled action stays on the accent** (D13). Play was
looked at over a light-wind field (the `k00` to `k09` blues) and reads as the
button that runs the forecast, not as a wind value, so it keeps `accent` rather
than taking `inverse`.

**2026-09-21 — The marketplace's active filter stays accent.** It is a line,
not a fill (a border and an inset ring), so it does not rival the one filled
action, and the second line says it whatever the hue.

**2026-10-05 — The chart: paper, ink, magenta and the red pen** (docs/BRAND.md).
The owner chose, after several rounds of mockups, an Admiralty chart crossed
with an old broadsheet weather report: "original… unique… keeps that kind of
look and feel of old kind of weather report". The reference is the mockup
`design/chart/1-the-chart.html` in the design worktree. It replaces the
Atlantic ruling's values, not its rules: one filled action per view (the ink
pill, magenta under the pointer), warm means now or degraded, wind colours mean
wind and keep their values. What changes: the site is one paper (`#f3eee3`; the
ground, a card and the solid fallback are one value) and one ink (`#1a1d21`),
structure is drawn in rules rather than lifted cards, the map's panels are
opaque paper rather than glass, boxes are square, the focus ring is 2px of the
chart's magenta (`#b0186a`), and the type is four self-hosted faces (Fraunces,
Newsreader, IBM Plex Mono, Kalam) on an eleven-step scale. The red pen
(`#d43a2c`) is new, and has a rule of its own above.

Measured, not assumed, on paper: `ink` 14.62:1, `ink-2` 9.54:1, `ink-muted`
5.80:1 (5.40:1 on `sunken`), `line-strong` 3.66:1 (a stroke's bar, not
text's), `chart-magenta` 5.70:1, `warn` 5.68:1. The pen's mark `pen` is
4.09:1, which is enough for a stroke and not for words, so its handwriting
takes `pen-ink` at 4.93:1. Paper on the hovered accent is 5.70:1.

**2026-10-11 — The map has no default place.** It used to open every first
visit on Brandon Bay, which told a rider in Donegal where to go before they had
asked. Now the dock opens on the spot in the link (`?spot=`, focused, as a
shared link always was), else the spot this visitor chose last, else their
first star, else none (`src/openingSpot.ts`). With none, the chart is the whole
of Ireland with every light, and the dock keeps its hours (the time that drives
the chart, its keys and its slider) and puts a line asking for a tap where a
spot's rows would be, at their height, so choosing a spot moves nothing. A
point tapped on the open map is read in the dock but not remembered: it is not
a riding place.

**2026-10-19 — No dock until a spot is chosen, and the dock is its hours.**
A remembered spot or a star no longer opens the dock as the page loads: on a
phone it took the foot of the screen before the reader had asked for anything.
Only a link that names a spot (`?spot=`) opens on it; otherwise the chart has
the whole screen until a spot, light or point is tapped (`src/openingSpot.ts`;
the store still keeps the visits and stars for your spots). The dock lost its
head: the star, the name, the Table/Blend switch (now one glyph, on while the
blend is shown), the spot's page and the fold stand on the chart at the dock's
top edge in a box like the map's controls, and a phone keeps the glyphs alone,
the pen's loop on the chart saying which spot it is. A phone's rows are drawn
tight, and a week with no hour worth rating leaves out the stars and the wing.
The phone's dock went from 232 px to 128, the desktop's from 205 to 172. The
chosen hour is the pen's (twice round its column, the hour in the pen's ink, no
wash and no black cell), and the time now is a pen line with the time written
over it (mockups in `wingfoil-mockups/table-selection`, option D, and
`dock-compact`, option B).

**2026-10-19 — One wind scale for every rider.** The map's wash and coloured
arrows had a scale of their own (`--ride-*`), its stops at the rider's
minimum, sweet spot and maximum, so Learning, Riding and Advanced each
coloured the same forecast differently. That was a second way for colour to
describe wind, which the wind rule forbids, and it confused: the same 20 knots
was green for one rider and orange for another. They are drawn on `PALETTE` now,
as the dock and the spot page already were, and the palette was redrawn as
Windy, Windguru and Windfinder draw theirs: pale blue in a calm, deepening to
10 kn; greens from 10 to 20; yellow by the high 20s; orange to red from 30 to
40; red to purple by 50; dark purple to nearly black past 60. The rider's level
moves the stars, the wedge and the lights, never the colour. The map's key
(`src/KnotScale.tsx`) is generated from the same stops.

**2026-10-19 — The map never draws one hour under another's reading.** Past
the map model's run (HARMONIE ends about 60 hours out) the map used to keep the
last frame it had painted, while the lights, the dock and a light's label read
the selected hour from the blend: a rider saw streaks from the south-west under
arrows saying "S 10" days later, and took it for a wrong direction. Now the
streaks fade out and the wash goes at any hour the map's run does not reach,
and the label where the map names its model says so ("HARMONIE ends Wed 22:00
· no wind drawn"), as does "Model on the map" in the layers. The map still
changes model only when the reader asks (docs/FORECAST_DATA_PLAN.md: switching
on a far click was ruled a trap); the dock's chip, "Show ECMWF on the map", is
how they ask. (Superseded on 2026-10-21 by the hand-over, below: the no-wind
rule stands for an hour no run the map can draw reaches.)

**2026-10-19 — The loupe is a ride rose, at a true distance.** The glass
round the chosen spot framed it and said nothing. Now it shows the headings
this rider can hold at the dock's hour: the no-go hatched, the tack out washed
in paper at about 45% with ink edges (so it reads over satellite), the tack
home dashed, the drift downwind. The bezel carries the offshore winds in red,
the wind's needle and a box at its foot ("SW 16 g22 · CROSS"). The wind's
colour is on the needle alone, and the pen's red only marks danger: the
offshore winds, and the drift when it heads out to sea. Its rim is a distance,
half a nautical mile or a kilometre in the rider's units, so the fans measure
the water before the rocks. Bearings are rounded to 5° and the key says
"about": it is not a polar. The angles and their sources are in
[RIDE_ROSE.md](RIDE_ROSE.md).

**2026-10-19 — The stars come from one model, the rider's choice.** "Why are
ECMWF and GFS contributing towards the stars? It's supposed to only take
whatever the user has configured. We don't use more than one model." Every
hour's stars, on every surface (the lights, the dock, the spot page, the app,
the alerts, the MCP tools and Gust), are one model's own wind, gust and
direction: the rider's model (HARMONIE unless they choose another) while it
reaches the hour, then ECMWF past the end of its run. Never a median or a
blend. (Since 23 October 2026 that is one choice, the model the rider sees on
the map, with no setting for the fallback and no model of a spot's own;
docs/STAR_RATINGS.md.) The other models are context: their agreement is shown beside the
stars and takes nothing off, and the wind bar is the one model's mean to its
gust, the others at most faint ticks in its card. Where the model changes, the
page says so in the pen's hand ("ECMWF from Wed 22:00"), and where the stars
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
beside a site menu at the top left: two places to look, and five instruments
on the chart for a reader who came for the wind. Now the top right is zoom
alone (it moves the chart, it configures nothing), and the menu opens on the
chart's own rows, under a mono "THE CHART" and over the site's sections: the
layers, your spots, the display options and "About the map", each opening the
dialog it did before, with the focus handed back to the menu. The rows carry
drawn glyphs, as do the layers' switches, each drawn as an Admiralty chart
draws the thing (INT 1): stepped tint bands with a drying height, a dotted
contour and its italic soundings, a hill in hachures, a light's flare beside
its name, an underlined drying height over sand stipple, a photograph inset,
a feathered wind arrow over a tint, a compass rose and a range ring. Single
ink at a stroke of 1.5, in one module (src/chartGlyphs.tsx) that the tidal
streams and a survey's lines draw from too, so a row reads at a glance and
reads as the chart. "Foilable depth"
is "Tidal depth" now, and the wash is "Coloured wind": the names say what a
reader sees, not what the layer is for.

**2026-10-23 — The glyphs take a little colour, and only where it means
something.** The customise-wizard mockup's glyph sheet is the set now: one
24-unit grid, one 1.5 stroke (1.6 at 18 pixels and under), round ends, each
drawn as a chart draws a buoy, an ink outline with a colour inside only where
the colour says something. The weather's state takes four tokens: the sun is
the buoy's yellow (`weather-sun`), rain a sea-blue (`weather-rain`,
`#3a7fb0`), a cloud's grey (`weather-cloud`, `#d6d0c2`) and the moon's pale
fill (`weather-night`, `#e7dcb4`). With the wind ramp, the chart's magenta
for the best and the warm red for a warning, that is all the colour there
is; the rest is ink on paper. Rain is 3.75:1 on paper, a mark and never
words, so the rain row's figures stay in ink over a rain-blue tint; the pale
fills sit inside an ink line at 8.72:1 (sun), 11.00:1 (cloud) and 12.32:1
(moon), and on the proposed night chart they carry the shape themselves
(8.8:1 to 12.4:1 on the night ground). None re-themes. The set is data
(`shared/web/glyphSet.ts`) that the site (`ChartGlyph`) and the app (`SetGlyph`)
both draw, so the dock's row labels, its sky (the moon in the dark hours) and
the blend's switch are the same on both; the layers' and the site menu's
glyphs stay src/chartGlyphs.tsx's own. The spot page's sky draws from the
same set (2026-10-23, later): its hours had their own grey suns and clouds,
and now show the dock's, drizzle and showers told from rain, and the moon in
a dark hour. The set and `ChartGlyph` sit in shared/web, which the map and
the spot page may both import, since neither may import the other.

**2026-10-23 — Present information, don't comment on it; a phone's dock is a
sheet.** "It's okay if we highlight the key times, but I don't want this
commentary because I just think it looks crap." The dock writes nothing in
the pen's hand: the time now is the red line alone, and where the stars hand
over to the next model is the dashed line alone, the head's chip naming the
model that rates the hour in hand (this replaces the hand-written "ECMWF from
Wed 22:00" of 2026-10-19). The rule is the information rule above. The water's
temperature left the dock's head, where on a phone "14.4 °C · 50 km" was the
most central thing on the screen: it is one measurement, often from a buoy far
offshore, and it is said on the spot's page with its station, its kind, its
distance and its age. The spot's name is the way to its page (a chevron after
it, as on any map); the separate page glyph is gone. The blend is a labelled
toggle, "Blend", among the tools. On a phone the dock is a bottom sheet: its
head (the name and the tools) is inside it, not floating on the chart, and it
is swiped between three heights, peek (the head alone), half (the hours and
the wind) and full (with the waves, sky, air and rain), and closed from peek.
A sideways swipe is still the hours'. The handle is a button for a keyboard
and a screen reader, and the glide is skipped for a reader who asks for less
motion.

**2026-10-24 — Mixed and rounded.** The owner approved a new treatment for
everything that is a box, from the mockup
`backlog/mockups/2026-10-24-layer-rail.html` (its "Mixed" style, the
`body.mixed` rules and the `--r-*` corners). It keeps the broadsheet's edge
and adds a corner and a lift: the 1px ink rule and the hairline just inside it
(`inset-shadow-frame`, now two of paper and a hairline of ink at a quarter,
`#1a1d2142`; the mockup's gap of `#f4efe5` is drawn in the product's paper,
`#f3eee3`, so it vanishes into it as before) stay on every box and sheet; corners are 10 for a control, 14 for
a box and 18 for a sheet, with capsules unchanged; and each box is lifted by
soft stacked shadows by its elevation (`shadow-card`, `shadow-float`,
`shadow-sheet`, `shadow-dock`). Paper stays flat on anything large; the
faintest top light is on a floating box only, and a sheen on small controls
only (a pressed ink control, a raised paper button), which nudge down a pixel
when pressed. Print rules (double rules under heads, table and column rules,
the dock's day dividers) stay square and unshadowed. It replaces the square
boxes of 2026-10-05 and the "rules, not surfaces" lift, not the rules
themselves: structure is still drawn in ink. Values: `ui/theme.css` "shape and
depth"; the bundle's `sem.radius.*`, `sem.shadow.*` and `sem.gradient.*`.

**2026-10-24 — The site menu is a drawer from the left.** The owner approved
the menu of the "Your spots" mockup (`backlog/mockups/2026-10-24-your-spots-home.html`)
for every page that has the site menu. The button stays where it was (top
left on the chart, at the left of a page's masthead); it opens a drawer from
the left edge over the kit's backdrop, a modal, so the focus is held in it,
Escape and a press on the backdrop shut it and the focus goes back to the
button. Its head is the close button and the name; then the page's own tools
and the site's sections, every row with its glyph in the margin (the wind
map's is a chart folded in three with a coast and a streak of wind, Use with
AI's a speech bubble with a spark: `windMap` and `useWithAi` in
shared/web/glyphSet.ts). A section switched off in the build is not drawn at
all. A finger drags it back off to the left: past about 70 px, or flicked, it
shuts; short of that it springs back, and a small grip on its right edge says
so. The Almanac's line and its puffin left the menu. Its corners and shadow are
the theme's (`rounded-r-dialog`, `shadow-sheet`), so it takes any change to
those with the rest of the site (`force5/src/SiteMenu.tsx`).

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

**2026-10-24 — The spot finder, beside the chart.** From the approved mockup
`backlog/mockups/2026-10-24-spot-finder.html`: "where is best for me, and
when?" as a list beside a map, at `/spots` (src/finder). It is a page of the
chart's bundle, drawn from the chart's own data (the rated hours, the strip of
columns, the frame on the map), and it replaces Your spots in the menu. It
lists the rider's Favourites, or every place within 30 km of them, rated at
one hour, best first: each card the place from above (the spot page's
picture) with the loupe's ride rose, its stars, its wind, and the day's wind
as a bar. Each place is a pin on the chart in a plain style (paper land, the
wind in ink, no lights), its stars said by shape and fill and never by a wind
colour: an ink pill for four or five, paper for one to three, dashed for none.
The hour is chosen on a week of daylight bars in the wind's colours and is the
chart's selected time, so the chart opens on it; the pen marks it, on the
timeline and on each card's day, as it marks the chosen hour in the dock. The
site's root opens on whichever of the two pages the rider last had; a link
that names one wins.

**2026-10-24 — Customise, in plain words, one title a step.** "It reads
like cryptic riddles." The owner approved the wizard of the mockup
`backlog/mockups/2026-10-24-customise-wizard.html` (src/Customise.tsx). Six
steps, each with one title in the dialog's head beside "n / 6" and the close,
and a thin bar of segments under it for the progress; no "Customise your
chart" over them, no row of step labels, no Almanac or puffin. The words say
literally what a thing is ("Still getting up on the foil.", "Blows along the
beach. Ideal for most riders."), and a step says nothing it does not need.
Units and "Wings you own" join the first step, so Display options is the
units, the model and the models in the blend. The wind's top is "Too much,
in gusts", hatched in the pen's red past it, and the sample day says why an
hour lost stars in a word ("too strong", "gusty", "offshore"), its gust red
over the top and orange when gusty. The shore is the draggable web again,
its arrows the way the wind blows. The spots step says what its list is near
and keeps its order as spots are starred. The dialog keeps the name
"Customise" for a screen reader while its title changes (`label` on
ui/Dialog.tsx), and the search in a box is a capsule (`shape="pill"` on
ui/SearchField.tsx).

**2026-10-25 — The wind in two layers, Coloured wind and Particles.** "Let's
get rid of ink. So we should have colored wind and particles... two separate
layers." The wind was one style of three (Ink, Coloured wind, Coloured
arrows); it is two switches now, either, both or neither. Coloured wind is the
speed as a wash on the sea and nothing more: it no longer draws the ink lines
over itself. Particles are the moving lines, always in ink, so they read over
the colour; the arrows tinted by speed are gone. A first visit has the
particles alone, as the chart has always opened. A rider's older choice is
read into the layers once (force5/src/windLayers.ts `parseWindLayers`): Ink
is the particles, Coloured wind the colour alone, Coloured arrows both. The
spot finder's map has the colour alone, so its pins are all that moves the
eye. The app has the same two switches in its Layers sheet and reads its own
older choice the same way; with Reduce Motion on, its particles are still
arrows in ink.

**2026-10-25 — The spot finder is a page of cards, and stars have colours of
their own.** From the approved mock-up
`backlog/mockups/2026-10-25-spot-list-cards.html`, its "7e" (after
`2026-10-25-spot-finder-ideas.html`, #194 to #200). The finder at `/spots`
(src/finder) is a page of its own: no map and no week's timeline at its head,
and no longer tied to the chart's time (this supersedes the finder of
2026-10-24, its map, its pins and its timeline). The head is the menu, the
wordmark and a Favourites / Near you switch; no heading, no Today / This week,
and no legend, the stars and the wind's colours being the site's own, said on
the Info page. The cards are ranked by the most stars in today and the five
days after it, the soonest, then the nearest; two columns from 1180px of page
(`cards:`), one under it. A card is the place from above with the ride rose on
it (pressed: the chart there, at the rose's hour; anywhere else on the card:
the spot's page), its name, distance, county and star; then today, a row of
hour columns from the hour before first light to the hour after last light
(civil dawn and dusk), each the hour, the sky, the wind and gust, the arrow
(the pen's red off the beach) and the hour's five stars, with the day's wind
faintly behind in the chart's own colours for knots and the gusts paler over
it. The row scrolls sideways with no bar, opens on now, fades at an edge with
more and steps with ‹ ›; an hour pressed is picked on every card and turns
every rose to it, and now goes back. The next five days are 6d's band:
daylight only, the windiest hour labelled, a line under the rideable hours.
**Stars as colour**: `stars-1` … `stars-5` (ui/theme.css), pale pink to deep
magenta, the chart's magenta paled and deepened, one hue darker with each
star and the one-star end 2:1 on paper; never the wind's colours, and no stars
has none. `StarGlyphs coloured` draws them, the earned in their colour and the
rest of the five outlined. For now only the finder's cards take them: the
chart's and the dock's stars stay ink until the owner says otherwise.

**2026-10-25 — The spot finder's cards keep one time between them.** The
owner, after 7e: "effectively one time setting across all of the cards that
keeps them all in sync and shows a little dotted line where I'm hovering",
as a Grafana dashboard's charts share a crosshair. One day and one hour for
the whole list. A day pressed among the next five (its name, a button, or its
drawing) is drawn hour by hour on every card in today's place, headed with
its name ("TUE 28"), first light to last, its hours a column each where the
run is hourly and the run's own steps where it is three-hourly; the five
below are then the other days in order, today among them as "Today" to come
back to, under "Other days" (the six stay six, and a fifth of a phone's card
is all a day has room for). With no hour picked a day chosen stands at its
early afternoon, ringed, the roses turned to it and the hour on each
picture; an hour picked is put down when the day changes. A mouse (or a pen)
over a card's hours, or over a day's drawing, draws a thin dotted line at that
time on the same day on every card, and the time beside it on the card it is
over; it goes when the pointer leaves. A finger has no hover: a tap picks, as
before. The line moves straight in the page once a frame (src/finder/hover.ts),
never drawing a card again. Under the row, first and last light hold to the
view's edges as it scrolls rather than being cut off by them; and the rose's
no-go is hatched in screen pixels over the picture, its washes kept light, so
a picture under a small rose is not fogged.

**2026-10-25 — One site menu, the same on every page.** "The menu for
SpotFinder and for the main chart page is different. This menu should be the
same across all pages." The menu opens on the site's navigation wherever it
is opened, in one order and one wording: Chart, Spot finder, Customise, and
after a gap the site's other sections (Use with AI; the marketplace and the
community where they are on). "Wind map" was the chart a second time and is
gone: the chart is the map. The page you are on is marked as the finder's
menu marked it, italic and heavier on the second sheet with
`aria-current="page"`; a spot's page and "How the stars work" are neither, so
nothing is. What only one page has is set apart under the navigation, under
the page's name in the mono label over an ink rule: on the chart, "This
chart", with Layers, Display options, About the map and Take the tour. A page
with nothing of its own has no such part. Customise from a page that is not
the map's is the chart with the wizard open (`/?customise`); from a page over
the map, the map as it was with the wizard over it (`force5/src/siteNav.ts`
`SITE_NAV`, `force5/src/SiteMenu.tsx`). The menu's rows say where they go:
Chart is always the chart (`/?chart`, and so is every way back named Chart)
and Spot finder always the finder, whichever was open last; only the bare
root, an address typed in, opens on the page the rider last had.

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

---

## Still open

- **Light only.** The bundle authored dark halves for its tokens that no product
  surface ever read; the theme is light only (D9, proposed). Dark needs its own
  contrast pass, and a dark basemap, before it is offered.
- **Preflight.** Tailwind's reset stays out (D3). Tried on 2026-09-22 with the
  map's colours all on the theme: the marketplace did not move, but all 36 map
  shots did (line heights, margins and box sizing through the dock and every
  panel). The map's stylesheets were written without a reset and lean on the
  browser's defaults; turning it on is a layout pass of its own. See the
  retire-force5-bundle item's LOG.
- **`.legend-gradient`'s eight `rgb()` stops** in `src/styles.css` are a stale
  copy of an old wind ramp, in a rule nothing draws. Removing the rule is the
  owner's call (map-theme-styles-compact, OPEN).
- **Model hues are not theme values.** See the ruling of 2026-09-16. Whether
  they become theme values (a fifth family made official) or stay in
  `MODEL_CATALOG` beside the model list is undecided; they have not been checked
  for contrast or for telling apart. Decide before the third ensemble lands.
