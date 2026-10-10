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

### Rideable wind: the mean, lifted toward the gusts

On a foil a gust is a free pump and a lull is glide, so a rider uses part of
the gap between mean and gust. The rating reads

```
rideable = mean + share × fade × min(gust − mean, mean)
```

where the share is 0.2 learning, 0.3 riding and 0.35 advanced (a learner still
falls off in the lulls), and `fade` runs from 1 at the floor to 0 at the top of
the sweet spot: the lift matters on a light day, when gusts are what get you
foiling, and not on a strong one, where a gust is only more power. A 9 kn mean
gusting 17 rides like 11.4 kn for an intermediate; 20 gusting 30 like 20.4.
The tooltip says "rides like N kn with the gusts" whenever the lift is a knot
or more.

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

| Condition                                                                       | Riding / Advanced | Learning             |
| ------------------------------------------------------------------------------- | ----------------- | -------------------- |
| Offshore (wind from within 30° of straight off the beach)                       | capped at 1       | capped at 0          |
| Cross-offshore                                                                  | −1.5 / −1 (adv.)  | −3                   |
| Onshore                                                                         | −1                | −1                   |
| Cross-shore                                                                     | —                 | −0.5                 |
| Gusts above the rider's ceiling                                                 | −1                | −1                   |
| Gust factor over 1.7 with the mean already in the sweet spot                    | −0.5              | —                    |
| Gust factor over 1.35 / 1.5 / 1.7, at any speed                                 | —                 | −0.75 / −1.5 / −2.25 |
| Models disagree / differ a little (agreement low / moderate, below)             | −1 / −0.25        | same                 |
| Your wings don't fit (biggest < 75% or smallest > 135% of the recommended size) | −1                | −1                   |

Every deduction that costs a star is given as a reason. The quarter for some
spread among the models is the one that usually costs nothing; when it does tip
an hour under a whole star, the reason says so ("The models differ a little,
enough to hold back a star").

Agreement is the standard deviation of the models' speeds (each ensemble as its
member mean), read more strictly the further ahead the hour is: "high" under
1.7 kn today, 1.55 tomorrow, 1.2 on day 2 and 0.8 from day 3; "low" from 3.05,
2.9, 2.55 and 2.15 kn. Fewer than three models are never "high". The lines are
fitted so a "high" hour is about a 2 kn forecast whichever day it is on
(`agreementFrom`, `force5/src/weights.ts`; docs/VERIFICATION.md, "Blend
weights"). So a day-5 hour now loses a quarter or a star that it used to keep:
the old range rule called far-off hours "high" more often than near ones.

Dark hours are not rated: the cell stays empty rather than showing a zero.

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
the hour is rated on the wind alone. 124 of the 146 places have one computed,
and the overrides below bring it to 127.

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

Each rated hour also has a name: _Too light_, _Pump and glide_, _Light-wind
drills_ (floor to sweet spot: tacks and gybes on a big wing), _Cruising_,
_Powered up_, _Overpowered_, _Too strong_, or _Offshore_.

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
- The head says the day's **best** stretch still ahead ("Best today
  13:00–16:00 · ★★★★ · 6.5 m"), and the red pen loops each day's best on the
  strip. The map's lights read the same stars for the selected hour
  (`src/ratings.ts`).

## On the spot page

`/spot/<id>` (`spot/web/`) is the chart's broadsheet for one place, day by
day. It rates the forecast server's consensus line rather than the dock's
blend: the median wind and gust of every live model, each ensemble's mean
once, their vector-mean direction and the same agreement thresholds
(`mcp/api/forecast.ts`), so the stars there are the stars an
assistant would be given. They can differ from the dock's by a star where the
dock's blend uses a different set of models (Display options) or columns.

- **The headline** is the week's verdict: its best window, most stars first,
  then the longest, then the soonest ("Brandon Bay: a five-star Friday
  afternoon on a 5.5 m").
- **The week strip**, a column a day for seven Irish days: the day's best
  stars and the hours of its best window. Choosing a day takes the page to it.
- **Each day** under a header that sticks while its hours scroll: the best
  stars and window, and the pen's note ("Go 18:00 till dark. Four stars on a
  6.5 m."; "Leave it on the roof." when no hour earns a star). The window is
  the longest run of rows at the day's highest solid stars, the earliest of
  equals; one row will do. The pen loops it in the table.
- **A row per daylight hour**, the dark folded either side and never rated:
  the stars, the wind with its gust raised (in the pen's red when it jumps),
  where it comes from, the sky, and **the chance it rides**. Rows are hourly
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

### The chance it rides

The stars are the consensus's verdict; the chance is the ensembles' own
spread. Where an ensemble publishes its members for the spot (`spotMembers`:
ECMWF ENS and GEFS), every member is read as its own run, and for each hour the
chance is the share of members whose rideable wind reaches the rider's floor:
the member's mean lifted toward its own gust exactly as the stars read an
hour (`rideableWind`), against `windBand(rider).min` (`rideChance` in
`mcp/api/forecast.ts`). The ensembles' members are pooled; one that does not
reach the hour adds none. It is shown as a whole per cent, washed in behind
the figure, and as a dash where no member reaches the hour.

The page asks for the members themselves (`members: true`), so a change of
rider re-rates the chance in the browser (`hourChance` in `spot/web/spot.ts`)
without asking again; an agent's `get_spot_forecast` answers `chance_pct` for
the skill and weight it is given. The hour's second line gives the members'
10th to 90th percentile wind beside the models' range, and the members' middle
80% is the sea-blue bar on its range bar.

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
