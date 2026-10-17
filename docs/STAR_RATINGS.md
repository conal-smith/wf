# Star ratings and wing sizes

Every forecast hour at a riding place gets a rating out of five, for the rider in
Display options, and the wing that rating assumes. The point is the glance: a
row of five solid stars on Thursday afternoon says "go" faster than three rows
of numbers do, and a light, steady day says "drills" instead of "nothing".

The logic is `force5/src/stars.ts`, a pure module with its tests beside it. The
dock draws it (`src/StarsRows.tsx`); nothing else is needed to rate an hour, so
the map, the forecast server and a notification job can all rate the same way.

## Two numbers per hour

|               | What it is                                                 | Drawn as              |
| ------------- | ---------------------------------------------------------- | --------------------- |
| **Potential** | What the wind alone is worth to this rider                 | faded (outline) stars |
| **Stars**     | What is left once the spot and the forecast have their say | solid stars           |

Stars never exceed potential, so the faded stars are always the upside a
kinder direction, a steadier breeze or better model agreement would have given.
Solid and faded differ by shape (filled against outline) as well as by tone.

### Rideable wind: the steady wind, lifted only on a light day

The steady wind, the mean, is what holds a rider on the foil, so it is what
the stars rate. On a light day a gust is also what gets you up, and once up a
lull is glide, so below the sweet spot a rider uses part of the gap between
mean and gust:

```
rideable = mean + share × fade × min(gust − mean, mean)
```

where the share is 0.2 learning, 0.3 riding and 0.35 advanced (a learner still
falls off in the lulls), and `fade` runs from 1 at the floor to 0 at the bottom
of the sweet spot. Gusts can make a light day rideable; they never make a day
better than its steady wind. A 9 kn mean gusting 17 is rated as 11.4 kn for an
intermediate, 12 gusting 20 as 13.2, and 18 gusting 28 as 18. The lift stays
inside the rating: no page names it as a wind of its own.

### Potential: the rideable wind against the rider's band

Each level has a band of wind, in knots, for an 80 kg rider:

| Level    | Floor | Sweet spot | Ceiling |
| -------- | ----- | ---------- | ------- |
| Learning | 12    | 14–20      | 24      |
| Riding   | 10    | 14–24      | 30      |
| Advanced | 8     | 13–28      | 35      |

A heavier rider needs more wind to get going — a wing's power rises with the
square of the wind, so the floor moves with the square root of the weight — and
holds a little more at the top (fourth root). Five stars sit in the middle half
of the sweet spot; four at its edges; one to four ramps up from the floor; two
at the ceiling, falling to none six knots past it.

### Stars: what the spot and the forecast take away

Each deduction is a sentence in the cell's tooltip, so a rider can argue with it.

| Condition                                                                       | Riding / Advanced                     | Learning                     |
| ------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------- |
| Offshore (wind from within 30° of straight off the beach)                       | capped at 1                           | capped at 0                  |
| Cross-offshore                                                                  | −1.5 / −1 (adv.)                      | −3                           |
| Onshore                                                                         | −1                                    | −1                           |
| Cross-shore                                                                     | —                                     | −0.5                         |
| Gusts past the top of the sweet spot (strength, below)                          | up to −1.5 by the ceiling, −3 past it | same                         |
| Gust factor past 1.35 (gustiness, below)                                        | −0.5 / −0.4 (adv.) per 0.1, × power   | −0.6 per 0.1, × at least 0.6 |
| Models disagree / differ a little (agreement low / moderate, below)             | −1 / −0.25                            | same                         |
| Your wings don't fit (biggest < 75% or smallest > 135% of the recommended size) | −1                                    | −1                           |

Every deduction that costs a star is given as a reason. The quarter for some
spread among the models is the one that usually costs nothing; when it does tip
an hour under a whole star, the reason says so ("The models differ a little,
enough to hold back a star"). The gusts are named the same way: only when they
cost a whole star.

### The gusts (`gustCost`)

Fewer gusts is better: a steady wind is one you can settle into, and a gusty
one throws you about. How much that costs depends on how powered the steady
wind already has you. Near your floor a big gust is a chance to get up; at the
top of your sweet spot every hit and every lull is felt; with a strong wind and
strong gusts it is hard to ride on any wing. So the gusts cost two things:

- **Strength**: gusts past the top of the sweet spot, 1.5 × (gust − sweet top)
  / (ceiling − sweet top), at most 3. One and a half stars by the ceiling.
- **Gustiness**: the gust factor past 1.35, at most 0.6 past it, × 5 riding
  (4 advanced, 6 learning) × power, where power runs from 0 at the floor to 1
  at the top of the sweet spot. A learner, who falls off in the lulls, pays at
  least 0.6 of it at any wind.

1.35 is a steady wind's factor _in the models_: their gust is the hour's
strongest, so even a steady breeze has one about a third over its mean. In the
published blend of 17 October 2026 the steadiest quarter of the daylight hours
at 14–19 kn were under 1.35 and the middle of them at 1.5.

For an intermediate 80 kg rider, nothing else taken off:

| Wind       | v2  | v3  | Why                                   |
| ---------- | --- | --- | ------------------------------------- |
| 9 gust 17  | 2   | 2   | light and gusty: the gusts get you up |
| 12 gust 20 | 4   | 3   | light and gusty, lifted a little less |
| 18 gust 24 | 5   | 5   | steady                                |
| 18 gust 27 | 5   | 4   | the usual Irish gust factor           |
| 18 gust 29 | 5   | 3   | gusty, and gusts past the sweet spot  |
| 22 gust 32 | 4   | 2   | powered, gusts past the ceiling       |
| 25 gust 38 | 3   | 0   | strong wind, strong gusts             |

Agreement is the standard deviation of the models' speeds (each ensemble as its
member mean), read more strictly the further ahead the hour is: "high" under
1.7 kn today, 1.55 tomorrow, 1.2 on day 2 and 0.8 from day 3; "low" from 3.05,
2.9, 2.55 and 2.15 kn. Fewer than three models are never "high". The lines are
fitted so a "high" hour is about a 2 kn forecast whichever day it is on
(`agreementFrom`, `force5/src/weights.ts`; docs/VERIFICATION.md, "Blend
weights"). So a day-5 hour now loses a quarter or a star that it used to keep:
the old range rule called far-off hours "high" more often than near ones.

Dark hours are not rated: the cell stays empty rather than showing a zero.

### Why v3 (17 October 2026)

v2 lifted the mean toward the gust as far as the top of the sweet spot and
took little for gustiness once a rider was off the learning level, so the more
a powered day gusted the better it rated: 18 kn gusting 29 was five stars for
an intermediate, and 25 gusting 38 three. The owner's rule is that the steady
wind matters most and fewer gusts is better, with big gusts a chance on a light
day and trouble on a strong one. v3 lifts only below the sweet spot and charges
the gusts as above. Replaying the published blend of 17 October 2026 (every
riding place, 08–17 UTC, shore not counted), hours at 0 / 1 / 2 / 3 / 4 / 5 ★:

| Level    | v2                                    | v3                                     |
| -------- | ------------------------------------- | -------------------------------------- |
| Learning | 5334 / 413 / 492 / 633 / 1123 / 293   | 6127 / 583 / 555 / 515 / 397 / 111     |
| Riding   | 3654 / 749 / 568 / 668 / 1094 / 1555  | 4014 / 824 / 773 / 1329 / 829 / 519    |
| Advanced | 2265 / 1142 / 803 / 712 / 1149 / 2217 | 2348 / 1198 / 1044 / 1444 / 1350 / 904 |

Five stars is now for a steady, powered wind; a gusty powered hour reads three
or four, and a light gusty one keeps its lift, a little less of it near
the sweet spot.

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

A light day still reads as light, and offshore is still capped; what changed is
that a gusty 9–12 kn day is now "drills" at two stars instead of nothing.

### The shore

"Onshore" needs to know which way the beach faces. `npm run spots:facing`
(`scripts/shore-facing.mjs`) reads the map's own basemap tiles (OpenFreeMap,
OpenStreetMap data): for each place, 72 bearings at 300 m, 700 m and 1.2 km,
each tested for water, and the facing is the circular mean of the water
bearings. `strength` says how lopsided that is; below 0.15 (a pin on an isthmus,
a lough's middle, an estuary with water all round) no facing is published and
the hour is rated on the wind alone. 125 of the 148 places have one computed,
and the overrides below bring it to 126.

It is a computed estimate. `data/locations/shore-facing.json` has an
`overrides` block for corrections, which win and survive a rerun. The first
five are from knowing the beaches, not a survey: Dollymount (ESE, 125°) and
Tramore (S, 175°), whose pins sit deep in their bays and fell under the cut-off
with the right bearing; Streedagh and Waterville likewise, at their computed
bearings; and White Strand Doonbeg set to unknown, because the computed NE
looks wrong and no direction is safer than the wrong one. Worth checking next:
**Brandon Bay** (computed E, from a pin on the Maharees neck) and the other
places left without a facing, listed by `strength` in the file.

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

Weight, level and wings live in the display preferences (`force5.prefs.v1`,
this device only), validated field by field on load: a weight outside 30–160 kg
or a wing outside 1.5–10 m² is dropped rather than rated. Until a weight is
given the stars assume 80 kg, and the row label says `~80 kg` so it is obvious.

## In the dock

- The **stars** are the dock's first row, over wind, direction, wing and tide,
  for every hour of the fortnight's strip. Hover or tap them for the chart's
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
day. It rates the forecast server's headline line: HARMONIE's own wind, gust and
direction while it reaches the hour, and past it the weighted median of the
other models, with agreement read across every model (`mcp/api/forecast.ts`),
so the stars there are the stars an assistant would be given. The dock follows
the same rule, so the two agree unless a reader has left models out in Display
options.

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
  live.

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
2. **Alerts.** Follow a place, get the bell when a four-star window with high
   agreement appears in the next 48 hours.
3. **Per-place knowledge.** Tide windows ("works from mid tide up") and known
   good directions from local riders, as overrides on the computed facing.
4. **Waves.** A wave-riding session (cross-off with swell) for advanced riders,
   and a penalty for a heavy shore break for beginners, from the wave rows the
   dock already has.
5. **The forecast server.** `get_spot_forecast` and `find_wind` could return
   the stars, so an assistant can answer "where is it five stars on Saturday".
