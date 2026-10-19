# The ride rose

When a spot or a tapped point is chosen and "Round the chosen spot" is
**Loupe** (the default), the map lays a glass round it. The glass is a ride
rose for the hour the dock has selected and for this rider: the headings they
can hold from this beach, the no-go upwind, where they would drift, the wind
directions that are offshore here, the wind's needle, and the reading at the
foot ("NE 22 g27 · CROSS"). It is the mockup's recommended design
(`wingfoil-mockups/loupe-purpose`, design 1 with design 2's needle and box,
without the 12-hour trail), approved by the owner on 19 October 2026.

- Geometry: `force5/src/rideWedge.ts` (`rideRange`, `rideRose`,
  `offshoreSpans`) and `force5/src/focus.ts` (`roseScale`, `roseRadius`,
  `roseDrawing`, `dialDrawing`, `footBox`, `loupeRose`). Pure functions, unit
  tested.
- Drawing: `drawLoupe` in `force5/src/WindMap.tsx`, styles under
  `.map-rose-*`, `.map-dial-*` and `.map-loupe-*` in `src/map.css`.
- The mobile app draws no loupe. It shares `rideRange` through the light's
  wedge (`mobile/src/features/map/lightsLogic.ts`), so the angles below reach
  it too.

## What it draws

| Part | Drawn as | From |
|---|---|---|
| No-go | Hatched in ink over a light paper wash, with dashed edges, labelled NO-GO | `rideRange`'s upwind angle, either side of the wind |
| Out | Paper wash at about 45% to the rim, with ink edges, a heavy rim arc and an arrowhead, labelled "OUT 120–165°" | The tack that reaches the sea, cut off at the beach (as the light's wedge is) |
| Home | Dashed edges and a dashed rim arc, labelled "HOME 285–330°" | The other tack, whole |
| Reach | As home, labelled REACH | Both tacks where out and home mean nothing: a tapped point, a place with no facing, or an offshore wind |
| Drift | Dotted arrow straight downwind, labelled DRIFT. In the pen's red, with "OUT TO SEA", when the wind is cross-offshore or offshore | The wind's bearing + 180° |
| Offshore | On the bezel: a dense red hatch where the wind is offshore, a light one where it is cross-offshore, a red arc outside, and the word OFFSHORE | `shoreAngle`'s bands (see below) and the spot's facing |
| Needle | From outside the bezel in to the glass, at the wind's from-bearing, filled with the wind's colour (`PALETTE`) | The dock's hour |
| Foot box | "SW 16 g22" in the rider's units, then the shore relation: ON, CROSS-ON, CROSS, CROSS-OFF (red) or OFF (red). With no beach, the units | The dock's hour |

The wind's colour appears only on the needle. The pen's red is used only for
danger: the offshore winds on the bezel, and the drift when it heads out to
sea. Labels are IBM Plex Mono in tracked capitals at 10 px on a paper halo.

**Fallbacks.** In the dark, or below the rider's floor, the glass is empty.
The needle, the foot box and the red bezel stay. The same happens when nothing
the rider can hold heads out to sea (a learner in an onshore wind), which is
the same case in which the light's wedge is absent. At an hour past the end
of the map model's run, the rose still reads the hour the dock shows, as the
lights do: it reads the place, not the map. While the loupe is on, the light's
own small wedge is hidden, because the rose shows the same thing, larger.
"Range ring" and "Off" are unchanged.

## Size: a true distance

The rose's rim is a distance on the chart, so a rider can see how much water
lies before the rocks or the river mouth. The rim distance is the round value
in the rider's units nearest one kilometre, about as far as anyone rides on one
tack. A dashed ring marks half of it.

| Units | Rim | Ring |
|---|---|---|
| kn | 0.5 NM (926 m) | 0.25 NM |
| mph | 0.5 mi (805 m) | 0.25 mi |
| km/h, m/s | 1 km | 500 m |

- **Choosing a spot.** The camera flies to the spot, centred on it, at the zoom
  where the rim is a little under half the shorter side of the map left clear
  of the boxes and the dock. That is at most 200 px: about zoom 13.3 on a
  desktop and 12.9 on a phone (`roseFitRadius`, `zoomFor`). A tapped point does
  not move the camera, so its rose is drawn at whatever size the zoom gives.
- **Zooming.** The rose scales with the chart, like the range ring. Under 70 px
  (`ROSE_MIN_PX`) it would be too small to read. It is then held at 70 px, no
  longer to scale, and drawn as a compass with the needle, the red bezel and
  the box, with nothing inside and no distances written. Names appear from
  90 px and bearings from 120 px.
- **Zoomed in past the screen.** The bezel runs off the screen, and the foot
  box stays pinned inside the clear map above the dock.
- **Redrawing.** A pan only moves the glass. The glass is redrawn when its size
  changes (a zoom), when the hour changes, and when the rider's level or units
  change.

## The angles, and where they come from (19 October 2026)

The owner asked for this check: "Showing where you cannot go is good. Make sure
that's actually accurate." These are the numbers, with their sources. They are
rounded to 5° on the rose, and the key says "about", because riders, boards and
foils vary as much as levels do. They are a guide, not a polar.

### Upwind: the no-go half-angle (degrees off the true wind)

| Level (stars) | Powered up (sweet spot) | Just foiling (band's floor) | Overpowered (band's top) |
|---|---|---|---|
| Learning | 90° | 95° | 95° |
| Riding | 60° | 75° | 65° |
| Advanced | 45° | 60° | 50° |

Between those points, `rideRange` blends smoothly across the rider's own wind
band (`windBand` in `stars.ts`), so the rose and the stars agree on how well
powered the hour is.

- **About 45° for a good rider.** This is well supported:
  - Duotone Wing Academy: "You can only go up to around 45 degrees into the
    wind"
    (<https://mackiteboarding.com/news/duotone-wing-academy-wind-and-courses>).
  - AFS Foiling: "maintain an angle of around 45° to the wind direction"
    (<https://afs-foiling.com/blog/how-do-you-wingfoil-upwind>).
  - Wing Daily: "up to 45° to the wind … if the course is too steep into the
    wind, you will slow down and get out of foiling"
    (<https://www.wingdaily.eu/wing-foiling-techniques/riding-upwind.htm>).
  - Go-Wingfoil claims about 30° on the foil. We treat that as an outlier.
    Some riders measure from the beam (boardsurfr: "around 30 degrees (60
    degrees relative to the wind)"), so a "30°" claim may mean 60° off the
    wind.
- **About 60° for a riding rider.** This is the only measured wing data found,
  from a GPS track on seabreeze.com.au: "122° between tacks which is 61
  degrees from straight upwind", in light open-ocean wind. A reply called
  about 50° realistic on flat water and 60° "very impressive for a wing"
  (<https://www.seabreeze.com.au/forums/Wing-Foiling/Wind-Wings/Any-tips-how-to-go-up-wind->).
- **A beam reach at best for a learner.** Coaching tells beginners to
  "concentrate on sailing at 90 degrees or slightly more off the wind"
  (<https://go-wingfoil.com/wing-foiling-undertanding-points-of-sailing/>), and
  that a learner drifts "downwind bit by bit" towards the "walk of shame"
  (<https://wingfoiltips.com/tutorials/wingfoil-going-upwind/>). This number
  is inferred, not measured.
- **Light wind costs about 15°.** A top Formula windsurfer reports "<10 knots
  = 60-65 deg, >10 knots = 55 deg, >20 knots = 49 deg" off the true wind
  (<https://www.seabreeze.com.au/forums/Windsurfing/General/Formula-Racing>),
  which is 10–15° worse in light air. A wing foiler at the floor also slips off
  the foil when pointing high, which "bleeds speed"
  (<https://parawingfoil.com/wingfoil/guides/why-cant-i-get-on-foil/>). We
  use +15°. This is extrapolated, so treat it as a guess.
- **Overpowered costs about 5°.** The sources only describe this
  qualitatively: a rider gets "knocked around" by the wing
  (<https://www.seabreeze.com.au/forums/Wing-Foiling/Wind-Wings/What-affects-upwind-ability-winging?page=1>).
  We use +5° and narrow the downwind side a little.
- **Gear.** A high-aspect foil, a longer mast, a harness and a race wing all
  point higher (same thread, and
  <https://www.seabreeze.com.au/forums/Wing-Foiling/Wind-Wings/Best-wing-upwind-angle-?page=1>).
  Kite-foil racers reach about 40–43°. No published wing-race VMG data was
  found. Advanced is therefore capped at 45°, not 40°: the rose assumes the
  wing the stars would recommend and an everyday foil.

### What changed in `rideRange` (19 October 2026)

| | Before | Now |
|---|---|---|
| Learning, powered | 85–105° | 90–105° |
| Learning, at floor | 95–102° | 95–100° |
| Learning, at top | 90–104° | 95–100° |
| Riding, powered | 60–105° | 60–105° (kept) |
| Riding, at floor | 85–100° | 75–100° |
| Riding, at top | 68–104° | 65–100° |
| Advanced, powered | 45–110° | 45–110° (kept) |
| Advanced, at floor | 75–105° | 60–105° |
| Advanced, at top | 48–108° | 50–105° |

The powered-up angles for riding and advanced were already right. The learner
pointed 5° too high for someone who holds a beam reach at best. Just foiling
was too pessimistic: 25–30° worse than powered, where the evidence says
10–15°.

### Downwind: the reaches stop at about 105–110°; the drift is straight down

The reaches stop at 100–110° off the wind. That is the deepest heading a
session is ridden on, back and forth across the wind, rather than the deepest
a rider can bear away:

- Duotone's best-speed course is "a downwind course at an angle of up to
  around 45 degrees" (about 135° off the wind). Running "straight downwind is
  possible, [but] requires more wind speed than your travel speed".
- A learner can bear away to about 135°, and a riding rider to about
  150–160°. An advanced rider can run dead downwind briefly, mostly with swell
  to ride.
- Every heading past about 110° gives away ground that has to be won back
  upwind. A rose that offered 135° would be telling a rider to run downwind,
  where a session ends a long walk from where it began.

**Drift** is straight downwind. That is where a rider who falls, or a learner
off the foil, ends up with the wing flagged. It turns red when the wind is
cross-offshore or offshore, because a drift then carries the rider away from
the beach:

- AFS: offshore is "risky and dangerous, as it can carry you away from the
  shore very quickly … With wingfoiling, you drift very quickly"
  (<https://afs-foiling.com/what-is-the-best-wind-direction-for-wing-foiling/>).
- Typhoon: it is "extremely tiring to get back upwind … especially if you're a
  beginner" (<https://typhoon-int.co.uk/?p=18043>).

### The shore bands (`shoreAngle`, unchanged)

The angle between the wind and the beach's seaward facing is split into five
bands:

| Angle off the facing | Band |
|---|---|
| under 30° | onshore |
| 30–70° | cross-on |
| 70–110° | cross |
| 110–150° | cross-off |
| 150° and over | offshore |

These are the usual 0/45/90/135/180° points of the beach, each given a band
round it. Nothing found argues for moving them. The bezel hatches the last two
bands in red, from the same numbers (`offshoreSpans`, which is tested against
`shoreAngle`).

### How sure we are

- Advanced at 45°: well supported (several schools and makers).
- Riding at 60°: supported (two forum GPS measurements).
- Learning at 90°: inferred from coaching.
- The light and overpowered adjustments: extrapolated from windsurfing.

The next step would be our own GPS tracks: a few riders of each level logging
tacks at a known wind on a flat-water spot.
