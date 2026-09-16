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

The worker defaults to hourly output and only uploads when `--bucket`/`S3_BUCKET` is supplied. `--models` accepts any registry id: `harmonie icon-eu ecmwf tides`. Configure `VITE_FORECAST_BASE_URL` at website build time to read forecasts from a separate CDN; leave unset for bundled snapshots. The scrubber colours show the selected location's forecast wind speed using the map palette, with grey for unavailable/loading values. Single-click selects a map point; double-click zooms without changing the selection.

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

### ECMWF ENS refresh

```sh
.venv/bin/pip install -r force5/ingest/requirements-worker.txt
npm run weather:refresh:ecmwf-ens
.venv/bin/python force5/ingest/worker.py --models ecmwf-ens --publish-only
```

Downloads ECMWF's open-data ensemble (stream `enfo`, type `pf`) with ranged HTTP
reads and no API key, and publishes `public/weather/ecmwf-ens.json`. It feeds a
future per-spot probability blend and is **not yet selectable in the website**.
Defaults: **25 perturbed members, 6-hourly through +144h** (25 steps).
`--members`, `--step` (3, 6 or 12) and `--hours` are configurable; 00/12 UTC runs
reach +360h, 06/18 only +144h, and `--step 3` exists only within +144h. The
importer never requests `type=cf`: IFS Cycle 50r1 retired `scda` and merged the
ENS control into `oper`, published here as the separate `ecmwf` model, so
`ensemble.control` is always `null`.

Member messages are large, so members and horizon trade directly against
bandwidth. Measured from the real 0.25° `enfo` index on 16 September 2026, one
member-message is 0.84 MB (`10u`), 0.83 MB (`10v`) and 1.39 MB (`10fg`), plus a
2.0 MB step index shared by a step's members: about 3.07 MB per member per step,
or 1.67 MB at +0h, which has no gust period.

| `--members`  | `--step` | `--hours` | Steps | Download per run |
| ------------ | -------- | --------- | ----- | ---------------- |
| 25 (default) | 6        | 144       | 25    | 1.95 GB          |
| 20           | 6        | 144       | 25    | 1.58 GB          |
| 15           | 6        | 240       | 41    | 1.97 GB          |
| 50           | 6        | 72        | 13    | 2.01 GB          |
| 50           | 6        | 144       | 25    | 3.87 GB          |
| 50           | 6        | 240       | 41    | 6.35 GB          |

The default keeps one run just under 2 GB and covers the days where the regional
models stop (HARMONIE +60h, ICON-EU +72h) while the `ecmwf` control continues to
day 15. All 50 members to day 10 would cost over 6 GB per run, twice daily.
Ensemble members are exchangeable, so members 1–25 are a random half of the
ensemble, not a selection of better members; `ensemble.members` records how many
were actually used and `modelDetail` names that count.

Only the ensemble **mean** u/v/gust becomes map frames, with the same crop,
validation and frame JSON as the ECMWF control. `spotForecasts` holds the mean
per spot — means, not most-likely outcomes — and `spotMembers[spotId][index]`
holds `u`/`v`/`gust` arrays indexed by member for the same hour, so a browser
drawing a probability blend never downloads member grids. `gust` is null for
every member only at +0h (`gustMissingHours: [0]`).

Every member message of every step is decoded and validated: centre `ecmf`,
`dataType` `pf`, an expected `number`, the 0.25° grid with a constant signature,
finite values within ±150 m/s, and one shared gust interval per step. A missing
member, a duplicate, a changed grid or a disagreeing gust interval fails the run
before anything is published, preserving the previous manifest. Raw per-step
GRIB is cached under `.cache/ecmwf-ens/<run>/`, and each run reports its own
measured transfer. The spot catalogue is `FORCE5_SPOTS_FILE` if set, otherwise
`public/riding-locations.json` when it exists, otherwise `public/spots.json`.

A verified default run of the live 12 UTC cycle on 16 September 2026 transferred
1.954 GB, validated 1,850 member messages and published 25 mean frames (1.44 MB
of JSON) plus a 114 kB manifest for eight spots in 172 seconds. No ENS snapshot
is committed to the repository.

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

### HARMONIE ensemble refresh (probability blend)

```sh
npm run weather:refresh:harmonie-eps
# Shorter, hourly, or a deeper lag:
.venv/bin/python force5/ingest/fetch_harmonie_eps.py --hours 24 --step 3
.venv/bin/python force5/ingest/fetch_harmonie_eps.py --hours 36 --step 1 --max-lag 11
```

Publishes `public/weather/harmonie-eps.json` with model id `harmonie-eps`: one
precomputed wind series **per ensemble member** for every spot, so an uncertainty
chart never downloads a frame. Default 0–48 hours at three-hour steps.

**What the public endpoints actually allow.** Met Éireann's DINI ensemble runs an
hourly cycle of a control plus five perturbed members, but neither public route
exposes a coherent perturbed member (verified 16 September 2026):

- The near-real-time portal addresses files by name, and all six files a cycle
  writes for one step share the single name `fcYYYYMMDDHH+HHHgrib2_enIoI`. The
  inventory lists six identical names with different sizes and timestamps, and
  `download/nwp?files=<name>` returns exactly one of them — deterministically for a
  given step, but a _different_ member from step to step. Cycle 2026091619 returned
  members 7, 7, 10, 6, 6, 9, 0, 7, 9, 7 … for steps +000…+048, so no member's time
  series can be reconstructed. No `member`, `timestamp`, `size` or `perturbationNumber`
  selector changes the result, and `enIRL25` resolves to the same member as `enIoI`.
- `https://opendata2.met.ie/nwp/<cycle>/mbrNNN/` keeps twelve hourly cycles and
  rotates through all 30 perturbed members, but each perturbed directory publishes
  only eight surface parameters (rain, total precipitation, cloud base, lightning,
  skin/2 m temperature, dew point, visibility) and **no 10 m wind at all**. Only
  `mbr000`, the control, publishes wind there, as speed/direction/gust on the full
  1909 × 1609 DINI grid.

The adapter therefore publishes a **time-lagged control ensemble**: member 0 is the
control of the newest complete cycle, and each further member is the control of an
older hourly cycle shifted onto the anchor's valid-time axis. `ensemble.memberRuns`
gives every member's own initialization, `ensemble.memberLagHours` its lag, and the
manifest states plainly that the spread reflects initialization lag only, not model
perturbations. `--max-lag` (default 6) bounds how far back members may come from.

Member count is limited by the portal keeping roughly three hours of publications:
a cold run assembles two to four members. Validated files stay in
`.cache/harmonie-eps/`, and a cycle qualifies when every file it owes is either
still listed or already cached, so repeated `--step 1` runs accumulate members the
portal has since dropped. `--step 3` runs do not share cached steps between
consecutive anchors, because the three-hour axis shifts parity every hour.

Each member/step is a separate 12.9–13.8 MB ZIP — about **13.0 MB per member-step**
measured, with no server-side subsetting available — so a 17-step, 2-member run
transfers roughly 443 MB and only 8.2 MB of validated U/V survives in the cache.
Budget for this before scheduling hourly.

ecCodes applies the control adapter's checks to every member and step: parameters,
10 m level, Lambert geometry and scanning, earth radius, provider, units, missing
values, `perturbationNumber`/`number` 0, `numberOfForecastsInEnsemble` 31, and each
member's **own** initialization and valid time, which is what catches a lagged step
being off by one. Vectors are rotated to true east/north at native points and
resampled onto the same 233 × 236 Ireland display grid as HARMONIE, so members,
the mean and the control model are directly comparable.

`frames` and `spotForecasts` are the ensemble **mean** of all members, published on
that display grid so the map can show the blend. `spotMembers[spotId][step]` holds
`{hour, validTime, u[], v[], gust[]}` with the arrays indexed by member.

**Gusts are null throughout.** The `ieIoI` control subset carries only signed gust
components (parameters 23/24), never scalar gust speed, exactly as the HARMONIE
control adapter documents, so `gustAvailable` is `false` and no mean or per-member
gust is manufactured. The perturbed `enIoI` files _do_ carry scalar
`max_i10fg` (parameter 22, a one-hour maximum), and so does `mbr000` on opendata2 —
either is the route to real HARMONIE gusts once a usable member source exists.

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
force5/ingest/fetch_ecmwf_ens.py ECMWF ENS members, mean frames and per-spot member series
force5/ingest/fetch_harmonie_eps.py Met Éireann lag-assembled ensemble member series
public/spots.json           Original eight precomputed forecast locations
public/riding-locations.json The 25 public riding places every adapter samples
scripts/export-riding-locations.mjs Regenerates that file from src/locations.ts
data/locations/             Sourced location records and spreadsheet export
src/locations.ts            Map/search merge, aliases and provenance
public/weather/latest.json Model/source/grid metadata, frame URLs, spot series
public/weather/harmonie.json HARMONIE's independent run, grid, frames and attribution
public/weather/ecmwf.json  ECMWF's 85-frame timeline, mixed cadence and attribution
public/weather/gfs.json    GFS's 0.25° timeline, instantaneous gusts and attribution
public/weather/ecmwf-ens.json ECMWF ENS mean frames, ensemble metadata and per-spot member series
public/weather/harmonie-eps.json HARMONIE ensemble: member spot series, mean frames
public/weather/<run>/*.json Immutable cropped U/V/gust grids
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

`schemaVersion` stays 1; every field below is optional and absent from the current
three wind models. `force5/ingest/registry.py` holds one line per model and
`validate_bundle` dispatches on `kind`.

```text
kind          "wind" (default when absent) | "wave" | "tide"
gustKind      "interval" (default) | "instantaneous"
ensemble      {members, control | null, description}
spotMembers   {spotId: [{hour, validTime, u[], v[], gust[]}]}   indexed by member
variables     {shortName: {units, label, description}}          wave bundles
spotSeries    {spotId: [{hour, validTime, values: {var: number|null}}]}
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
- **wave** bundles declare `variables` and carry one numeric array per variable in
  each frame, `null` for land or unresolved cells, never zero, plus `spotSeries`.
  No wave adapter exists yet; the validator and its fake-bundle tests do.
- **tide** bundles carry `stations`, `spots`, `coverage` and an immutable file per
  station. Heights are metres above Chart Datum (LAT); each station publishes its
  `odMalinOffsetMetres` and a `datumNote`, and the OD Malin value is never mixed
  into the curve. Spots with no station in range are published with a `reason`.
  All numeric U/V/gust arrays are in m/s and rounded to 0.01 m/s. `grid` specifies dimensions, spacing and bounds. `runTime` is the forecast initialization; each frame has its own `validTime`. Gust `startStep`/`endStep` are retained as hours since initialization. Gust at forecast hour zero has no accumulation window and is hidden in the main readout. For explicitly unavailable gusts (`gustAvailable: false`), the frame's `gust` array, spot `gust` values and `gustIntervalHours` are `null`, never zero. ECMWF declares `gustMissingHours: [0]` with gusts enabled: only that frame is null; a missing later gust fails publication. The `ecmwf-ens` manifest adds `ensemble` (member count, `control: null`) and `spotMembers` (per-spot arrays indexed by member); its `frames` and `spotForecasts` are ensemble means, and `stepHours`/`stepRanges` describe its chosen cadence exactly.
  An ensemble manifest adds `ensemble` and `spotMembers`. `ensemble.members` is the member count, `ensemble.control` the index of the control member or `null`, and `ensemble.memberRuns` each member's own initialization when members come from different cycles. `spotMembers[spotId]` is the same valid-time axis as `spotForecasts`, but each entry's `u`, `v` and `gust` are arrays indexed by member; `spotForecasts` carries the ensemble mean. `frames` may be empty only when `ensemble` is present.

Both the browser and importer use bilinear interpolation. Direction is the meteorological bearing **from** which the wind blows; arrows/particles move **towards** the opposite bearing. Calm wind has no meaningful direction. The particle advection speed is a visual scale, not a real-time speed measurement.

## Multi-model data layer

Data-layer modules for the planned probability blend. They are pure TypeScript with
unit tests and no UI: nothing in the dock consumes them yet. See the
[multi-model plan](docs/MULTI_MODEL_PLAN.md) for the ingest side.

```text
force5/src/units.ts      Units type, conversion, labels, formatted speeds
force5/src/manifests.ts  Model registry (live and planned) and the manifest cache
force5/src/series.ts     Precomputed per-spot and per-member series access
force5/src/blend.ts      Common hourly axis, interpolation, statistics, candles, plot helpers
force5/src/sun.ts        Sunrise, sunset, civil twilight, night intervals for shading
force5/src/prefs.ts      Row/unit/view/model preferences, persisted best effort
force5/src/tides.ts      Tide manifest, station curves, heights and high/low events
```

`validateManifest` now also accepts the optional keys the new adapters publish, at
`schemaVersion` 1: `kind` (`wind`, `wave` or `tide`; absent means wind), `gustKind`
(`instantaneous` gusts declare `[hour, hour]` at every frame including hour 0 and
have no `gustMissingHours`), and `ensemble` plus `spotMembers` for per-member spot
series. Only an ensemble manifest may publish an empty `frames` list, because the
chart reads precomputed series and never downloads frames.

Blend statistics are per hour: count, min, max, quartiles, median, mean, spread and
an agreement label. Spread is the full range in metres per second; agreement is
`high` below 4 knots of spread and `moderate` below 8. Interpolation happens in u/v
space, never between speeds or wrapped bearings, and never across a gap wider than
twice a model's median cadence. The registry lists models whose adapter is still
planned with `planned: true` so the dock can show them greyed instead of hiding them;
model identity hues are provisional pending a design ruling.

## Sources and limitations

- Weather: [DWD ICON-EU GRIB2](https://opendata.dwd.de/weather/nwp/icon-eu/grib/), [access information](https://opendata.dwd.de/README.txt), [DWD terms/attribution](https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html).
- Basemap: [OpenFreeMap](https://openfreemap.org/quick_start/), with OpenMapTiles/OpenStreetMap attribution. External basemap and Google Fonts requests require internet. Fonts have local fallback stacks.
- Renderer: [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
- GFS: [NOAA NCEP product documentation](https://www.nco.ncep.noaa.gov/pmb/products/gfs/), [NOMADS GRIB filter](https://nomads.ncep.noaa.gov/), [NOAA Open Data registry](https://registry.opendata.aws/noaa-gfs-bdp-pds/), [NWS disclaimer](https://www.weather.gov/disclaimer). US Government work in the public domain; Force5 publishes modified output, which is not official government material, and NOAA/NWS does not endorse this site.
- Tides: [Marine Institute ERDDAP](https://erddap.marine.ie/erddap/tabledap/imiTidePrediction.html), `imiTidePrediction` and `IMI_TidePrediction_HighLow`, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Predictions only; Northern Ireland has no Marine Institute station.
- HARMONIE: [Met Éireann open-data listing](https://data.gov.ie/dataset/numerical-weather-prediction-data/resource/1fefad43-8aa9-46cb-88f6-053e712cdafa), [near-real-time downloads](https://opendata.met.ie/nwp/near-realtime), [model documentation](https://opendata.met.ie/documentation), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The older empty Apache index is not used.

Set `VITE_BASEMAP_STYLE_URL` in `.env.local` to use a compatible hosted or self-hosted MapLibre style (including working glyphs). Restart/rebuild after changing it. The default style has simplified custom city labels; provider attribution remains visible.

This is a **forecast snapshot**, not a live observation feed. The browser flags runs older than 18 hours and snapshots whose coverage has ended. There is no background refresh service yet. Spatial interpolation makes the map look smooth but cannot increase native detail (6.5 km ICON-EU / 2 km HARMONIE); shelter, headlands and launch-site turbulence remain unresolved. Tidal predictions are ingested but not yet shown in the browser; there are no wave or marine warning feeds and no rideability scores. The source dialog links to official warnings. Numerical/data-pipeline validation is not a measured forecast-accuracy comparison against observations.

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
