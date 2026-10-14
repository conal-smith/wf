# Satellite imagery at high and low tide, and intertidal heights

Two products from one national pass over Sentinel-2 L2A, 2017-01 to 2026-10:

1. **Imagery** for the map's Layers panel, Satellite: **High tide** / **Low tide**
   (`force5/src/satellite.ts`). Natural colour over the whole island and 5 km
   of sea. Round the coast, each pixel is the median of the clear looks taken
   when the tide at its station was in the top fifth (high) or the bottom fifth
   (low) of the levels seen at Sentinel-2's overpass; inland, both share one
   summer composite. Our own composites of open Copernicus data: free to
   publish, and no map provider's account.
2. **Intertidal heights** for the foil-depth layer (`scripts/foildepth`, branch
   `foildepth-coast`): per 10 m pixel, the tide level at which it covers and
   uncovers, by the rocks pilot's method (`scripts/rockspilot`, branch
   `rocks-pilot`), one archive per tide station's region, in the foil-depth
   layer's own encoding.

The app draws the heights over the foil-depth layer from zoom 10, with the
foil layer's colours at the same tide (`force5/src/intertidal.ts`), until the
foil-depth build takes them in itself.

## Steps

All under one working folder outside the repo (`SATELLITE_ROOT`, default
`/Volumes/workdrive/satellite`): `downloads/` (untrusted: the STAC lists, the
tide downloads, EOT20, the Sentinel-2 windows), `work/`, `out/`, `logs/`.
Python 3.12 venv with `rasterio numpy scipy pyproj pystac-client
planetary-computer pillow pmtiles requests pyTMD dask netCDF4 boto3`; every
script runs with `python -I`.

```sh
S=scripts/satellite; PY=/Volumes/workdrive/satellite/venv/bin/python
$PY -I $S/catalog.py            # every acquisition over the island, per MGRS tile (minutes)
$PY -I $S/tides.py fetch        # Marine Institute predictions and gauges; UK gauges (minutes)
# EOT20: https://www.seanoe.org/data/00683/79489/data/85762.zip -> downloads/eot20/EOT20/ocean_tides/*.nc
$PY -I $S/tides.py calibrate    # EOT20 fitted per station (~25 min)
$PY -I $S/tides.py scenes       # every station's level at every acquisition
$PY -I $S/coarse.py             # the island at 100 m: coverage, coast, sea (1 min)
$PY -I $S/plan.py               # blocks, stations and tide thresholds per tile
$PY -I $S/run.py --all          # scout.py, fetch.py then compose.py, tile by tile (hours)
$PY -I $S/bathyguard.py fetch   # EMODnet Bathymetry's DTM over the box
$PY -I $S/bathyguard.py apply   # deep open water read as foreshore, put back as water
$PY -I $S/fetch.py --tile <t> --coast-only && $PY -I $S/lagmap.py --tile <t>   # the tide's lag, per 2.56 km cell
$PY -I $S/basins.py             # lag maps -> basin stations (then tides.py calibrate, scenes, plan.py, compose)
$PY -I $S/tiles.py imagery      # high.pmtiles, low.pmtiles, index.json
$PY -I $S/tiles.py intertidal   # tide-<station>.pmtiles, index.json
$PY -I $S/validate.py --infomar <infomar10> --lidar dub:2.561:<mosaic> ...
$PY -I $S/bedtype.py fit --region dublin:29UPV:2.561:<mosaic> --region brandon:29UMT:2.677:<mosaic>
$PY -I $S/bedtype.py apply      # rocky.tif per tile: rock or weed, percent
$PY -I $S/tiles.py imagery --tiles 29UPV --bbox -6.26,53.34,-6.04,53.50 --out <root>/out/satellite-offline
$PY -I $S/publish.py --area ireland --imagery <root>/out/satellite --intertidal <root>/out/intertidal \
    --offline <root>/out/satellite-offline --env deploy/home-compute/.env --upload
$PY -I $S/publish.py --offline-intertidal <root>/out/intertidal --offline-bbox=-6.24,53.36,-6.06,53.49 \
    --offline-areas tide-howth
```

Each step is resumable: the catalog by month, the fetch by acquisition, the
compose by block, and `run.py` skips a tile that has its `stats.json`.

`run.py` reads a tile, then composes it, one step at a time (5 readers, one
compose worker, about 2 GB at most: the machine it ran on is shared), and
then drops the tile's Sentinel-2 reads (`--keep-downloads` keeps them): from
compose on, everything reads only `work/tiles/<tile>/` (`high.tif`, `low.tif`,
`heights.tif`, `lowir.tif`, `weight.tif`, `stats.json`; `blocks/` and `qc.npz`
let a tile be finished again without reading). So the tiles can be split
between machines: copy `work/plan.json`, `work/coarse.tif`, `work/tides/`,
`downloads/catalog` and `scripts/foildepth/stations.json` across (EOT20 is only
for `tides.py`), run `run.py --tiles <some>` there, and copy each finished
`work/tiles/<tile>/` back.

The national run (October 2026) was read on an Azure VM in Sweden Central (4
vCPUs, `--fetch-workers 16 --compose-jobs 3`), beside Planetary Computer's
storage in West Europe: about 390 MB/s against a home connection's 30–70, and
nothing read over the home connection. Dublin (29UPV) took 24 minutes there,
reading and composing.

## Method

### Where

`coarse.py` maps the island from Sentinel-2 itself (nothing else's licence
comes in): the clearest looks of every tile at the COGs' 1/16 overview, NDWI
> 0 water, voted onto a 100 m Irish Transverse Mercator grid. Sea is water
joined to the box's edge; Ireland is the land not joined to it (Kintyre is),
within 15 km of the main island by a chain of islands, lakes filled in. The
**coverage** is Ireland and the sea within 5 km of it (faded out over the
last kilometre); the **coastal zone**, where every acquisition is read, is the
land within 3 km of the sea and the sea within 5.5 km of land.

The Sentinel-2 tiles overlap by about 10 km (more across the UTM zone line at
6°W), so each point is given to the tiles round it by weight: the tiles'
centres' Voronoi cells, blended over 1.5 km either side of their edges, and
faded towards each tile's own edge (`plan.py`). A tile reads only its 512-pixel
COG blocks where it has weight: 1,708 coastal blocks and 4,677 blocks in all,
over 22 tiles.

### The tide at each look

Every station is EOT20 (DGFI-TUM's global ocean-tide model, CC BY 4.0, via
pyTMD) at its point, fitted to an open reference (`tides.py`):

- the Marine Institute's 33 stations (the foil-depth regions' own,
  `scripts/foildepth/stations.json`): fitted to the Marine Institute's
  predictions (ERDDAP `imiTidePrediction`, metres above LAT, 2026): timing
  shift, scale and datum, **0.04–0.11 m RMS**;
- Northern Ireland, which none of them predicts (`stations_ni.json`):
  **Bangor** and **Portrush**, fitted to the UK gauges there (UK National Tide
  Gauge Network via the Copernicus Marine in-situ TAC, served on EMODnet
  Physics' ERDDAP, chart datum, hourly since mid-2022; 0.21 and 0.19 m RMS,
  the surge included); **Ballycastle**, **Larne** and **Killard Point** have
  no open gauge, so they keep the model's amplitude and timing and take as
  their datum the model's own LAT (its lowest level over 19 years). At the 33
  fitted stations the fitted model's own 19-year lowest falls within 0.2 m of
  the published LAT, which is about how good that datum is. The UKHO's tide
  tables, which the rocks pilot used at Killard, are Crown copyright and are
  not used.

**Strangford Lough** is a basin: behind the Narrows its water runs well behind
the open coast, and on Killard's levels its flats got no fit. A flip fit
depends only on the order of the looks' levels, so `lag.py` reads the lag off
the imagery: Killard's fitted model shifted by each lag in turn, and the median
misfit over the lough's pixels that are wet in some looks and dry in others
(21,340 of them). It falls from 0.26 at no lag to **0.065 at 100 minutes**
(about as good as the open coast's fits). So the lough is its own station
(`Strangford_MODELLED`, a polygon inside the Narrows), Killard's tide 100
minutes later; its amplitude and datum stay Killard's, which the order of the
looks cannot give.

At a look's time the level is the gauge's where there is one (the Irish
National Tide Gauge Network's 5-minute gauges at 18 stations, the UK gauges
since 2022: it carries the surge the waterline sees), else the fitted model. A
gauge-year more than 0.3 m off the model (a datum change) is not used, nor a
reading more than 1 m off it.

A pixel's station is the foil-depth regions' rule (`common.nearest_station`):
the nearest Marine Institute station if one is within 45 km or nearer than
any Northern Ireland station, decided per 4×4 pixels of the z13 grid as
`scripts/foildepth/national.py` does; else the nearest Northern Ireland one. So
the Republic's cells are the foil-depth regions', and the five Northern
Ireland stations take Portrush round to Dundrum Bay.

### Reading

`fetch.py`, per tile and acquisition (tile cloud under 80%), from Microsoft
Planetary Computer's STAC (no account; COG URLs signed per read): the whole
SCL (about 3 MB), and if the coastal blocks are no more than 75% cloud,
shadow or no data, windows of B03 and B08 over them, made into a byte a
pixel: not usable (SCL's no data, saturation, shadow, cloud, cirrus and snow,
its clouds and shadows grown by 40 m, or haze, B03 > 0.22), dry, or wet
(NDWI > 0); and for the looks in a tide tail at one of the tile's stations
(the composite's candidates), B02 and B04 as well, in natural colour (an
8-bit square-root encoding, 0 where unusable or B02 > 0.22), and the lush flag
(a dry pixel with NDVI > 0.7). The summer scenes (the 28 clearest of May to
September, 2018–2025) are read over all the tile's blocks, in colour. The
processing baseline's +1000 offset (04.00 on) is removed. For the looks in the
low tail, B08 and B11 (20 m, beside SCL) too, the same encoding: the low tide's
near and shortwave infrared, which tell the bed's rock and weed from sand and
mud (`lowir.tif`). Nothing else is kept.

**Not every acquisition** (`chosen`, config `select`; `--every-look` reads
them all): per station of the tile, its levels at the overpasses cut into 12
equal steps, each given 12 clear looks, the least cloudy first by the
catalogue's tile cloud, a look found cloudy over the coast replaced by the
next in later rounds; a step with fewer gives all it has (the lowest tides,
rare at the overpass, show the lowest flats dry), and each tide tail 30 clear
looks for the composites. About a third of the reads: Dublin 348 of 989, 192
coastal looks kept against 557. Its heights against the every-look run's, over
the 103.7 km² both observed: median difference 0.000 m, 97% within 0.25 m;
against the LiDAR, 80% within 0.5 m (82,794 pixels) where every look gave
79% (78,708); the looks spread evenly over the levels fit better (median
misfit 0.029 against 0.042).

**Not every coastal block** (`scout.py`, config `scout`): first, per station,
the 8 least cloudy looks at its lowest and at its highest levels, B03, B08 and
SCL at 40 m from the overviews (half a minute a tile). A 40 m pixel dry in most
clear low looks and wet in most clear high ones is foreshore. A block with
under 0.01 km² of it, seen clear at least twice at each end of the tide, is
left out of the fetch and the compose (`common.scouted`): a steep coast, where
the tide only climbs the rock. On the six tiles composed every block, the
scout's foreshore against the observed heights' per block correlates at 0.97;
the rule leaves out 274 of 873 coastal blocks (31%) and 0.30 km² of the
560.5 km² observed (0.05%, no block over 0.09 km²). A block the scout saw
clear fewer than twice at either end is never left out: in Connemara, cloud at
the lowest tides hid 2 km² a block that way.

### Composites

`compose.py`, per tile:

1. **Scene QC**, the pilot's, made local: per block, the pixels wet (or dry) in
   97% of the looks are the references; a look that contradicts more than 6%
   of them over the 3×3 blocks round it (about 15 km), or sees under 30% of
   the coast there, is dropped there (haze, glint, a cloud the masks missed,
   surf).
2. **High and low tide**: per pixel and per station near enough, the robust
   median of the clean looks in the station's top or bottom 20% of levels: a
   median, then again without the looks whose brightness is more than 25
   steps (about a doubling of dark water) from it. All seasons: keeping to the
   summer looks where a pixel had six of them made the sea blotchy, since the
   choice changes from pixel to pixel with the clouds. Across the stations'
   cells the per-station images are blended over 3 km (`station_weights`).
3. **Summer**: the robust median of the summer scenes, everywhere.
4. **The tide zone** is where the water ever reaches (wet in at least 4% of
   the clean looks, joined to the sea, not lush vegetation), and the sea; the
   image is tide-sorted there and in an 80 m margin, feathered (σ 80 m) into
   the summer composite beyond it. So both options share the same land, and
   differ only where the tide does: the winter colours of the high-tide looks
   never reach the fields.

`tiles.py imagery` blends the tiles' images by weight (premultiplied, so an
edge never blends with "no value"), applies one colour stretch everywhere
(reflectance over a white point of 0.26, saturation ×1.15 about the mean,
gamma 2), and writes lossy WebP (quality 78, alpha at the fading sea edge),
512 px, z6–z13. 512 px at z13 is 5.8 m a pixel at 53°N, the same as 256 px
tiles at z14; the imagery is 10 m.

### Intertidal heights

As the rocks pilot's `build_heights.py`, per pixel and against its own
station's levels: the threshold between the looks sorted by tide with the
fewest contradictions (wet below it, dry above), its misfit, and the looks
dry below and wet above it. A pixel is **observed** when it flips, is seen
dry below its flip 3 times and wet above it 3 times, has misfit under 0.2 and
30 looks, is joined to the sea (through pixels wet in 3% of looks, seeded by
the always-wet pixels the coarse grid calls sea) and is not lush land
vegetation (NDVI > 0.7 in most of its dry looks: fields flooded or shadowed
in winter are not foreshore). 0.25 m is taken off (`biasMetres`; the pilot
measured +0.26 m against the OPW LiDAR at Portmarnock).

`tiles.py intertidal` writes one archive per region (`tide-<station>`, the
foil-depth regions' ids), Terrarium heights in lossless WebP, metres above
LAT in 1/32 m, 512 px, z6–z13, a pixel taken from the tile with the most
weight there and only if it was measured against the pixel's own station.
Reserved values (the index says them too):

| Value | Meaning |
| --- | --- |
| a height | the station's level at which the pixel covers and uncovers, less the bias |
| 30 (`belowSeenMetres`) | wet in every look: its bed is under the lowest tide seen (`lowestSeenMetres`) |
| 40 (`noSurveyMetres`) | looked at, but no height: too few looks, a poor fit, or a cell's edge |
| 50 (`landMetres`) | dry in every look, lush land, or not joined to the sea |
| −20 (`deepMetres`) | another region's water (the cells' edges, as the foil-depth archives write them) |

A tile with no height in it is left out. Overviews (z6–z12) are the mean of
the heights under each pixel, else the most telling reserved value.

### Rock or weed

`bedtype.py` rates each observed foreshore pixel's likelihood of being rock or
weed rather than sand or mud (`rocky.tif`, percent). The features: the low
tide's bed from `lowir.tif` and the tide zone's colour (`lowrgb.tif`: log of
B11 over red, NDVI, NDWI, log B08, log red) and the flip heights' own spread
over 3×3 and 5×5 pixels (a rocky shore's heights jump, a flat's run
smoothly). The labels are the LiDAR's: the 2 m DTM's RMS about its own 10 m
smoothing, rough over 0.10 m, smooth under 0.04 m, above 1.7 m LAT (dry at
the flights). A class-balanced logistic model on both regions
(`work/bed_model.json`); each region tested on the model from the other:

| Held out | Pixels | Rough | AUC | Flagged that is rough, finding 60% of it |
| --- | --- | --- | --- | --- |
| Dublin (dub, mal mosaics) | 73,635 | 10% | 0.850 | 39% |
| Brandon | 14,727 | 9% | 0.873 | 50% |

Four to five times the base rate, from the far side of the island: a guide to
where the bed is likely rock or weed, not a map of rocks (a boulder or a reef
narrower than a pixel or two is lost in it). The colour alone separates them
barely (AUC 0.57); the infrared and the heights' spread carry it. Where a
LiDAR reaches, its own roughness says more.

### Deep water

A handful of the lowest tide's looks can read open water as dry (glint and
whitecaps the masks missed), and every pixel of that patch then flips at the
one look's level: squares of the Atlantic west of Lewis came out as flat
foreshore at 0.50 m, east of Shetland at 0.6 m, off the Blaskets at 0.3 m.
The scene QC misses them, each patch being small against the 3x3 blocks it
weighs a look over. `bathyguard.py` puts such a pixel back as water (below
the lowest tide seen) when EMODnet Bathymetry's DTM has all of the seabed
within about 300 m deeper than 20 m **and** it flips within 0.75 m of the
lowest level its station was seen at: both, because the DTM is coarse and
wrong in places by the shore. Deep alone at 5 m took 0.7 km² of Sandymount
Strand (3.1 m above LAT on the OPW LiDAR, the satellite within 0.1 m of it);
deep alone at 20 m took Castlemaine Harbour's and Trawbreaga Bay's flats,
which flip at 2.2 m and 1.0 m. Both together took 20 km² of open water out
of Great Britain's foreshore and 0.5 km² out of Ireland's (the Blaskets),
and nothing a LiDAR covers. `undo` restores a tile exactly (a pixel it moved
keeps its flip level, which no always-wet pixel has). Bridgwater Bay's
squares, in about 11 m of the Bristol Channel's muddy water, are not caught.

### The tide's lag

Behind a narrows or up an estuary the water covers and uncovers its flats
later than at the station a sailor would look up; along a coast it can be
earlier, where the nearest station is a gauge up a river. A flip fit depends
only on the order of the looks' levels, so the lag can be read off the looks
themselves: `lagmap.py` takes each 2.56 km cell of flats, shifts its
station's fitted tide by -120 to +240 minutes, and keeps the shift that sorts
its wet and dry looks best (a positive lag is later). A cell's lag counts
when it beats no lag by 0.02 of misfit, is 20 minutes or more, and then fits
under 0.1 (`lagmap.clear`). Round Strangford, where the lough was already a
basin 100 minutes behind Killard: inside it the cells read 0 (the method
agrees with itself), the Narrows read +40 and +60 going in, the lough's
southern flats +100 (they lay outside the basin's polygon), its north end a
further +20, and inner Dundrum Bay +30. Up the Tay the flats run 40 to 100
minutes behind the station at its mouth; the Humber's mouth and Spurn 30 to
80 minutes ahead of Immingham's gauge.

`basins.py` joins touching clear cells of one station whose lags agree
within 20 minutes into a basin station (polygon, `lagOf`, `lagMinutes`,
1.5 km² of flats at least) in the root's stations file; the smaller of two
overlapping basins wins (`common.basins`), and a basin can lag another.
Its tide is its parent's model shifted; its amplitude its parent's, which
the order of the looks cannot give. Precision is about the lag step (10
minutes); a strongly asymmetric tide (the Severn's) fits a shifted curve
less well, and its larger lags are less sure.

### Great Britain

The same steps with `SATELLITE_CONFIG=config-gb.json` and a root of its own
(Northern Ireland is in the island's run). What differs:

- **Grid**: British National Grid (EPSG:27700), 100 m, 12,889 × 8,129;
  `coarse.py` votes each tile into its own window of it.
- **Land**: every piece mostly inside `coarse.landPolygon`, a line through
  the North Channel, the Irish Sea, the Channel and the southern North Sea:
  the Hebrides, St Kilda, Orkney, Shetland, Man and Scilly in; Rathlin, the
  Channel Islands and the continent out. A piece needs 5 cells dry in four
  fifths of at least four clear looks (`minSureCells`): the open sea's specks
  (a cloud or glint dry in about half of a handful of looks) and most oil
  platforms are left out, while St Kilda, North Rona, Sule Skerry and the
  Flannans have dozens. 233,400 km² of land, 78,600 km² of coastal zone.
- **Tides**: no Marine Institute stations. The 47 open UK gauges on EMODnet
  Physics' ERDDAP (`gauges_gb.json`: the National Tide Gauge Network under
  its short codes, hourly or 15-minute since 2012 to late 2024, and the
  Channel Coastal Observatory's), EOT20 fitted to each; and EOT20 alone at
  91 points 1–2 km offshore, placed furthest first until every coast point
  is within 30 km of a station (`tides.py place`, `stations_gb.json`). Some
  gauges are in chart datum, some in ODN (Deal, 3.58 m apart), so every
  station's datum is its fitted model's 19-year lowest (`tides.datum`
  `modelLAT`), the gauge's levels moved with it. Levels from −9 to 16 m are
  kept (`validRange`: the Severn's reach 14 m).
- **Rock or weed**: Ireland's model (`bed_model.json`) applied as it is.
- **Checked** against the Environment Agency's LiDAR Composite DTM (1 m,
  ODN, OGL, from its WCS), only above 1.7 m on the station's datum, where
  the datum is exact (an ODN gauge's own station: the offset is its
  `obsOffset`): Pegwell Bay (Deal) 93% of 37,130 pixels within 0.5 m,
  median -0.18 m; Ryde Sands (Sandown) 88% of 9,307, +0.11 m; Camber and
  Rye Bay (Hastings) 80% of 22,613, -0.14 m. Morecambe Bay, on a chart-datum
  gauge: the middle half of the differences within 0.40 m of each other.
- **Station numbers past 127**: `compose.py` kept each pixel's station in an
  int8, and Great Britain's last ten wrapped; the heights were right but
  `tiles.py` left those pixels out. Now an int16; a block written before is
  read back unwrapped.

## In the app

Nothing of either product is on the first load. The site ships two small
indexes, `public/satellite/index.json` and `public/intertidal/index.json`,
written by `publish.py`; the archives are on the data host under immutable,
content-versioned prefixes (`Cache-Control: public, max-age=31536000,
immutable`), read by HTTP range a tile at a time.

- **Satellite** (Layers → Satellite: Off / High tide / Low tide, off by
  default): the index and the code that reads it
  (`force5/src/satelliteIndex.ts`) load the first time an image is chosen.
  The index lists **areas**, one per published run, each with its own `base`,
  its archives and its `cover` (the z8 tiles its archive has, as boxes); only
  an area whose cover meets the view is opened. The archives are opened
  ranges-only (`force5/src/archives.ts`): a host that answered a range with
  the whole file would be refused, never downloaded.
- **Intertidal heights**: with the foil layer on, from zoom 10, the index and
  `force5/src/intertidal.ts` load, and the regions in view are drawn over the
  foil areas on their station's tide, every reserved value clear (the foil
  archive shows there). A tap reads them first. A region whose station has no
  Marine Institute prediction in the app (Northern Ireland's five, and Great
  Britain's) has no tide to draw at, so it is not drawn.

Great Britain is another area: `publish.py --area great-britain --imagery …
--intertidal …` uploads its sets and adds its entries to both indexes beside
Ireland's (a run replaces only its own area's), with no change to the app.

## Findings

(See the numbers below, filled in from the national run.)
