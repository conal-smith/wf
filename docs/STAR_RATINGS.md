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

### Potential: the wind against the rider's band

Each level has a band of mean wind, in knots, for an 80 kg rider:

| Level    | Floor | Sweet spot | Ceiling |
| -------- | ----- | ---------- | ------- |
| Learning | 12    | 14–20      | 24      |
| Riding   | 11    | 14–24      | 30      |
| Advanced | 9     | 13–28      | 35      |

A heavier rider needs more wind to get going — a wing's power rises with the
square of the wind, so the floor moves with the square root of the weight — and
holds a little more at the top (fourth root). Five stars sit in the middle half
of the sweet spot; four at its edges; one to four ramps up from the floor; two
at the ceiling, falling to none six knots past it.

### Stars: what the spot and the forecast take away

Each deduction is a sentence in the cell's tooltip, so a rider can argue with it.

| Condition                                                                       | Riding / Advanced | Learning    |
| ------------------------------------------------------------------------------- | ----------------- | ----------- |
| Offshore (wind from within 30° of straight off the beach)                       | capped at 1       | capped at 0 |
| Cross-offshore                                                                  | −1.5              | −3          |
| Onshore                                                                         | −1                | −1          |
| Cross-shore                                                                     | —                 | −0.5        |
| Gust factor over 1.35 / 1.5 / 1.7                                               | −0.5 / −1 / −1.5  | ×1.5        |
| Models disagree (spread ≥ 8 kn) / some spread                                   | −1 / −0.25        | same        |
| Your wings don't fit (biggest < 75% or smallest > 135% of the recommended size) | −1                | −1          |

Dark hours are not rated: the cell stays empty rather than showing a zero.

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

- The **Stars** row sits under the wind (chart or table) and above the sea
  rows, on by default. It exists only at riding places, where the blend exists.
  Each cell's tooltip gives the session, the shore angle, the wing and every
  reason a star was taken off.
- The **Wing size** row, per hour, is off by default: the dock has a height
  budget with room for one new row, and the wing is already in every tooltip
  and in the best window. Display options turns it on.
- The toolbar shows the **best window still ahead** — the longest run of two or
  more columns at the highest level any such run reaches, rated on its weakest
  column — with its wing; selecting it jumps the timeline there.

## What would make it better next

1. **Stars on the map.** A small badge per marker for the selected hour would
   make the whole coast light up on a good day. The ratings are cheap; the cost
   is reading every place's series, which is the manifest-size question below.
2. **Rider feedback.** A "rode it: ★★★" check-in from the community spot card
   would give ground truth to tune the bands and deductions against, and is the
   honest way to make the stars better than a formula.
3. **Alerts.** Follow a place, get the bell when a four-star window with high
   agreement appears in the next 48 hours.
4. **Per-place knowledge.** Tide windows ("works from mid tide up") and known
   good directions from local riders, as overrides on the computed facing.
5. **Waves.** A wave-riding session (cross-off with swell) for advanced riders,
   and a penalty for a heavy shore break for beginners, from the wave rows the
   dock already has.
6. **The forecast server.** `get_spot_forecast` and `find_wind` could return
   the stars, so an assistant can answer "where is it five stars on Saturday".
