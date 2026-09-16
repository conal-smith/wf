# wingfoil.ie — Ireland wind explorer

An edge-to-edge Irish wind map powered by **Force5**, with real **DWD ICON-EU**, **Met Éireann HARMONIE-AROME DINI control**, **ECMWF IFS 15-day** and **NOAA GFS 0.25°** forecasts. Floating glass controls keep the map central; a bottom forecast grid is visible immediately for Brandon Bay and updates when you select a spot or map point. MapLibre renders the geography and wind-speed colour layer. A Canvas particle overlay follows the same U/V vectors. The selected spot, map markers and inspector use the same forecast frame.

## Run the website

Requires Node.js 22.12+ (tested with Node 26) and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/** (or the port printed by Vite). Use the numeric address if another local application occupies `localhost` on IPv6. Real sample snapshots are included in `public/weather`: the regional forecasts cover 13–16 September 2026 and ECMWF extends to 28 September. Later generated run directories are git-ignored. Refresh to obtain a newer available run.

Features:

- Pan/zoom Ireland and the surrounding Atlantic.
- Stronger Force5 wind colours: cool blues below 10 knots, green through yellow-green from 10–30, then yellow, orange, red and purple. The map, hourly cells and scrubber share the scale; colours indicate speed, not safety or rider suitability.
- Downwind particles and 25 selectable riding-place references. Clicking a spot opens a compact glass popout with coordinates, access caveats and source links.
- Click anywhere inside the forecast domain for its modelled wind and gust.
- HARMONIE is the default; the initial view zooms inside its served Ireland coverage so the rectangular data perimeter is off-screen. This crops some of Ireland rather than stretching the weather field. You can still pan/zoom out to see the model's real limits. Use the separate model buttons in the bottom dock to switch between HARMONIE (2 km, 60 hours) and ICON-EU (6.5 km, 72 hours), both at three-hour steps in the bundled snapshots.
- Model changes preserve the nearest available valid time, explain time/range changes, and replace the map, readings and metadata together only after validation. Failed/cancelled switches keep the old model visible.
- **ECMWF · 15 days** adds an explicit long-range choice: public 0.25° IFS wind, 3-hourly through day 6, then 6-hourly through day 15. The scrubber uses elapsed time; later columns widen to reflect the cadence. Week two is labelled as a less-certain outlook. Scalar gusts are included except at initialization; gust-cell tooltips show the actual source maximum periods. See the [specification and implementation plan](docs/ECMWF_15_DAY_PLAN.md) and [gust data notes](docs/GUST_DATA.md).
- **GFS · 0.25°** adds NOAA's public-domain global deterministic run: the same Ireland/Atlantic box at 0.25°, 3-hourly to +240 h by default. Its gust field is an **instantaneous** surface gust valid at each forecast time, not a maximum over a preceding interval, so gust values are not directly comparable with ICON-EU or ECMWF.
- Edge-to-edge, bottom-flush forecast grid open on arrival: day-grouped time columns and aligned, horizontally scrollable wind, gust and direction rows. Click a time column to update the map. HARMONIE gusts remain explicitly unavailable for the current source.
- The grid opens around the current time. A dashed **Now** line marks real clock time between forecast timestamps, separately from the selected forecast column. It updates every 30 seconds and on tab return without interrupting manual browsing; it is hidden when the current time lies outside the model's forecast range.
- Magnifying-glass button expands county/name search; point selection keeps the selected location above the sheet.
- Small standalone Force5 branding; coastline outlines and a soft shadow above the wind layer add depth to the land.
- Knots/metres per second and independent display controls.
- Irish local time with explicit model initialization in UTC.
- Real source information, stale/expired snapshot status, retryable frame errors.
- Responsive glass surfaces, keyboard controls and Escape dismissal; reduced-motion and reduced-transparency support with an opaque fallback.

The [location research](data/locations/README.md) retains 46 sourced records alongside the eight original spots (two duplicates merged). The public map and search show only 25 riding-place references, excluding business listings and broad area pins. Kilcrea and Newtownards use place names with their original coordinate provenance and access caveats. New locations sample the forecast grids on demand. These are source-listed references, not verified launches. Paid business listings are a future product feature, not implemented here.

## Live forecast worker

See the [live forecast pipeline runbook](docs/LIVE_FORECAST_PIPELINE.md) for container build/run instructions, scheduled ECS tasks, safe S3 publishing, CDN caching, IAM, monitoring and remaining launch checks.

```sh
docker build -f force5/Dockerfile -t force5-forecast:local .
docker run --rm -v force5-work:/data force5-forecast:local --models harmonie --step 1
```

The worker defaults to hourly output and only uploads when `--bucket`/`S3_BUCKET` is supplied. `--models` accepts any registry id: `harmonie icon-eu ecmwf gfs tides mi-swan`. Configure `VITE_FORECAST_BASE_URL` at website build time to read forecasts from a separate CDN; leave unset for bundled snapshots. The scrubber colours show the selected location's forecast wind speed using the map palette, with grey for unavailable/loading values. Single-click selects a map point; double-click zooms without changing the selection.

## Refresh the forecast

Requires Python 3.9+ and an internet connection. This is an ingestion command, not a process that runs on every page load.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r force5/ingest/requirements.txt
npm run spots:export     # only after changing src/locations.ts or data/locations/
npm run weather:refresh
```

Reload the page afterwards. For a shorter download or an explicit available run:

```sh
.venv/bin/python force5/ingest/fetch_forecast.py --hours 24 --step 3
.venv/bin/python force5/ingest/fetch_forecast.py --run 2026091306 --hours 72 --step 3
```

Default: 72 hours at three-hour steps, control forecast only. `--step 1` also works up to 72 hours, increasing bandwidth/storage. DWD removes older runs, so a historical `--run` may be unavailable.

The importer:

1. Inspects all four main-cycle inventories for U, V and gust files.
2. Chooses the newest run with all requested fields/times present.
3. Downloads at most four files concurrently with timeouts/retries into `.cache/grib`.
4. Uses ecCodes to decode GRIB2. Checks parameter, level, units, initialization, valid time, projection, vector orientation, scanning geometry and value ranges. Normalises ecCodes time units to hours.
5. Crops an Ireland/Atlantic buffer (18° W–2° E, 48°–59° N), retaining the source 0.0625° grid. Rows are north-to-south, columns west-to-east.
6. Publishes content-hashed JSON frames and precomputed spot time series.
7. Atomically replaces `public/weather/latest.json` only after all requested frames pass validation.

Existing published data remains intact on failure. Partial run files may remain unreferenced. Run one refresh process at a time; raw cache and old processed files are retained without automatic pruning in this MVP. The initial download is roughly 90 MB compressed for 75 full-Europe GRIB fields; the current cropped JSON snapshot is roughly 22 MB, with only requested/adjacent frames fetched by the browser and an eight-frame cache.

### ECMWF 15-day refresh

```sh
.venv/bin/pip install -r force5/ingest/requirements-worker.txt
npm run weather:refresh:ecmwf
.venv/bin/python force5/ingest/worker.py --models ecmwf --publish-only
```

Downloads the latest available full-length 00/12 UTC IFS control forecast from
the public AWS mirror using ECMWF's client, with no API key. Publishes 85 validated
frames through +360h, preserving source 3/6-hour sampling. The worker supports
`--models harmonie icon-eu ecmwf`; its `--step` option does not override ECMWF's
source cadence. See [ECMWF's catalogue](https://www.ecmwf.int/en/forecasts/datasets/open-data)
and [the live-operation guide](docs/LIVE_FORECAST_PIPELINE.md) for deployment,
attribution and refresh scheduling. Local verification does not deploy an AWS job.

### GFS refresh

```sh
npm run weather:refresh:gfs
# Shorter, hourly, or the S3 fallback:
.venv/bin/python force5/ingest/fetch_gfs.py --hours 48 --step 3
.venv/bin/python force5/ingest/fetch_gfs.py --hours 120 --step 1
.venv/bin/python force5/ingest/fetch_gfs.py --hours 240 --step 3 --source s3
```

Default: 0–240 hours at three-hour steps (81 frames), no API key. With `--step 1`
the default horizon is +120 h (121 frames), which is as far as NOAA publishes
hourly files. `--hours` accepts 3–384 divisible by the step; an hourly request
beyond +120 h is rejected rather than silently resampled.

The importer lists the provider's own inventory for each 6-hourly cycle, newest
first, and selects the newest cycle that actually contains **every** requested
step; a cycle still publishing is skipped. Runs older than 12 hours or dated in
the future are refused.

The default source is NOAA's **NOMADS GRIB filter**, which crops server-side and
returns roughly 14 KB per step for u, v and gust — about 0.6 MB for a 41-frame
run. Requests are limited to two concurrent connections with a minimum pause
between them, retries with backoff, and an identifying User-Agent, as NOMADS
asks. `--source s3` reads the same fields from the `noaa-gfs-bdp-pds` Open Data
bucket instead, using the `.idx` sidecar and three HTTP range requests per step
(no boto3, no credentials). That path transfers whole-globe messages, about
2.5 MB per step, and is a fallback for NOMADS outages rather than the normal
route. Both sources were verified to produce byte-identical frames.

GFS longitudes run 0–360°; they are normalised to −180…180° before cropping to
the shared Ireland/Atlantic box (18°W–2°E, 48°–59°N), giving an 81 × 45 grid at
the native 0.25°. ecCodes checks parameter, level (10 m for wind, surface for
gust), units, earth-relative vectors, regular geometry, initialization, valid
time and value ranges for every message.

**GFS gusts are instantaneous, not period maxima.** The manifest declares
`gustKind: "instantaneous"` with `gustIntervalHours: [hour, hour]` on every
frame, initialization included, and no `gustMissingHours`. Instantaneous gusts
read lower than an interval maximum covering the same time; do not compare them
with ICON-EU or ECMWF gusts. The bundled acceptance snapshot is 16 September
2026 at 12 UTC through +120 h: 41 frames, approximately 2.4 MB.

### Tide refresh

```sh
npm run tides:refresh
.venv/bin/python force5/ingest/fetch_tides.py --max-distance-km 25 --days-ahead 5
```

Marine Institute ERDDAP tidal predictions, CC BY 4.0, no account. The station list is
fetched with a `distinct()` query and cached for a week. Each riding location takes its
nearest station by great-circle distance; anything beyond 40 km is published without
tides and with a stated reason rather than being attached to a distant station. Ballyholme,
Newtownards and Lough Derg currently have none. Benone Strand falls just inside the limit
at 38.7 km from Malin Head, which is a different tidal regime from Lough Foyle: treat it as
indicative, or lower `--max-distance-km`. The window is yesterday through eight days ahead: the 5-minute
curve republished at 10 minutes (every second source sample, no interpolation) plus the
high/low events. Event heights above LAT are read from the curve, because the events
dataset publishes Ordnance Datum Malin only; the two are cross-checked against each
station's constant datum offset. A live run took 10 seconds for 15 stations across the 25
riding locations, 188 KB total. `public/marine/tides.json` is replaced only after every
station file validates.

These are astronomical predictions, not observations, and carry no surge or wind effect.

### Irish Shelf SWAN refresh

```sh
npm run weather:refresh:mi-swan
# Shorter and three-hourly, with optional map frames, or the shelf grid only:
.venv/bin/python force5/ingest/fetch_mi_swan.py --hours 48 --step 3
.venv/bin/python force5/ingest/fetch_mi_swan.py --hours 24 --step 3 --frames
.venv/bin/python force5/ingest/fetch_mi_swan.py --no-nest
```

Marine Institute Irish Shelf SWAN wave model through public ERDDAP griddap, CC BY 4.0, no
account. ERDDAP subsets server-side, so a whole 145-step, seven-variable series for one
location is a single 10 KB request. This is Ireland's own wave model; it is a **wave**
bundle, so nothing in the browser reads it yet.

**Run identity.** The dataset aggregates about eight days of hindcast followed by six days
of forecast on one hourly `time` axis, and the axis alone cannot say where the forecast
starts. The importer takes the model day from the dataset's global `date` attribute and uses
that day at **00 UTC** as `run`: the first forecast hour. It refuses to publish unless the
axis ends exactly 144 hours later, so a half-updated or late aggregate fails instead of
being mislabelled. Series hours count from `run`, which keeps `validTime` equal to
`runTime + hour` as the contract requires, and the hindcast is not published. ERDDAP exposes
no publication time, so `sourceUpdated` is the provider's own `history` timestamp, which
states no time zone and is republished verbatim next to `sourceDate` and the whole `history`
string. One run a day appears around 08:20–09:30 UTC and is occasionally a day late, so the
registry allows 36 hours of age rather than 24.

**Nearest wet cell.** The shelf grid is 0.025°: about 2.8 km north–south but only about
1.6 km east–west at Irish latitudes. Riding locations are beaches, so the cell containing
one is usually dry. Each spot gets one small single-timestep height query around it and
takes the closest wet cell within 8 km, recording `nearestOffsetKm`, whether a neighbour was
needed and how many cells were searched. The 200 m Connemara nest (10.80°W–8.90°W,
52.95–53.73°N) is queried as well for spots inside it and wins when its nearest wet cell is
at least as close; `comparedWith` then keeps the shelf's offset and the mean absolute wave-height
difference between the two grids. A location with no wet cell inside the limit is published
as nulls with a stated reason rather than borrowing open water: on 16 September 2026 that
was Lough Derg (inland) and Strangford Lough.

**Variables.** `swh`, `hswe` (swell), `mwp` (tm02), `pp1d` (peak), `mwd`, `pwd` and
`spread` are source values, rounded only. `shww` is **derived** by Force5 as
`sqrt(max(0, swh² − hswe²))`: SWAN publishes total and swell heights, not a wind sea, and
`shww` is null whenever either input is null. `pwd` comes off SWAN's discrete 10° spectral
direction bins and is far coarser than `mwd`. Directions are meteorological, the bearing
waves come from. `energy_period` and `orbital_velocity` are available and unused.

**Frames are off by default.** The full grid is 480 × 280 cells × 9 variables per hour, so
the spot series is the product and `frames` is empty. `--frames` publishes the 11°W–5°W /
51°N–56°N crop at native resolution (240 × 200, rows north-to-south) carrying `swh`, `mwp`
and `mwd` only, declared through `frameVariables`. It costs about 3.2 MB transferred and
0.74 MB published per frame, and the whole bundle shares one cadence, so pair it with
`--step 3`.

A clean live run on 16 September 2026 took **3.5 seconds** for all 25 riding locations: 58
requests at two concurrent connections, 0.65 MB of cached raw CSV, and a 0.56 MB manifest
(62 KB gzipped) holding 145 hourly steps. 19 of the 23 published locations needed a
neighbour cell and 3 used the Connemara nest. Brandon Bay took the cell 2.79 km away at
52.2875°N, 9.9875°W and read 0.44 m at 10.9 s from 15° at the run hour. Raw responses are
cached under `.cache/mi-swan/<run>/` and reused; `public/weather/mi-swan.json` is replaced
by a single atomic write after everything else succeeds, so a failure preserves the last
published wave forecast. That file is git-ignored: no wave snapshot is bundled with the site.

Best endeavours, not for safety-critical use. A 2.8 km wave model does not resolve a
shorebreak, and an offset cell is open water near the spot, not the spot itself.

### HARMONIE refresh

```sh
npm run weather:refresh:harmonie
# Optional shorter or hourly run:
.venv/bin/python force5/ingest/fetch_harmonie.py --hours 24 --step 1
```

The importer inspects the public portal's last three hours of **file publication**
(not a three-hour forecast horizon), selects the newest complete requested control
run and downloads `fcYYYYMMDDHH+HHHCONTROL_grib2_ieIoI` ZIPs with two concurrent
requests. No account is needed for this near-real-time endpoint. Archive access is
separate and is not used. Complete 60-hour output may not be present yet while a
run is publishing; failure preserves both published models.

ecCodes validates the 10 m parameters, control member 0, provider, units, run/valid
times, missing values and native Lambert geometry. The importer checks projection
coordinates against ecCodes latitude/longitude coordinates, rotates native
grid-relative vectors to true east/north, and then bilinearly resamples them.
The rotation is independently tested against geodesic bearings. Display grid:
233 × 236, 0.025° longitude × 0.02° latitude, 10.9°W–5.1°W / 51°N–55.7°N.
This is an **Ireland crop**, not full model coverage; areas beyond it deliberately
have no HARMONIE wind overlay and are not silently filled with ICON-EU.

Source ZIPs are checked for their expected entry name and CRC. Only validated
GRIB messages for U/V are retained in `.cache/harmonie`. Immutable output frames
and spot series are published before atomically replacing `weather/harmonie.json`.
The manifest records source filenames, extracted-wind SHA-256 hashes, processing
notes and attribution. The bundled run is 13 September 2026 at 13 UTC, through
16 September at 01 UTC: 21 frames, approximately 11 MB total.

**HARMONIE gusts are intentionally unavailable.** This subset supplies signed gust
components (GRIB2 parameters 23/24 with maximum statistics), not scalar gust speed
(parameter 22). Their combination has not been validated, so the importer does
not manufacture a speed or substitute ICON-EU gusts. The UI shows `—` with an
explanation. Confirm gust-component semantics or add a validated scalar source
before enabling HARMONIE gusts.

## Verify / build

```sh
npm test
npm run test:weather
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start the production preview on port 4173. They use the real map/data, so they require internet for OpenFreeMap. Tests cover time/units/point inspection, particles, mobile search, failed-frame recovery, missing and expired snapshots, reduced motion, and unavailable basemaps. Screenshots and failure traces go into ignored `test-results/`.

```sh
npm run preview
```

Serve `dist/` through any static web host after building. No secrets or account provisioning is needed. Use HTTPS, compression and proper JS MIME types. MapLibre v6's ES-module worker is bundled with Vite's `?worker&url` import; serving its worker asset is essential.

## Files and data contract

```text
force5/ingest/registry.py  The model table: script, manifest, kind, freshness limit
force5/ingest/fetch_forecast.py DWD discovery, download, validation and publication
force5/ingest/fetch_harmonie.py Met Éireann control download, rotation and regridding
force5/ingest/fetch_ecmwf.py ECMWF IFS 15-day open-data download and crop
force5/ingest/fetch_gfs.py  NOAA GFS 0.25° filtered/ranged download and crop
force5/ingest/fetch_tides.py Marine Institute tidal predictions per riding location
force5/ingest/fetch_mi_swan.py Marine Institute Irish Shelf SWAN wave series per riding location
public/spots.json           Original eight precomputed forecast locations
public/riding-locations.json The 25 public riding places every adapter samples
scripts/export-riding-locations.mjs Regenerates that file from src/locations.ts
data/locations/             Sourced location records and spreadsheet export
src/locations.ts            Map/search merge, aliases and provenance
public/weather/latest.json Model/source/grid metadata, frame URLs, spot series
public/weather/harmonie.json HARMONIE's independent run, grid, frames and attribution
public/weather/ecmwf.json  ECMWF's 85-frame timeline, mixed cadence and attribution
public/weather/gfs.json    GFS's 0.25° timeline, instantaneous gusts and attribution
public/weather/<run>/*.json Immutable cropped U/V/gust grids
public/weather/mi-swan.json Irish Shelf SWAN wave series per riding location (git-ignored)
public/marine/tides.json   Tide stations, spot assignments, coverage and datum notes
public/marine/tides-*.json Immutable per-station curves and high/low events
force5/src/weather.ts      Validation, sampling, units, bearings, frame cache
force5/src/WindMap.tsx      MapLibre basemap, raster colours, particle renderer
force5/assets/             Force5 platform branding
src/App.tsx                Full-screen forecast explorer and floating controls
src/ForecastSheet.tsx      Bottom forecast table for named and arbitrary points
IMPLEMENTATION_PLAN.md     Scope, implementation decisions and next milestone
```

All numeric U/V/gust arrays are in m/s and rounded to 0.01 m/s. `grid` specifies dimensions, spacing and bounds. `runTime` is the forecast initialization; each frame has its own `validTime`. Gust `startStep`/`endStep` are retained as hours since initialization. Gust at forecast hour zero has no accumulation window and is hidden in the main readout. For explicitly unavailable gusts (`gustAvailable: false`), the frame's `gust` array, spot `gust` values and `gustIntervalHours` are `null`, never zero. ECMWF declares `gustMissingHours: [0]` with gusts enabled: only that frame is null; a missing later gust fails publication. A model whose gust is instantaneous rather than a period maximum declares `gustKind: "instantaneous"` and a zero-length `gustIntervalHours` of `[hour, hour]` at every hour, including zero; without that declaration a zero-length interval after initialization is rejected.

`spotForecasts` covers every id in `public/riding-locations.json`. Adapters read
`FORCE5_SPOTS_FILE`, defaulting to that file and falling back to `spots.json` with a
printed warning when it is absent. Regenerate it with `npm run spots:export` after
changing `src/locations.ts` or `data/locations/`; the original eight ids and
coordinates are asserted unchanged, because bundled snapshots refer to those points.
Bundled snapshots predate the change and still carry only the original eight.

### Optional manifest fields

`schemaVersion` stays 1; every field below is optional and absent from the wind
models that do not use it. `force5/ingest/registry.py` holds one line per model and
`validate_bundle` dispatches on `kind`.

```text
kind          "wind" (default when absent) | "wave" | "tide"
gustKind      "interval" (default) | "instantaneous"
ensemble      {members, control | null, description}
spotMembers   {spotId: [{hour, validTime, u[], v[], gust[]}]}   indexed by member
variables     {shortName: {units, label, description}}          wave bundles
spotSeries    {spotId: [{hour, validTime, values: {var: number|null}}]}
horizonHours  last published hour                               frameless wave bundles
frameVariables[shortName]  the subset of variables frames carry  wave bundles
```

- **wind** keeps the existing frame rules. `gustKind: "instantaneous"` is for sources
  that publish a surface gust at the valid time rather than a period maximum (NOAA
  GFS): every frame, hour 0 included, then carries `gustIntervalHours: [hour, hour]`,
  which the validator accepts only under that declaration.
- **ensemble** manifests hold the ensemble **mean** in `spotForecasts` and every
  member in `spotMembers`; member arrays must all have length `members`, with finite
  values, |u| and |v| at most 150 m/s and gusts at or above zero. `frames` may be
  empty **only** when `ensemble` is present, for models shown on the chart but not
  the map. The browser's `validateManifest` still requires a non-empty `frames`, so a
  chart-only model needs that frontend check relaxed first.
- **wave** bundles declare `variables` and publish `spotSeries` for every riding
  location, with `null` for land, unresolved cells and locations with no usable grid
  cell, never zero. Frames are **optional**: `frames` may be empty when `spotSeries`
  is present, and `horizonHours` then declares the last published hour instead of the
  frame count implying it. When frames are published they carry one numeric array per
  gridded variable; `frameVariables` may narrow that to a distinct subset of
  `variables`, because a map needs fewer fields than a series. Frames and series share
  one `stepHours`. Marine Institute Irish Shelf SWAN (`mi-swan`) is the first adapter
  of this kind and publishes no frames by default.
- **tide** bundles carry `stations`, `spots`, `coverage` and an immutable file per
  station. Heights are metres above Chart Datum (LAT); each station publishes its
  `odMalinOffsetMetres` and a `datumNote`, and the OD Malin value is never mixed
  into the curve. Spots with no station in range are published with a `reason`.

Both the browser and importer use bilinear interpolation. Direction is the meteorological bearing **from** which the wind blows; arrows/particles move **towards** the opposite bearing. Calm wind has no meaningful direction. The particle advection speed is a visual scale, not a real-time speed measurement.

## Sources and limitations

- Weather: [DWD ICON-EU GRIB2](https://opendata.dwd.de/weather/nwp/icon-eu/grib/), [access information](https://opendata.dwd.de/README.txt), [DWD terms/attribution](https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html).
- Basemap: [OpenFreeMap](https://openfreemap.org/quick_start/), with OpenMapTiles/OpenStreetMap attribution. External basemap and Google Fonts requests require internet. Fonts have local fallback stacks.
- Renderer: [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
- GFS: [NOAA NCEP product documentation](https://www.nco.ncep.noaa.gov/pmb/products/gfs/), [NOMADS GRIB filter](https://nomads.ncep.noaa.gov/), [NOAA Open Data registry](https://registry.opendata.aws/noaa-gfs-bdp-pds/), [NWS disclaimer](https://www.weather.gov/disclaimer). US Government work in the public domain; Force5 publishes modified output, which is not official government material, and NOAA/NWS does not endorse this site.
- Tides: [Marine Institute ERDDAP](https://erddap.marine.ie/erddap/tabledap/imiTidePrediction.html), `imiTidePrediction` and `IMI_TidePrediction_HighLow`, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Predictions only; Northern Ireland has no Marine Institute station.
- Waves: Marine Institute [Irish Shelf SWAN](https://erddap.marine.ie/erddap/info/IMI_IRISH_SHELF_SWAN_WAVE/index.html) and the 200 m [Connemara nest](https://erddap.marine.ie/erddap/info/IMI_CONNEMARA_SWAN_WAVE/index.html), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Wave forecast © Marine Institute; best endeavours, not for safety-critical use. One run a day, and a beach series is the nearest open-water cell, not the shorebreak.
- HARMONIE: [Met Éireann open-data listing](https://data.gov.ie/dataset/numerical-weather-prediction-data/resource/1fefad43-8aa9-46cb-88f6-053e712cdafa), [near-real-time downloads](https://opendata.met.ie/nwp/near-realtime), [model documentation](https://opendata.met.ie/documentation), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The older empty Apache index is not used.

Set `VITE_BASEMAP_STYLE_URL` in `.env.local` to use a compatible hosted or self-hosted MapLibre style (including working glyphs). Restart/rebuild after changing it. The default style has simplified custom city labels; provider attribution remains visible.

This is a **forecast snapshot**, not a live observation feed. The browser flags runs older than 18 hours and snapshots whose coverage has ended. There is no background refresh service yet. Spatial interpolation makes the map look smooth but cannot increase native detail (6.5 km ICON-EU / 2 km HARMONIE); shelter, headlands and launch-site turbulence remain unresolved. Tidal predictions and Irish Shelf SWAN wave series are ingested but not yet shown in the browser; there are no marine warning feeds and no rideability scores. The source dialog links to official warnings. Numerical/data-pipeline validation is not a measured forecast-accuracy comparison against observations.

The raster colour image is generated at 512 × 512 and displayed by MapLibre's GPU. Particles use a precomputed screen-space wind grid and Canvas 2D at about 30 fps, capped at 2,600 particles with DPR capped at 2. Pan/zoom invalidates the sampled screen grid; animation pauses while moving, in hidden tabs, and with reduced-motion preference. This is an intentional small-prototype implementation, not a claimed reproduction of Windy's proprietary renderer. A WebGL particle layer can replace it after profiling real mobile devices.

## Next implementation milestone

The initial reference snapshot is committed for immediate local use. Runtime forecast
directories are otherwise ignored by Git; only files referenced by `latest.json` and `harmonie.json`
should be deliberately staged when updating a bundled snapshot. Caches, development
tool settings, environment files, dependencies and build outputs are not committed.

Arbitrary-point forecast sheets load all forecast times with two concurrent requests,
showing values progressively and offering retry on failure. This can transfer the
whole ~22 MB snapshot; a production point-series endpoint is a future bandwidth
optimisation. The original eight spots use the small precomputed manifest series; additional directory locations sample the frame grids like arbitrary map points.

Deploy the prepared container worker and S3 publisher using the live runbook, then monitor run age/download failures for all three models. Local locking and conditional S3 pointer writes are implemented; production scheduling, monitoring and safe retention still need configuring. Preserve older files long enough for open browser sessions. Validate HARMONIE gust semantics before enabling them, and consider ensemble uncertainty. Keep model switches explicit; do not silently mix runs/models or interpret interpolated output as observations.
