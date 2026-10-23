# Foilable depth round the coast of Ireland

A map layer (on by default) that shows, at the forecast hour the dock has
selected, how much water there is over the bed, and where it is deep enough
to wing-foil. It is drawn like the satellite height map of the foreshore it
is partly built from: one smooth colour scale across the tide's reach.

- the water is coloured by its **depth at this tide** (tide − bed): nearly
  white at the tide's edge, light sea blue while it is too shallow for the
  mast (water, but not enough; not green, the wind's colour of good
  riding), then a step to **strong blue where a metre of water**
  (`FOIL_CLEARANCE_METRES`) makes it rideable, on through the chart's blue
  to a faint wash six metres down, so the chart's own tints and soundings
  read through deep water;
- a thin wet-sand line is the **waterline** at the hour (not ink: a bank the
  satellite measured flat at the tide would draw as a dark blot);
- the foreshore the tide has left is only a **light sand tint**: dry ground
  reads as ground;
- the shore is **OpenStreetMap's coastline** (the basemap's): nothing is
  drawn on land, and nothing inside the coastline is land.

The seabed and foreshore do not change, so they are built once, here, into
elevation archives. The tide makes it dynamic in the browser:
`depth = tide − z`, both in metres above Lowest Astronomical Tide (LAT).

Two kinds of archive:

- **42 national regions** (`national.py`, `national.json`): the whole coast,
  Northern Ireland's included, cut into one region per tide station of
  `public/marine/tides.json` (the station's Voronoi cell; Strangford Lough's
  a polygon), z6–13, from EMODnet's DTM and satellite waterlines, INFOMAR's
  merged 10 m inshore grid, the Sentinel-2 intertidal heights of the national
  satellite run along the whole coast (below), and in the north the JIBS
  survey and OSNI's LiDAR. Each is drawn with its own station's tide.
- **3 pilot areas** (`build.py`, `areas.json`): Dublin north, its Malahide
  lagoon basin, and Brandon Bay, z10–14, with LiDAR and the individual
  INFOMAR surveys besides (Dublin: the Sentinel-2 heights). They win where
  they are. The live set carries the pilots rebuilt on 18 October 2026 from
  their inputs fetched again (`fetch_pilots.py`, see "Rebuilding"), with the
  national run's satellite heights of 15 October.

Each archive holds raster-dem tiles: Terrarium RGB (`m = R·256 + G + B/256 − 32768`)
in **lossless** WebP (a lossy one would corrupt the heights), 512 px. Heights
are quantised to 1/32 m, so a height's blue byte is a multiple of 8. Only the
water a rider needs is kept: from the dry ceiling down to **5 m under LAT**
(`floorMetres: -5`). The values:

- a height, `floorMetres` to the dry ceiling;
- an **estimate**: a height whose blue byte is 4 over a multiple of 8 (a 64th
  of a metre over its step, `estimateBlue` in the index): water no survey
  reached, its bed estimated from the heights round it (below). The map draws
  it as any height; a tap says it is an estimate;
- **−20 m** (`deepMetres`): water deeper than the floor, deep enough at every
  tide, drawn as nothing; flagged as an estimate (−20 + 1/64 m), water no
  survey has sounded that is too wide to estimate (below), also drawn as
  nothing, which a tap calls unsurveyed rather than deep;
- **50 m**: land; and from **10 m** (`padMetres`) up, land beside the water
  written so the map's linear sampling runs cleanly from the water to nothing
  (`pad_land`). Both are drawn as nothing, and a tap reads them as land.

The older value **40 m** (`noSurveyMetres`, water of unsurveyed depth) is
still in the index and understood by the client, but a set built now writes
none. Tiles with nothing to draw (only land and deep water) are left out of
the archive.

## The depth cut

Anything deeper than 5 m under chart datum is foilable at every tide, so its
height is not kept: it is written as the deep value, drawn as nothing, and the
chart's own depth tints carry it. Before, heights were clamped at −6 m and the
sea kept out to 1.5 km from the shore; now the layer hugs the coastline and
the shallow banks (the Arklow Bank, the Shannon's flats), however far out they
are, and stops at the 5 m line: its edge is the seabed's contour, never a
distance from the shore or a box. Water with no height from any source
(inside OSM's coastline) is estimated within 1.5 km of a height
(`estimateMetres`; below); further out (a gap in the surveys out at sea where
EMODnet only had GEBCO, the middle of a harbour no survey has crossed, as
Wexford's) it is not drawn: the flagged deep value. The stretch's size used
to decide this; but a chunk of the national build sees only part of a large
stretch, and neighbouring chunks judging it differently drew straight lines
along chunk edges on the zoomed-out chart. A distance under the chunks'
margin is judged alike everywhere.

The edge is a **short fade**: the ramp (`foilRamp` with `deep`) draws nothing
from −20 m up to −5 m and fades the water in between −5 and −4 m
(`FOIL_FADE_METRES`). MapLibre interpolates heights between pixels, so the
last height kept and a deep pixel beside it run down through the fade: the
edge is soft and passes through no colour that is not there. A clean edge
(`fade: 0`) drew the 5 m line as a hard contour that read as a feature of the
seabed. Where EMODnet's 115 m cells are the only source, the 5 m line follows
their blocks: that is the data, and the chart's own tints show the same.

## The shore: OpenStreetMap's coastline (2026-10)

The site's owner found the layer badly wrong round the Malahide lagoon on
staging (rc.24): brown "dry" and blue "too shallow" blobs over fields outside
the shore, blank areas inside the water, staircase edges. Read straight out
of the published set (`foildepth/vb2f7a0ca40ae/`) and traced through the
build source by source:

| Point | What it is | Published | EMODnet DTM | Waterlines | LiDAR | Now |
| --- | --- | --- | --- | --- | --- | --- |
| 53.47761, −6.15961 | field north of the lagoon | 1.06 m (dry/shallow) | 1.08 | none | none | land |
| 53.47647, −6.15673 | field by the railway | 0.41 m | 0.42 | none | none | land |
| 53.4684, −6.168 | lagoon, inside its north shore | land | none | none | none | 1.27 m (est.) |
| 53.4675, −6.168 | lagoon, north shore strip | land | none | none | none | 1.27 m (est.) |
| 53.4657 … 53.4600, −6.185 | lagoon, western half | land | none | none | none | 1.27 m, 2.58 m by the south shore (est.) |
| 53.46311, −6.18846 | lagoon, west | land | none | none | none | 1.27 m (est.) |
| 53.4620, −6.170 | lagoon, middle | 0.81 m | none | 0.82 | none | 1.27 m (est.) |

(Two of the "western half" points the owner gave, 53.4580 and 53.4558 at
−6.185, are south of the lagoon's shore in OSM and on imagery: land, rightly.)

- **Fields drawn as flats: EMODnet's DTM, not the waterlines.** EMODnet fills
  land with a coarse (115 m) land model that reads 0.4–1.1 m LAT here. The
  waterline walk left that ground "unplaced" (half the Dublin grid is), so it
  was neither thrown out as land nor bounded, and the sea mask let it in:
  joined to the sea through low ground and under the 5 m dry ceiling. Over
  the Dublin pilot, 9.4 km² drawn on OSM land came from EMODnet alone and
  0.6 km² from the waterline interpolation.
- **The western lagoon blank: no source at all, not the LiDAR.** Of the
  lagoon's water (OSM: 3.30 km²), 32% was written as land, and 91% of that had
  no height from any source: EMODnet's intertidal cells are a 0 fill (thrown
  out), the waterline walk did not place them, and no survey has been there.
  The TII/OPW LiDAR covers only 3.4% of the lagoon (the M1 strip), and only
  0.3% of the land-written pixels; its basin surface rule
  (`lidarWaterLat`) was not the cause.
- **Staircases:** the map drew each pixel as itself (`resampling: "nearest"`)
  and the classes followed EMODnet's 115 m cells and the waterline grid.
- **No georeferencing offset.** Over 1,467 coastal z13 tiles of the national
  set, the shift that best aligns the archive's water with OSM's is 0 m
  east–west and one z13 pixel (5.6–5.9 m) north–south at the median
  (interquartile ±6–12 m): within the 10 m sources' pixel, and the pilots
  show none. INFOMAR's merged 10 m grid against a 2013 2 m survey (CB13_01,
  Lambay) aligns to 4 m. The disagreement is classification: in a 300 m band
  along OSM's coastline 7.9% of pixels disagreed with OSM, and only 33% of
  the layer's edge was within 10 m of the coastline (10th/50th/90th
  percentiles −60/0/+37 m).

So OpenStreetMap is now a **hard mask** (`osm.py`) for every archive:

- **sea**: outside OSM's land polygons (the coastline, mapped at about mean
  high water, as built by osmdata.openstreetmap.de), plus tidal water mapped
  inland of it (`natural=water` with `tidal=yes` or `water=lagoon`, tidal
  rivers, `wetland=tidalflat`) that joins the sea. **Never land**: a pixel
  with a height under the dry ceiling keeps it; one with none, or only a
  height over the ceiling (a coarse land cell, a LiDAR's water surface), is
  estimated (below).
- **shore**: beaches, sand, shingle, shoals, mud and salt marsh
  (`natural=beach|sand|shingle|shoal|mud`, `wetland=saltmarsh`) joined to the
  sea. Above the coastline, so they may be foreshore: drawn where a source's
  height says the tide reaches them (under the dry ceiling), land elsewhere.
  Upper beaches are drawn where a LiDAR or the satellite saw them; where only
  EMODnet or the waterlines had a height, those count too.
- **everything else is land**, never drawn, whatever a source says. Fields
  cannot be intertidal.

Joining is by pixels (`joinPixels`): a lagoon behind a shingle bar (Lady's
Island Lake, Tacumshin) is not tidal water and is not drawn. The older rules
(water joined to soundings under LAT, the upper-beach band, marsh up to MHW +
0.5 m) are kept only for a build with no mask.

Measured on every tile at each archive's max zoom (`edgecheck.py`,
comparing with OSM on the tile's own grid), the live set (1,835 tiles)
disagrees with OSM's water in 0.0% of a 300 m band along the coastline
(7.8% before the mask); nothing is drawn on OSM land (145 km² before) and
0.06 km² of OSM's sea is left as land (291 km² before, the lagoons,
estuaries and harbours inside the coastline among it); 94% of the layer's
edge is within 10 m of the coastline (33% before; the rest is beaches and
marsh drawn landward of it), and the best-aligning shift is zero in 99.9% of
1,482 coastal tiles. Per archive, with the area that changed class:

| Archive | Coastal band disagreeing with OSM, before → after | Drawn on OSM land before (km²) | Land → water (km²) | Water → land (km²) |
| --- | --- | --- | --- | --- |
| `brandon` | 12.3% → 0.0% | 9.509 | 0.8 | 9.5 |
| `dublin-north` | 11.8% → 0.0% | 4.809 | 3.8 | 4.8 |
| `malahide-lagoon` | 44.1% → 0.0% | 1.399 | 1.2 | 1.4 |
| `tide-achill-island` | 5.5% → 0.0% | 2.727 | 9.4 | 2.8 |
| `tide-aranmore` | 11.8% → 0.0% | 8.992 | 43.4 | 9.0 |
| `tide-arklow` | 6.5% → 0.0% | 0.188 | 2.4 | 0.2 |
| `tide-ballycotton` | 5.5% → 0.0% | 1.357 | 1.7 | 1.4 |
| `tide-ballyglass` | 5.7% → 0.0% | 2.74 | 10.6 | 2.7 |
| `tide-bray-harbour` | 4.5% → 0.0% | 0.495 | 0.6 | 0.5 |
| `tide-buncranna` | 6.1% → 0.0% | 9.5 | 5.1 | 9.5 |
| `tide-castletownbere` | 5.7% → 0.0% | 8.678 | 12.5 | 8.7 |
| `tide-clare-island` | 4.7% → 0.0% | 1.675 | 2.7 | 1.7 |
| `tide-crosshaven` | 6.8% → 0.0% | 0.362 | 2.1 | 0.4 |
| `tide-dingle` | 5.7% → 0.0% | 2.933 | 7.5 | 2.9 |
| `tide-dungarvan` | 5.0% → 0.0% | 0.544 | 2.2 | 0.5 |
| `tide-dunmore` | 6.8% → 0.0% | 3.288 | 4.2 | 3.3 |
| `tide-fenit` | 10.1% → 0.0% | 11.78 | 3.1 | 11.8 |
| `tide-galway` | 5.8% → 0.0% | 5.974 | 0.8 | 6.0 |
| `tide-killybegs` | 8.2% → 0.0% | 4.875 | 10.8 | 4.9 |
| `tide-kilrush` | 7.6% → 0.0% | 5.475 | 12.7 | 5.4 |
| `tide-kinsale` | 5.6% → 0.0% | 0.612 | 4.4 | 0.6 |
| `tide-lahinch` | 9.4% → 0.0% | 4.158 | 8.8 | 4.1 |
| `tide-letterfrack` | 6.5% → 0.0% | 10.873 | 6.8 | 10.9 |
| `tide-malin-head` | 7.0% → 0.0% | 3.232 | 4.1 | 3.3 |
| `tide-port-oriel` | 6.9% → 0.1% | 3.733 | 4.3 | 3.9 |
| `tide-ringaskiddy` | 9.9% → 0.0% | 1.558 | 6.9 | 1.6 |
| `tide-roonagh` | 4.9% → 0.0% | 2.305 | 3.5 | 2.3 |
| `tide-rossaveel` | 6.8% → 0.0% | 15.151 | 3.3 | 15.2 |
| `tide-rosslare` | 13.5% → 0.0% | 0.436 | 15.4 | 0.4 |
| `tide-skerries` | 8.4% → 0.0% | 4.489 | 0.2 | 4.6 |
| `tide-sligo` | 5.0% → 0.0% | 4.74 | 3.4 | 4.7 |
| `tide-tory-island` | 12.6% → 0.0% | 1.775 | 43.9 | 1.8 |
| `tide-union-hall` | 6.5% → 0.0% | 3.25 | 8.9 | 3.3 |
| `tide-wexford` | 18.7% → 0.0% | 1.375 | 41.6 | 1.4 |

**Estimates.** Water with no height is filled from the heights round it
(`local_fill`, their Gaussian-weighted mean, σ 400 m, cut at 1.8 km, then
`relax`, a few hundred sweeps of the neighbours' mean, so it meets them
without a step), never higher than
what is known of it: under the satellite's lowest tide seen where the
satellite never saw it dry, under LAT under the waterlines' LAT line. A
basin's `bedEstimateLat` stands in where no height is within `pinMetres`.
They are written as estimates (above).

The first national build with the whole coast's satellite heights (17
October) filled from `push_pull`, a smooth surface through every known height
in the grid. That is global: two chunks see different heights past their
margins, so they estimated the same water differently, and off Raven Point
(Wexford) one side of a chunk's edge drew water about 4 m deep and the other
nothing, a straight north–south line at 6.33° W. `local_fill` depends only on
the heights within 1.8 km, inside the 2.9 km margin, on blocks that lie on
the global grid as the chunks do, so each chunk computes the same value
(`test_an_estimate_is_the_same_in_any_chunk`). The pilots, rebuilt on 18
October, take `local_fill`'s estimates too (they had `push_pull`'s until
then): 13% of Dublin's estimated pixels and 7% of Brandon's moved by more
than 0.5 m, nearly all of them down (by a metre or so where they were held
under a tide), while the Malahide lagoon's estimate (1.27 m) stayed put.

**Smooth edges.** The map samples the heights linearly now
(`resampling: "linear"` in `force5/src/WindMap.tsx`), so the edges and the
waterline are smooth at any zoom. What made hairlines before was two reserved
values side by side, which the interpolation runs through every colour
between: land (50) beside water would draw a fringe of every colour from the
water's height to the dry ceiling at every shore. Now the land pixel beside
water is written as 2 × ceiling − h, at least 10 m (`pad_land`), at each zoom
before the tiles are cut (so a tile's edge sees its neighbour's water), and
the interpolated height crosses the ceiling, where the colour stops, inside
the gap; the overviews are made from the unpadded level. With the mask, land
meets water only at OSM's coastline, never out at sea, and the deep value
meets heights only at the 5 m cut and at a region's or a pilot box's edge,
where it fades. The overviews (z6–9) are made from the regions' z10 tiles; a
tile left out (nothing to draw) was taken for land there, which put a line of
every colour along the open sea at each chunk's edge on the zoomed-out chart:
it is now taken for what OSM says (`Fill` in `national.py`: the deep value at
sea, land on land), and a pilot's pyramid carries its grid's own edge on
past it.

## Satellite intertidal heights

Sentinel-2 sees each foreshore pixel wet or dry at hundreds of known tides;
the tide at which it floods is its height, and because it comes from the
imagery it lines up with it. The national run (`scripts/satellite`, after the
rocks pilot on `rocks-pilot`) makes one archive per tide station's region,
cut as these regions are, with the height (the station's level when the
pixel floods, its 0.25 m bias against LiDAR already off) and reserved values
for "wet in every look" (under the lowest tide seen) and "dry in every
look". `satellite.py from-archives` puts each region in the form the builds
read (two bands, the height and a flag: seen wet and dry, never seen dry,
never seen wet; and the tides seen), and both builds take them from
`satellite/*.tif` (a `kind: "satellite"` source in `areas.json` and
`national.json`).

The set built in is the national run's rebuild of 15 October 2026,
published as `intertidal/ve71a2a306bca/` (`public/intertidal/index.json`):
all 22 Sentinel-2 tiles, 66 regions. Besides the 33 stations' regions there
are 31 **basins** whose water runs 20–110 minutes behind their station
(`tide-<station>-lag<n>`: Lough Swilly behind Buncrana, the Shannon estuary
behind Kilrush, the Fergus behind Lahinch, Rogerstown behind Skerries, …).
A basin's heights are its own lagged tide's levels, in its station's datum
and amplitude, so they are bed heights like any other; the files sort before
their parent's, which writes the basin as another region's water, so each
pixel takes one. The map draws a basin with its station's tide, not the
lagged one: see "What is missing". Northern Ireland's six regions come from
the set cut again on 18 October (below).

The map draws the heights only as part of these archives. Until this build,
a separate overlay drew the intertidal archives over the foil layer from
zoom 10 (`force5/src/intertidal.ts`, `src/useIntertidal.ts`, the app's
`useIntertidal`), on the same ramp but with no mask and its own fringe at
every reserved value; it is retired, and a tap reads the foil archive alone.

In the band the tides seen cover, the satellite **leads**: where a pixel was
seen both wet and dry its height wins over the waterline interpolation, the
LiDAR and INFOMAR, feathered into them over 80 m at the edge of what it saw.
A rejected pixel among accepted ones is filled from the satellite's heights
round it. Under the lowest tide seen (never seen dry), within 300 m of what
it saw flood, the surveys stand (INFOMAR, LiDAR, EMODnet, down to −5 m), held
under that tide (0.5–0.6 m LAT round Dublin after the bias); over the highest
(never seen wet), within 300 m of what it saw flood and only where no source
has the bed more than 1.5 m under the lowest tide seen, they are raised to
it. (The national set writes "dry in every look" over whole blocks of open
sea it could not read, off the Aran Islands, Achill and Inishbofin; raised to
the top of the tide, their soundings drew those blocks as sand on the
zoomed-out chart.) The waterlines' interpolated surface is not a survey:
wherever the satellite saw a pixel wet in every look, at any distance, and the
waterlines put it over the lowest tide seen, their surface goes, and what was
under it (EMODnet) stands if it is under that tide, else the bed is estimated
under it from the heights round it. (Built so since the Northern Ireland
regions of 18 October, and only in the chunks built since: EMODnet's lines
off Islandmagee drew the sea at Browns Bay, 3–7 m deep, as a flat drying at
half tide, then, held under the lowest tide seen, as barely covered.) It **yields** to a sonar or
bathymetric LiDAR survey that has the bed more than 1.5 m under it (a 10 m
pixel across a wall or a cliff's foot, as round Howth Head), or more than
0.5 m under it at the bottom of the tides seen, where the method reads high.
Behind the weir a pixel's flooding tide is turned into the basin's level
(`basin_height`); in the Dublin pilot, drawn on Howth's tide, heights
measured against Dublin Port's or Skerries' are moved to the same stage of
Howth's (`to_station`; a lag basin's, as Rogerstown's `Skerries_LAG1` along
the box's north edge, are in its station's terms and move the same way).

Against the other sources where both have a height (the Dublin pilot, z14,
before the yield; the 18 October rebuild, with the 15 October run):

| Against | Pixels | Median | Interquartile | Off by more than 0.5 m |
| --- | --- | --- | --- | --- |
| OPW/TII LiDAR | 1,041,584 | −0.09 m | −0.28 to +0.09 m | 18.8% |
| INFOMAR (the 10 m grid and the surveys) | 43,503 | +2.56 m | +1.38 to +4.19 m | 92% |
| EMODnet and its waterline interpolation | 2,349,693 | +0.80 m | +0.39 to +1.14 m | 74% |

The satellite and the LiDAR agree. The disagreements over 0.5 m are where
the method is weakest, mapped in `<debug>/dublin-north-sat-minus-lidar.tif`:
over 4.2 m LAT, the top of the tides seen, 85% of pixels (the satellite
1.4 m under the LiDAR's sea walls and marsh tops, which a 10 m pixel still
saw flood); under 1.7 m, near the lowest tides seen, 34%; on slopes over 1 in
50, where a pixel spans a beach face, 37% (11% on the flats); between 1.7 and
4.2 m, 11–21%. INFOMAR's shared pixels are few and mostly where the satellite
is weakest (round Howth Head's rocks, the bottom of the tides seen): the
yield rule above hands them back to the survey. The waterline flats were about 0.8 m too low, as the rocks
pilot found (it said 0.7–1 m), and are gone wherever the satellite has a
height.

**Northern Ireland.** The national run also writes regions on Northern
Ireland's own stations (`scripts/satellite/stations_ni.json`: Portrush,
Ballycastle, Larne, Bangor, Killard Point and Strangford Lough). The 15
October rebuild wrote no heights for the first four and only part of the
last two: its station numbers were stale after the basin stations were added
(`scripts/satellite/README.md`, "Published"). They were cut again on 18
October from the same composed tiles (`intertidal/v293c9dd4de9c/`). The foil
regions there are drawn on the site's own stations of the same names
(`force5/ingest/tides_ni.py`), plus Portavogie, Ardglass and Dundrum Bay,
whose cells take the satellite's Bangor and Killard heights moved to the
same stage of their own tide (`read_satellite`'s `regions`, `to_station`).
The satellite run's Bangor and Portrush levels were the UK gauges' chart
datum; the site's stations' LAT is their constants' 18.6-year lowest, 0.142
and 0.158 m over chart datum, so those heights come down by that much (the
files' `DATUM` tag, stations.json `chartDatumAboveLatMetres`). Its other
stations' datum was EOT20's own 19-year lowest at the same points as the
site's stations, within a few millimetres of theirs.

## How the map uses it

- `force5/src/foilDepth.ts`: the pure parts. `foilRamp(tide, colours, …)`
  builds the `color-relief-color` interpolate on `["elevation"]` whose stops are
  the depth scale's (`depthScale`: 0, the clearance, 3 and 6 m) at `tide − d`,
  the waterline just under the tide (`FOIL_LINE_METRES`), and the dry tint up
  to the area's dry ceiling (MapLibre wants literal stops, so the ramp is
  rebuilt and set with `setPaintProperty` as the hour moves; that is a small
  texture upload, not a re-tile). Also the datum
  conversion (`malinToLat`), the class rule (`foilClass`), Terrarium decoding,
  a basin's level (`basinLevel`, `waterLevelAt`: see below) and the
  tapped-point wording.
  With the index's `deepMetres` the ramp draws nothing from it up to the floor
  (−5 m) and fades the deep colour in over the next metre
  (`FOIL_FADE_METRES`): see "The depth cut" below.
- `force5/src/WindMap.tsx`: one `raster-dem` source and `color-relief` layer
  per area in view, under the rivers, the coast's ink and the names, sampled
  linearly (the build's padding keeps that clean: "Smooth edges" above). A layer
  shows from half a zoom under its archive's min zoom: MapLibre rounds a
  raster's zoom to the nearest whole one, so that is where its tiles start
  (and where a region's cut-out for a pilot's box starts). Its opacity has no
  transition: any paint change starts the style's 300 ms fade on it, and the
  whole map drew every frame of it, 17 frames for each new hour. And MapLibre
  6.9 keeps a color-relief layer's newest ramp textures without deleting the
  ones they replace, so `force5/src/colorRelief.ts` deletes them (two a layer
  an hour). `npm run perf` measures both (scripts/perf/run.mjs).
- `src/useFoilDepth.ts`: loads `index.json` (from the site) the first time
  the layer is on, and the tide curve (`tideForStation` in
  `force5/src/tides.ts`) of each station whose area comes into view, once,
  never all 42 up front. `foilArchiveUrl` puts an archive under the index's
  `base` on the data host (`forecastUrl`, `force5/src/urls.ts`).
- `src/App.tsx`: the areas over the chart's view (`areasInView`), the water
  level at the dock's selected column (`tideAt`, and a basin's
  `waterLevelAt`), the layer switch (site menu → Layers → Chart →
  "Tidal depth", on by default), the key (`src/FoilLegend.tsx`, in the map's
  information dialog, not on the chart), and a tapped point's water
  (`force5/src/foilProbe.ts` reads one pixel out of the archive). `areasAt`
  says which archives may hold a point: inside a pilot's box the pilots only
  (a basin first: the first with water under the point is the side of the
  weir it is on); elsewhere the one region whose station is nearest, as the
  regions were cut. A point can read as a height, an estimate (`foilPoint` in
  `force5/src/foilDepth.ts`: the blue byte), deeper than 5 m ("deep enough at
  any tide"), land (the padding beside it included), or, where the archive
  has no tile, nothing drawn; an older set's unsurveyed value still reads.
  The layer is on by default for a first visit (`DEFAULT_LAYERS`); a choice
  saved in the layers' store stands.
- The app's chart (`mobile/src/features/map`: `foilLogic.ts`, `ChartMap.tsx`,
  `probe.ts`, the key in `InfoSheet.tsx`) draws the same archives with the
  same ramp at full opacity, on by default, and reads a tap with `foilPoint`.
  MapLibre Native samples a colour-relief layer linearly (it has no
  `resampling` property).
- The colours are `--map-foil-*` in `ui/theme.css` (edge, shallow, enough,
  deep, deeper, line, dry); the key (`src/FoilLegend.tsx`) draws the same
  scale from them.
- `force5/src/archives.ts`: how the map and the probe read every archive
  (these and the bathymetry). Byte ranges where the host serves them (vite,
  Caddy, R2); where it answers a range with a 200 and the whole file, as
  Cloudflare Pages does, the file is kept and read from memory. The archives
  are now all on the data host (R2, ranges), so a visitor fetches only the
  tiles in view. `e2e/foil-depth.spec.ts` draws the pilots from both kinds of
  host; `e2e/foil-national.spec.ts` draws a routed fixture region
  (`e2e/foildepth/tide-galway.pmtiles`, `fixture.py`, padded as the build
  pads), taps it, and checks that a region out of view has neither its
  archive nor its tide fetched.

## The national regions

The coast is cut by tide station: every pixel belongs to its nearest station
of `public/marine/tides.json` (the Marine Institute's 33 and the site's own
nine in Northern Ireland), decided per 4×4 pixels on the global z13 grid so a
pixel gets the same answer in any chunk, and is left out if it is further than
45 km from all of them (`maxStationKm`). A station with a polygon (Strangford
Lough inside the Narrows) takes every pixel inside it and none outside
(`station_cells`), and the index carries the polygon so a tap reads the same
region. Each region is one archive, z6–13 (512 px tiles: ~5.8 m a
pixel at z13, 53°N; z6–9 are overviews, the mean of the heights under each
pixel, so the coast shows on the all-Ireland view), drawn on its own
station's curve with its own ramp. A point is read from the region whose
station is nearest (`stationLonLat` in the index), as the cells were cut.

Northern Ireland's levels come from the site's own predictions over the same
three years (`fetch_national.py tides-ni`, `force5/ingest/tides_ni.py
levels`), in each station's own LAT.

Each region's levels are its station's, from three years (2026–2028) of the
Marine Institute's predictions, aggregated on ERDDAP by `fetch_national.py
tides` and kept in `stations.json`: MSL is the mean of the 5-minute curve
(`imiTidePrediction`, `orderByMean`), MHW the mean of the predicted high
waters (`IMI_TidePrediction_HighLow`, OD Malin + the station's
`odMalinOffsetMetres`), HAT the curve's highest value (`orderByMax`); the
lowest (`orderByMin`) is within 0.1 m of 0 at every station, which checks the
LAT datum. The waterline surface puts the satellite LAT, MSL and MHW lines at
0, MSL and MHW; the dry ceiling is HAT + 0.3 m rounded up to 0.1 m (three
years fall a few centimetres short of the 18.6-year nodal cycle's HAT).

| Region | Station | MSL / MHW / HAT (m LAT) | Dry ceiling | Tiles | Size |
| --- | --- | --- | --- | --- | --- |
| `tide-achill-island` | Achill Island | 2.43 / 3.77 / 4.69 | 5.0 | 131 | 2.11 MB |
| `tide-aranmore` | Aranmore | 2.22 / 3.43 / 4.50 | 4.8 | 118 | 2.04 MB |
| `tide-ardglass` | Ardglass | 3.17 / 4.90 / 6.21 | 6.6 | 26 | 0.20 MB |
| `tide-arklow` | Arklow | 0.89 / 1.15 / 1.64 | 2.0 | 80 | 0.51 MB |
| `tide-ballycastle` | Ballycastle | 0.61 / 0.89 / 1.27 | 1.6 | 115 | 0.74 MB |
| `tide-ballycotton` | Ballycotton | 2.34 / 3.78 / 4.57 | 4.9 | 50 | 0.59 MB |
| `tide-ballyglass` | Ballyglass | 2.17 / 3.33 / 4.36 | 4.7 | 171 | 2.45 MB |
| `tide-bangor` | Bangor | 2.05 / 3.20 / 4.07 | 4.4 | 70 | 0.99 MB |
| `tide-bray-harbour` | Bray Harbour | 2.19 / 3.45 / 4.27 | 4.6 | 60 | 0.27 MB |
| `tide-buncranna` | Buncranna | 2.44 / 3.77 / 4.96 | 5.3 | 187 | 3.25 MB |
| `tide-castletownbere` | Castletownbere | 1.93 / 3.08 / 3.84 | 4.2 | 256 | 2.76 MB |
| `tide-clare-island` | Clare Island | 2.51 / 3.90 / 4.83 | 5.2 | 66 | 0.84 MB |
| `tide-crosshaven` | Crosshaven | 2.06 / 3.36 / 4.09 | 4.4 | 34 | 0.21 MB |
| `tide-dingle` | Dingle | 2.28 / 3.55 / 4.47 | 4.8 | 163 | 1.55 MB |
| `tide-dublin-port` | Dublin Port | 2.47 / 3.82 / 4.66 | 5.0 | 6 | 0.02 MB |
| `tide-dundrum-bay` | Dundrum Bay | 3.17 / 4.89 / 6.21 | 6.6 | 82 | 0.96 MB |
| `tide-dungarvan` | Dungarvan | 2.15 / 3.44 / 4.20 | 4.5 | 63 | 0.61 MB |
| `tide-dunmore` | Dunmore | 2.38 / 3.77 / 4.59 | 4.9 | 74 | 0.98 MB |
| `tide-fenit` | Fenit | 2.76 / 4.28 / 5.42 | 5.8 | 82 | 1.15 MB |
| `tide-galway` | Galway | 3.00 / 4.61 / 5.79 | 6.1 | 77 | 1.64 MB |
| `tide-howth` | Howth | 2.52 / 3.95 / 4.86 | 5.2 | 11 | 0.02 MB |
| `tide-killard` | Killard Point | 3.15 / 4.88 / 6.18 | 6.5 | 29 | 0.38 MB |
| `tide-killybegs` | Killybegs | 2.30 / 3.53 / 4.63 | 5.0 | 154 | 1.92 MB |
| `tide-kilrush` | Kilrush | 2.96 / 4.56 / 5.67 | 6.0 | 176 | 2.56 MB |
| `tide-kinsale` | Kinsale | 2.01 / 3.29 / 4.00 | 4.3 | 68 | 0.66 MB |
| `tide-lahinch` | Lahinch | 2.68 / 4.20 / 5.17 | 5.5 | 106 | 1.25 MB |
| `tide-larne` | Larne | 1.86 / 2.85 / 3.62 | 4.0 | 66 | 0.64 MB |
| `tide-letterfrack` | Letterfrack | 2.51 / 3.90 / 4.83 | 5.2 | 164 | 2.70 MB |
| `tide-malin-head` | Malin Head | 2.12 / 3.21 / 4.20 | 4.5 | 77 | 0.73 MB |
| `tide-port-oriel` | Port Oriel | 2.95 / 4.65 / 5.72 | 6.1 | 104 | 1.54 MB |
| `tide-portavogie` | Portavogie | 2.87 / 4.46 / 5.64 | 6.0 | 37 | 0.43 MB |
| `tide-portrush` | Portrush | 1.24 / 1.81 / 2.43 | 2.8 | 80 | 0.99 MB |
| `tide-ringaskiddy` | Ringaskiddy | 2.29 / 3.78 / 4.54 | 4.9 | 55 | 0.77 MB |
| `tide-roonagh` | Roonagh | 2.48 / 3.81 / 4.83 | 5.2 | 82 | 1.72 MB |
| `tide-rossaveel` | Rossaveel | 2.81 / 4.35 / 5.49 | 5.8 | 169 | 3.59 MB |
| `tide-rosslare` | Rosslare | 1.13 / 1.73 / 2.26 | 2.6 | 65 | 0.54 MB |
| `tide-skerries` | Skerries | 2.87 / 4.47 / 5.47 | 5.8 | 40 | 0.48 MB |
| `tide-sligo` | Sligo | 2.30 / 3.56 / 4.67 | 5.0 | 145 | 2.22 MB |
| `tide-strangford` | Strangford Lough (Killard Point +100 min) | 3.15 / 4.88 / 6.18 | 6.5 | 68 | 1.48 MB |
| `tide-tory-island` | Tory Island | 2.30 / 3.60 / 4.56 | 4.9 | 95 | 1.25 MB |
| `tide-union-hall` | Union Hall | 1.93 / 3.21 / 3.93 | 4.3 | 119 | 1.54 MB |
| `tide-wexford` | Wexford | 0.89 / 1.46 / 1.97 | 2.3 | 88 | 0.76 MB |

Howth's and Dublin Port's regions are small because the Dublin pilot covers
most of their cells from z10 up. Northern Ireland's levels are over each
station's own LAT (its constants' 18.6-year lowest); Strangford Lough is
Killard Point's curve 100 minutes later. The live set
(`foildepth/va75bf93693c2/`, 18 October 2026, `public/foildepth/index.json`)
is 45 archives and its index: the regions 52.0 MB, the pilots 6.1 MB, the
index 68 kB. It is the pilots' set of the same day (`foildepth/vec09f9fbdb11/`:
the pilots rebuilt, and Howth, Dublin Port, Skerries, Bray, Fenit and Dingle
built again) with Northern Ireland's nine regions added and the four whose
chunks the new stations or sources reach (Buncranna, Malin Head, Tory Island,
Port Oriel) built again; the other 29 regions and the pilots are the same
bytes. The sets before it (`vec09f9fbdb11/`, `vb597fbba2f1c/`, and
`vb2f7a0ca40ae/`, 12 October, three flat classes drawn pixel by pixel) stay
in the bucket for any page still holding their index. A visitor fetches only the tiles in view,
from R2 by range.

### National sources (CC BY 4.0, and in Northern Ireland OGL v3), in order of trust

1. **EMODnet Bathymetry DTM 2024** (`emodnet:mean`, 1/16′ ≈ 115 m), fallback,
   fetched in 1° tiles; its intertidal 0 fill dropped, and the cells its
   source references (`emodnet:source_references`, release 2024) give to
   GEBCO dropped too (`gebco2024.json`, 230 polygons over Ireland, fetched with
   a CQL filter), except where GEBCO has them deeper than 10 m
   (`keepDeeperThan`, national.json's notes): deep water, drawn as nothing.
   EMODnet's 2024 DTM fills most of Northern Ireland's inshore water from
   GEBCO (in one chunk off Larne, 58% of the grid); with all of it dropped,
   the sea a kilometre off the Antrim coast and round the Maidens, 20–90 m
   deep, was estimated from the beaches as shallow, or as drying.
2. **EMODnet satellite-derived waterlines** (`emodnet:coastlines`, LAT, MSL,
   MHW): fetched in 0.25° boxes over every box where the DTM shows the coast,
   quartered where the WFS's 1000-feature cap was hit (Strangford, Clew Bay),
   each feature once. The waterline walk (`waterlines.py`) gained two rules
   at this scale: a "lake" (a shore traced as all three lines at once, no
   tide: Lough Corrib) reached straight from the land is land, not "under
   LAT"; and a band whose ground is mostly over 1.2 km from any line is open
   sea placed wrongly (where only GEBCO's fill was, off Achill and north-west
   Donegal), not a drying flat.
3. **INFOMAR's merged inshore bathymetry**, 10 m, LAT, positive up: the GSI
   ImageServer `Marine/IE_GSI_MI_Bathymetry_10m_Inshore_IE_WGS84_LAT_GRID`
   does export float heights (`exportImage`, `pixelType=F32`, `noData=-9999`,
   LZ77), at its own pixel size (0.000124° × 0.000130°), in 0.25° boxes: 182
   boxes, 875 MB. It merges multibeam and bathymetric LiDAR (2002–2025), so it
   has the shallows and lower beaches wherever INFOMAR has flown; behind the
   satellite MHW line its land returns are kept only up to MHW + 0.5 m.
4. **INFOMAR's JIBS grid** (`fetch_national.py surveys`): the Joint Irish
   Bathymetric Survey of 2007–08, multibeam, as GSI publishes it, a 10 m XYZ
   of the north coast from Inishowen to Torr Head (14.9 million soundings,
   LAT, positive up, gridded on its own 0.000099° spacing). Its Northern
   Ireland side (the Maritime and Coastguard Agency's survey HI1240, OGL) is
   in no merged grid; on the Irish side, where the merged grid has it too, they
   agree (median 0.00 to 0.06 m). It goes under the merged grid. Its shallowest
   sounding is −0.9 m: the seabed off Portstewart, Portrush, Whitepark Bay and
   Ballycastle, not their beaches.
5. **INFOMAR's 2008 bathymetric LiDAR of Lough Foyle**, 5 m, LAT: the merged
   grid has it at 10 m (the same heights, median 0.00 m, interquartile
   ±0.03 m), so this goes over it for the flats' detail.
6. **OSNI's river-basin LiDAR** (`fetch_national.py osni-lidar`; OSNI Open
   Data, Land & Property Services, OGL v3), 0.5–1 m DTMs of the flood-study
   areas, 2007–2012, Irish Grid, heights above OD Belfast, made into 2 m
   mosaics: the twelve areas that reach the shore (Coleraine–Portstewart–
   Portrush, Ballycastle, Cushendall, Ballygalley, Larne, Carrickfergus, Bangor
   and its 2012 extension, Newtownards, Killyleagh, Downpatrick, Newcastle). A
   topographic LiDAR sees the sea's surface where the sea was: each 1 km
   tile's level is read off its returns over EMODnet's always-wet cells (the
   densest 10 cm of them, if it holds a quarter: Bangor's 2007 flight saw the
   sea at −0.9 to −1.5 m OD, near low water; Portrush's at +0.1 to +0.2 m),
   else the nearest tile's within 3 km, else +2.3 m OD (over mean high water
   springs anywhere on this coast), and everything at or under it plus 0.1 m
   is left out (`<flight>.json` records each tile's). Brought to each pixel's
   station's LAT with its `odBelfastOffsetMetres` (national.json's
   `landDatums`). It goes under the satellite, which leads in its band: the
   LiDAR adds the upper beaches over the highest tide the satellite saw, and
   the foreshore where it saw none. Against the satellite at Ballyholme
   (27,412 pixels), the satellite reads 0.25 m over it at the median
   (interquartile −0.06 to +0.56), about 0.3 m over it from 0 to 3 m LAT;
   round Strangford's north end (83,814) +0.28 m (interquartile +0.19 to
   +0.38). Round Dublin the satellite reads within 0.1 m of the OPW LiDAR, so
   either the satellite's Northern Ireland tides (the gauges' fit, EOT20) or
   the OSNI flights' datum is off by about 0.3 m; nothing open here says which.
7. **The pilot areas' merged grids** (below), where they are.

Attribution: "Contains Irish Public Sector Data (Geological Survey Ireland &
Marine Institute) licensed under CC BY 4.0"; "EMODnet Bathymetry Consortium:
EMODnet Digital Bathymetry (DTM 2024) and coastlines"; "Tidal predictions ©
Marine Institute, CC BY 4.0"; in Northern Ireland "Contains public sector
information licensed under the Open Government Licence v3.0 (OSNI Open Data,
Land & Property Services: River Basin LiDAR)", "Contains Maritime &
Coastguard Agency data © Crown copyright" (JIBS's HI1240), and the site's
own tide predictions from the Environment Agency's gauges (OGL v3) and EOT20
(DGFI-TUM, CC BY 4.0).

### Coverage

- **Republic**: every coast within 45 km of a station, islands included
  (Aran, Achill, Clare Island, the Blaskets' sounds, Tory, Inishowen), and the
  bays and estuaries: Shannon (Kilrush's tide to above Foynes), Galway Bay,
  Clew Bay, Killala, Sligo and Donegal Bays, Lough Swilly, Lough Foyle,
  Bantry and Kenmare Bays, Cork Harbour, Dungarvan, Waterford and Wexford
  Harbours, Dundalk Bay and Carlingford Lough. INFOMAR's 10 m grid covers
  most bays (multibeam and LiDAR); the open coast between them and the
  smaller inlets have only EMODnet's DTM and the waterlines.
- **Northern Ireland**: the whole coast, Lough Foyle round to Carlingford
  Lough, on the site's own nine stations (`force5/ingest/tides_ni.py`) and the
  Marine Institute's Malin Head, Buncranna and Port Oriel: Portrush (Benone,
  Portstewart, Portrush, Portballintrae), Ballycastle (the Giant's Causeway to
  Torr Head and Rathlin), Larne (the Antrim coast, Larne Lough, Islandmagee
  and Browns Bay, Carrickfergus), Bangor (Belfast Lough, Ballyholme,
  Donaghadee, Millisle), Portavogie (the Ards coast to Kearney), Strangford
  Lough inside the Narrows (a polygon: Newtownards, Comber, Killyleagh, the
  Quoile), Killard Point (the Narrows, Killard, Ballyhornan), Ardglass
  (Killough, St John's Point), Dundrum Bay (Tyrella, Dundrum, Newcastle,
  Annalong, Kilkeel) and Port Oriel (Cranfield and Carlingford Lough). INFOMAR's merged grid
  reaches only Lough Foyle; the north coast has JIBS's 10 m multibeam out
  from about the 1 m line; elsewhere the seabed is EMODnet's (mostly GEBCO's
  fill: deep water only, above), the foreshore the satellite's, and OSNI's
  LiDAR where its twelve flood-study areas reach the shore. Lough Neagh and
  the other lakes are fresh water: no tide, nothing drawn (OSM has them as
  lakes, not tidal water).

## The pilot areas: sources (all CC BY 4.0)

In order of trust; a later one wins where it has data, feathered over 12 px.
INFOMAR's merged 10 m grid (as for the regions) goes in under the individual
surveys, so the pilots have its shallows and bathymetric LiDAR where the
surveys have none; the satellite's heights (above) go in last.

1. **EMODnet Bathymetry DTM** (`emodnet:mean`, 1/16′ ≈ 115 m), fallback only.
   Relative to chart datum ≈ LAT, negative down. It fills the intertidal with
   0 and land with a coarse, low DEM: both are thrown out. Where no survey
   reached, it fills from GEBCO, a global grid; its source references
   (`emodnet:source_references`, fetched beside the DTM) say which cells, and
   those are thrown out too (`gapFill` in `areas.json`; see Sandymount below).
2. **EMODnet satellite-derived waterlines** (WFS `emodnet:coastlines`, types
   `LAT`, `MSL`, `MHW`). Where no LiDAR or sonar has been (the whole Malahide
   estuary), `waterlines.py` interpolates an intertidal surface between the
   three lines (0, MSL and MHW above LAT, set per area from the station: Howth
   2.5/3.8 m, Fenit 2.7/4.1 m). Under the LAT line is wet at every tide; above
   MHW is land, and nothing below it (EMODnet's DEM, a LiDAR's fields behind a
   beach) is let into the sea unless a bathymetric survey has been there.
3. **INFOMAR** multibeam (Geological Survey Ireland & Marine Institute), 2–5 m,
   relative to LAT, positive up (despite the CRS saying "LAT depth, down"),
   nodata 0 or −99999. Surveys used: Dublin north CB13_01, GEO13_01, GEO17_01,
   KRY17_01 (2013–17, VORF), CV03_01 (2003), KRY09_02 (2009), KRY10_01 (2010),
   GEO11_01 (2011), TON16_01, LIR17_02 (2016–17), GEO21_06 (2021), the same
   surveys cut again south of 53.34° N for Sandymount to Dún Laoghaire
   (`a4_dublinbay_south__*`; none of them sounds the flats); Brandon
   CB14_05, CV14_02, GEO14_03, KRY14_05 (2014), GEO17_03 (2017). Surveys before
   March 2011 were reduced with a Proudman tidal model rather than VORF and are
   on average 0.54 m deeper; the ones here are offshore (−4 to −26 m, always
   deep) so they are not shifted.
4. **INFOMAR bathymetric LiDAR**, Tralee Bay 2008 (Tenix LADS), 5 m, LAT: the
   shallows and lower beach of Brandon Bay and the Maharees (pre-VORF).
5. **GSI/OPW/TII topographic LiDAR** (2 m DTM, ITM, OD Malin): OPW 2011 and TII
   2010–11 round Dublin, OPW 2006–07 coastal round Brandon. Brought to LAT with
   the tide station's published offset (`z_LAT = z_Malin + odMalinOffsetMetres`;
   Howth 2.561, Fenit 2.677, from `force5/ingest/fetch_tides.py`, which defines
   the offset as LAT height − Malin height). A LiDAR sees the water's surface,
   not the bed: returns well above a bathymetric survey are dropped, and round
   Dublin, where the 2011 flight saw water at about −1.0 m OD (≈1.6 m LAT; the
   open sea's surface that day, in Dublin Port, Dún Laoghaire harbour and off
   Seapoint), so is anything at or under 1.65 m LAT. Inside a basin its own
   surface is used instead (`lidarWaterLat`: 4.0 m LAT in the Malahide lagoon).

### What was wrong at Sandymount (fixed 2026-10)

The flats off Sandymount and Merrion, which dry for a kilometre and more at
low water, were drawn deep blue. Sampled across them (metres above LAT):

| Point | LiDAR | EMODnet DTM | Built before | Built after |
| --- | --- | --- | --- | --- |
| Sandymount, upper beach (−6.207, 53.331) | 3.55 | – | 3.56 | 3.56 |
| Sandymount, 1 km out (−6.195, 53.329) | – (water in flight) | −3.99 | −3.81 | 2.09 |
| Sandymount, 2 km out (−6.184, 53.329) | – | −3.44 | −3.06 | 0.53 |
| Flats under the South Bull Wall (−6.180, 53.339) | 2.89 | −0.12 | 1.66 | 2.62 |
| Merrion Strand, 1 km out (−6.194, 53.317) | – | −1.65 | outside | 0.91 |
| Booterstown, 700 m out (−6.184, 53.309) | – | 0.39 | outside | 1.25 |

INFOMAR has no sounding on the flats at all, and the 2011 LiDAR stops a few
hundred metres out, where the flight met the water. So the merge fell back on
EMODnet's DTM, and EMODnet has no survey there either: its source references
name **GEBCO 2024** for a block of cells from −6.203 to −6.167 E, 53.302 to
53.339 N, and GEBCO's global grid draws a smooth hollow 2–11 m under LAT
across the sand. Worse, those cells seeded the waterline method's "under LAT"
walk, so the whole flat inside the satellite LAT line was taken for sea and
the waterlines never laid their 0–2.5 m surface over it. The datum was not at
fault: the LiDAR's beach at +3.5 to +4.2 m LAT sits where the chart puts the
upper strand (Howth's offset of 2.561 m against Dublin Port's 2.458 m is a
0.1 m difference here), and the tide station is not the issue either.

The fix: GEBCO-filled cells are dropped from the fallback (they are not a
sounding), and are not allowed to seed the sea; where the line-walk has to
guess round a line's open end, they still count as sea, not land. Inside the
LAT line the flats are now the waterlines' surface (0 at the LAT line rising
to 2.5 m at the MSL line), under the LiDAR's beach; outside it, between the
LAT line and the first real soundings, a strip is wet at every tide and
unsurveyed (now estimated, between the flats and the soundings). The area now reaches south to 53.287° N (Seapoint and Dún
Laoghaire), with the OPW 2011 and TII tiles there added to the LiDAR mosaic
and the INFOMAR surveys cut again for the band.

### A basin's own level: the Malahide lagoon

West of the railway viaduct the Broadmeadow estuary is held up by the weir
under it. The water passes through the viaduct's 180 m opening, so the lagoon
never drains below the weir's crest, and fills only part way and late as the
sea rises past it. Drawn from Howth's open-sea tide it was drained to the
sea's low water, its margins painted shallow or dry when they are fine to ride.

So it is a **basin**: a polygon in `areas.json` (under its area, with the
reasons for every number in `notes`), cut out of `dublin-north.pmtiles` into
`malahide-lagoon.pmtiles` from the same merged grid, and listed in
`index.json` before its area with a `level`:

```
level = floorLat + rangeFactor × max(0, tide(t − lagHours) − floorLat)
```

- `floorLat` **3.06 m**: the weir's crest, about +0.5 m OD Malin (Engineers
  Ireland, "The collapse and reconstruction of the Malahide viaduct", part 2,
  which also gives spring tides of +2.22 to −2.38 m OD and says neap high
  waters top the weir by only about 0.4 m), with Howth's offset.
- `rangeFactor` **0.6**: the owner's figures, about 1.8 m deep across the
  middle at low water and 2.5 m at high, a 0.7 m range, over the sea's rise
  above the crest on a spring tide at Howth (high water about 4.2 m):
  0.7 / (4.2 − 3.06).
- `lagHours` **1**: an estimate; nothing measured.
- The TII LiDAR saw a flat surface at +1.3 m OD (3.86 m LAT) under the M1 at
  the lagoon's west end: the lagoon's water, near the top of the range this
  model gives on a spring tide (3.06 + 0.6 × 1.3 ≈ 3.85 m). Returns at or
  under 4.0 m LAT inside the basin are taken for water (`lidarWaterLat`).
  The "1.65 m" the README gave for Dublin's LiDAR water is the open sea's
  surface in Dublin Bay, not the lagoon's: it is under the weir's crest.

Inside the basin only what saw the bed itself stands: a LiDAR's ground over
the lagoon's surface, and the satellite's heights where a pixel floods and
drains with the lagoon's level. The waterlines there were the lagoon's own
edge on the day read as if it were the sea's, and EMODnet's cells are coarse,
so they go. The satellite never sees the lagoon's middle dry (it never
drains), and no survey has sounded it: its bed is an estimate, the owner's
1.8 m under the weir's crest at low water (`bedEstimateLat` 1.26 m LAT) more
than `pinMetres` (60 m) from any height, filled from the rim's heights nearer
the shore. At the lagoon's low (3.06 m) the middle is 1.8 m deep and only the
rim dries, which is how the owner rides it; a tap says the depth is an
estimate. The client applies the level to the station's curve (`waterLevelAt`), builds the basin's ramp from it, and
reads a tapped point against it. Another impounded lagoon needs only a
polygon and a level.

Then the mask: OpenStreetMap's sea and shore (above), the dry ceiling (HAT
plus a margin: 5.0 m at Howth, 5.6 m at Fenit), the estimates, and the depth
cut. The pilots keep their own hand-set waterline levels and ceilings
(`areas.json`); the national regions take theirs from the stations' predictions
(`stations.json`: Howth's MSL 2.52 and MHW 3.95 m against the pilot's 2.5 and
3.8 m, Fenit's 2.76 and 4.28 m against 2.7 and 4.1 m).

Attribution, as the licences ask: "Contains Irish Public Sector Data
(Geological Survey Ireland, Marine Institute, the Office of Public Works &
Transport Infrastructure Ireland) licensed under CC BY 4.0"; "EMODnet
Bathymetry Consortium: EMODnet Digital Bathymetry (DTM 2024) and coastlines".

### What is missing

- **The Malahide inner estuary** (west of the railway viaduct, Kilcrea's
  water) has no open LiDAR or INFOMAR survey, and the satellite never sees it
  dry. Its bed is the owner's figure (above), flat where it is not known. A
  Fingal/OPW flood-study LiDAR, a drone survey or a few soundings at low
  water would replace it. Its level is a model, calibrated on one rider's
  figures and a 2009 description of the weir; a tide gauge in the lagoon for
  a fortnight would settle the floor, the range and the lag.
- **The pilots were rebuilt on 18 October** (`foildepth/vec09f9fbdb11/`):
  the 12 October build's LiDAR and INFOMAR survey downloads were lost from
  `/tmp`, and `fetch_pilots.py` fetched the same 108 LiDAR tiles and 17
  survey grids again from the same GSI portals (every file still there, the
  survey zips byte for byte the size they were) and cut them as that build
  did: the three LiDAR mosaics came out the same size, extent and range as
  before. Brandon's merged grid is the 12 October one: 99.0% of its heights
  identical, the rest estimates (above). Dublin's took the 15 October
  satellite run: of the heights both builds measured, 65% are identical,
  2.6% moved by more than 0.25 m and 1.0% by more than 0.5 m, most of it the
  marsh tops round Bull Island's lagoon (about 0.6 m lower) and Rogerstown's
  south shore; at the README's check points (Malahide's table, Sandymount's)
  the heights moved by 0.12 m at most, and the mask checks hold. Where the
  pilots' grids run on past their boxes the regions round them take them as
  a source, so the chunks of Howth, Dublin Port, Skerries, Bray, Fenit and
  Dingle were built again. Brandon takes no satellite heights (`areas.json`
  has none for it): its foreshore is the 2008 bathymetric LiDAR and the OPW
  LiDAR, which are better there.
- **North of the Dublin box** (Rogerstown, drawn by the Skerries region),
  the pilot's grid, which the region takes as its most trusted source, holds
  heights in Howth's terms (`to_station`), not Skerries'. Up to 53.52° N,
  where the grid ends, a bank there reads 0.2–0.5 m low on Skerries' tide
  (more the higher it is); the 17 October set had the same. Cutting the
  pilot grid to its box for the regions, or moving it back to each region's
  station, would fix it.
- **A basin is drawn on its station's tide, not its own.** The heights
  inside the 31 lag basins are right (each was read against its own lagged
  tide), but the map draws them with the region's station's curve, so in
  Lough Swilly or up the Shannon the water's edge at an hour is where it
  would be 20–110 minutes earlier. Drawing a basin on its lag needs the
  basins as areas of their own (as the Malahide lagoon is: a `level` with
  `lagHours`), cut out of their regions.
- Where a satellite tile's edge, or the edge of what it saw, ends on a flat,
  the 80 m feather into the waterlines shows as a change of colour across it.
- **The band under the lowest tide the satellite saw** (0.57 m LAT after the
  bias) is the surveys' where they have it and an estimate held under 0.57 m
  where they have not (the outer Malahide channel's banks, the strip off
  Donabate): S2 passes near midday, when spring low water never falls here.
- Off **Merrion and Booterstown** the strip between the LAT line and the
  first soundings is an estimate, under LAT, filled between the flats and the
  soundings.
- The tide is **one station's astronomical prediction** for the whole area: no
  surge, no waves, and no lag or damping in the open estuaries (inside one low
  water is later and higher than at Howth); only the basins have a level of
  their own. Sandymount uses Howth too: Dublin Port's low waters agree with
  Howth's to a few centimetres, its high waters are about 0.15 m lower and
  5–10 minutes later, which matters little on a flat that dries at half tide.
- LAT from OD Malin is one constant per station, not a modelled surface (a
  VORF-style separation model would be better).

Nationally:

- **Flats with only EMODnet's DTM read too deep.** Where INFOMAR has not
  flown and the satellite LAT line is broken, a drying flat is taken for
  "under LAT" and keeps the DTM's coarse 115 m heights, around LAT or under
  it, so it is drawn as water at low tide though it dries: Dungarvan's inner
  harbour (−1.1 to −0.2 m where it dries), the Fergus estuary in the Shannon
  (−4 m), Dundalk Bay (−1 to +0.8 m), the flats inside Raven Point at
  Wexford. INFOMAR or OPW LiDAR over them, or a stricter rule for what the
  waterlines may call "under LAT", would fix them. Where INFOMAR's 10 m grid
  reaches (most of the bays), the heights are surveys.
- **Topographic LiDAR** (GSI/OPW/TII 2 m tiles) is used in the pilots only.
  It is practical to pull in bulk (tile indexes and zips on GSI's server, as
  for the pilots) but it sees the water's surface where it was flown, so
  each flight needs its water level checked (`waterLevelLat`); left for
  later. It would add the upper foreshore and beaches that INFOMAR's grid
  leaves to the waterlines.
- **Northern Ireland's surveys are not open enough.** The UK Hydrographic
  Office holds 2 m multibeam of nearly the whole coast under the Open
  Government Licence (the Civil Hydrography Programme's HI1811 of 2024–25,
  Lough Foyle to Carlingford; HI1745, HI1747 Dundrum Bay, HI1377 and HI1353;
  Belfast Lough's port surveys at 1 m), but its seabed mapping service
  (seabed.admiralty.co.uk) gives the files only to a signed-in account
  (`POST …/api/features` answers 401 without one; the index,
  `GET …/api/featuremetadata`, is open). With an account they would replace
  EMODnet's 115 m cells round the whole coast, Belfast Lough and Strangford
  included: the next step. EMODnet's DTM there is mostly GEBCO's fill
  (`keepDeeperThan` above), so between the beaches and the 10 m line the bed
  is the satellite's and an estimate. DAERA's 2021 coastal survey (0.25 m
  topographic LiDAR of the whole intertidal, satellite-derived bathymetry to
  8–11 m, bathymetric LiDAR of Dundrum Bay, all OGL) is published only as
  colour tile services and I3S point clouds, with no stated vertical datum;
  the source grids would be worth asking DAERA for.
- **Northern Ireland's tides are our own**: Portrush and Bangor fitted to a
  month of the Environment Agency's gauges, the rest EOT20 at a point
  (`scripts/tides`). EOT20's cells off the Down coast are 14 km across, so
  Portavogie, Killard Point, Ardglass and Dundrum Bay are nearly one curve
  (HAT 6.2 m, MSL 3.15 m over its own LAT at Killard, where the Admiralty's
  secondary-port figures give MSL about 2.5 m over chart datum: the model's
  range there looks too large). The satellite's heights were measured against
  the same curve, so the foreshore's depths hold; EMODnet's soundings and the
  LiDAR are brought in on the chart's or OD's own levels, so under the low
  tides the Down coast's depths may be some tenths of a metre off.
- **Strangford Lough** is drawn on Killard Point's tide 100 minutes later at
  Killard's range: no open gauge inside the Narrows says how much smaller the
  lough's range is. The satellite saw its flats dry no lower than 1.0 m over
  that LAT, so the lough's lower flats and channels are the band under the
  lowest tide seen (estimated, held under 0.75 m). Its basins (Killard_LAG1 in
  inner Dundrum Bay, Killard_LAG2 at the Narrows' inner end, Strangford_LAG1)
  are drawn on their region's tide, not their own lag.
- **The satellite and OSNI's LiDAR disagree by about 0.3 m** in Northern
  Ireland (above); which is off is not known.
- **One tide per station cell**: the cells are straight-line Voronoi, so a
  bay can take the tide of a station across a peninsula (Bantry's head is on
  Union Hall's, not Castletownbere's), and a long estuary its mouth's
  (Kilrush's tide up the Shannon; Buncranna's in inner Lough Foyle). Five
  more ERDDAP stations (Wicklow, Carrigaholt, Inishmore, Killary Harbour, Tom
  Clarke Bridge) are not in tides.json because no spot is near them; adding
  them to the tide ingest would refine the cells.
- **The coastline is OSM's**, so the layer is as good as OSM there: it is
  mapped at about mean high water from imagery, and in Ireland it is
  generally close, but a flat mapped inland of it only as land (not as
  `wetland=tidalflat`, beach or marsh) is not drawn, and a breakwater or pier
  not in the coastline is drawn over as water. Ground behind walls is land
  now (Sandymount village, which the old rules let in through the Dodder).
  Fixes go to OSM, and the next build takes them.
- **Impounded lagoons** other than Malahide's: Lady's Island Lake and
  Tacumshin are behind shingle bars in OSM and are not drawn; Inch Lake on
  Lough Swilly, where it is joined, is drawn on the open sea's tide.
- Where two regions meet, the tide steps from one station's to the next:
  the colours can change across the line. Each region's archive writes the
  water past its edge as deep, so with linear sampling each side fades out
  over the half pixel at the line (and a pilot's box edge, and the viaduct
  between the lagoon and its area, the same): on a flat at high zoom a faint
  seam, not a line of colour.

## Rebuilding

Downloads go in a directory of their own, outside the repo, and **not under
`/tmp`**: macOS empties it of files untouched for three days, which took every
input of the 12 October build (the national downloads, and the pilots'
LiDAR and INFOMAR surveys fetched by hand). The October 17 build kept its own
under `/Volumes/workdrive/foildepth-gradient/` (`data/`, `work/`, `out/`,
`pilots/`), and the pilots' inputs, fetched again on 18 October, are in
`pilot-data/` there (1.8 GB: the downloads, 873 MB, and what is cut from
them), with `manifest.json` naming every download's URL, size and SHA-256.
The 18 October set was built from `data-rebuild/` (`data/` with the new
pilot grids), `work-rebuild/`, `pilots-rebuild/` and `out-rebuild/`.
Northern Ireland's (also 18 October) is under `/Volumes/workdrive/foildepth-ni/`:
`data/` (links to the national data, with its own `satellite/` and
`infomar-surveys/` and `osni-lidar/` from `data-dl/`), `work/` (the 17
October chunks with the 46 round Northern Ireland built again), `out/`,
`set/` (what was published), and `satellite/` (the satellite run's seven
tiles restationed, and the intertidal set cut again). Python 3 with
numpy, scipy, rasterio, pyproj, pillow and pmtiles, and boto3 to upload (a
scratch venv is fine); run it isolated (`python -I`).

The national regions (about 3 GB of RAM a worker; ~45 minutes with 3):

OpenStreetMap first (the mask; `osm.py` needs pyshp and osmium (pyosmium)
for this step only), and the satellite heights where there are some:

```sh
mkdir -p $DL/osm-land $DL/osm-pbf   # downloads, a directory of their own
curl -L -o $DL/osm-land/land-polygons-split-4326.zip https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip
curl -L -o $DL/osm-pbf/ireland.osm.pbf https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf
unzip -d $DL/osm-land/x $DL/osm-land/land-polygons-split-4326.zip
python -I osm.py extract --land $DL/osm-land/x/land-polygons-split-4326/land_polygons.shp \
    --pbf $DL/osm-pbf/ireland.osm.pbf --out $DATA/osm      # ~1 minute; 3,698 land polygons, 7,407 tidal features
python -I satellite.py from-archives --set <satellite root>/out/intertidal --out $DATA/satellite
    # the national run's set (the one public/intertidal/index.json names): 66 files, ~1 minute
```

(`from-rockspilot` still turns the rocks pilot's own heights into the same
form, for a pilot built before the national run.)

Both the pilots' and the regions' data directories need `osm/` and
`satellite/` (a link to one copy is fine).

```sh
N=/Volumes/workdrive/foildepth-gradient
python -I fetch_national.py --data $N/data --tides-json ../../public/marine/tides.json   # tides, emodnet, coastlines, infomar, surveys, osni-lidar
# tides-ni: Northern Ireland's stations alone (force5/ingest/tides_ni.py), the Marine Institute's kept
# A change of stations needs only the chunks it touches rebuilt (and those under a new source's files):
python -I national.py --data $N/data --work $N/work affected --was <the stations.json before>   # prints --only x,y ...
python -I national.py --data $N/data --work $N/work chunks --jobs 3   # resumable; --only x,y --force for one
python -I national.py --data $N/data --work $N/work assemble --out $N/out
```

The pilots, then the index of both, then the bucket and the repo:

```sh
D=$N/pilot-data
python -I fetch_pilots.py --data $D        # ~10 minutes; resumable; writes $D/manifest.json
ln -s $N/data/infomar10 $N/data/osm $N/data/satellite $D/
python -I build.py --data $D --out $N/pilots [--area dublin-north] --debug $N/pilots-debug
cp $N/pilots-debug/dublin-north.tif $N/pilots-debug/brandon.tif $N/data/pilots/
# The regions' `pilots/*.tif` source is build.py's --debug grids of the same
# pilots (only those: not the -sat-minus-lidar grid beside them). Rebuild the
# chunks they reach (Howth, Dublin Port, Skerries, Bray: 493–495,331–332;
# Fenit, Dingle, Kilrush: 482–484,336–337), then assemble and index.
python -I national.py --data $N/data --work $N/work chunks --force --only 494,331 ...
python -I national.py --data $N/data --work $N/work assemble --out $N/out
python -I national.py --data $N/data --work $N/work index --out $N/out --pilots $N/pilots
python -I publish.py --set $N/out --bathy public-data/bathy/v…/ireland.pmtiles \
    --env /path/to/deploy/home-compute/.env --upload
node shots.mjs http://127.0.0.1:5173 $N/shots kilcrea 2 2026-10-08T06:00:00Z   # a look by eye, with the app running
```

`publish.py` names the set by its content (`foildepth/v<12 hex>/`), adds the
archives and the index to the bucket (`S3_BUCKET`, the one behind
https://data.wingfoil.ie) with `Cache-Control: public, max-age=31536000,
immutable`, never overwriting or deleting anything, and refusing any key
outside `foildepth/v…/` and `bathy/v…/`; then it writes the site's
`public/foildepth/index.json` (with that `base`), the offline copies in
`public-data/` (the pilots and the bathymetry, committed) and `BATHY_PATH`.
An old version stays in the bucket for any page still holding the old index;
nothing sweeps it (`force5/ingest/prune.py`'s STATIC_ROOTS keep the hourly
sweep off both prefixes, `test_prune.py` StaticDataTest proves it).

The dev server serves `public-data/` at the same paths, by range, and fetches
an archive that is not on disk (a region) from the data host; copy a set's
`tide-*.pmtiles` into `public-data/foildepth/v…/` to work offline (they are
git-ignored there). The e2e site stages the committed pilots only, and
`e2e/foil-national.spec.ts` routes its own fixture region.

`build.py` takes 3–4 minutes an area, and writes an area's basins with it.
`--debug` writes each merged grid as a GeoTIFF (EPSG:3857) to look at.
`python -I test_build.py` checks the gap-fill, basin, depth-cut, reserved
values, partition, lake, index and publish pieces on toy grids, and the OSM
mask (a field never draws, a lagoon is always water), the estimates, the
padding and the satellite merge. `python -I spotcheck.py --set <set> --check`
reads the built set at the Malahide places it was found wrong and fails if a
field draws or the lagoon does not.

Where the data came from (2026-10):

- INFOMAR survey grids: the download portal linked from <https://www.infomar.ie/data>,
  whose footprint layers give direct zips,
  `gsi.geodata.gov.ie/server/rest/services/Marine/IE_GSI_MI_Marine_Download_Seabed_Survey_{Leg,Merged}_Data_IE_Waters_WGS84/FeatureServer/0/query`,
  files under `gsi.geodata.gov.ie/downloads/Marine/Data/Downloads/<year>/<survey>/`.
  `maps.marine.ie` answered 503 throughout; the merged 10 m grid is also an
  ImageServer at `gsi.geodata.gov.ie/imagehost/…/IE_GSI_MI_Bathymetry_10m_Inshore_IE_WGS84_LAT_GRID`.
- LiDAR: GSI's tile indexes, zips under `gsi.geodata.gov.ie/downloads/LIDAR/`
  (TII) and `…/LiDAR/OPW_NASC/` and `…/lidar/OPW_*` (OPW). The GSI image
  services serve shaded relief only, not heights.
- EMODnet: `ows.emodnet-bathymetry.eu` WCS and WFS, as in the two fetch scripts.

`fetch_pilots.py` holds the pilots' lists: the LiDAR tiles (every OPW_NASC
2011, OPW 2006–07 and TII 2010–11 tile the GSI coverage layers put in the
first build's boxes, and those the Sandymount extension added), the 17 survey
zips, the boxes each is cut to, and the order the mosaics take the tiles in.
They were read back out of the 10 October build's own session. All of them
were still on GSI's server on 18 October; the one zip packed with Deflate64
(KRY17_01) is unpacked with `unzip`.

To add a pilot area: a box, its station and offset (`public/marine/tides.json`), its
dry ceiling and waterline levels, and its sources in `areas.json`; then build
it with `--area` (pilots.json keeps the others), rebuild the regions' chunks
that touch its box (they cut it out), and index and publish again.
