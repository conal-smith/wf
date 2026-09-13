# wingfoil.ie — Ireland wind explorer

An edge-to-edge Irish wind map powered by **Force5**, with real **DWD ICON-EU**, **Met Éireann HARMONIE-AROME DINI control**, and **ECMWF IFS 15-day** forecasts. Floating glass controls keep the map central; a bottom forecast grid is visible immediately for Brandon Bay and updates when you select a spot or map point. MapLibre renders the geography and wind-speed colour layer. A Canvas particle overlay follows the same U/V vectors. The selected spot, map markers and inspector use the same forecast frame.

## Run the website

Requires Node.js 22.12+ (tested with Node 26) and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/** (or the port printed by Vite). Use the numeric address if another local application occupies `localhost` on IPv6. Real sample snapshots are included in `public/weather`: the regional forecasts cover 13–16 September 2026 and ECMWF extends to 28 September. Later generated run directories are git-ignored. Refresh to obtain a newer available run.

Features:

- Pan/zoom Ireland and the surrounding Atlantic.
- Wind-speed colours, downwind particles and 52 selectable locations, with distinct spot, operator, club and area markers.
- Click anywhere inside the forecast domain for its modelled wind and gust.
- HARMONIE is the default; the initial view zooms inside its served Ireland coverage so the rectangular data perimeter is off-screen. This crops some of Ireland rather than stretching the weather field. You can still pan/zoom out to see the model's real limits. Use the separate model buttons in the bottom dock to switch between HARMONIE (2 km, 60 hours) and ICON-EU (6.5 km, 72 hours), both at three-hour steps in the bundled snapshots.
- Model changes preserve the nearest available valid time, explain time/range changes, and replace the map, readings and metadata together only after validation. Failed/cancelled switches keep the old model visible.
- **ECMWF · 15 days** adds an explicit long-range choice: public 0.25° IFS wind, 3-hourly through day 6, then 6-hourly through day 15. The scrubber uses elapsed time; later columns widen to reflect the cadence. Week two is labelled as a less-certain outlook. Scalar gusts are included except at initialization; gust-cell tooltips show the actual source maximum periods. See the [specification and implementation plan](docs/ECMWF_15_DAY_PLAN.md) and [gust data notes](docs/GUST_DATA.md).
- Edge-to-edge, bottom-flush forecast grid open on arrival: day-grouped time columns and aligned, horizontally scrollable wind, gust and direction rows. Click a time column to update the map. HARMONIE gusts remain explicitly unavailable for the current source.
- The grid opens around the current time. A dashed **Now** line marks real clock time between forecast timestamps, separately from the selected forecast column. It updates every 30 seconds and on tab return without interrupting manual browsing; it is hidden when the current time lies outside the model's forecast range.
- Magnifying-glass button expands county/name search; point selection keeps the selected location above the sheet.
- Small standalone Force5 branding; coastline outlines and a soft shadow above the wind layer add depth to the land.
- Knots/metres per second and independent display controls.
- Irish local time with explicit model initialization in UTC.
- Real source information, stale/expired snapshot status, retryable frame errors.
- Responsive glass surfaces, keyboard controls and Escape dismissal; reduced-motion and reduced-transparency support with an opaque fallback.

The [location directory](data/locations/README.md) merges 46 sourced records with the eight original spots (two duplicates merged). All 52 locations appear on the map and in search; new locations sample the forecast grids on demand. Source links and attribution are available in the map's information dialog. These are source-listed references, not verified launches.

## Live forecast worker

See the [live forecast pipeline runbook](docs/LIVE_FORECAST_PIPELINE.md) for container build/run instructions, scheduled ECS tasks, safe S3 publishing, CDN caching, IAM, monitoring and remaining launch checks.

```sh
docker build -f force5/Dockerfile -t force5-forecast:local .
docker run --rm -v force5-work:/data force5-forecast:local --models harmonie --step 1
```

The worker defaults to hourly output and only uploads when `--bucket`/`S3_BUCKET` is supplied. Configure `VITE_FORECAST_BASE_URL` at website build time to read forecasts from a separate CDN; leave unset for bundled snapshots. The scrubber colours show the selected location's forecast wind speed using the map palette, with grey for unavailable/loading values. Single-click selects a map point; double-click zooms without changing the selection.

## Refresh the forecast

Requires Python 3.9+ and an internet connection. This is an ingestion command, not a process that runs on every page load.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r force5/ingest/requirements.txt
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
force5/ingest/fetch_forecast.py DWD discovery, download, validation and publication
force5/ingest/fetch_harmonie.py Met Éireann control download, rotation and regridding
force5/ingest/fetch_ecmwf.py ECMWF IFS 15-day open-data download and crop
public/spots.json           Original eight precomputed forecast locations
data/locations/             Sourced location records and spreadsheet export
src/locations.ts            Map/search merge, aliases and provenance
public/weather/latest.json Model/source/grid metadata, frame URLs, spot series
public/weather/harmonie.json HARMONIE's independent run, grid, frames and attribution
public/weather/ecmwf.json  ECMWF's 85-frame timeline, mixed cadence and attribution
public/weather/<run>/*.json Immutable cropped U/V/gust grids
force5/src/weather.ts      Validation, sampling, units, bearings, frame cache
force5/src/WindMap.tsx      MapLibre basemap, raster colours, particle renderer
force5/assets/             Force5 platform branding
src/App.tsx                Full-screen forecast explorer and floating controls
src/ForecastSheet.tsx      Bottom forecast table for named and arbitrary points
IMPLEMENTATION_PLAN.md     Scope, implementation decisions and next milestone
```

All numeric U/V/gust arrays are in m/s and rounded to 0.01 m/s. `grid` specifies dimensions, spacing and bounds. `runTime` is the forecast initialization; each frame has its own `validTime`. Gust `startStep`/`endStep` are retained as hours since initialization. Gust at forecast hour zero has no accumulation window and is hidden in the main readout. For explicitly unavailable gusts (`gustAvailable: false`), the frame's `gust` array, spot `gust` values and `gustIntervalHours` are `null`, never zero. ECMWF declares `gustMissingHours: [0]` with gusts enabled: only that frame is null; a missing later gust fails publication.

Both the browser and importer use bilinear interpolation. Direction is the meteorological bearing **from** which the wind blows; arrows/particles move **towards** the opposite bearing. Calm wind has no meaningful direction. The particle advection speed is a visual scale, not a real-time speed measurement.

## Sources and limitations

- Weather: [DWD ICON-EU GRIB2](https://opendata.dwd.de/weather/nwp/icon-eu/grib/), [access information](https://opendata.dwd.de/README.txt), [DWD terms/attribution](https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html).
- Basemap: [OpenFreeMap](https://openfreemap.org/quick_start/), with OpenMapTiles/OpenStreetMap attribution. External basemap and Google Fonts requests require internet. Fonts have local fallback stacks.
- Renderer: [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
- HARMONIE: [Met Éireann open-data listing](https://data.gov.ie/dataset/numerical-weather-prediction-data/resource/1fefad43-8aa9-46cb-88f6-053e712cdafa), [near-real-time downloads](https://opendata.met.ie/nwp/near-realtime), [model documentation](https://opendata.met.ie/documentation), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The older empty Apache index is not used.

Set `VITE_BASEMAP_STYLE_URL` in `.env.local` to use a compatible hosted or self-hosted MapLibre style (including working glyphs). Restart/rebuild after changing it. The default style has simplified custom city labels; provider attribution remains visible.

This is a **forecast snapshot**, not a live observation feed. The browser flags runs older than 18 hours and snapshots whose coverage has ended. There is no background refresh service yet. Spatial interpolation makes the map look smooth but cannot increase native detail (6.5 km ICON-EU / 2 km HARMONIE); shelter, headlands and launch-site turbulence remain unresolved. There are no tide, wave or marine warning feeds or rideability scores. The source dialog links to official warnings. Numerical/data-pipeline validation is not a measured forecast-accuracy comparison against observations.

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
