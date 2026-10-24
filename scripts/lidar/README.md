# The LiDAR layer

**Off since 24 October 2026.** See [Off](#off) below: the site has no LiDAR
layer and serves none of it. This pipeline and the published set are kept.

It was a map layer (Layers → Ground → **LiDAR**, off by default) that showed every
LiDAR survey we hold where it reaches the coast: the ground's height above the
lowest tide (LAT, chart datum, the dock's tides' datum), coloured and
hillshaded, so the sandbars, channels, beaches and reefs a rider cares about
show at about 3 m a pixel. A dashed outline marks each survey at every zoom
(and a faint fill under z9, where the tiles stop).

## What we hold

| Source | Where | Flown | Cell | Datum | Licence |
| --- | --- | --- | --- | --- | --- |
| INFOMAR bathymetric LiDAR (GSI & Marine Institute) | Lough Foyle | 2008 | 5 m | LAT | CC BY 4.0 |
| INFOMAR bathymetric LiDAR | Tralee Bay and Brandon Bay | 2008 | 5 m | LAT | CC BY 4.0 |
| OPW National CFRAM LiDAR (via GSI) | Dublin's north coast (Portmarnock, Baldoyle, Bull Island, Howth, Sutton), Sandymount to Dún Laoghaire, Brandon Bay's east end | 2011 | 2 m | OD Malin | CC BY 4.0 |
| TII LiDAR (via GSI) | Donabate to Dún Laoghaire, inland of the coast (the M1, the Malahide estuary's west end) | 2010–11 | 2 m | OD Malin | CC BY 4.0 |
| OPW coastal LiDAR (via GSI) | Dublin's north coast and Brandon Bay | 2006–07 | 2 m | OD Malin | CC BY 4.0 |
| OSNI River Basin LiDAR (Land & Property Services) | 12 flights that reach the sea: Portrush–Portstewart–Coleraine, Ballycastle, Cushendall, Ballygalley, Larne, Carrickfergus, Bangor and Belfast Lough's south shore, Newtownards and Strangford's north end, Killyleagh, Downpatrick, Newcastle | 2007–12 | 2 m (from 0.5–1 m) | OD Belfast | OGL v3.0 |

About 800 km² in all (the index's `areaKm2`). These are the foil layer's
downloads: GSI's tiles are the ones `scripts/foildepth/fetch_pilots.py`
fetched for the pilot areas (108 2 km tiles), OSNI's are
`fetch_national.py osni-lidar`'s 2 m mosaics, which leave out the sea's
surface each flight saw (and, where the sea's level that day is not known,
the ground under +2.3 m OD Belfast: some of Northern Ireland's lower
foreshore is missing for that reason). The national LiDAR of GSI and OPW
covers much more of the coast than the pilots took; adding a stretch is
fetching its tiles (fetch_pilots.py's lists) and building again.

## Steps

One working folder outside the repo, `/Volumes/workdrive/lidar`: `data/`
(the downloads, untrusted), `work/`, `out/`, `logs/`. The satellite run's
venv (`rasterio numpy scipy pyproj pillow pmtiles shapely boto3`); every
script runs with `python -I`.

```sh
L=scripts/lidar; PY=/Volumes/workdrive/satellite/venv/bin/python; D=/Volumes/workdrive/lidar/data
ln -s <pilot data>/lidar/tiles $D/gsi-tiles          # fetch_pilots.py's LiDAR tiles
ln -s <national data>/osni-lidar $D/osni-lidar       # fetch_national.py osni-lidar
$PY -I $L/fetch.py --data $D                          # INFOMAR's Foyle and Tralee LiDAR
$PY -I $L/build.py --data $D --work /Volumes/workdrive/lidar/work --out /Volumes/workdrive/lidar/out --jobs 4
$PY -I $L/publish.py --set /Volumes/workdrive/lidar/out --offline --env deploy/home-compute/.env --upload
```

`build.py --coverage-only` writes the outline and the index again over an
archive already built; `--bbox w,s,e,n` builds only the chunks in a box (a
trial).

## Method

- **Merge.** Each z11 tile is a 4096 px grid at z14 (2.9 m a pixel at 53°N),
  with a 32 px margin. The sources are reprojected onto it (bilinear) in
  `lidar.json`'s order, a pixel taking the first that has it: the
  bathymetric surveys first (flown for the shore and the shallows, in LAT),
  then the topographic flights (over water they see only its surface).
  Fill values are dropped (`invalid`, `validRange`).
- **Datum.** A survey in OD Malin or OD Belfast is brought to the LAT of each
  pixel's tide station, as the foil layer's regions are
  (`scripts/foildepth/stations.json`: the nearest station, or Strangford's
  basin polygon), decided per 64 px block and interpolated between the
  blocks, so no station's edge draws a step.
- **Draw.** A colour per height, linear between `lidar.json`'s `ramp` stops
  (blue under the lowest tide; aqua through pale green and straw to sand
  across the tide's reach; grey buff above the tides), times a hillshade lit
  from the north-west, exaggerated more at each zoom out. The tiles are
  baked RGBA WebP (lossy colour, lossless alpha), 512 px, z9–z14; z9–z10
  are the mean of the heights under each pixel, shaded at their own scale.
  The index carries the ramp, and the map's key draws its scale from it, so
  the key always matches the tiles.
- **Outline.** coverage.json: each source's (each OSNI flight's) valid cells
  at 25 m, closed by a cell, holes filled, specks dropped, simplified to
  40 m, as GeoJSON with the survey's name, year, cell and licence.

## Publishing

`publish.py` versions the set by content under `lidar/v<12 hex>/` on the
bucket behind https://data.wingfoil.ie (only ever adding objects; the sweep in
`force5/ingest/prune.py` never touches `lidar/`). With `--site` it also writes
the site's index `public/lidar/index.json` with that `base`, and with
`--offline` cuts a small set (Malahide to Howth) into `public-data/lidar/v…/`
for the dev server and the e2e site. While the layer is off, leave `--site`
out: the repo is not touched.

## Off

The owner took the layer off on 24 October 2026. The surveys reach only
Dublin's coast, Tralee and Brandon Bays, Lough Foyle and Northern Ireland's
coast, so everywhere else the layer drew nothing and looked broken. So:

- The site has no LiDAR layer: no entry in Layers, no key, no part in "About
  the map", no code (`force5/src/lidar.ts`, `src/useLidar.ts`,
  `src/LidarKey.tsx` were removed; they are in git history). A rider's stored
  choice of it is ignored.
- The site does not serve it: `public/lidar/index.json` (the pointer the
  build copied into every deploy) and the committed offline set
  `public-data/lidar/` were removed, and neither the dev server's data proxy
  (`vite.config.ts`) nor the e2e site (`scripts/e2e-site.mjs`) serves
  `lidar/` any more.
- The published objects are still on the data host, under `lidar/v…/`
  (`lidar/v1f0f7d51cdae/` was the last the site pointed at). Nothing reads
  them. Removing them is the owner's call; `prune.py` leaves `lidar/` alone
  either way.

To bring it back it needs wider coverage first: most of the coast a rider
uses, not four stretches of it. GSI and OPW's national LiDAR reaches much more
of the Republic's coast than the pilots took (fetch its tiles with
`scripts/foildepth/fetch_pilots.py`'s lists and build again), and INFOMAR's
bathymetric LiDAR covers more bays. With that, restore the client from git
history, run `publish.py --site` (and `--offline` for the dev and e2e sites),
put `lidar` back in the static-data paths in `vite.config.ts` and
`scripts/e2e-site.mjs`, and add the layer to Layers again.

## Limits

The surveys are 2006–2012: banks and channels have moved since. A
topographic flight over water saw its surface, not the bed. Not for
navigation.
