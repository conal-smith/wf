# Force5 principles

What the tokens cannot decide. Read this before the catalog: it settles the
arguments the token names only imply.

Force5 is a map with tools floating over it. The map is the product; everything
else is chrome that has to earn the pixels it covers the sea with. That single
fact decides most of what follows.

---

## The accent rule

**One accent per view.** `--sem-color-action-bg` is the filled action, and a view
gets one: Play in the timeline, or Retry in an error state, never both at once. A
second filled button does not add emphasis, it removes it.

Everything else that can be pressed is quiet — `--sem-color-action-quiet` with no
fill until hover. On a map this is not timidity: a screen of filled buttons over
moving water is unreadable.

**Warm is not an accent.** The warm family (`ref.color.warm.*`) means one of two
things and nothing else: *this instant* (the now-marker) or *this is degraded*
(a stale snapshot, a failed fetch). It is never used to make something stand out.

## What structure is made of

Structure is **surfaces, not lines.** A thing is separated from the map by being
a glass pane with an elevation, not by being boxed in. Inside a surface, division
is `--sem-color-border-hairline` and nothing heavier.

There are exactly four kinds of surface — pane, pill, dock, dialog — and they are
distinguished by radius and elevation, not by colour. If a new surface does not
fit one of the four, the answer is usually that it should not be a surface.

**Never glass on glass.** Two backdrop blurs stacked compound into mud and cost a
frame. A surface inside a surface uses `--sem-color-surface-raised` (lifted) or
`--sem-color-surface-sunken` (recessed).

**Every glass surface ships a solid fallback.** `prefers-reduced-transparency`
and browsers without `backdrop-filter` both get `--sem-color-surface-solid`, and
the whole text ramp is contrast-tested against that solid ground rather than
against the glass — so the fallback is the accessible case, not a degradation of
one.

## Ceilings

**Type.** Ten steps, 9px to 48px.

- 9px (`2xs`) is the floor, and it is only for tracked uppercase labels and axis
  ticks. Never a sentence.
- 10px (`xs`) is the floor for anything sentence-case.
- One `title` per surface. One `reading` per view — the wind speed is the number
  the product exists to show, and a second thing that size competes with it.
- Above `3xl`, only the wind reading. There is no display type in this product
  besides the wordmark.

**Radius.** Four steps plus `round`. A view may use at most three, and they must
nest inward: a pill inside a pane inside a dialog goes large to small, never the
reverse. A rounded thing inside a more-rounded thing reads as a mistake.

**Elevation.** Four shadows, and they are a hierarchy, not a palette: everything
at the same z casts the same shadow. If two things at the same layer look
different, one of them is at the wrong layer.

**Colour.** One neutral family and one accent. `ref.color.teal.*` (the navy ramp
since the ruling of 2026-09-20) is the entire structural palette, and
`ref.color.blue.*` is the filled action and nothing else; the only other families
are `warm` (degraded / now), `green` (one liveness dot) and `wind` (data). A
further family is a design change, not an implementation detail.

## The wind scale is data, not decoration

The fourteen stops in `ref.color.wind.*` are the `PALETTE` in
`force5/src/weather.ts`. They are speed bands — not safety ratings, not ability
ratings — and they are the only way colour may describe wind.

They do **not** re-theme in dark mode. A colour that means 35 knots means 35
knots at night; a data scale that shifts with the theme means nothing.

The legend is generated from those stops (`sem.gradient.wind`), never restated.
That is the whole reason the token exists — see the ruling of 2026-09-14 below.

## Don't

- Don't add a hex, a px, a radius or a duration to product code. A missing value
  is a missing step in a scale; add the step with semantics and regenerate.
- Don't put a second filled action on a view.
- Don't use the wind ramp for anything that is not wind speed.
- Don't nest glass in glass.
- Don't restyle a focus ring. It is one token, one width, one colour, every
  control, both modes.
- Don't let colour be the only carrier of a state. Status chips say the status in
  words; markers carry kind as shape; the selected segment is raised as well as
  filled.
- Don't use `--sem-color-text-disabled` for text that is merely low priority.
  That is `--sem-color-text-muted`. Disabled means unavailable.
- Don't go below `--sem-control-height-sm`, and only use that size where the
  parent pads the tap target out to 44px.
- Don't hand-edit a derived file. `foundations/tokens.css` and
  `catalog/index.html` are outputs; the manifest's `derived` map names the
  generator for each.

---

## Rulings

Dated, because an undated rule cannot be told from an opinion and gets
relitigated.

**2026-09-14 — The ramp is derived from the product, not invented.**
Every colour, radius, type size, weight and spacing literal in `src/` and
`force5/src/` was harvested and clustered in OKLab. The result was 70 opaque and
49 alpha colour literals sitting on a single hue (190–198°), smeared across
near-duplicate lightnesses — 25 of them inside one 7-point band. The eleven-step
teal ramp is that cluster, regularised: step 800 (`#163f49`) reproduces the
historical `--ink` `#173d49`, and step 400 (`#82aab4`) reproduces the historical
sea `#83afb9`. Nothing about the product's colour was chosen afresh.

**2026-09-14 — `teal.600` is the floor for text; `teal.500` is never text.**
Measured on the panel ground, 600 is 5.46:1 and 500 is 3.50:1. Four colours in
the old set (`#567c82`, `#567781`, `#557871`, `#567680`) sat at 4.12–4.41:1 —
under AA, at 9–11px, on captions and coordinates. They all resolve to
`--sem-color-text-muted` (600). 500 survives for UI strokes and icons, where 3:1
is the bar, and is barred from text by name.

**2026-09-14 — The legend is generated from `PALETTE`, never restated.**
The CSS `.legend-gradient` carried eight stops. `PALETTE` in
`force5/src/weather.ts` — which actually paints the map, the forecast cells and
the wind fills — carries fourteen, and they are different colours. The legend has
been telling the reader a scale the map does not use. `ref.gradient.wind` is
composed from the same fourteen tokens the cells consume, positioned by knots over
the clamped 0–65 range, so the two cannot drift again.

**2026-09-14 — Five weights, no half-steps.**
The variable fonts were being used at 400, 450, 500, 550, 600, 650, 700 and 800.
Eight weights is not a hierarchy, it is eight opinions. The scale is 400 / 500 /
600 / 700 / 800. The half-steps are retired; where one was load-bearing, round up.

**2026-09-14 — 9px is the floor, and only for tracked uppercase.**
The product had type at 6px, 7px and 8px. Those are gone. 9px survives for
tracked uppercase eyebrows and axis ticks; sentence-case text stops at 10px.

**2026-09-14 — Shape carries kind on the map; colour carries the reading.**
Spot markers were separating riding spots, operators, clubs and areas partly by
colour, while the same markers also carry a wind reading. Two colour meanings on
one object is one too many: kind is now round / squared / dashed, and colour on a
marker only ever means wind.

**2026-09-14 — The warm pair inverts wholesale in dark, not one end of it.**
Mapping `warnFg` to `warm.500` while leaving `warnBg` at `warm.800` put warning
text at 1.70:1 in dark mode — unreadable. Foreground and background swap ends of
the warm family together (`warm.800` on `warm.100` in light, `warm.100` on
`warm.800` in dark), which holds at 6.24:1 both ways. A dedicated dark warm
ground was tried and rejected: at 1.10:1 against the dark page the strip stopped
reading as a strip at all.

**2026-09-16 — Per-model identity hues are permitted only inside the forecast
chart and filter swatches; they never colour wind speed.**
The multi-model dock has to answer "which line is which model", and a fifth
colour family was previously forbidden outright. The exception is narrow and it
is drawn where the ambiguity is: a model hue may stroke a faint line on the
forecast chart and fill a swatch beside that model's name in the display filter.
It may not fill an area, colour a number, colour a map, colour a chip, or appear
anywhere outside those two places. Wind speed is still described by the wind
ramp and by height on the value axis, both of which come from `PALETTE`. The
hues themselves live in `MODEL_CATALOG` (`force5/src/manifests.ts`) and reach
the CSS through a `--f5-model-hue` custom property, so the component never
names one.

*Pending:* whether those hues become `ref.color.model.*` tokens with `sem`
aliases. They are currently twelve literals in TypeScript, half of them for
models whose adapter does not exist yet, and they have not been checked for
contrast against either ground or for distinguishability from each other. Adding
them as tokens would make a fifth family official; leaving them in the registry
keeps them where the model list is. Decide before the third ensemble lands.

**2026-09-14 — Dark mode is authored, not yet adopted.** See the gap below.

**2026-09-16 — Two type steps for content pages: `lead` and `prose`.**
The marketplace is the first surface that is a page rather than chrome over the
map, and the scale had nothing between `body` (12px) and `title` (25px). Cards
were about to lead with a 12px price and descriptions were about to be read at
length at 12px. `sem.text.prose` (14px regular) is body copy read at length away
from the map; `sem.text.lead` (17px semibold) is the one thing a card leads with,
or a section heading. Neither is display type: `title` is still one per surface
and `reading` is still the wind number alone.

**2026-09-17 — A content page has its own ground and its own opaque surface.**
The marketplace first shipped on `bg.page` with `surface.solid` panes, because
those were the tokens that existed. `bg.page` is the sea: a mid-tone meant to be
covered by a map, and `text.muted` on it is 2.4:1. A page that is read, with
headings, filters and captions standing directly on the ground, cannot stand on
that. `sem.color.bg.content` (teal.50) is the ground of a page with no map
behind it, and `sem.color.surface.card` (white; teal.900 in dark) is the opaque
surface that stands on it: a listing card, a form pane, a field fill. The card
is *lighter* than its ground, which is what makes it read as lifted without
glass. The whole text ramp passes on both: `text.muted` is 5.7:1 on the content
ground and 6.0:1 on the card. Neither token is for anything over the map; that
is still glass, with `surface.solid` as its fallback.

**2026-09-17 — On a content page the header's Sell is the accent, unless the
page brings its own.** One filled action per view still holds. Browse and the
seller page have no primary of their own, so the header's Sell is filled there;
on a listing (contact the seller), the sell form (publish) and the account
pages it drops back to a quiet pill. A destructive confirmation is a dialog, a
view of its own, and its one filled button is the warm pair, because removing a
listing and its photos is the degraded case warm exists to mark.

**2026-09-20 — Atlantic: one neutral family and one accent.**
The teal was made to sit quietly over a map full of wind colour; on a page with
no map behind it, it read cold and still. "One hue" becomes one neutral family
(navy) and one accent (blue). The navy ramp replaces `ref.color.teal.*` step for
step, `#f4f6fa` at 50 to `#050f20` at 950, and the family keeps its name so that
every `sem` alias keeps pointing at the same step number; the rename belongs to
the bundle's retirement, not to this change. One step is added, `teal.750`
(`#0b2545`), which `surface.inverse`, `action.quiet` and `action.focus` share.
The accent is `ref.color.blue.500` (`#1463ff`) with `blue.600` (`#0d4fd1`) for
hover, and it has one job: `action.bg`. The accent rule itself does not change:
one filled action per view. Warm still means now or degraded, wind colours still
mean wind, and `warm`, `green` and all fourteen `wind` stops keep their values.
The ink alphas (hairline, shadows, scrim) are re-based on `#0a1f3c`.

Measured the way the ruling of 2026-09-14 measured the old ramp: on the panel
ground 600 is 5.75:1 and 500 is 3.22:1, so 600 is still the floor for text and
500 is still never text. `text.muted` is 5.96:1 on the content ground and 6.45:1
on a card; white on `action.bg` is 4.93:1, and 6.87:1 hovered. Those figures
replace the teal ones quoted in the rulings of 2026-09-14 and 2026-09-17, which
stand as the record of how the old ramp was made.

The map does not follow yet. Its stylesheets read no tokens, so until they are
migrated the map stays teal while the pages around it are navy: separate page
loads, a visible seam rather than a broken one. The dark-mode halves keep their
aliases and have not had this pass; dark is still not adopted (see the gap
below), and they need it before it ever is.

---

## Gaps

Recorded rather than invented. These are known-missing, and a change that closes
one should update this list.

- **Dark mode ships in the tokens but not in the product.** The 22 mode-varying
  tokens are a designed proposal, reviewed in the catalog in both modes; no
  product surface reads them yet, and no one has seen the real map under them.
  The map basemap in particular is a third-party style that will need its own
  dark variant before the app can honestly offer the mode. Until that happens,
  dark is a bundle feature, not a product feature.
- **The forecast grid still has no component.** `forecast-chart` covers the
  dock's two chart views and its display filter, but the grid itself — sticky
  headers, per-cell wind fills, the now-line, the selected column, the glyph row
  labels — is still only in product CSS. It remains the biggest thing standing
  between this bundle and covering the real UI.
- **Model identity hues are not tokens.** See the ruling of 2026-09-16. They
  live in `MODEL_CATALOG` and are passed in as `--f5-model-hue`.
- **The wind gradient exists only left to right.** `sem.gradient.wind` is
  authored at 90deg for the horizontal legend, and a precomposed gradient cannot
  be re-angled by a consumer. The chart's vertical ramp is therefore supplied by
  the product through `--f5-chart-scale`. A turned variant of the token, or a
  stop list a consumer can compose, would close this.
- **No plot-height scale.** The chart box is 140px on a desktop and 104px on a
  phone. Neither is a step in any scale, and both are declared with a
  `ds-lint-allow`. Whether component dimensions like these deserve a scale at
  all is undecided.
- **No motion spec beyond two durations.** There are easing curves in the product
  that are not tokenised, and `sheet-in` is the only named animation.
- **No spec for the map's own controls.** MapLibre's attribution and control
  container are restyled in product CSS with `!important`; whether those become
  components or stay an explicit exception has not been decided.
- **No text field, select or textarea component.** The marketplace's forms
  carry `.mk-field` in product CSS (`market/web/market.css`), consuming `--sem-*`
  only, pending promotion into the bundle as a proper trio.
- **Pill buttons and chips are drawn for glass only.** `.f5-button--pill` and
  `.f5-chip` carry a white hairline and a translucent white fill, which vanish
  on `bg.content`. The marketplace re-grounds them on `surface.card` /
  `surface.sunken` with the ink hairline, scoped under `.mk-root` in
  `market/web/market.css`. If a second content page appears, that belongs in
  the components as a variant rather than in a second product stylesheet.
- **No dialog or toast component.** The marketplace's confirm dialog
  (`.mk-dialog`) is the dialog surface on a native `<dialog>`, in product CSS.
- **No 16px type step.** iOS zooms a focused field under 16px; the scale goes
  14 then 17, so marketplace fields take `lead`'s size on coarse pointers.
- **No icon set.** `glyphs/` is empty; the product uses `lucide-react` directly.
  Whether Force5 wraps it or adopts it wholesale is undecided.
