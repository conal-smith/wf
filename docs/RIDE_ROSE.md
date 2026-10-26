# The ride rose

When a spot or a tapped point is chosen and "Round the chosen spot" is
**Loupe**, the map lays a glass round it. The default is **Range ring**; a
rider's choice is kept for their next visit. The glass is a ride rose for the
hour the dock has selected and for this rider: the headings they can hold
from this beach, the no-go upwind, the slow water downwind, where they would
drift, the wind
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
| Out | Paper wash at about 45% to the rim, with ink edges, a heavy rim arc and an arrowhead, labelled "OUT 105–155°" | The tack that reaches the sea, cut off at the beach (as the light's wedge is), from the no-go's edge to 120° off the wind |
| Home | Dashed edges and a dashed rim arc, labelled "HOME 295–345°" | The other tack, whole |
| Reach | As home, labelled REACH | Both tacks where out and home mean nothing: a tapped point, a place with no facing, or an offshore wind |
| Slow | A faint dotted arc along the rim, labelled SLOW in muted ink from 120 px | Downwind of both courses, past 120° off the wind each side: possible, but slow, so not drawn as course |
| Drift | Dotted arrow straight downwind, labelled DRIFT. In the pen's red, with "OUT TO SEA", when the wind is cross-offshore or offshore | The wind's bearing + 180° |
| Offshore | On the bezel: a dense red hatch where the wind is offshore, a light one where it is cross-offshore, a red arc outside, and the word OFFSHORE | `shoreAngle`'s bands (see below) and the spot's facing |
| Needle | From outside the bezel in to the glass, at the wind's from-bearing, filled with the wind's colour (`PALETTE`) | The dock's hour |
| Foot box | "SW 16 g22" in the rider's units (in Force, the wind's glyph and force and the gust's smaller, `BeaufortGlyph`'s drawing), then the shore relation: ON, CROSS-ON, CROSS, CROSS-OFF (red) or OFF (red). With no beach, the units | The dock's hour |

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
| kn, Force | 0.5 NM (926 m) | 0.25 NM |
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
- **Redrawing.** The glass moves in the same frame as the chart, from
  MapLibre's `move` event, as its markers do. A pan only moves the glass, as a
  layer of its own, so nothing is painted again. Through a zoom the elements
  already drawn are given their new sizes rather than built again, and the
  hole in the paper wash, a distance on the chart, is cut again only when its
  edge would leave the rim's band, and once the camera rests. The glass is
  also redrawn when the hour changes, and when the rider's level, degrees
  into the wind or units change.

## The angles, and where they come from (19, 22 and 24 October 2026)

The owner asked for this check: "Showing where you cannot go is good. Make sure
that's actually accurate." These are the numbers, with their sources. They are
rounded to 5° on the rose, and the key says "about", because riders, boards and
foils vary as much as levels do. They are a guide, not a polar.

On 22 October 2026 the owner judged the rose to point too high: "I don't think
people can go so sharp an angle into the wind generally, unless they are very
very good", and asked for it to be configurable. That became **Pointing
upwind** (cautious, typical, sharp) in the display options. On 24 October 2026
it became one number, below.

### Two angles, ours to start (25 October 2026)

With the levels gone (docs/STAR_RATINGS.md, v7), the course is two numbers,
both set in Customise's "Can you ride upwind?" and neither moving a star:

- **Degrees into the wind** (`Rider.upwind`, `upwindOf`): ours is 0°,
  straight across, "Not yet" (A little 5°, Yes 20°, up to 45°).
- **Degrees below straight across** that the course runs to
  (`Rider.downwind`, `downwindOf`, `courseDeep` = 90° plus it): ours is 10°,
  from 0° to 45°. Past it the rider drifts and loses ground: the wizard's
  picture says DRIFT, "you lose ground" (it said SLOW); the loupe still draws
  it faintly along the rim.

So ours runs from 90° to 100° off the wind. The no-go and the course below
replace the levels' starts (0°, 20°, 35° into the wind, and a course to 120°
off it), which are kept below as the history of the rule. A rider stored
before 25 October 2026 starts again from ours (`PREFS_VERSION` 3).

### Degrees into the wind: the rule (24 October 2026)

The rider says how far into the wind they ride, in degrees counted from
straight across it (`Rider.upwind`, `upwindOf` in `force5/src/rideWedge.ts`).
The owner ruled:

- **0° is the least.** Everyone is taken to be able to ride straight across
  the wind and hold their ground. **45° is the most**, about what a very good
  rider points (the sources below).
- **One angle, in every wind.** The owner ruled that the number is used
  whatever the hour: there is no blending by how powered the hour is, so the
  light-wind and overpowered adjustments of 19 October are gone from the
  no-go. How powered the hour is still decides whether there is a course at
  all (below the rider's floor there is none) and how long and how fast the
  light's wedge is drawn, from the rider's band in `stars.ts`.
- **The no-go half-angle is 90° less the number**, either side of the wind.
- **The course runs from the no-go's edge to about 120° off the wind**
  (`COURSE_DEEP`; since 25 October 2026 the rider's own `courseDeep`, 100° for
  ours, above). Past that, downwind, is possible but slow: the rose draws
  it faintly (SLOW), not as part of the course, and the light's wedge leaves
  it out.
- **It never moves a star.** The stars rate the wind and how it meets the
  beach, not the heading.

Each level starts somewhere sensible, and the rider moves it in Customise
("Can you ride upwind?": Not yet 0°, A little 5°, Yes 20°, then a slider from
0° to 45° or a handle on the picture's edge):

| Level (stars) | Starts at | No-go half-angle | Course |
|---|---|---|---|
| Learning | 0° into the wind | 90° | 90–120° off the wind |
| Riding | 20° | 70° | 70–120° |
| Advanced | 35° | 55° | 55–120° |

It is kept on the device with the weight and the level (`parseRider` in
`force5/src/prefs.ts`), as a whole number of degrees held to 0–45, and absent
while it is the level's own, so a rider who never set it follows their level.
Customise is the only place to set it: the display options' control went with
the three words. The mobile app reads it through the light's wedge but has no
control for it yet.

A rider stored before 24 October 2026 with a `pointing` has it read from their
level's start: typical is the level's own, cautious 10° less (never under 0°),
sharp 10° more (never over 45°).

| Stored pointing | Learning | Riding | Advanced |
|---|---|---|---|
| Cautious | 0° | 10° | 25° |
| Typical | 0° | 20° | 35° |
| Sharp | 10° | 30° | 45° |

### The sources

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
- **Light wind costs about 15°.** (Used from 19 to 24 October 2026; since
  the owner's ruling of 24 October the rose uses one angle in every wind.) A top Formula windsurfer reports "<10 knots
  = 60-65 deg, >10 knots = 55 deg, >20 knots = 49 deg" off the true wind
  (<https://www.seabreeze.com.au/forums/Windsurfing/General/Formula-Racing>),
  which is 10–15° worse in light air. A wing foiler at the floor also slips off
  the foil when pointing high, which "bleeds speed"
  (<https://parawingfoil.com/wingfoil/guides/why-cant-i-get-on-foil/>). We
  use +15°. This is extrapolated, so treat it as a guess.
- **Overpowered costs about 5°.** The sources only describe this
  qualitatively: a rider gets "knocked around" by the wing
  (<https://www.seabreeze.com.au/forums/Wing-Foiling/Wind-Wings/What-affects-upwind-ability-winging?page=1>).
  We used +5° and narrowed the downwind side a little, until 24 October 2026.
- **Gear.** A high-aspect foil, a longer mast, a harness and a race wing all
  point higher (same thread, and
  <https://www.seabreeze.com.au/forums/Wing-Foiling/Wind-Wings/Best-wing-upwind-angle-?page=1>).
  Kite-foil racers reach about 40–43°. No published wing-race VMG data was
  found. Advanced is therefore capped at 45°, not 40°: the rose assumes the
  wing the stars would recommend and an everyday foil.

### What changed in `rideRange` (24 October 2026)

One angle in every wind, from the rider's degrees into the wind, and a deeper
course, to 120°. At each level's start:

| | Typical, 22 October (powered / floor / top) | Now, in every wind |
|---|---|---|
| Learning | 90–105° / 95–100° / 95–100° | 90–120° (0°) |
| Riding | 70–105° / 85–100° / 75–100° | 70–120° (20°) |
| Advanced | 55–110° / 70–105° / 60–105° | 55–120° (35°) |

Powered up, the upwind edges at each level's start are the 22 October
numbers: what changed is that a light or an overpowered hour no longer pulls
them down, and the course runs on to 120° with the slow water past it drawn
faintly.

### What changed in `rideRange` (22 October 2026)

Typical pointing is 10° lower upwind for riding and advanced riders, at every
point of the band. Sharp gives back exactly the 19 October numbers.

| | 19 October | Typical, 22 October |
|---|---|---|
| Riding, powered | 60–105° | 70–105° |
| Riding, at floor | 75–100° | 85–100° |
| Riding, at top | 65–100° | 75–100° |
| Advanced, powered | 45–110° | 55–110° |
| Advanced, at floor | 60–105° | 70–105° |
| Advanced, at top | 50–105° | 60–105° |

The learner is unchanged at Typical: a beam reach at best was already what an
ordinary learner holds.

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

### Downwind: the course stops at about 120°; past it is slow; the drift is straight down

The course stops at 120° off the wind (`COURSE_DEEP`; 100–110° until 24
October 2026). That is the deepest heading a session is ridden on, back and
forth across the wind, rather than the deepest a rider can bear away:

- Duotone's best-speed course is "a downwind course at an angle of up to
  around 45 degrees" (about 135° off the wind). Running "straight downwind is
  possible, [but] requires more wind speed than your travel speed".
- A learner can bear away to about 135°, and a riding rider to about
  150–160°. An advanced rider can run dead downwind briefly, mostly with swell
  to ride.
- Every heading past about 120° gives away ground that has to be won back
  upwind, so the rose draws it faintly as SLOW: possible, but not a course to
  plan a session on, where it ends a long walk from where it began.

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

- 45° as the most anyone points: well supported (several schools and makers).
- Riding at 20° into the wind (70° off it): 10° short of the forum GPS
  measurements' 60°, the owner's judgement of an ordinary session.
- Advanced at 35° (55° off): 10° short of the schools' 45°, the same
  judgement.
- Learning at 0°, a beam reach: inferred from coaching, and the owner's floor.
- One angle in every wind: the owner's ruling, for a number a rider can set
  and recognise, over the light-air and overpowered adjustments, which were
  extrapolated from windsurfing.

The next step would be our own GPS tracks: a few riders of each level logging
tacks at a known wind on a flat-water spot.
