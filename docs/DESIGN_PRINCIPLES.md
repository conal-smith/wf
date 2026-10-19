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
round the best hour, an underline under the word that carries the note, a
strike through a spot that is offshore, and the note itself in the hand. One
mark on a view, two at most. It is never a fill, never a control, never a
status: a warning is `warn`, a different red that means degraded. The pen's
strokes are `pen`; its handwriting is `pen-ink`, which reads as words.

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

**A box is the chart's box**: paper with its grain, a 1px ink border, and for
one that matters (a dialog, anything laid over the map) a second line inside
it, the double rule (`inset-shadow-frame`). Inside a box, division is
`border-line`, the hairline, and nothing heavier.

**Over the map, paper is opaque.** A translucent panel over a moving map is a
second, blurred map, and the blur costs a phone every frame. `Surface` is solid
paper in a double rule. Glass survives only as a badge over a photograph
(`Chip tone="glass"`), and goes solid for a reader who asks for less
transparency.

**Four kinds of box, told apart by their rules, not their fill**: the pane (one
rule), the chart's box (`Surface`, `Dialog`: the double rule), the pill (a
capsule, for what is pressed) and the dock (a double rule along its top edge).
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

**Radius.** Square, as print is: `surface` and `dialog` are 0, `control` is 2
(a whisper, so a field reads as a box to write in), and `pill` and `full` are a
capsule, for what is pressed. A rounded box is a mistake on the chart.

**Elevation.** Four shadows, `control`, `marker`, `surface` and `dock`, all
small and warm: paper lifts off paper, it does not float. They are a hierarchy,
not a palette: everything at the same layer casts the same shadow.

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
- Don't use the pen for more than the one thing that matters on a view, and
  never as a fill or a status.
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
