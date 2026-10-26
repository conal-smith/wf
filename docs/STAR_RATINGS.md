# Star ratings and wing sizes

Every forecast hour at a riding place gets a rating out of five, on ours or on
the rider's own (set in Customise), and a wing size beside it. The point is the glance: a
row of five solid stars on Thursday afternoon says "go" faster than three rows
of numbers do, and a light, steady day says "drills" instead of "nothing".

The logic is `force5/src/stars.ts`, a pure module with its tests beside it. The
dock draws it (`src/StarsRows.tsx`); nothing else is needed to rate an hour, so
the map, the forecast server and a notification job can all rate the same way.

## One model, the rider's choice

**Ruling, 19 October 2026: the stars come from one model, the rider's choice.**
Every hour is rated on one model's own wind, gust and direction, never on a
median or blend of several.

**23 October 2026: one choice, the model the rider sees.** The rider picks one
model ("Model", HARMONIE unless they pick another), and it is the model the
map draws, the dock and the spot page give, and the stars rate. Past the end
of its run ECMWF takes over on its own, because it runs fifteen days and
HARMONIE some two and a half; there is no setting for it, and ECMWF itself
hands over to nobody. There are no spots with a model of their own any more:
a spot rated from a model the map was not drawing broke "what you see is what
is rated". Each hour is the first of the two that reaches it; an hour neither
reaches has no stars, and no other model stands in. Where that model gives no
gust, the hour has none. How far the other models agree is shown beside the
stars, as context, and never takes a star off.

The rule is `force5/src/lead.ts` (`starsFromAt`, `leadFor`, `pickModel`), shared
by every surface that rates:

| Surface                              | Where the hours come from                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map lights, dock stars (web and app) | `src/ratings.ts` `placeConsensus`, or for the default choice the published blend built by the same function (`src/spotBlend.ts`, `force5/blend/build.ts`) |
| Dock's Blend chart                   | `src/useBlend.ts` → `blendStats(…, headline)`: the headline line is the same one model's                                                                  |
| Spot page, MCP tools, Gust           | `mcp/api/forecast.ts` `hourWind(…, from)`; `get_spot_forecast` and `find_wind` take `model`                                                               |
| Alerts                               | the published blend for a rider on the default; the models' own spot squares through `hourWind` for any other (`alerts/api/forecast.ts`)                  |
| Verification                         | `force5/ingest/consensus.py`, a line-by-line replica held to the TypeScript by `force5/ingest/fixtures/blend-consensus.json`                              |

The choice rides on the rider (`Rider.starsFrom`, a `StarsChoice` of one
`model` in `force5.prefs.v1`; the field keeps its old name so stored riders
still read), so every page and service that is handed the rider rates from it.
It is set in Display options ("Model", above "Models in the blend"), the map's
Layers ("Model, for the map and the stars"), the spot page's rider line and its
hour card's model table, and the app's Settings → Model; all of them set the
same choice, and the map moves to it. The map opens on it (`storedMapModel` in
`force5/src/boot.ts`), so a rider on HARMONIE downloads nothing new. A choice
saved before 23 October keeps its model; what it said for after the run's end
(`then`) and for spots of their own (`spots`) is dropped (`parseStarsChoice`).
Like the weight it stays on the device; only a rider's own star
rating is kept with their account. The app's alerts get it with the rest of
the rider when the phone registers.

The published blend is built for the default choice and says so (`lead` in
the pointer, and in each place which model each hour is). A reader whose
choice matches it rates from it; any other model is worked out in the browser
from the models' own spot squares, the squares in view.

The rider also chooses which models go into the blend ("Models in the blend",
every live wind model by default). The blend is context: the dock's Blend
chart draws the models ticked, with the rider's model's own line through them
as the headline the stars rate, and how far they agree. Since the blend moves
no star, a rider's own blend no longer stops the map rating from the published
file: the lights cost the same for any blend. The chart reads only the ticked
models' (and the rider's model's and ECMWF's) spot square for the open spot,
and only while it is shown.

Where the stars hand over from one model to the next, the dock draws a dashed
pen line down the hours with "ECMWF from Wed 22:00" written by it, and the
dock's head names the model whose forecast the hour in hand is ("★ HARMONIE",
"★ ECMWF" past the end of its run). The map hands over to ECMWF at the same
hours (`handoverModel` in `force5/src/timeline.ts`) and its label says so. The spot page puts a handover row in the day's
table, names the model on the day's header and in each hour's card.

## One rating, ours, made your own (v7, 25 October 2026)

**The owner's ruling, 25 October 2026: one rating, no levels.** Learning,
Riding and Advanced are gone everywhere. Everyone is rated on ours; a rider
who wants something else moves four numbers in Customise
(`backlog/mockups/2026-10-25-own-star-rating.html`, approved; the plan before
it, `backlog/research/2026-10-25-star-rating-plan.html`). The rider never sees
a gust setting: the rest is our model.

| The four numbers (`WindBand`) | Ours  | What it does                                   |
| ----------------------------- | ----- | ---------------------------------------------- |
| Too light (`min`)             | 11 kn | no stars below it; one star at it              |
| Sweet spot from (`sweetLow`)  | 15 kn | five stars from here…                          |
| Sweet spot to (`sweetHigh`)   | 22 kn | …to here                                       |
| Too much, in gusts (`max`)    | 35 kn | a gust past it leaves the hour no stars at all |

### Two numbers per hour

|               | What it is                                               | Drawn as       |
| ------------- | -------------------------------------------------------- | -------------- |
| **Potential** | What the steady wind alone is worth                      | outlined stars |
| **Stars**     | What is left once the gusts and the shore have their say | solid stars    |

Stars never exceed potential. The outlined stars between them stand for one
thing only: stars lost to the gusts or to the shore angle (`HourRating.lost`
says which). Solid and outlined differ by shape as well as by tone.

### The steady wind (`windStars`)

The steady wind, the mean, is what holds a rider on the foil, so it is what
the stars rate; a gust never lifts a light hour. From the four numbers:

- none below too light;
- one star at too light, climbing a star a knot (evenly, on a wider gap) to
  four just short of the sweet spot;
- five through the sweet spot;
- then four for up to three knots, down to one star at too much − 5 and none
  from too much − 3.

Ours by steady wind: 10 kn none, 11 one, 12 two, 13 three, 14 four, 15–22
five, 23–25 four, 26–27 three, 28–29 two, 30–31 one, 32 and over none.
Exactly the mock-up's function; `force5/src/stars.test.ts` holds the rating to
a copy of it for every wind and gust, ours and others.

### The gusts (`gustStars`, `gustsOverLimit`)

A gust past too much leaves the hour no stars, outlined ones too: "Gusts over
your limit" (the session `too-gusty`, or `too-strong` where the mean is too
strong on its own). Otherwise the gust is read `GUST_EASE_KN` (5 kn) lighter
on the same scale, and the hour takes the lower of the two; the stars that
costs are outlined, and the reason says "Gusts: 1 star off." Riders judge a
gust by how strong it is, not by its ratio to the mean, so there is no
gust-factor penalty and no "how much does gusty wind bother you" setting
any more. The dock's gust factor row is a figure to read, tinted only where
the gust, so read, costs a star or is past too much.

The agreed table (ours, cross-shore), asserted in `stars.test.ts`:

| Hour       | Stars         |
| ---------- | ------------- |
| 15 gust 25 | 5             |
| 20 gust 25 | 5             |
| 20 gust 30 | 4, 1 outlined |
| 25 gust 30 | 4             |
| 30 steady  | 1             |
| 22 gust 35 | 1, 4 outlined |
| 32+ steady | 0             |
| 10 steady  | 0             |

It differs from the plan's draft only at the ends: 10 kn steady (the plan's
tail gave it a star; under too light, none) and a gust of 36 (past too much,
none).

### The shore (`directionCosts`)

Whole stars off for each way the wind meets the beach, taken after the gusts:

| Way of wind    | Ours  | The rider may set |
| -------------- | ----- | ----------------- |
| Onshore        | —     | 0–5               |
| Cross-onshore  | —     | 0–5               |
| Cross-shore    | —     | 0–5               |
| Cross-offshore | −1    | 0–5               |
| Offshore       | never | never, locked     |

Offshore is never for everyone: no stars, outlined ones too, and "We don't
recommend going out in an offshore wind." Any way of wind set to five is
never too (session `never-shore`).

### What never moves a star

Weight and wings (a wing size is still shown, `wingSize`, from the weight
alone), how far up and down the wind the rider rides (it draws the loupe and
the light's wedge, docs/RIDE_ROSE.md), the models' agreement, and a yellow
warning. An **orange or red** Met Éireann warning replaces the stars outright
(below).

### Met Éireann warnings (`applyWarnings`, force5/src/warnings.ts)

After the stars are worked out, Met Éireann's warnings for the place have the
last word (the owner's ruling of 25 October 2026). An hour an **orange or red**
warning covers, wind, weather or marine, has no rating at all: the warning's
mark stands where its stars were, on the spot page and in the dock, its light
and the finder count it as nothing, and the MCP never calls it rideable. A
**yellow** warning leaves the stars as they are and is shown beside them:
some yellow warnings (rain, fog) say little about the wind on the water. The
same function applies it everywhere, so the site and an agent always agree.
Which counties and coastal stretches each place takes its warnings from is in
`data/locations/warning-areas.json`; the warnings themselves are copied hourly,
unaltered, by the `warnings` job (docs/LIVE_FORECAST_PIPELINE.md).

### A rider's own rating (`CustomRating`)

```ts
{ version: 3,
  wind: { min, sweetLow, sweetHigh, max },                        // knots
  direction: { onshore, crossOn, cross, crossOff, offshore } }    // whole stars off; offshore 5
```

Made in Customise (src/Customise.tsx on the site, mobile/src/features/stars
in the app, on the same arithmetic, `spot/web/yourStars.ts`). Left as ours, no
rating is kept (`isOurs`), and "Reset to ours" shows only once something
differs from ours. It rides on the rider (`Rider.custom`), so every page and
service that rates (`rateHour`) uses it. `parseCustomRating` is the one place
it is made safe, whoever wrote it: only version 3 is read — a level's rating
from before 25 October 2026 (versions 1 and 2, with a `base` level) is
ignored, and the rider is on ours; a missing number drops it; knots are held
to the tenth, the four numbers in order a knot apart within 2–40 kn, every
direction to whole stars 0–5, and offshore to never whatever was sent.

### Why v7 (25 October 2026)

The owner's rulings. One rating instead of three levels, so nobody has to
guess which they are; the four numbers the rider already drags are all they
set. The steep fall past the sweet spot follows the research (most riders
struggle above 25–28 kn; 30 is a limit, not a good day; the plan's sources),
and reading a gust 5 kn lighter keeps an ordinary coastal 15 gusting 25 at
five stars while 20 gusting 30 loses one. The gust-factor penalty went: our
own check of the forecasts against buoys and stations (PR #202) found the
models get a gust's size right but not which hours are gustier than usual,
so a ratio rule was mostly guessing. Wings never cost a star; weight no
longer moves the band. Stored settings from before (levels, gusty wind, a
kept rating, a version 1 or 2 rating) are read without fault and ignored.

### Why v6 (24 October 2026)

The owner's rulings. A rider's top wind now means "the most I can hold, gusts
included", so an hour gusting over it has no stars at all, not outline stars,
and says "Gusts over your limit"; the tops stay 24, 30 and 35 kn at 80 kg
("nobody goes out in 40; 30 is about the max, maybe 35 for very advanced").
The gust curve went: v4 and v5 charged a 32 kn gust on a 22 kn riding day a
third of a star, which said nothing useful about an hour few riders would go
out in, while a 15 kn mean gusting 27 lost nothing though it rides very
unevenly. Gusty wind is judged by gust ÷ mean instead, from the floor up, and
each rider says how much it bothers them, so gusty wind costs outline stars
and a rider who doesn't mind it can say so. Onshore, cross-onshore and
cross-shore cost nothing for any level: cross-shore "is perfect conditions",
and onshore cost a star on hours that ride well. A rider's own rating is now
version 2, without the gust curve; a version 1 rating is read with its wind
and directions kept.

### Why v5 (19 October 2026)

The owner's ruling: "Why are ECMWF and GFS contributing towards the stars? It's
supposed to only take whatever the user has configured. We don't use more than
one model." v4 rated HARMONIE's own hour, but past HARMONIE's run it rated a
weighted median of the other models (in practice GFS's number once ICON-EU had
ended too), and every hour lost a quarter to a whole star when the models'
spread was moderate or low, so a model the rider never looked at could take a
star off. v5 rates one model's hour, the rider's choice, then one fallback,
never a blend, and the agreement is context only. The wind, gust and direction
bands are v4's.

### Why v4 (18 October 2026)

v3 charged the gusts for running more than ten knots over the mean, which cost
a 15 kn mean gusting 27 two stars though nothing about it is hard, and took
another half star for any gust past the ceiling. Riders judge a gust by how
strong it is, so v4 rates that, on a curve per level. Offshore was a cap of one
star (none for a learner); it is now four stars off (five for a learner), so it
reads the same on a good wind and can be set like any other direction in a
rider's own rating.

### Why v3 (17 October 2026)

v2 rated a light day on its gusts as much as its mean, lifting the mean toward
the gust as far as the top of the sweet spot, so 12 kn gusting 20 read as four
stars for an intermediate. The owner's rule, and the forums' and size guides',
is that the baseline wind is what matters: 12 kn is a light day whatever it
gusts, and ordinary gusts shouldn't move the stars, while gusts running well
clear of the mean, or past what you can hold, make a session harder. v3 rates
the mean, lets gusts lift only a sub-floor hour to the floor, raises the
intermediate floor from 10 to 11 kn and the learner's to 13 (sweet spot from
15), and charges only the spread past ten knots and gusts past the ceiling.
Replaying the published blend of 17 October 2026 (every riding place, 08–17
UTC, shore not counted), hours at 0 / 1 / 2 / 3 / 4 / 5 ★:

| Level    | v2                                    | v3                                    |
| -------- | ------------------------------------- | ------------------------------------- |
| Learning | 5334 / 413 / 492 / 633 / 1123 / 293   | 5873 / 804 / 625 / 393 / 287 / 306    |
| Riding   | 3654 / 749 / 568 / 668 / 1094 / 1555  | 4170 / 1152 / 557 / 659 / 757 / 993   |
| Advanced | 2265 / 1142 / 803 / 712 / 1149 / 2217 | 2310 / 2006 / 694 / 891 / 1068 / 1319 |

Most of the change is light days: hours v2 lifted on their gusts now sit at
one or two stars. Five stars stays for a good mean with ordinary gusts.

### Why v2 (October 2026)

The first version read the mean wind alone and took up to 1.5 stars for any
gust factor over 1.35, at any speed. Irish coastal winds are nearly always that
gusty in the models, so "Gusty" was the deduction on 1,657 of the daylight hours
rated on 4 October 2026, and a light, gusty day scored nothing: the whole of
Dublin Bay sat at zero stars (9 kn gusting 17, cross-shore) while riders were
out on big wings. Replaying the published runs through both versions
(`.scratch`-style replay over every riding place, daylight only):

| Best hour of the day, intermediate (spots at 0 / 1 / 2 / 3 / 4 / 5 ★) | v1                          | v2                         |
| --------------------------------------------------------------------- | --------------------------- | -------------------------- |
| Sat 4 Oct, SW 15–21 kn west, 8–11 kn east                             | 30 / 22 / 36 / 21 / 27 / 10 | 2 / 21 / 10 / 34 / 34 / 45 |
| Mon 6 Oct, N 6–14 kn                                                  | 126 / 16 / 2 / 2 / 0 / 0    | 44 / 54 / 26 / 15 / 6 / 1  |

A light day still reads as light, and offshore was still capped; what changed is
that a gusty 9–12 kn day is now "drills" at two stars instead of nothing.

### The shore

"Onshore" needs to know which way the beach faces. `npm run spots:facing`
(`scripts/shore-facing.mjs`) reads the map's own basemap tiles (OpenFreeMap,
OpenStreetMap data): for each place, 72 bearings at 300 m, 700 m and 1.2 km,
each tested for water, and the facing is the circular mean of the water
bearings. `strength` says how lopsided that is; below 0.15 (a pin on an isthmus,
a lough's middle, an estuary with water all round) no facing is published and
the hour is rated on the wind alone. 126 of the 149 places have one computed,
and the overrides below bring it to 127.

It is a computed estimate. `data/locations/shore-facing.json` has an
`overrides` block for corrections, which win and survive a rerun. The first
five are from knowing the beaches, not a survey: Dollymount (ESE, 125°) and
Tramore (S, 175°), whose pins sit deep in their bays and fell under the cut-off
with the right bearing; Streedagh and Waterville likewise, at their computed
bearings; and White Strand Doonbeg set to unknown, because the computed NE
looks wrong and no direction is safer than the wrong one. The sixth is
Skerries — South Strand (ESE, 105°, square to the beach's high-water line):
its pin sits on the sand beside Red Island's neck, and the harbour and North
Beach behind the neck pull the computed bearing round to NE (50°). Worth
checking next: **Brandon Bay** (computed E, from a pin on the Maharees neck)
and the other places left without a facing, listed by `strength` in the file.

The same facing draws the loupe's ride rose on the map: the tack out to sea,
the tack home, the no-go and the drift, on angles shared with the light's
wedge (`rideRange`). Those angles, with their sources and the dated check of
19 October 2026, are in [RIDE_ROSE.md](RIDE_ROSE.md).

### Wing size

Fitted to published size charts: an 80 kg rider on 5.5 m² at 15 knots, 4.5 m²
at 20 and 3 m² at 30.

```
size = 5.5 × (weight / 80)^0.8 × (15 / wind)^0.85
```

rounded to the half metre and held between 2 and 8 m². With a quiver listed,
the rider's own wing is the smallest that is not much smaller than the
recommendation (≥ 90%), because a wing a touch big still works in the lulls.
It never moves a star.

### Sessions

Each rated hour is also sorted by its steady wind against the four numbers
(too light, drills, cruising, powered, overpowered, too strong) or as
too gusty, offshore, or a way of wind the rider never rides. The kinds have
no names on the page: the stars and the figures speak for the hour. Only an
hour with no stars says why: "too light", "too strong", "gusts over your
limit", "offshore" or the way of wind (`noStarsWhy`).

## The rider

Weight, wings, how far up and down the wind the rider rides (`upwind`,
`downwind`, kept only when not ours: 0° and 10°) and any rating of their own
live in the display preferences (`force5.prefs.v1`, version 3), validated
field by field on load: a weight outside 30–160 kg or a wing outside 1.5–10 m²
is dropped rather than used, and a rating goes through `parseCustomRating`.
Preferences stored before version 3 keep their weight, wings and model, and
start from ours: their level, gusty wind, angles and rating belonged to the
levels. Until a weight is given the wing sizes assume 80 kg.

A rider's own rating is saved, or gone back to ours, through
`withCustomStars`, which stamps the moment (`starsUpdatedAt`). For a
signed-in rider it is also kept with their account (`GET`/`PUT
/api/me/rider`, `site/api/riders.ts`, the `rider_profiles` table), so it
follows them across devices: `shared/web/riderSync.ts` compares the device's
copy with the account's when the page knows who is signed in and after every
change on the device, and the newer wins, going back to ours included. An old
rating the account still holds from before 25 October 2026 reads as none. A
copy last matched with another account on a shared device is never sent to
the next one who signs in. The community and the marketplace run it inside
their sign-in; the map and the spot pages load it on their own
(`shared/web/AccountRider.tsx`), only on a device that has signed in before,
so nobody else downloads the identity provider. The app has no sign-in yet, so
its rating stays on the phone; it reaches the alerts server with the rest of
the rider when the phone registers.

## In the dock

- The **stars** are the dock's first row, over wind, direction, wing and tide,
  for every hour of the fortnight's strip, and over the chart in the Blend
  view, rated from the same hours as the map's lights. Hover or tap them for the chart's
  box with the session, the shore, the wing and every reason a star came off
  (`ui/RatingTip.tsx`, the same card as the spot page's); the "?" beside the
  row leads to [How the stars work](/stars).
- The **wing** row gives each rated hour's wing, the rider's own if they have
  one that fits, else the recommended size.
- The map's lights read the same stars for the selected hour
  (`src/ratings.ts`), and so do the rows that list places (the search, Your
  spots, the note beside the selected light): each gives the place's stars and
  wind at that hour.

Days are not rated. A day's heading is its name and date: a "best today" or a
day's stars would sell a day on its one good hour, and a rider reads the hours
and picks a window themselves.

## On the spot page

`/spot/<id>` (`spot/web/`) is the chart's broadsheet for one place, day by
day. It rates the forecast server's headline line, one model's own wind, gust
and direction by the rider's choice (`hourWind`, `mcp/api/forecast.ts`), with
agreement read across every model as context, so the stars there are the stars
an assistant would be given. The dock follows the same rule from the same
`force5/src/lead.ts`, so the two agree.

- **The week strip**, a column a day for seven Irish days, by name and date.
  Choosing a day takes the page to it. No day is rated: the stars are the
  hours'.
- **Each day** under a header that sticks while its hours scroll: its name
  and date.
- **A row per daylight hour**, the dark folded either side and never rated:
  the stars, the wind with its gust raised (in the pen's red when it jumps),
  where it comes from, the waves and the sky. Rows are hourly
  for the first 72 hours and every third Irish hour after, where the models
  themselves step three-hourly. Hover or tap the stars for why
  (`ui/RatingTip.tsx`); tap the row for its second line: the session, the
  wing, what the gusts make it ride like, waves and rain, the models' and the
  members' spread drawn on the rider's own scale (`RangeBar.tsx`), and every
  reason a star came off.
- **The tide and the light** under each day: a 24-hour curve with the night
  and twilight behind it, then the high and low waters and first light to last
  light as two small tables.
- **Stars:** "Ours" or "Your own", with a way to Customise, and the weight
  and wings behind a fold, written to the same `rider` in `force5.prefs.v1`
  through the same `parseRider` validation (neither moves a star).

### The members' spread

There is no "chance it rides" column. It was the share of ensemble members
(ECMWF ENS and GEFS) windy enough for the rider; it was removed on 11 October
2026, with both ensembles retired to save downloads, since the hours' stars
already say when to go.

Where an ensemble does publish its members for the spot (`spotMembers`), the
hour's second line gives the members' 10th to 90th percentile wind beside the
models' range, and the members' middle 80% is the sea-blue bar on its range
bar (`hourEnsemble` in `mcp/api/forecast.ts`). With both ensembles retired,
neither shows.

## What would make it better next

1. **Rider feedback.** A "rode it: ★★★" check-in from the community spot card
   would give ground truth to tune the bands and deductions against, and is the
   honest way to make the stars better than a formula.
2. **Alerts.** Follow a place, get the bell when a four-star window appears in
   the next 48 hours.
3. **Per-place knowledge.** Tide windows ("works from mid tide up") and known
   good directions from local riders, as overrides on the computed facing.
4. **Waves.** A wave-riding session (cross-off with swell) for advanced riders,
   and a penalty for a heavy shore break for beginners, from the wave rows the
   dock already has.
5. **The forecast server.** `get_spot_forecast` and `find_wind` could return
   the stars, so an assistant can answer "where is it five stars on Saturday".
