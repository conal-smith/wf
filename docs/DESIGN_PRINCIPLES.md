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

---

## The accent rule

**One filled action per view.** `bg-accent` is the filled action, and a view
gets one: Play in the dock, Sell in the marketplace header, Retry in an error
state, never two at once. A second filled button does not add emphasis, it
removes it. In the kit it is `<Button variant="primary">`, and the kit writes
the accent fill nowhere else.

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

## The wind rule

**Wind colours mean wind speed and nothing else.** The fourteen
`--color-wind-k*` stops are the `PALETTE` in `force5/src/weather.ts`. They are
speed bands, not safety ratings and not ability ratings, and they are the only
way colour may describe wind. No other element, state or category borrows them.

They do not re-theme. A colour that means 35 knots means 35 knots at night and
on any palette: the Atlantic change left all fourteen at their values (D5, D12),
as it left the now-marker and the gust cap.

A legend is generated from those stops, never restated: a legend that copies
the ramp by hand is how the legend and the map drifted apart before.

On the map, **shape carries kind and colour carries the reading.** A spot
marker says riding spot, operator, club or area by its shape (round, squared,
dashed); colour on a marker only ever means wind.

## What structure is made of

Structure is **surfaces, not lines**. Over the map a thing is separated by
being a glass pane with an elevation, not by being boxed in; inside a surface,
division is `border-line` and nothing heavier.

**Glass is for what is laid over something worth seeing**: the moving map, or a
photograph. A `Surface` is glass; a `Pane` is the content ground's card. On a
page with no map behind it a white hairline and a translucent fill vanish, so
the content ground takes `bg-card` on `bg-ground` instead: the card is lighter
than its ground, which is what makes it read as lifted without glass.

**Four kinds of surface, told apart by radius and elevation, not colour**: the
pane (`Surface` over the map, `Pane` on a page), the pill, the dock and the
dialog (`Dialog`). If a new thing fits none of them, the answer is usually that
it should not be a surface.

**Never glass on glass.** Two backdrop blurs stacked compound into mud and cost
a frame. A control inside a glass surface is raised (`variant="raised"`: the
raised white and the glass's own hairline) or sunken, never a second blur.

**Every glass surface goes solid for a reader who asks.** Under
`prefers-reduced-transparency` glass becomes `bg-solid`, and the text ramp is
measured against that solid ground, so the fallback is the accessible case, not
a degraded one.

## Ceilings

**Type.** Eight named steps, 9px to 48px: `eyebrow` 9, `caption` 10, `label`
11, `body` 12, `prose` 14, `lead` 17, `title` 25, `reading` 48.

- 9px (`text-eyebrow`) is the floor, and only for tracked uppercase labels and
  axis ticks. Never a sentence.
- 10px (`text-caption`) is the floor for anything in sentence case.
- One `title` per surface. One `reading` per view: the wind speed is the number
  the product exists to show, and a second thing that size competes with it.
- Above `title`, only the wind reading. There is no display type besides the
  wordmark.
- `prose` is body copy read at length away from the map; `lead` is the one thing
  a card leads with, or a section heading. Neither is display type.
- A field on a coarse pointer is set at `lead` (`pointer-coarse:text-lead`, as
  `ui/control.ts` and `SearchField` do): a phone zooms into a focused field
  whose text is under 16px, and the scale steps from 14 to 17.
- Four weights: 400, 500, 600, 700 (`font-normal` to `font-bold`). The
  half-steps the product once used are retired; where one was load-bearing,
  round up.

**Radius.** `control` 12, `surface` 20, `pill` 24, `dialog` 30, and `full`. A
view uses at most three, and they nest inward: a control inside a pane inside a
dialog goes small inside large, never the reverse. A rounded thing inside a
more-rounded thing reads as a mistake.

**Elevation.** Four shadows, `control`, `marker`, `surface` and `dock`, and they
are a hierarchy, not a palette: everything at the same layer casts the same
shadow. If two things at the same layer look different, one of them is at the
wrong layer.

**Colour.** One neutral family and one accent (ruling of 2026-09-20 below). The
navy ramp is the entire structural palette, and the blue accent is the filled
action and nothing else. The only other families are warm (now or degraded),
green (`ok`, one liveness mark) and wind (data). A further family is a design
change, not an implementation detail.

**Text contrast.** `ink-muted` is the floor for text. `line-strong` and
`ink-disabled` (the same step) are for strokes, icons and disabled controls,
where 3:1 is the bar, and are never used for text that is merely low priority:
disabled means unavailable.

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
- Don't nest glass in glass.
- Don't restyle a focus ring. There is one: 3px of `focus`, 2px clear of the
  control (`RING` in `ui/tv.ts`), on every control.
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
