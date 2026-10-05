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
