# Where the chart data comes from

Run from this folder (`npm i geotiff d3-contour` first, in a scratch directory or here):

1. `bash fetch.sh`: EMODnet Bathymetry's DTM over WCS (`emodnet:mean`), Ireland at
   0.0025° in four quarters and the five featured bays at the survey's 1/16 arc-minute
   (~115 m), into `tif/`.
2. `node bathy.mjs`: contours, depth bands, land relief, soundings and the bays' raw
   grids into `../data/*.js`.
3. `npx tsx wind.ts`, from the repository root with `public/weather` populated
   (`npm run weather:refresh`): the HARMONIE and ECMWF runs resampled to `../data/wind.js`.

EMODnet's depths are referenced to Lowest Astronomical Tide where the surveys allow,
which is the datum of the Marine Institute tide predictions the product already shows,
so depth + tide height is the water over the bottom (an estimate: the tide station is
rarely at the beach).

## The depth tiles (data/bathy.pmtiles)

4. `bash fetch-fine.sh`: EMODnet at its own 1/16′ (~115 m) for the whole coast, Northern
   Ireland included, in 1° tiles (`tif/fine/`, ~110 MB).
5. `node --max-old-space-size=12000 tiles.mjs` (`npm i geojson-vt vt-pbf` too): bands,
   contours, soundings and relief as vector tiles, z5–9 from the 0.0025° grid and z10–12
   from the 115 m one, into `../tiles/bathy/`.
6. `python pack.py ../tiles/bathy ../data/bathy.pmtiles` (`pip install pmtiles`): one
   gzip-compressed PMTiles archive (~11.5 MB). Pages read it by HTTP range requests, so
   it needs a server that supports them (`npx http-server`, not `python -m http.server`).
