# Four directions for wingfoil.ie

Four single-file HTML mockups, each a complete answer to the same three
questions, all on real forecast data (5–9 October 2026, the v2 stars from
`feature/stars-v2`, 80 kg intermediate):

1. **The map.** How the coast reads at a glance: where is it on, and when.
2. **The spot page.** Click a spot → a page of its own, in the spirit of the
   Magicseaweed page riders loved: a star rating per day and per hour, the wing
   it takes, and further down the tide and daylight.
3. **The companion.** A character who lives in the corner, knows the forecast,
   the spots and the rider, and answers by pointing at the forecast instead of
   writing essays.

Open [`index.html`](index.html) in a browser (it needs no server; `data.js` sits
beside it). Each mockup takes a hash to jump straight to a view: `#map`,
`#spot/brandon` (also `dollymount`, `keel`, `rusheen`, `the-burrow`), `#companion`.

| | Direction | Mood | Map | Spot page | Companion |
| - | --------- | ---- | --- | --------- | --------- |
| A | [Shipping Forecast](a-shipping-forecast.html) | Admiralty chart × broadsheet. Paper, ink, magenta | Engraved chart, depth contours, light-flash symbols on 4★ spots | A front page with a generated headline; best window circled in red pen | **The Almanac**, an ink puffin who answers in marginal notes and footnotes on the forecast itself |
| B | [Isobar](b-isobar.html) | 3am over the Atlantic, wind made visible | Full-screen wind particles, spots as beacons glowing with their stars | **The Ribbon**: five days as a 3D ribbon, height wind, twist direction, colour stars | **Gust**, a wisp of the same particles that flies to the spots it mentions |
| C | [Telemetry](c-telemetry.html) | Chartplotter × F1 pit wall. Numbers first | LED dot-matrix Ireland, bar gauges, a ranked "rig now" ticker | Speed trace, lamp stars, a countdown to the next window, rider config re-scoring live | **Co-pilot**, a terminal line that answers in radio calls and drives the cursor |
| D | [Wild Atlantic Toybox](d-toybox.html) | Riso poster × papercut. Warm and funny | Papercut layers; each spot a sticker rider whose pose is the rating | **The beach strip**: an hourly comic, wing sized to the hour, stamped stars | **Puffin**, a mascot on a foil whose kit follows the weather; answers are cards |

## Where they came from

Awwwards has almost nothing about wind or weather, so these borrow from nearby
work:

- **Whiteout · An Ascent** (scroll as altitude) → scroll as *time* on the spot
  page (B).
- **WC 2026 Data Portraits** ("an impression, built entirely from data") → the
  forecast as a landscape (B's ribbon).
- **Madeira Ocean Trails**, **WWF Oceans Futures** → a coast you read, with
  curated entry points instead of a sea of pins (A, D).
- **Lando Norris**, **Radian** → one high-voltage colour kept for "go", and a
  kit configurator that re-scores live (C).
- **Igloo Inc**, **Atmos** → cold-Atlantic restraint and fly-through transitions,
  continuing the three.js intro film already on `feature/cinematic-intro` (B).
- **Cats & Dogs Weather** → a mascot whose mood *is* the conditions (D, and the
  in-app Gust).
- earth.nullschool / Windy's open-source webgl-wind → the particle map (B).

## What is common to all four (and to the app)

- **Solid stars are the hour; faded stars are what the wind alone would give.**
  Night is unrated, never zero.
- **Wing first.** Every rated hour carries the wing size, the session (*Light-wind
  drills*, *Cruising*, *Powered up*…), the shore angle, and "rides like N kn with
  the gusts" when the gusts lift it.
- **The companion answers with the forecast.** Cards, highlighted spots and
  circled hours rather than paragraphs, so the numbers always come from the
  data, never from the model's prose.

## Picking one

These are directions, not a choice between finished sites. The ideas transplant:
A's headline and red-pen window would sit well on the real spot page
(`feature/spot-page`); C's live rider config is the "stars for your ability"
setting; B's particle map is the most "Awwwards" and the most work; D is the
friendliest face for the community and the marketplace. A sensible path is one
direction for the brand (type, colour, mascot) and the best two or three
signature interactions from the others.
