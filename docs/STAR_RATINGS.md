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

Each level has a band of wind, in knots, for an 80 kg rider:

| Level    | Floor | Sweet spot | Ceiling |
| -------- | ----- | ---------- | ------- |
| Learning | 13    | 15–20      | 24      |
| Riding   | 11    | 14–24      | 30      |
| Advanced | 8     | 13–28      | 35      |

A heavier rider needs more wind to get going — a wing's power rises with the
square of the wind, so the floor moves with the square root of the weight — and
holds a little more at the top (fourth root). Five stars sit in the middle half
of the sweet spot; four at its edges; one to four ramps up from the floor; two
at the ceiling, falling to none six knots past it.

### Stars: what the spot and the forecast take away

Each deduction is a sentence in the cell's tooltip, so a rider can argue with it.

| Condition                                                                       | Riding / Advanced               | Learning    |
| ------------------------------------------------------------------------------- | ------------------------------- | ----------- |
| Offshore (wind from within 30° of straight off the beach)                       | capped at 1                     | capped at 0 |
| Cross-offshore                                                                  | −1.5 / −1 (adv.)                | −3          |
| Onshore                                                                         | −1                              | −1          |
| Cross-shore                                                                     | —                               | −0.5        |
| Gusts more than 10 kn over the mean (7 learning; below)                         | −0.5 a knot past it, at most −2 | same        |
| Gusts past the rider's ceiling                                                  | −0.5                            | −1          |
| Models disagree / differ a little (agreement low / moderate, below)             | −1 / −0.25                      | same        |
| Your wings don't fit (biggest < 75% or smallest > 135% of the recommended size) | −1                              | −1          |

Every deduction that costs a star is given as a reason. The quarter for some
spread among the models is the one that usually costs nothing; when it does tip
an hour under a whole star, the reason says so ("The models differ a little,
enough to hold back a star"). The gusts are named the same way: only when they
cost a whole star.

### The gusts (`gustCost`)

The mean decides the stars; the gusts are a footnote. Riders, size guides and
forecast guides agree that what matters about gusts is how many knots they run
over the mean: up to about 8 a session is fine, 8–10 gets stop-start, and past
10 it is unsteady (a 16 kn mean gusting 28 is "a small-wing day, not a 16 kn
day"). The models' gust is the hour's strongest, and in the published blend of
17 October 2026 the middle daylight hour at 14–24 kn ran 8 to 9.5 kn over its
mean, so a gust up to ten over costs nothing. Past that:

- **Gusty**: half a star for every knot past ten over the mean, at most two.
  A learner, who drops off in every lull, counts from seven.
- **Past the ceiling**: half a star (a whole one learning) when the gusts pass
  the most the rider can hold.

For an intermediate 80 kg rider, nothing else taken off:

| Wind       | v2  | v3  | Why                                              |
| ---------- | --- | --- | ------------------------------------------------ |
| 9 gust 17  | 2   | 1   | under the floor: the gusts are a chance, no more |
| 12 gust 20 | 4   | 2   | a light day; the gusts don't make it windier     |
| 18 gust 24 | 5   | 5   | steady                                           |
| 18 gust 27 | 5   | 5   | an ordinary gust                                 |
| 18 gust 29 | 5   | 5   | 11 over: half a star, not enough to round down   |
| 15 gust 27 | 5   | 3   | 12 over: stop-start                              |
| 22 gust 32 | 4   | 4   | gusts past the ceiling                           |
| 25 gust 38 | 3   | 2   | strong, gusty and past the ceiling               |

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
