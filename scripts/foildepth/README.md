# Foilable depth round the coast of Ireland

A map layer (on by default) that shows, at the forecast hour the dock has
selected, where the water is deep enough to wing-foil:

- **blue**: deep enough, the bed at least the clearance (1 m, `FOIL_CLEARANCE_METRES`) under the tide;
- **pale blue**: wet, but too shallow for the mast;
- **grey-brown**: dry at this tide (sand and mud flats);
- **mid blue**: wet at every tide, but no survey says how deep.

The seabed and foreshore do not change, so they are built once, here, into
elevation archives. The tide makes it dynamic in the browser:
`depth = tide − z`, both in metres above Lowest Astronomical Tide (LAT).

Two kinds of archive:

- **33 national regions** (`national.py`, `national.json`): the whole coast,
  cut into one region per tide station of `public/marine/tides.json` (the
  station's Voronoi cell), z6–13, from EMODnet's DTM and satellite waterlines
  and INFOMAR's merged 10 m inshore grid. Each is drawn with its own
  station's tide.
- **3 pilot areas** (`build.py`, `areas.json`): Dublin north, its Malahide
  lagoon basin, and Brandon Bay, z10–14, with LiDAR and the individual
  INFOMAR surveys. They win where they are.

Each archive holds raster-dem tiles: Terrarium RGB (`m = R·256 + G + B/256 − 32768`)
in **lossless** WebP (a lossy one would corrupt the heights), 512 px. Heights
are quantised to 1/32 m. Only the water a rider needs is kept: from the dry
ceiling down to **5 m under LAT** (`floorMetres: -5`). Three values are
reserved: **−20 m** (`deepMetres`) is water deeper than that, deep enough at
every tide; **50 m** is not water (land, or ground cut off from the sea); both
are drawn as nothing, but a tap tells them apart. **40 m** is water of
unsurveyed depth. Tiles with nothing to draw (only land and deep water) are
left out of the archive.

## The depth cut

Anything deeper than 5 m under chart datum is foilable at every tide, so its
height is not kept: it is written as the deep value, drawn as nothing, and the
chart's own depth tints carry it. Before, heights were clamped at −6 m and the
sea kept out to 1.5 km from the shore; now the layer hugs the coastline and
the shallow banks (the Arklow Bank, the Shannon's flats), however far out they
are, and stops at the 5 m line: its edge is the seabed's contour, never a
distance from the shore or a box. Unsurveyed water (under the satellite LAT
line, no sounding) is judged by the size of each stretch of it
(`maxUnsurveyedKm2`, 5 km²): a lagoon or the strip off a flat is drawn as
unsurveyed; a larger stretch is a gap in the surveys out at sea (where
EMODnet only had GEBCO) and is taken for deep. The 1.5 km band that did this
before left circles round Lambay and a straight cut at Portrane.

What counts as foreshore is decided the same way, by height and not by box:
the sea reaches up through ground that floods at a spring tide (to MHW +
0.5 m, `marshAboveMhwMetres`), and above that, up to the dry ceiling, only an
upper beach within 60 m of it (`upperBeachMetres`). Fields and streets at
3–5 m LAT joined to the shore through a chain of low ground (Sandymount
village, the land round the Malahide and Rogerstown estuaries, EMODnet's
coarse land behind a broken MHW line) are land. The pilots' old box edge had
been hiding this: it cut those chains off.

The colours put the weight on the shallows: "deep enough" is only a faint
wash of blue (`--map-foil-deep`, 16% opacity), so the chart's tints and
soundings read through it; "too shallow" is a strong blue and "dry" the
grey-brown, and where the water becomes rideable is where the strong blue
gives way to the wash.

The edge is a **short fade**: the ramp (`foilRamp` with `deep`) draws nothing
from −20 m up to −5 m and fades the deep colour in between −5 and −4 m
(`FOIL_FADE_METRES`). MapLibre interpolates heights between pixels, so the
last height kept and a deep pixel beside it run down through the fade: the
edge is soft and passes through no colour that is not there. A clean edge
(`fade: 0`) drew the 5 m line as a hard blue contour that read as a feature
of the seabed (a shelf, a channel edge); the fade reads as "deeper, not
drawn" (screenshots of both were compared at Rusheen Bay and Clew Bay).

Where an archive leaves a pixel out (another region's, or past a pilot's
box), it writes the deep value if there is water there of any kind, else
land (`edge_value`): the deep value and land side by side would interpolate
through every colour (a hairline), so they meet only where water meets land
anyway. The pilots are built a little past their boxes, and that grid is the
national regions' most trusted source, so at a box's edge the pilot and the
region hold the same heights and the seam does not show.

## How the map uses it

- `force5/src/foilDepth.ts`: the pure parts. `foilRamp(tide, colours, …)`
  builds the `color-relief-color` interpolate on `["elevation"]` whose stops are
  `tide − clearance`, `tide` and the area's dry ceiling (MapLibre wants literal
  stops, so the ramp is rebuilt and set with `setPaintProperty` as the hour
  moves; that is a small texture upload, not a re-tile). Also the datum
  conversion (`malinToLat`), the class rule (`foilClass`), Terrarium decoding,
  a basin's level (`basinLevel`, `waterLevelAt`: see below) and the
  tapped-point wording.
  With the index's `deepMetres` the ramp draws nothing from it up to the floor
  (−5 m) and fades the deep colour in over the next metre
  (`FOIL_FADE_METRES`): see "The depth cut" below.
- `force5/src/WindMap.tsx`: one `raster-dem` source and `color-relief` layer
  per area in view, under the rivers, the coast's ink and the names. A layer
  shows from half a zoom under its archive's min zoom: MapLibre rounds a
  raster's zoom to the nearest whole one, so that is where its tiles start
  (and where a region's cut-out for a pilot's box starts).
- `src/useFoilDepth.ts`: loads `index.json` (from the site) the first time
  the layer is on, and the tide curve (`tideForStation` in
  `force5/src/tides.ts`) of each station whose area comes into view, once,
  never all 33 up front. `foilArchiveUrl` puts an archive under the index's
  `base` on the data host (`forecastUrl`, `force5/src/urls.ts`).
- `src/App.tsx`: the areas over the chart's view (`areasInView`), the water
  level at the dock's selected column (`tideAt`, and a basin's
  `waterLevelAt`), the layer switch (Layers → Chart → "Foilable depth at the
  tide", on by default), the key (`src/FoilLegend.tsx`, in the map's
  information dialog, not on the chart), and a tapped point's water
  (`force5/src/foilProbe.ts` reads one pixel out of the archive). `areasAt`
  says which archives may hold a point: inside a pilot's box the pilots only
  (a basin first: the first with water under the point is the side of the
  weir it is on); elsewhere the one region whose station is nearest, as the
  regions were cut. A point can read as a height, unsurveyed, deeper than
  5 m ("deep enough at any tide"), land, or, where the archive has no tile,
  nothing drawn.
- The colours are `--map-foil-*` in `ui/theme.css`.
- `force5/src/archives.ts`: how the map and the probe read every archive
  (these and the bathymetry). Byte ranges where the host serves them (vite,
  Caddy, R2); where it answers a range with a 200 and the whole file, as
  Cloudflare Pages does, the file is kept and read from memory. The archives
  are now all on the data host (R2, ranges), so a visitor fetches only the
  tiles in view. `e2e/foil-depth.spec.ts` draws the pilots from both kinds of
  host; `e2e/foil-national.spec.ts` draws a routed fixture region
  (`e2e/foildepth/tide-galway.pmtiles`, `fixture.py`), taps it, and checks
  that a region out of view has neither its archive nor its tide fetched.

## The national regions

The coast is cut by tide station: every pixel belongs to its nearest station
of `public/marine/tides.json` (the 33 the site already publishes curves for),
decided per 4×4 pixels on the global z13 grid so a pixel gets the same answer
in any chunk, and is left out if it is further than 45 km from all of them
(`maxStationKm`). Each region is one archive, z6–13 (512 px tiles: ~5.8 m a
pixel at z13, 53°N; z6–9 are overviews, the mean of the heights under each
pixel, so the coast shows on the all-Ireland view), drawn on its own
station's curve with its own ramp. A point is read from the region whose
station is nearest (`stationLonLat` in the index), as the cells were cut.

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
| `tide-achill-island` | Achill Island | 2.43 / 3.77 / 4.69 | 5.0 | 131 | 1.79 MB |
| `tide-aranmore` | Aranmore | 2.22 / 3.43 / 4.50 | 4.8 | 113 | 1.68 MB |
| `tide-arklow` | Arklow | 0.89 / 1.15 / 1.64 | 2.0 | 76 | 0.44 MB |
| `tide-ballycotton` | Ballycotton | 2.34 / 3.78 / 4.57 | 4.9 | 51 | 0.57 MB |
| `tide-ballyglass` | Ballyglass | 2.17 / 3.33 / 4.36 | 4.7 | 169 | 2.00 MB |
| `tide-bray-harbour` | Bray Harbour | 2.19 / 3.45 / 4.27 | 4.6 | 60 | 0.24 MB |
| `tide-buncranna` | Buncranna | 2.44 / 3.77 / 4.96 | 5.3 | 202 | 3.35 MB |
| `tide-castletownbere` | Castletownbere | 1.93 / 3.08 / 3.84 | 4.2 | 259 | 2.33 MB |
| `tide-clare-island` | Clare Island | 2.51 / 3.90 / 4.83 | 5.2 | 72 | 0.77 MB |
| `tide-crosshaven` | Crosshaven | 2.06 / 3.36 / 4.09 | 4.4 | 42 | 0.18 MB |
| `tide-dingle` | Dingle | 2.28 / 3.55 / 4.47 | 4.8 | 163 | 1.24 MB |
| `tide-dublin-port` | Dublin Port | 2.47 / 3.82 / 4.66 | 5.0 | 6 | 0.01 MB |
| `tide-dungarvan` | Dungarvan | 2.15 / 3.44 / 4.20 | 4.5 | 67 | 0.51 MB |
| `tide-dunmore` | Dunmore | 2.38 / 3.77 / 4.59 | 4.9 | 115 | 1.25 MB |
| `tide-fenit` | Fenit | 2.76 / 4.28 / 5.42 | 5.8 | 81 | 0.96 MB |
| `tide-galway` | Galway | 3.00 / 4.61 / 5.79 | 6.1 | 75 | 1.80 MB |
| `tide-howth` | Howth | 2.52 / 3.95 / 4.86 | 5.2 | 11 | 0.02 MB |
| `tide-killybegs` | Killybegs | 2.30 / 3.53 / 4.63 | 5.0 | 154 | 1.59 MB |
| `tide-kilrush` | Kilrush | 2.96 / 4.56 / 5.67 | 6.0 | 180 | 2.24 MB |
| `tide-kinsale` | Kinsale | 2.01 / 3.29 / 4.00 | 4.3 | 62 | 0.48 MB |
| `tide-lahinch` | Lahinch | 2.68 / 4.20 / 5.17 | 5.5 | 108 | 1.06 MB |
| `tide-letterfrack` | Letterfrack | 2.51 / 3.90 / 4.83 | 5.2 | 194 | 2.67 MB |
| `tide-malin-head` | Malin Head | 2.12 / 3.21 / 4.20 | 4.5 | 112 | 0.94 MB |
| `tide-port-oriel` | Port Oriel | 2.95 / 4.65 / 5.72 | 6.1 | 141 | 1.83 MB |
| `tide-ringaskiddy` | Ringaskiddy | 2.29 / 3.78 / 4.54 | 4.9 | 49 | 0.70 MB |
| `tide-roonagh` | Roonagh | 2.48 / 3.81 / 4.83 | 5.2 | 78 | 1.56 MB |
| `tide-rossaveel` | Rossaveel | 2.81 / 4.35 / 5.49 | 5.8 | 168 | 3.87 MB |
| `tide-rosslare` | Rosslare | 1.13 / 1.73 / 2.26 | 2.6 | 64 | 0.46 MB |
| `tide-skerries` | Skerries | 2.87 / 4.47 / 5.47 | 5.8 | 40 | 0.49 MB |
| `tide-sligo` | Sligo | 2.30 / 3.56 / 4.67 | 5.0 | 131 | 2.08 MB |
| `tide-tory-island` | Tory Island | 2.30 / 3.60 / 4.56 | 4.9 | 80 | 0.77 MB |
| `tide-union-hall` | Union Hall | 1.93 / 3.21 / 3.93 | 4.3 | 119 | 1.21 MB |
| `tide-wexford` | Wexford | 0.89 / 1.46 / 1.97 | 2.3 | 78 | 0.47 MB |

Howth's and Dublin Port's regions are small because the Dublin pilot covers
most of their cells from z10 up. The set (`foildepth/vb2f7a0ca40ae/`) is 36
archives and its index: the regions 41.6 MB, the pilots 6.4 MB (dublin-north
2.65, brandon 3.62, malahide-lagoon 0.12 MB), the index 38 kB; with the
bathymetry (`bathy/v7a4f9286f579/`, 11.5 MB), 38 objects and 59.5 MB in the
bucket. A visitor fetches only the tiles in view, from R2 by range.

### National sources (all CC BY 4.0), in order of trust

1. **EMODnet Bathymetry DTM 2024** (`emodnet:mean`, 1/16′ ≈ 115 m), fallback,
   fetched in 1° tiles; its intertidal 0 fill dropped, and the cells its
   source references (`emodnet:source_references`, release 2024) give to
   GEBCO dropped too (`gebco2024.json`, 230 polygons over Ireland, fetched with
   a CQL filter).
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
4. **The pilot areas' merged grids** (below), where they are.

Attribution: "Contains Irish Public Sector Data (Geological Survey Ireland &
Marine Institute) licensed under CC BY 4.0"; "EMODnet Bathymetry Consortium:
EMODnet Digital Bathymetry (DTM 2024) and coastlines"; "Tidal predictions ©
Marine Institute, CC BY 4.0".

### Coverage

- **Republic**: every coast within 45 km of a station, islands included
  (Aran, Achill, Clare Island, the Blaskets' sounds, Tory, Inishowen), and the
  bays and estuaries: Shannon (Kilrush's tide to above Foynes), Galway Bay,
  Clew Bay, Killala, Sligo and Donegal Bays, Lough Swilly, Lough Foyle,
  Bantry and Kenmare Bays, Cork Harbour, Dungarvan, Waterford and Wexford
  Harbours, Dundalk Bay and Carlingford Lough. INFOMAR's 10 m grid covers
  most bays (multibeam and LiDAR); the open coast between them and the
  smaller inlets have only EMODnet's DTM and the waterlines.
- **Northern Ireland**: EMODnet's DTM and waterlines reach it, INFOMAR's grid
  does not (only Lough Foyle and Carlingford, shared). But no station in
  tides.json is near most of it, and the tide there is not like any nearby
  one (a degenerate amphidrome off Antrim, Strangford's narrows), so only
  Lough Foyle (Buncranna, Malin Head), Carlingford Lough and the Mourne coast
  to about Annalong (Port Oriel) are drawn. Portrush round to Dundrum Bay,
  Belfast Lough and Strangford Lough wait for a station.

## The pilot areas: sources (all CC BY 4.0)

In order of trust; a later one wins where it has data, feathered over 12 px.

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
unsurveyed. The area now reaches south to 53.287° N (Seapoint and Dún
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

The margins' heights are still the waterlines' (0, 2.5 and 3.8 m at the
satellite LAT, MSL and MHW lines): at the lagoon's low (3.06 m) everything
inside the MSL line is a metre or more deep and only the rim near the MHW
line dries, which is how the owner rides it. The client applies the level to
the station's curve (`waterLevelAt`), builds the basin's ramp from it, and
reads a tapped point against it. Another impounded lagoon needs only a
polygon and a level.

Then the mask: ground at or under the area's dry ceiling (HAT plus a margin:
5.0 m at Howth, 5.6 m at Fenit) and connected to water a survey sounded under
LAT; small no-data holes inside the water become "unsurveyed"; and the depth
cut (above). The pilots keep their own hand-set waterline levels and ceilings
(`areas.json`); the national regions take theirs from the stations' predictions
(`stations.json`: Howth's MSL 2.52 and MHW 3.95 m against the pilot's 2.5 and
3.8 m, Fenit's 2.76 and 4.28 m against 2.7 and 4.1 m).

Attribution, as the licences ask: "Contains Irish Public Sector Data
(Geological Survey Ireland, Marine Institute, the Office of Public Works &
Transport Infrastructure Ireland) licensed under CC BY 4.0"; "EMODnet
Bathymetry Consortium: EMODnet Digital Bathymetry (DTM 2024) and coastlines".

### What is missing

- **The Malahide inner estuary** (west of the railway viaduct, Kilcrea's
  water) has no open LiDAR or INFOMAR survey. The satellite LAT line says it
  holds water at every tide (the weir under the viaduct holds it up), so it is
  drawn "unsurveyed", with its rim from the waterlines. A Fingal/OPW flood-study
  LiDAR, a drone survey or a few soundings at low water would fill it. Its
  level is a model (above), calibrated on one rider's figures and a 2009
  description of the weir; a tide gauge in the lagoon for a fortnight would
  settle the floor, the range and the lag.
- **The outer Malahide flats, North Bull/Baldoyle and Sandymount** come from
  the waterlines, not a survey: right in shape, ±0.5 m or so in height. Off
  Merrion and Booterstown the strip between the LAT line and the first
  soundings is drawn unsurveyed (deep blue), though it is probably only a
  metre or less under LAT.
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
- **Northern Ireland's east and north coasts** wait for a tide station
  (above). EMODnet's data is there; the UK's own predictions are not open.
- **One tide per station cell**: the cells are straight-line Voronoi, so a
  bay can take the tide of a station across a peninsula (Bantry's head is on
  Union Hall's, not Castletownbere's), and a long estuary its mouth's
  (Kilrush's tide up the Shannon; Buncranna's in inner Lough Foyle). Five
  more ERDDAP stations (Wicklow, Carrigaholt, Inishmore, Killary Harbour, Tom
  Clarke Bridge) are not in tides.json because no spot is near them; adding
  them to the tide ingest would refine the cells.
- **Ground defended by walls** that a 2 m LiDAR does not resolve is taken
  for foreshore where it is under the dry ceiling and joins the tide through
  low ground: a few streets of Sandymount village (about 0.2 km², 3.5–4.6 m
  LAT, joined through the tidal Dodder) still show as drying ground. A
  polygon of defended land per place (as the basins have) would settle it.
- **Impounded lagoons** other than Malahide's (Inch Lake on Lough Swilly,
  Lady's Island and Tacumshin) are drawn on the open sea's tide.
- Where two regions meet, the tide steps from one station's to the next:
  the colours can change across the line. And where a tile holds the region's
  edge, the half pixel at it fades; at native zoom it does not show.

## Rebuilding

Downloads go in a directory of their own, outside the repo. Python 3 with
numpy, scipy, rasterio, pyproj, pillow and pmtiles, and boto3 to upload (a
scratch venv is fine); run it isolated (`python -I`).

The national regions (about 3 GB of RAM a worker; ~45 minutes with 3):

```sh
N=/tmp/wf-foildepth-national
python -I fetch_national.py --data $N/data --tides-json ../../public/marine/tides.json   # tides, emodnet, coastlines, infomar
python -I national.py --data $N/data --work $N/work chunks --jobs 3   # resumable; --only x,y --force for one
python -I national.py --data $N/data --work $N/work assemble --out $N/out
```

The pilots, then the index of both, then the bucket and the repo:

```sh
D=/tmp/wf-foildepth/data
sh fetch-emodnet.sh    $D/emodnet    dublin-north -6.30 53.27 -5.96 53.52
sh fetch-emodnet.sh    $D/emodnet    brandon     -10.22 52.18 -9.78 52.38
sh fetch-coastlines.sh $D/coastlines dublin-north -6.27 53.28 -5.99 53.50
sh fetch-coastlines.sh $D/coastlines brandon     -10.18 52.22 -9.83 52.35
# INFOMAR and the LiDAR by hand, from the portals below, cut to the areas'
# boxes into $D/infomar/clipped/ and $D/lidar/{dub,mal,bran}/ (see areas.json
# for the names it globs). The Dublin LiDAR mosaic reaches 53.285° N: OPW
# 3235–3237, 3257–3259, 3282–3284, 3311–3312, 3335–3336, 3355–3356 and TII
# 2472, 2493–2494, 2502–2503, 2509–2510, 2522 joined the first build's tiles.
python -I build.py --data $D --out $N/pilots [--area dublin-north] [--debug /tmp/wf-foildepth/debug]
python -I national.py --data $N/data --work $N/work index --out $N/out --pilots $N/pilots
python -I publish.py --set $N/out --bathy public-data/bathy/v…/ireland.pmtiles \
    --env /path/to/deploy/home-compute/.env --upload
node shots.mjs http://127.0.0.1:5173 /tmp/wf-foildepth/shots kilcrea 2   # a look by eye, with the app running
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
values, partition, lake, index and publish pieces on toy grids.

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

To add a pilot area: a box, its station and offset (`public/marine/tides.json`), its
dry ceiling and waterline levels, and its sources in `areas.json`; then build
it with `--area` (pilots.json keeps the others), rebuild the regions' chunks
that touch its box (they cut it out), and index and publish again.
