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

Not drawn by the app: the heights are an input to the foil-depth build.

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
$PY -I $S/run.py --all          # fetch.py then compose.py, tile by tile (many hours)
$PY -I $S/tiles.py imagery      # high.pmtiles, low.pmtiles, index.json
$PY -I $S/tiles.py intertidal   # tide-<station>.pmtiles, index.json
$PY -I $S/validate.py --infomar <infomar10> --lidar dub:2.561:<mosaic> ...
$PY -I $S/tiles.py imagery --tiles 29UPV --bbox -6.26,53.34,-6.04,53.50 --out <root>/out/satellite-offline
$PY -I $S/publish.py --imagery <root>/out/satellite --intertidal <root>/out/intertidal \
    --offline <root>/out/satellite-offline --env deploy/home-compute/.env --upload
```

Each step is resumable: the catalog by month, the fetch by acquisition, the
compose by block, and `run.py` skips a tile that has its `stats.json`.

`run.py` reads a tile, then composes it, one step at a time (5 readers, one
compose worker, about 2 GB at most: the machine it ran on is shared), and
then drops the tile's Sentinel-2 reads (`--keep-downloads` keeps them): from
compose on, everything reads only `work/tiles/<tile>/` (`high.tif`, `low.tif`,
`heights.tif`, `weight.tif`, `stats.json`; `blocks/` and `qc.npz` let a tile be
finished again without reading). So the tiles can be split between machines:
copy `work/plan.json`, `work/coarse.tif`, `work/tides/` and
`downloads/{catalog,eot20}` across, run `run.py --tiles <some>` there, and copy
each finished `work/tiles/<tile>/` back.

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
processing baseline's +1000 offset (04.00 on) is removed. Nothing else is
kept. About 70 MB/s from a home connection.

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

## Findings

(See the numbers below, filled in from the national run.)
