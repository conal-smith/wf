# Star ratings and wing sizes

Every forecast hour at a riding place gets a rating out of five, for the rider in
Display options, and the wing that rating assumes. The point is the glance: a
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
Like the weight and the level it stays on the device; only a rider's own star
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

## Two numbers per hour

|               | What it is                                                 | Drawn as              |
| ------------- | ---------------------------------------------------------- | --------------------- |
| **Potential** | What the wind alone is worth to this rider                 | faded (outline) stars |
| **Stars**     | What is left once the spot and the forecast have their say | solid stars           |

Stars never exceed potential, so the faded stars are always the upside a
kinder direction or a steadier breeze would have given. An hour whose gust is
over the rider's limit has neither: no stars are drawn at all.
Solid and faded differ by shape (filled against outline) as well as by tone.

### Rideable wind: the steady wind, lifted only to the floor

The steady wind, the mean, is what holds a rider on the foil and what decides
whether a session is on, so it is what the stars rate. Below the rider's floor
a gust is still a chance to get up, so there it may lift the hour, and only as
far as the floor:

```
rideable = mean                                              at or above the floor
rideable = min(floor, mean + share × min(gust − mean, mean))  below it
```

where the share is 0.2 learning, 0.3 riding and 0.35 advanced. A light day with
big gusts is worth a star at most, a chance to get up; it is never rated as a
windier day than it is. A 9 kn mean gusting 17 is rated as 11 kn (the floor)
for an intermediate, one star; 12 gusting 20 as 12, two. The lift stays inside
the rating: no page names it as a wind of its own.

### Potential: the rideable wind against the rider's band

Each level has a band of wind, in knots, for an 80 kg rider. The top is the
most the rider can hold, gusts included (below):

| Level    | Floor | Sweet spot | Ceiling |
| -------- | ----- | ---------- | ------- |
| Learning | 13    | 15–20      | 24      |
| Riding   | 11    | 14–24      | 30      |
| Advanced | 8     | 13–28      | 35      |

"Nobody goes out in 40; 30 is about the max, maybe 35 for very advanced" (the
owner, 24 October 2026).

A heavier rider needs more wind to get going — a wing's power rises with the
square of the wind, so the floor moves with the square root of the weight — and
holds a little more at the top (fourth root). Five stars sit in the middle half
of the sweet spot; four at its edges; one to four ramps up from the floor; two
at the ceiling, falling to none six knots past it.

### Stars: what the spot takes away

```
stars = round(wind − gusty − direction − wing), from 0 to potential
```

and no stars, potential too, when the hour's gust is over the top of the
rider's band. Each deduction is a sentence in the cell's tooltip when it costs
a whole star, so a rider can argue with it.

| Condition                                                                       | Learning | Riding | Advanced |
| ------------------------------------------------------------------------------- | -------- | ------ | -------- |
| A gust over your limit, the top of your band (below)                            | all      | all    | all      |
| Onshore (wind within 30° of straight onshore)                                   | —        | —      | —        |
| Cross-onshore                                                                   | —        | —      | —        |
| Cross-shore                                                                     | —        | —      | —        |
| Cross-offshore                                                                  | −3       | −1.5   | −1       |
| Offshore (wind within 30° of straight off the beach)                            | −5       | −4     | −4       |
| Gusty or very gusty, by how much it bothers you (below)                         | to −3    | to −3  | to −3    |
| The models disagree (shown beside the stars, never counted, since v5)           | —        | —      | —        |
| Your wings don't fit (biggest < 75% or smallest > 135% of the recommended size) | −1       | −1     | −1       |

Offshore is a deduction like the others, not a cap: the faded stars still say
what the wind is worth, and a rider's own rating may set it as they like.
Cross-shore never costs a star: "it's perfect conditions".

Gusty wind and the direction are named in the reasons only when they cost a
whole star.

### Gusts over your limit (`gustsOverLimit`)

The top of the rider's band, `max`, is the most they can hold, gusts
included: 24, 30 and 35 kn at 80 kg, moving with weight by the fourth root of
weight / 80, or their own figure in a rating of their own. An hour whose gust
is over it gets no stars and no potential, so nothing is drawn, not even
outline stars: a kinder direction would not make it rideable. The reason
reads "Gusts over your limit", and an hour with no stars says "gusts over your
limit" (`noStarsWhy`; the session is `too-gusty`, or `too-strong` where the
mean is too strong on its own).

### Gusty wind (`gustiness`, `gustyCost`)

How gusty an hour is, is its gust over its mean, counted only when the mean is
at or above the rider's floor (below it a gust is a chance to get up):

| Gust ÷ mean | The hour is |
| ----------- | ----------- |
| under 1.5   | steady      |
| 1.5 or more | gusty       |
| 1.8 or more | very gusty  |

What that costs is the rider's choice, "Gusty wind: how much uneven wind
bothers you" in Customise (`Rider.gusty`, "some" unless they pick another):

| Gusty wind bothers you | Steady | Gusty | Very gusty |
| ---------------------- | ------ | ----- | ---------- |
| Not much (`little`)    | —      | —     | −1         |
| Some (`some`)          | —      | −1    | −2         |
| A lot (`lots`)         | —      | −2    | −3         |

The stars lost show as outline stars, as any other cost does, and the reason
says "Gusty" or "Very gusty" when it moved a star.

The owner's calibration of v6, for Riding at 80 kg, gusty wind "some",
cross-onshore, no wings listed (`force5/src/stars.test.ts` asserts every line,
with the other two levels):

| Wind       | v5  | v6  | Why                                              |
| ---------- | --- | --- | ------------------------------------------------ |
| 9 gust 17  | 1   | 1   | under the floor: the gusts are a chance, no more |
| 12 gust 20 | 2   | 1   | gusty (1.67): one off                            |
| 15 gust 20 | 4   | 4   | steady (1.33)                                    |
| 15 gust 27 | 4   | 2   | very gusty (1.8): two off                        |
| 18 gust 24 | 5   | 5   | steady                                           |
| 18 gust 27 | 5   | 4   | gusty (1.5): one off                             |
| 22 gust 32 | 4   | 0   | a gust over 30: no stars                         |
| 25 gust 33 | 3   | 0   | a gust over 30: no stars                         |
| 25 gust 38 | 2   | 0   | a gust over 30: no stars                         |

v6, solid out of outlined. Learning: 12g20 1/1, 15g20 and 15g22 4/4, 18g24
5/5, and none for 15g27, 18g27, 22g32 or 25g38 (gusts over 24). Advanced: 9g17
0/2 and 10g16 1/2 (over its 8 kn floor, and gusty), 12g20 2/3, 15g27 3/5, 18g27
4/5, 22g32 and 25g33 5/5, 25g38 none (a gust over 35).

### A rider's own rating (`CustomRating`)

A rider can set their own stars ("Customise" or "Edit custom" under the level
pill in Display options, or the "Custom stars" chip in the dock): the four
wind handles, the top one their limit for gusts, and the stars each direction
takes off, starting from a level. The app has the same dialog as a screen of its own
(`mobile/src/features/stars`), from the same link under the pill in More ›
Rider and the chip in the dock, on the site's arithmetic
(`spot/web/yourStars.ts`).

```ts
{ version: 2, base: Skill,
  wind: { min, sweetLow, sweetHigh, max },        // knots
  direction: { onshore, crossOn, cross, crossOff, offshore } } // stars off
```

It rides on the rider (`Rider.custom`), so every page and service that rates
for a rider (`rateHour`) uses it. It replaces the level's band and direction
costs, with no weight scaling; `base` keeps the level's share of a gust below
the floor and its wing sizes. How much gusty wind bothers the rider is not in
it: it is the rider's whatever rates (`Rider.gusty`, kept on the device as
how high they point is, and sent with the rider to the alerts and to Gust).
`parseCustomRating` is the one place it is made safe, whoever wrote it: a
version 1 rating, from before v6, is read as version 2 with its gust curve
left behind, so nobody loses their wind and directions; any other version or
a missing number drops it; knots are held to the tenth, the wind handles in
order a knot apart within 2–40 kn, and every star figure 0–5 in half stars. `standardRating(rider, level)` is a level's own rating for that
rider's weight, where "Start from" begins, so saving it unchanged rates as the
level does.

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
size = 5.5 × (weight / 80)^0.8 × (15 / wind)^0.85 × level
```

where the level factor is 1.1 learning, 1 riding and 0.92 advanced; rounded to
the half metre and held between 2 and 8 m². With a quiver listed, the rider's
own wing is the smallest that is not much smaller than the recommendation
(≥ 90%), because a wing a touch big still works in the lulls.

### Sessions

Each rated hour is also sorted by its rideable wind against the band (too
light, floor to sweet spot, sweet spot, powered, overpowered, too strong) or
as offshore. The kinds have no names on the page: the stars and the figures
speak for the hour. Only an hour with no stars says why, where the wind alone
does: "too light", "too strong" or "offshore" (`noStarsWhy`).

## The rider

Weight, level, wings, how much gusty wind bothers the rider (`gusty`, absent
while it is "some") and any custom rating live in the display preferences
(`force5.prefs.v1`), validated field by field on load: a weight outside
30–160 kg or a wing outside 1.5–10 m² is dropped rather than rated, and a
custom rating goes through `parseCustomRating`. Until a weight is given the
stars assume 80 kg, and the row label says `~80 kg` so it is obvious.

A rider's own rating is saved, which puts it in use, or deleted through
`withCustomStars`. The level pill (Learning, Riding, Advanced, and Custom once
there is a rating of their own) goes through `withStarsOn`: picking a level
keeps the rating aside (`rider.keptCustom`) so Custom can be picked again, and
only the rating in use (`rider.custom`) rates, here, in the alerts and in
Gust. Both stamp the moment the rating is saved, deleted, or goes on or off
(`starsUpdatedAt`). Preferences from before the kept rating (no `version`, or
version 1) read a rider's `custom` as saved and in use. For a signed-in rider it is also kept with
their account (`GET`/`PUT /api/me/rider`, `site/api/riders.ts`, the
`rider_profiles` table), so it follows them across devices:
`shared/web/riderSync.ts` compares the device's copy with the account's when
the page knows who is signed in and after every change on the device, and the
newer wins, a deletion included. The account keeps the rating in use as
`customStars` and one kept aside as `keptStars`, so a device from before the
kept rating reads only what it should rate with, and its `PUT` without
`keptStars` means what it meant then: saved and in use, or deleted. A copy last matched with another account on a
shared device is never sent to the next one who signs in. The community and
the marketplace run it inside their sign-in; the map and the spot pages load
it on their own (`shared/web/AccountRider.tsx`), only on a device that has
signed in before, so nobody else downloads the identity provider. The app has
no sign-in yet, so its rating stays on the phone; it reaches the alerts server
with the rest of the rider when the phone registers.

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
- **Rate for** (Learning / Riding / Advanced, with weight and wings behind a
  fold) writes the same `rider` in `force5.prefs.v1` as the dock's Display
  options, through the same `parseRider` validation, and re-rates the page
  live. How much gusty wind bothers the rider is set in Customise on the map,
  and the page reads it from the same rider.

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
