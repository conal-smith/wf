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
- **GEFS · 31 members** adds NOAA's public-domain global ensemble over the same box at 0.25°, 6-hourly to +240 h. The map draws the ensemble **mean**, and the manifest also carries every member's own series for each riding place, so a probability view never downloads member grids. A mean is not the most likely outcome, its gusts are instantaneous like GFS's, and averaging 31 of them reads lower than any single member's gust.
- Edge-to-edge, bottom-flush forecast dock open on arrival, with three views over one shared set of time columns: **Blend** (the default), **Candles** and **Table**. The table keeps the aligned, horizontally scrollable wind, gust and direction rows. Click a time column to update the map. HARMONIE gusts are hourly maxima from the control's gust components; the bundled snapshot predates this and still shows `—`.
- The grid opens around the current time. A dashed **Now** line marks real clock time between forecast timestamps, separately from the selected forecast column. It updates every 30 seconds and on tab return without interrupting manual browsing; it is hidden when the current time lies outside the model's forecast range.
- Magnifying-glass button expands county/name search; point selection keeps the selected location above the sheet.
- Small standalone Force5 branding; coastline outlines and a soft shadow above the wind layer add depth to the land.
- Knots, metres per second, km/h and mph, chosen in the dock's display options, which drive the charts, the table and the map readouts together.
- Irish local time with explicit model initialization in UTC.
- Real source information, stale/expired snapshot status, retryable frame errors.
- Responsive glass surfaces, keyboard controls and Escape dismissal; reduced-motion and reduced-transparency support with an opaque fallback.

The [location research](data/locations/README.md) retains 46 sourced records alongside the eight original spots (two duplicates merged). The public map and search show only 25 riding-place references, excluding business listings and broad area pins. Kilcrea and Newtownards use place names with their original coordinate provenance and access caveats. New locations sample the forecast grids on demand. These are source-listed references, not verified launches. Paid business listings are a future product feature, not implemented here.

## Run it yourself on one machine

The [local deployment guide](deploy/local/README.md) sets up the whole site on a single
computer with Docker Compose: a Caddy container serving the built site and the forecast
data on one origin, a scheduler running the ingest worker per model on documented
cadences, and a retention job. No cloud account, no S3 bucket, no CDN and no secrets,
reachable over your LAN or a Tailscale mesh.

```sh
npm run deploy:build
npm run deploy:up
npm run deploy:run -- --models gfs --step 3   # the quickest real forecast, ~1 minute
npm run deploy:status                          # each manifest's run age
open http://127.0.0.1:8080/
```

Check freshness with `npm run deploy:status`: it prints every model's run, age, frame
count and forecast horizon, and exits nonzero when a model is missing, stale or
expired. `npm run deploy:logs` follows the ingest and web logs; each job logs a JSON
`forecast_complete` or `forecast_failed` event.

## Live forecast worker

See the [live forecast pipeline runbook](docs/LIVE_FORECAST_PIPELINE.md) for the
separate AWS design: container build/run instructions, scheduled ECS tasks, safe S3
publishing, CDN caching, IAM, monitoring and remaining launch checks.

```sh
docker build -f force5/Dockerfile -t force5-forecast:local .
docker run --rm -v force5-work:/data force5-forecast:local --models harmonie --step 1
```

The worker defaults to hourly output and only uploads when `--bucket`/`S3_BUCKET` is supplied. `--models` accepts any registry id: `harmonie icon-eu icon-eu-weather ecmwf gfs gefs tides mi-swan`. Configure `VITE_FORECAST_BASE_URL` at website build time to read forecasts from a separate CDN; leave unset for bundled snapshots. The scrubber colours show the selected location's forecast wind speed using the map palette, with grey for unavailable/loading values. Single-click selects a map point; double-click zooms without changing the selection.

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

### ICON-EU surface weather refresh

```sh
npm run weather:refresh:icon-weather
# Shorter, hourly, or every variable on the map:
.venv/bin/python force5/ingest/fetch_icon_weather.py --hours 12 --step 3
.venv/bin/python force5/ingest/fetch_icon_weather.py --hours 24 --step 1
.venv/bin/python force5/ingest/fetch_icon_weather.py --hours 12 --frame-variables all
```

The same DWD ICON-EU open data as the wind importer (CC BY 4.0, no API key), read for
thirteen single-level surface parameters and published as a **`kind: "weather"`
variables bundle** — the same shape as the wave bundle: a declared `variables` map, one
array per gridded variable in every frame, and a precomputed `spotSeries` for all 25
riding locations. Model id `icon-eu-weather`, manifest `public/weather/icon-eu-weather.json`.
Default: 0–72 hours at three-hour steps (25 frames); `--step 1` works to +72 h, and
`--hours` takes 3–72 divisible by the step. Discovery, the four-cycle inventory check,
the 12-hour freshness limit, at most four concurrent downloads into `.cache/grib/<run>/`
and the bz2/GRIB checks are the wind importer's, reused unchanged. **The browser now
reads this manifest**: `icon-eu-weather` is a live `kind: "weather"` model in
`MODEL_CATALOG`, `availableModels()` fetches it alongside the wind and wave models,
and the dock's Air, Rain, Weather, Cloud, Pressure and Sea rows read its spot series
through `force5/src/surface.ts`. It is not map-capable — nothing draws a temperature
raster yet — so its frames are still unread by the website.

Fourteen published variables, converted and rounded once so nothing downstream guesses:

| Variable                       | DWD parameter                  | Published as        |
| ------------------------------ | ------------------------------ | ------------------- |
| `t2m`, `td2m`                  | `t_2m`, `td_2m` (K)            | °C, 0.1             |
| `rh2m`                         | `relhum_2m`                    | %, whole            |
| `tp`                           | `tot_prec` (kg/m² since run)   | mm, 0.1             |
| `precip`                       | derived from `tot_prec`        | mm, 0.1 per step    |
| `clct`, `clcl`, `clcm`, `clch` | `clct`, `clcl`, `clcm`, `clch` | %, whole            |
| `pmsl`                         | `pmsl` (Pa)                    | hPa, 0.1            |
| `vis`                          | `vis` (m)                      | km, 0.1             |
| `cape`                         | `cape_ml`                      | J/kg, whole         |
| `ww`                           | `ww`                           | WMO code, integer   |
| `tg`                           | `t_g` (K)                      | °C, 0.1 — SST proxy |

All thirteen directories were confirmed present in the live index on 17 September 2026;
none had to be dropped. `tot_prec` is an accumulation (`stepType: accum`, always starting
at initialization), so `precip[h] = tp[h] − tp[h−step]`, clamped at zero and `null` at hour
0, which has no interval; every frame and series step carries the interval in
`precipIntervalHours`. `ww` is a **code table**, not a measurement: its variable declares
`"kind": "code"`, so the publisher checks it is a whole code rather than range-checking it,
and a spot reads the code of the cell it sits in — a code is never interpolated, averaged
or blended. `tg` is the model's ground/skin temperature: over sea it is ICON's own SST
field and published as a labelled **proxy**, not an observation, and over land it is the
skin temperature, which on a sunny afternoon runs far above `t2m`. ecCodes checks the
parameter category/number, the numeric level and level type, units, statistical processing,
initialization, valid time and the originating centre (`edzw`, because DWD's own local
tables are what name the cloud, CAPE and present-weather parameters) on all thirteen
messages of every step, and a value outside its plausible range fails the run instead of
being published.

The Ireland/Atlantic crop and 0.0625° grid are the wind importer's: 321 × 177 = 56,817
cells, 18°W–2°E / 48°–59°N, rows north-to-south. Thirteen arrays per frame would be about
3 MB of JSON, so frames carry a declared subset — `t2m`, `precip`, `clct`, `pmsl`, `ww`,
about 1.2 MB a frame — while `spotSeries` carries every variable at every hour.
`--frame-variables` takes any distinct subset, or `all`.

A measured live run (18 UTC on 16 September 2026, cold cache, default 0–72 h): **67
seconds**, 301 MB of bz2 GRIB in 325 files, 25 frames totalling 30.3 MB (1.19–1.27 MB
each) and a 156 KB manifest. The bundled acceptance snapshot is the same run through
+3 h: 2 frames, 2.4 MB, with a 17 KB manifest. Brandon Bay from that run: 15.6 °C with
97 % cloud and 1016.8 hPa at 18 UTC, then 0.6 mm of rain in 18–21 UTC (`ww` 61, rain)
at 16.0 °C and 1014.6 hPa, 0.5 mm more by midnight with `ww` 80 (showers), and a drier
14.2 °C at 03 UTC with 63 % cloud and 1012.9 hPa.

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

### GFS-Wave refresh

```sh
npm run weather:refresh:gfs-wave
# Shorter, hourly, or the S3 fallback:
.venv/bin/python force5/ingest/fetch_gfswave.py --hours 48 --step 3
.venv/bin/python force5/ingest/fetch_gfswave.py --hours 24 --step 1
.venv/bin/python force5/ingest/fetch_gfswave.py --hours 240 --step 3 --source s3
```

NOAA's WAVEWATCH III wave forecast, public domain, no API key. Default: 0–240 hours
at three-hour steps (81 frames). `--step 1` reaches +120 h, as far as NOAA publishes
hourly wave files; `--hours` takes 3–384 divisible by the step. Inventory-based
discovery of the newest complete cycle, the 12-hour freshness limit, two throttled
connections and the `--source s3` fallback all work as in the GFS wind importer.
A live 240-hour run took 75 seconds: 5.3 MB downloaded, 81 frames and 45 MB published.
The dock reads this manifest: it is the fallback wave source for every spot the
Irish shelf model cannot resolve, and the only one a fresh checkout has, because
`mi-swan.json` is git-ignored. Map frames are still an ingest deliverable; the
browser reads only `spotSeries`.

Nine variables per frame, all SI: `swh`/`pp1d`/`mwd` for the whole spectrum,
`shww`/`mpww`/`mdww` for the local wind sea, and `swell1_h`/`swell1_p`/`swell1_d` for
the first swell partition. Directions are the bearing waves come **from**, degrees
true, like the wind rows. The partitions are separate wave trains arriving together,
so their heights add in energy, not in metres. Partitions 2 and 3 exist in the source
and are deliberately not published: they would add two thirds again to every frame.
ecCodes checks discipline 10 / category 0, the parameter number, the fixed surface
(code 1 for the surface fields, 241 carrying the partition number for the swell
sequence), units, instantaneous processing, initialization, valid time and ranges
(0–30 m, 0–30 s, one turn of direction) on all nine messages of every step.

The source grid is `arctic.9km`: 1006 × 1006 **polar stereographic** cells of 9 km,
true at 70°N, oriented on 0°, centred on the pole, and it does cover the Irish Sea.
`global.0p16` stops at 52.5°N and `atlocn.0p16` is the west Atlantic, so neither can
serve Ireland. ecCodes cannot compute coordinates for this grid — its polar
stereographic iterator supports only a spherical earth, and these files declare
WGS84 — so the importer reconstructs them with pyproj and checks them first:

- the whole grid's published corner projects onto the pole-centred lattice to better
  than a metre on WGS84 and nowhere near it on any sphere, which is what identifies
  the declared shape as the one the grid was built with;
- NOMADS rewrites a cut-out's corner coordinates using NCEP's legacy 6367.47 km
  sphere, about one cell from the WGS84 position of the same point, so the corner is
  matched back to an integer parent cell on that sphere and the block is then placed
  on the declared WGS84 lattice. The two Ireland cut-outs resolve to parent blocks
  (409, 18) and (398, 4), both confirmed against the whole-grid message by identical
  values. A corner that is not on the lattice fails the run.

Values are then bilinearly resampled onto a regular 0.05° display grid, 121 × 101,
11°W–5°W / 51°–56°N, rows north-to-south, columns west-to-east. The download box is a
degree larger on every side because the native block is a rotated quadrilateral in
latitude and longitude. A display cell whose four native neighbours are all land, ice
or unresolved is `null`, never zero; where part of the stencil is land the remaining
weights are renormalised, so the coastal water the product exists for survives, and
water values can reach up to one 9 km cell inland. Directions are averaged as unit
vectors, never as degrees. Point sampling of a direction is then the same plain
bilinear as every other variable, which is wrong inside a cell straddling 0°/360°.

**Nine of the 25 riding locations have no waves at 9 km.** `spotCoverage` records per
spot whether the cell over it is land (`landMasked`), whether any value resolved, and
a sentence the UI can show. Rusheen Bay, Tramore, Lahinch, Pollan Bay, Tullan Strand,
Spiddal, Mulranny, Newtownards and Lough Derg sit in land or enclosed cells; seven
more are land-masked but take values from the resolved water beside them, which
describes the nearby open sea rather than the shoreline. This is a 9 km global wave
model: no breaking waves, no refraction round a headland, no idea a bay is sheltered.

The bundled acceptance snapshot is 16 September 2026 at 18 UTC through +9 h: 4 frames,
approximately 2.2 MB. Wave frames carry nine arrays over 12,221 cells, about 560 KB
each, so a full 240-hour run is roughly 45 MB and is generated locally, not committed.

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

### Sea temperature refresh

```sh
npm run sea:refresh
.venv/bin/python force5/ingest/fetch_sea_temperature.py --max-distance-km 120 --days 3
```

**Observations, not a forecast.** Marine Institute ERDDAP in-situ water
temperature, CC BY 4.0, no account. Every riding location takes the nearest
station that has actually reported inside the freshness window; the manifest's
`run` is the **newest observation hour**, so the registry's 48-hour limit measures
how stale the reading is rather than how long ago the job ran. Nothing is
modelled, gridded or extrapolated forward: the newest reading is as recent as the
water gets.

Three networks are read, preferred in this order, because water at a beach is not
water on the open shelf — in summer an offshore buoy reads colder than a bay, in
winter warmer:

```text
coastal   ICTempNetwork       shore loggers in the aquaculture bays, 1-20 m
sentinel  compass_mace_head   Mace Head met-ocean buoy, SBE sensor at the surface
          sentinel_lehanagh   Lehanagh Pool met-ocean buoy, 10-minute cadence
buoy      IWBNetwork          the offshore weather buoys M2, M3, M5, M6, hourly
```

A row survives only if the network's own quality flag calls it usable and the
value is inside −2…35 °C. `ICTempNetwork` publishes `QFlag` 1 (good) and 40
(failed); `IWBNetwork` publishes SeaDataNet `QC_Flag` 0 (unknown), 1 (good) and 9
(missing) and delivers **real-time rows unflagged as 0**, so for that network the
range check is what actually filters. The sentinel buoys have no quality column at
all, which the manifest says outright.

The series thins readings to one per aligned three-hour slot over seven days,
keeping each reading's **own** time and value — no averaging, no interpolation and
no relabelling a measurement onto a slot it was not taken at. A slot with no
reading within 90 minutes contributes nothing, so a source coarser than the step
is simply sparser, and no slot reaches past the newest reading. Spots with nothing
in range, or nothing reporting, are published with a stated reason.

**Station coverage is genuinely thin: 9 of the 25 riding locations at the default
60 km.** The Marine Institute runs no live inshore temperature station on the
north, north-west, south or east coast. `ICTempNetwork` is the densest coastal
network Ireland has and is read first, but it is a **delayed-mode logger archive**
— sites are downloaded in batches, and at the time of writing its newest reading
anywhere was eight months old, so it contributes no station on a normal day. M4
off north-west Donegal has been off station since March 2026; because stations are
discovered from the data rather than hard-coded, Donegal gains coverage the day it
returns. Raising `--max-distance-km` to 120 reaches 17 of 25, at the cost of
calling a buoy 120 km offshore "the sea temperature here".

A live run took **3.3 seconds** for 6 stations across the 25 riding locations and
published **29,755 bytes** in a single file; the adapter refuses to publish above
300 KB rather than silently growing the pointer, at which point the series would
move to per-station files as the tides do. `public/marine/sea-temperature.json` is
replaced only after the whole manifest is built.

| Riding location                | County    | Station       | Network  | Distance | Reading                                |
| ------------------------------ | --------- | ------------- | -------- | -------- | -------------------------------------- |
| Dollymount                     | Dublin    | M2            | buoy     | 48.5 km  | 15.47 °C                               |
| Kilcrea — Malahide Estuary     | Dublin    | M2            | buoy     | 49.4 km  | 15.47 °C                               |
| Rusheen Bay                    | Galway    | Lehanagh Pool | sentinel | 49.3 km  | 16.29 °C                               |
| Seanchéibh an Spidéil          | Galway    | Lehanagh Pool | sentinel | 38.4 km  | 16.29 °C                               |
| Fanore Beach                   | Clare     | Lehanagh Pool | sentinel | 47.3 km  | 16.29 °C                               |
| Mulranny / Murrivaugh Beach    | Mayo      | Lehanagh Pool | sentinel | 55.7 km  | 16.29 °C                               |
| Lahinch Beach                  | Clare     | Mace Head     | sentinel | 58.9 km  | 16.20 °C                               |
| Tramore                        | Waterford | M5            | buoy     | 59.4 km  | 16.73 °C                               |
| Grange Beach                   | Wexford   | M5            | buoy     | 57.1 km  | 16.73 °C                               |
| Keel Beach                     | Mayo      | —             | —        | 65.5 km  | Nearest reporting station beyond 60 km |
| White Strand Doonbeg           | Clare     | —             | —        | 69.6 km  | Nearest reporting station beyond 60 km |
| Blackrock Beach                | Louth     | —             | —        | 81.3 km  | Nearest reporting station beyond 60 km |
| Drum Beach                     | Mayo      | —             | —        | 89.7 km  | Nearest reporting station beyond 60 km |
| Cross Beach — Belmullet        | Mayo      | —             | —        | 91.4 km  | Nearest reporting station beyond 60 km |
| Mountshannon, Lough Derg       | Clare     | —             | —        | 106.3 km | Inland lake; no sea station            |
| Maharees Beach                 | Kerry     | —             | —        | 116.0 km | Nearest reporting station beyond 60 km |
| Brandon Bay                    | Kerry     | —             | —        | 117.4 km | Nearest reporting station beyond 60 km |
| Newtownards — Strangford Lough | Down      | —             | —        | 120.4 km | Nearest reporting station beyond 60 km |
| Inchydoney                     | Cork      | —             | —        | 124.0 km | Nearest reporting station beyond 60 km |
| Ballyholme                     | Down      | —             | —        | 132.7 km | Nearest reporting station beyond 60 km |
| Tullan Strand                  | Donegal   | —             | —        | 158.3 km | Nearest reporting station beyond 60 km |
| Rossnowlagh                    | Donegal   | —             | —        | 166.4 km | Nearest reporting station beyond 60 km |
| Benone Strand                  | Derry     | —             | —        | 208.4 km | Nearest reporting station beyond 60 km |
| Magheraroarty                  | Donegal   | —             | —        | 222.8 km | Nearest reporting station beyond 60 km |
| Pollan Bay                     | Donegal   | —             | —        | 238.1 km | Nearest reporting station beyond 60 km |

Measured 17 September 2026 at 00:17 UTC, newest observation 2026-09-16 23:00 UTC.
A station 50 km offshore is not the water at the launch: show the distance with
every reading.

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

### GEFS refresh

```sh
.venv/bin/pip install -r force5/ingest/requirements-worker.txt
npm run weather:refresh:gefs
.venv/bin/python force5/ingest/worker.py --models gefs --publish-only
# Shorter, denser, fewer members, or the S3 fallback:
.venv/bin/python force5/ingest/fetch_gefs.py --hours 120 --step 3
.venv/bin/python force5/ingest/fetch_gefs.py --members 11 --hours 240
.venv/bin/python force5/ingest/fetch_gefs.py --hours 24 --source s3
```

Downloads NOAA's Global Ensemble Forecast System at 0.25° and publishes
`public/weather/gefs.json`. Public domain, no API key. Defaults: **all 31 members,
6-hourly through +240h** (41 steps, `stepHours: 6` with a single-entry `stepRanges`
ladder that describes the cadence exactly). `--members` (2–31), `--step` (3 or 6)
and `--hours` (3–240, divisible by the step) are configurable. Member 0 is the
`gec00` low-resolution control and 1–30 are `gep01`–`gep30`; the control is
included in the published mean, so unlike ECMWF ENS this ensemble has a real
`ensemble.control` of `0`.

The source files are the `pgrb2sp25` "s" parameter set
(`gefs.YYYYMMDD/HH/atmos/pgrb2sp25/ge{c00|pNN}.tHHz.pgrb2s.0p25.fFFF`), which is the
only 0.25° GEFS set carrying UGRD/VGRD at 10 m and GUST at the surface, and which
stops at +240h — beyond that GEFS is 0.5° only, so `--hours` is capped at 240.

**Bandwidth: the NOMADS filter is not a convenience here, it is the only affordable
route.** Both paths were measured on the live 18 UTC cycle of 16 September 2026,
`+006h`:

| Route                   | UGRD    | VGRD    | GUST    | Sidecar | Per member-step | Per default run (31 × 41) |
| ----------------------- | ------- | ------- | ------- | ------- | --------------- | ------------------------- |
| NOMADS filter (default) | 5.65 kB | 5.19 kB | 4.28 kB | –       | 14.7–15.6 kB    | **19.3 MB**               |
| S3 `.idx` byte ranges   | 830 kB  | 808 kB  | 536 kB  | 2.4 kB  | 2.18–2.24 MB    | 2.84 GB                   |

The filter crops the Ireland box server-side, so one member-step is an 81 × 45
grid of three messages and averages **15.2 kB** across all 31 members. The S3 path
must transfer whole-globe messages, which is about **148 times** the traffic: it is
an outage fallback, not the normal route, and `--source s3` prints its own measured
total. The default therefore keeps a run around 19 MB, far under the 500 MB budget;
even all 31 members at `--step 3` (81 steps) is only about 38 MB.

The two routes were verified to decode to **identical** cropped member values on the
same 81 × 45 grid for `gec00` and `gep01` at +000h and +006h of the 2026-09-16
12 UTC cycle, so `--source s3` changes only the bytes on the wire.

Request count, not bytes, is the binding constraint. A default run makes 1,271
filter requests; at NOMADS' asked-for two connections and a minimum pause between
them that is the bulk of the run's wall time. `--step 3` doubles it.

| `--members`  | `--step` | `--hours` | Steps | Requests | Download per run |
| ------------ | -------- | --------- | ----- | -------- | ---------------- |
| 31 (default) | 6        | 240       | 41    | 1,271    | 19.3 MB          |
| 31           | 6        | 120       | 21    | 651      | 9.9 MB           |
| 31           | 3        | 240       | 81    | 2,511    | 38.2 MB          |
| 11           | 6        | 240       | 41    | 451      | 6.9 MB           |

The importer lists the provider's own inventory **per member** for each 6-hourly
cycle, newest first, and selects the newest cycle that contains every requested
step for every requested member. A cycle still writing later members is skipped —
this is common, because the 0.25° members finish 4.5–6 hours after run time and not
in member order. Runs older than 12 hours or dated in the future are refused.

GEFS longitudes run 0–360°; they are normalised to −180…180° before cropping to the
shared Ireland/Atlantic box (18°W–2°E, 48°–59°N), giving the same 81 × 45 grid at
0.25° as the GFS control product. Every member message of every step is decoded and
validated with the GFS contract plus the ensemble checks: centre `kwbc`,
`perturbationNumber` equal to the requested member, `cf` for the control and `pf`
for a perturbed member, 30 perturbed members declared in the message, parameter,
level, units, earth-relative vectors, regular geometry, a constant grid signature,
initialization and valid time, finite values within ±150 m/s and a non-negative
gust. A missing member, a duplicate message, a changed grid or a mislabelled member
fails the run before anything is published, preserving the previous manifest. Raw
per-member GRIB is cached under `.cache/gefs/<run>/`, and a cache entry that will
not revalidate is fetched once more rather than published.

**GEFS gusts are instantaneous, not period maxima**, exactly like the GFS control:
the manifest declares `gustKind: "instantaneous"` with `gustIntervalHours:
[hour, hour]` on every frame, initialization included, and no `gustMissingHours`.
Averaging instantaneous gusts across 31 members lowers them further than any single
member's gust, so do not compare a GEFS mean gust with an ICON-EU or ECMWF interval
maximum.

Only the ensemble **mean** u/v/gust becomes map frames
(`weather/gefs-<run>-<hours>h-v1/<hhh>-<hash>.json`), with the same crop, validation
and frame JSON as the GFS control. `spotForecasts` holds the mean per spot — a mean,
not a most-likely outcome — and `spotMembers[spotId][step]` holds `u`/`v`/`gust`
arrays indexed by member with the control at index 0, so a browser drawing a
probability blend never downloads member grids. A riding location that falls outside
the 0.25° crop keeps its mean series of nulls but gets no member series, because the
ensemble contract requires a number per member; all 25 published locations are
inside the crop. No GEFS snapshot is committed: an ensemble manifest is large.

The mean is a **vector** mean of u and v. When members disagree on direction its
speed is lower than the members' median speed, and increasingly so with lead time:
in the verified run below, Brandon Bay at +168 h has a mean of 1.7 kt against a
median member speed of 4.4 kt. Read the mean as a vector average, not as a forecast
wind strength, and derive a speed distribution from `spotMembers`.

A verified default run of the live 12 UTC cycle on 16 September 2026 transferred
**18.4 MB** over 1,271 member-steps (**14.5 kB** each), validated 3,813 member
messages, and published 41 ensemble-mean frames (2.38 MB of JSON, 56–61 kB each)
plus a **659 kB** manifest carrying 25 locations × 41 steps × 31 members, in
**781 seconds** with two readers. Requests, not bytes, took that time. The 18 UTC
cycle was skipped as incomplete — 12 of its 31 members were still being written
about 5.5 hours after run time — so the importer used the 12 UTC cycle, 11.5 hours
old against the 12-hour limit. The run wrote only to a scratch work directory and
created no AWS resources.

Brandon Bay (`brandon`) member spread from that run, wind speed in knots:

| Lead   | Valid (UTC)      | Mean | Min  | p10  | Median | p90  | Max  | Mean gust |
| ------ | ---------------- | ---- | ---- | ---- | ------ | ---- | ---- | --------- |
| +0 h   | 2026-09-16 12:00 | 12.4 | 10.7 | 11.5 | 12.4   | 13.2 | 13.8 | 15.7      |
| +24 h  | 2026-09-17 12:00 | 18.1 | 15.5 | 16.4 | 18.5   | 19.7 | 20.7 | 24.4      |
| +48 h  | 2026-09-18 12:00 | 16.9 | 12.1 | 14.8 | 17.2   | 19.3 | 20.7 | 30.8      |
| +72 h  | 2026-09-19 12:00 | 12.3 | 4.9  | 8.2  | 12.0   | 17.2 | 19.6 | 18.1      |
| +120 h | 2026-09-21 12:00 | 5.9  | 2.0  | 3.5  | 6.2    | 9.4  | 10.7 | 8.8       |
| +240 h | 2026-09-26 12:00 | 2.9  | 1.4  | 1.8  | 6.9    | 13.7 | 20.1 | 9.9       |

The spread widens with lead time as it should: a 3 kt range at initialization, a
5 kt range on day one, and on day ten members that disagree between 1 and 20 kt.
That is model uncertainty, not a rideability probability, and it says nothing about
shelter, headlands or launch-site turbulence.

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
location is a single 10 KB request. This is Ireland's own wave model, and the dock
prefers it over GFS-Wave for every spot it resolves; `npm run weather:refresh:mi-swan`
is what puts it on screen, because the manifest is not committed.

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

**HARMONIE gusts are hourly maxima taken from the control's own gust components.**
The Ireland subset publishes the time-maximum gust as the signed component pair
`max_10efg` / `max_10nfg` (GRIB2 parameters 23/24), not as the scalar
`max_i10fg` (parameter 22). Met Éireann's full-domain `CONTROL_grib2_ie`
export carries all three together, and there the components' magnitude reproduces
the scalar to within GRIB packing precision across the whole 1909 × 1609 grid,
so the magnitude is the provider's gust rather than a derived estimate. See
[gust data notes](docs/GUST_DATA.md) for the measured agreement. Each value is the
maximum over the one hour ending at the forecast time, read from
`lengthOfTimeRange` / `indicatorOfUnitForTimeRange`, never assumed. Initialization
(+0h) has a zero-length window and is published as unavailable, not zero. If any
later step lacks both components the whole run publishes wind-only with
`gustAvailable: false`; ICON-EU gusts are never substituted.

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

### Backfilling spot series

A snapshot published before a riding location existed has no series for it, and the
blend and candle views are unavailable wherever a series is missing. Re-downloading
an old run is not possible — providers rotate them within hours — but every frame is
bundled, and the adapters derive each series from nothing but the frame grids and
`sample()`, so the missing series can be recomputed exactly:

```sh
.venv/bin/python force5/ingest/backfill_spots.py --all --check   # report, write nothing
.venv/bin/python force5/ingest/backfill_spots.py harmonie icon-eu ecmwf gfs
```

Only `spotForecasts` (wind) or `spotSeries` (wave) is rewritten, atomically and in
place: the frames are untouched, so no content hash moves, and the manifest keeps its
key order and its `generatedAt`. Series that are already published are recomputed as
a check and then kept byte-for-byte; a disagreement beyond 0.005 m/s means the frames
and the manifest describe different data, so the run aborts without writing rather
than papering over a corrupt bundle. Gust rules are taken from the manifest, not
guessed: `gustAvailable: false` or an hour in `gustMissingHours` is `null` for every
spot, and a frame that carries a gust the manifest calls unavailable is a fault. A
spot outside the grid samples to `null`, as ECMWF and GFS publish it.

Ensemble manifests are refused, because `spotMembers` holds per-member values while
the bundled frames are only the ensemble mean. Wave bundles are recomputed the same
way when they publish frames for every declared variable; SWAN publishes no frames
and is skipped with a message, as is any bundle whose `frameVariables` narrows the
frames or whose `spotCoverage` lacks a location, since that flag comes from the
native land mask rather than the published grid.

The bundled runs' horizons have passed, so `worker.py --publish-only` refuses them:
`--max-age-hours` caps a run's **age**, not its horizon. ECMWF and GFS still validate
through the worker; for HARMONIE and ICON-EU call
`validate_bundle(public, model, now=<a time inside the run>)` directly.

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
force5/ingest/fetch_gefs.py NOAA GEFS 0.25° ensemble members, mean frames and per-spot series
force5/ingest/fetch_gfswave.py NOAA GFS-Wave 9 km polar-stereo decode and resampling
force5/ingest/fetch_icon_weather.py DWD ICON-EU surface weather variables (temperature to CAPE)
force5/ingest/fetch_tides.py Marine Institute tidal predictions per riding location
force5/ingest/fetch_sea_temperature.py Marine Institute in-situ sea temperature observations
force5/ingest/fetch_ecmwf_ens.py ECMWF ENS members, mean frames and per-spot member series
force5/ingest/fetch_harmonie_eps.py Met Éireann lag-assembled ensemble member series
force5/ingest/fetch_mi_swan.py Marine Institute Irish Shelf SWAN wave series per riding location
force5/ingest/backfill_spots.py Recomputes a published manifest's spot series from its own frames
force5/ingest/scheduler.py  Per-model cadences for the local deployment, one job at a time
force5/ingest/prune.py      Retention: unreferenced aged objects and raw cache
force5/ingest/status.py     Freshness report for every published manifest
deploy/local/               Docker Compose stack, Caddyfile, schedule and guide
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
public/weather/gefs.json   NOAA GEFS mean frames, ensemble metadata and per-spot member series (not committed)
public/weather/harmonie-eps.json HARMONIE ensemble: member spot series, mean frames
public/weather/mi-swan.json Irish Shelf SWAN wave series per riding location (git-ignored)
public/weather/gfs-wave.json GFS-Wave variables, display grid, spot series and coverage
public/weather/icon-eu-weather.json ICON-EU surface variables, frame subset and 25 spot series
public/weather/<run>/*.json Immutable cropped U/V/gust or wave-variable grids
public/marine/tides.json   Tide stations, spot assignments, coverage and datum notes
public/marine/tides-*.json Immutable per-station curves and high/low events
public/marine/sea-temperature.json Observed sea temperature: stations, per-spot reading and series
force5/src/weather.ts      Validation, sampling, units, bearings, frame cache
force5/src/variables.ts    The shared wave/weather bundle contract, validator and axis matching
force5/src/waves.ts        The wave-shaped door onto it: coverage notes, sea-state fields, source order
force5/src/surface.ts      The weather-shaped door: surface fields, source order, WMO present weather
force5/src/seaTemperature.ts Observed sea temperature: manifest contract and per-spot readings
force5/src/WindMap.tsx      MapLibre basemap, raster colours, particle renderer
force5/assets/             Force5 platform branding
src/App.tsx                Full-screen forecast explorer and floating controls
src/ForecastDock.tsx       Dock shell: toolbar, scrubber, shared header, rows, filter
src/ForecastHeader.tsx     Day groups with sun times and the hour columns every view shares
src/ForecastSheet.tsx      Table view rows for named and arbitrary points
src/BlendChart.tsx         Probability blend: gradient bands, model lines, median, arrows
src/CandleChart.tsx        One candle per three-hour column
src/WeatherGlyph.tsx       One inline stroke glyph per WMO present-weather group
src/DisplayFilter.tsx      Rows, units and blend models, persisted in preferences
src/chart.ts               Chart geometry, scales and path builders (pure, unit-tested)
src/dock.css               Dock, chart and filter styles
IMPLEMENTATION_PLAN.md     Scope, implementation decisions and next milestone
```

All numeric U/V/gust arrays are in m/s and rounded to 0.01 m/s. `grid` specifies dimensions, spacing and bounds. `runTime` is the forecast initialization; each frame has its own `validTime`. Gust `startStep`/`endStep` are retained as hours since initialization. Gust at forecast hour zero has no accumulation window and is hidden in the main readout. For explicitly unavailable gusts (`gustAvailable: false`), the frame's `gust` array, spot `gust` values and `gustIntervalHours` are `null`, never zero. ECMWF declares `gustMissingHours: [0]` with gusts enabled: only that frame is null; a missing later gust fails publication. A model whose gust is instantaneous rather than a period maximum declares `gustKind: "instantaneous"` and a zero-length `gustIntervalHours` of `[hour, hour]` at every hour, including zero; without that declaration a zero-length interval after initialization is rejected.

`spotForecasts` covers every id in `public/riding-locations.json`. Adapters read
`FORCE5_SPOTS_FILE`, defaulting to that file and falling back to `spots.json` with a
printed warning when it is absent. Regenerate it with `npm run spots:export` after
changing `src/locations.ts` or `data/locations/`; the original eight ids and
coordinates are asserted unchanged, because bundled snapshots refer to those points.
The bundled snapshots predate the change and were published with only the original
eight; their remaining series were recomputed from their own frames by
`force5/ingest/backfill_spots.py`, so every bundled manifest now carries all 25.

### Optional manifest fields

`schemaVersion` stays 1; every field below is optional and absent from the wind
models that do not use it. `force5/ingest/registry.py` holds one line per model and
`validate_bundle` dispatches on `kind`.

```text
kind          "wind" (default when absent) | "wave" | "weather" | "tide" | "observation"
gustKind      "interval" (default) | "instantaneous"
ensemble      {members, control | null, description}
spotMembers   {spotId: [{hour, validTime, u[], v[], gust[]}]}   indexed by member
variables     {shortName: {units, label, description, kind?}}   wave/weather bundles
spotSeries    {spotId: [{hour, validTime, values: {var: number|null}}]}
horizonHours  last published hour                               frameless wave bundles
frameVariables[shortName]  the subset of variables frames carry  wave/weather bundles
```

- **wind** keeps the existing frame rules. `gustKind: "instantaneous"` is for sources
  that publish a surface gust at the valid time rather than a period maximum (NOAA
  GFS and GEFS): every frame, hour 0 included, then carries
  `gustIntervalHours: [hour, hour]`, which the validator accepts only under that
  declaration, and such a model has no `gustMissingHours`.
- **ensemble** manifests hold the ensemble **mean** in `spotForecasts` and every
  member in `spotMembers`; member arrays must all have length `members`, with finite
  values, |u| and |v| at most 150 m/s and gusts at or above zero. Because a member
  value may not be null, a location the grid cannot sample is published in
  `spotForecasts` with nulls and left out of `spotMembers` entirely. `ensemble.control`
  is the control member's index (`0` for GEFS, whose `gec00` control is a member of the
  published mean) or `null` when the product has no control (ECMWF ENS). `frames` may
  be empty **only** when `ensemble` is present, for models shown on the chart but not
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
  GFS-Wave (`gfs-wave`) publishes frames and adds `spotCoverage` so the UI can say why
  a location has no waves, plus `directionConvention`/`partitionNote` for what the
  numbers mean. Wave directions are the bearing waves come **from**, like the wind.
  The browser reads wave manifests through `force5/src/waves.ts`, whose
  `validateWaveManifest` mirrors these manifest-level rules; `tests/snapshot.test.ts`
  adds what only a committed snapshot can check, which is that the frame files on
  disk agree with the manifest.
- **weather** bundles are validated by the same code as waves: a `variables` map, a
  `spotSeries` per riding location and frames of one array per gridded variable, with
  `frameVariables` narrowing the map fields. Two things differ. Measurements may be as
  large as 100,000 rather than 1,000, because the units include hectopascals, millimetres
  and J/kg; and a variable may declare `"kind": "code"`, which makes its values whole
  code-table entries (WMO present weather) that are checked for being small integers
  instead of range-checked, and that no sampler, chart or blend may interpolate.
  ICON-EU surface weather (`icon-eu-weather`) is the first adapter of this kind.
  The browser reads both kinds through one shared reader, `force5/src/variables.ts`,
  whose `validateVariablesManifest(kind)` mirrors these manifest-level rules and is
  what `validateWaveManifest` and `validateWeatherManifest` are: the same function,
  told which kind it is holding. `waves.ts` and `surface.ts` hold only what is
  actually kind-specific — the coverage notes an adapter publishes for a beach it
  cannot resolve, which variables carry a sea state or a surface reading, and the
  order the dock prefers its sources in.
- **tide** bundles carry `stations`, `spots`, `coverage` and an immutable file per
  station. Heights are metres above Chart Datum (LAT); each station publishes its
  `odMalinOffsetMetres` and a `datumNote`, and the OD Malin value is never mixed
  into the curve. Spots with no station in range are published with a `reason`.
- **observation** bundles hold **measurements, not a forecast**, and are the only
  kind with no forecast hour, no frames and no immutable objects at all: the whole
  bundle is one small self-contained file. They carry `stations` (each with a
  `network` of `coastal`, `sentinel` or `buoy`, a sensor `depth` that is `null`
  when the network publishes none, and its `latest` reading) and `spots` (the
  nearest station, `distanceKm`, `latest` and a recent `series`), plus `variable`
  and `stepMinutes`. `run` is the **newest observation hour**, so the freshness
  limit measures the age of the data rather than the age of the job, and
  `validate_observation_bundle` refuses a value outside −2…35 °C, a time it cannot
  parse or that lies in the future, a series that is not strictly increasing, and
  a `run` that is not the newest hour the manifest publishes. `status.py` reports
  the newest observation age and never calls a past reading expired; `prune.py`
  accepts a manifest that points at nothing. Sea temperature (`sea-temperature`)
  is the first adapter of this kind.
  All numeric U/V/gust arrays are in m/s and rounded to 0.01 m/s. `grid` specifies dimensions, spacing and bounds. `runTime` is the forecast initialization; each frame has its own `validTime`. Gust `startStep`/`endStep` are retained as hours since initialization. Gust at forecast hour zero has no accumulation window and is hidden in the main readout. For explicitly unavailable gusts (`gustAvailable: false`), the frame's `gust` array, spot `gust` values and `gustIntervalHours` are `null`, never zero. ECMWF declares `gustMissingHours: [0]` with gusts enabled: only that frame is null; a missing later gust fails publication. The `ecmwf-ens` manifest adds `ensemble` (member count, `control: null`) and `spotMembers` (per-spot arrays indexed by member); its `frames` and `spotForecasts` are ensemble means, and `stepHours`/`stepRanges` describe its chosen cadence exactly. The `gefs` manifest is the same shape with `control: 0`, `gustKind: "instantaneous"` and no `gustMissingHours`.
  An ensemble manifest adds `ensemble` and `spotMembers`. `ensemble.members` is the member count, `ensemble.control` the index of the control member or `null`, and `ensemble.memberRuns` each member's own initialization when members come from different cycles. `spotMembers[spotId]` is the same valid-time axis as `spotForecasts`, but each entry's `u`, `v` and `gust` are arrays indexed by member; `spotForecasts` carries the ensemble mean. `frames` may be empty only when `ensemble` is present.

Both the browser and importer use bilinear interpolation. Direction is the meteorological bearing **from** which the wind blows; arrows/particles move **towards** the opposite bearing. Calm wind has no meaningful direction. The particle advection speed is a visual scale, not a real-time speed measurement.

## Multi-model data layer

Data-layer modules behind the probability blend. They are pure TypeScript with unit
tests and no UI; the dock consumes them through `src/ForecastDock.tsx`. See the
[multi-model plan](docs/MULTI_MODEL_PLAN.md) for the ingest side.

```text
force5/src/units.ts      Units type, conversion, labels, formatted speeds
force5/src/manifests.ts  Model registry (live and planned) and the manifest cache
force5/src/revalidate.ts When an open tab should look for a newer run, as a pure decision
force5/src/series.ts     Precomputed per-spot and per-member series access
force5/src/blend.ts      Common hourly axis, interpolation, statistics, candles, plot helpers
force5/src/sun.ts        Sunrise, sunset, civil twilight, night intervals for shading
force5/src/prefs.ts      Row/unit/view/model preferences, persisted best effort
force5/src/tides.ts      Tide manifest, station curves, heights and high/low events
force5/src/variables.ts  The shared wave/weather bundle contract, validator and axis matching
force5/src/waves.ts      Sea-state fields, partitions, coverage notes, wave source order
force5/src/surface.ts    Surface fields, weather source order, WMO present-weather mapping
force5/src/seaTemperature.ts Observed sea temperature: stations, latest reading, recent series
```

`validateManifest` now also accepts the optional keys the new adapters publish, at
`schemaVersion` 1: `kind` (`wind`, `wave`, `weather` or `tide`; absent means wind), `gustKind`
(`instantaneous` gusts declare `[hour, hour]` at every frame including hour 0 and
have no `gustMissingHours`), and `ensemble` plus `spotMembers` for per-member spot
series. Only an ensemble manifest may publish an empty `frames` list, because the
chart reads precomputed series and never downloads frames.

A **variables bundle** — `kind: "wave"` or `kind: "weather"` — is a separate
contract with its own validator, because it declares its own variables instead of
publishing u/v/gust and its frames are optional. Both kinds are the same shape, so
`force5/src/variables.ts` is one reader and `validateVariablesManifest(kind)` is one
validator: `validateWaveManifest` and `validateWeatherManifest` are that function
told which kind it is holding, mirroring the single `validate_variables_bundle` in
the importer. It checks the variable map and its `kind: "code"` declarations, the
optional frame list, the declared `horizonHours` for a frameless bundle,
`frameVariables` as a distinct subset, and every `spotSeries` entry covering every
step with every variable present and either null, a code-table entry under 1000 or a
measurement inside the kind's bound (1,000 for waves, 100,000 for weather). Frame
_contents_ are not checked, because the dock never downloads a variables frame.
`variableSeries`, `variableValue` and `variableAtAxis` are the shared readers, and
`variableAtAxis` matches native steps onto the dock's columns within 1.5 hours and
never interpolates — not between two sea states, and not between two present-weather
codes, where the mean of "fog" and "rain" means nothing.

`MODEL_CATALOG` says which contract a manifest URL holds, so one cache serves all
three: `loadAnyManifest` fetches and validates by `kind`, and `loadManifest`,
`loadWaveManifest` and `loadWeatherManifest` are the typed doors onto it.
`availableModels()` sweeps wind, wave and weather models together and hands each
result back already narrowed, as `wind`, `wave` or `weather`. On top of the shared
reader, `waves.ts` adds `waveFields`, `waveCoverageNote` and `preferredWaveSource`,
and `surface.ts` adds `weatherFields`, `preferredWeatherSource`,
`precipIntervalHours` and `presentWeather`, which turns a WMO 4677 code into one of
nine glyph groups and the code table's own words for it.

Blend statistics are per hour: count, min, max, quartiles, median, mean, spread and
an agreement label. Spread is the full range in metres per second; agreement is
`high` below 4 knots of spread and `moderate` below 8. Interpolation happens in u/v
space, never between speeds or wrapped bearings, and never across a gap wider than
twice a model's median cadence. The registry lists models whose adapter is still
planned with `planned: true` so the dock shows them greyed and labelled "coming"
instead of hiding them. Model identity hues are permitted on the chart's own lines
and on its filter swatches, and nowhere else; see the ruling of 2026-09-16 in
`design/foundations/principles.md`.

A tide manifest maps every riding location, including the ones with no station
inside the adapter's distance limit: those are published as `station: null` with a
stated reason, `tideForSpot` returns no curve for them without fetching anything,
and `tideSpotNote` gives the UI the manifest's own words. Heights are metres above
the station's datum, which the dock prints in its credits line with every reading.

`force5/src/seaTemperature.ts` is the same shape for the observation bundle:
`validateSeaTemperatureManifest`, `loadSeaTemperature`, `seaTemperatureForSpot` and
`seaTemperatureNote`, plus the display helpers the Sea row reads —
`seaTemperatureText` (the reading in two parts), `observationAge` (how old it is,
in words) and `sparklinePoints` (the recent series scaled to its own range and
spaced by real time). Because the whole bundle is one file, a spot's latest reading
and its series need no second request, and `seaTemperatureForSpot` also returns
`ageHours` so the row can say how old the reading is. These are observations:
nothing in the module interpolates forward from the newest one, and a station's
distance travels with every value because a buoy 50 km offshore is not the water at
the launch.

## Forecast dock

One shell, three views, all hung off the same time columns so the Now line, the
auto-scroll and the column hooks are shared:

- **Toolbar** (48px): the Play button — the view's one filled action — the spot
  name with its county and a caption naming how many models are in the blend and
  which tide station is being read, a Table / Blend / Candles switch (icons only
  under 760px), the display filter and close. The scrubber sits directly beneath.
- **Time header**: day groups carrying sunrise and sunset in Irish time, then the
  hour ticks. A day group too narrow to hold its sun times shows only its label,
  because a group is as wide as its own content and would otherwise stretch the
  columns beneath it. A group of at least six columns also carries that day's
  highest air temperature after the sun times, when a weather run reaches it;
  a narrower group skips it rather than truncating it.
- **Blend**: the models filled between, coloured by speed from the wind ramp read
  off the value axis — full range, quartiles and an inner core, multiplied so the
  core darkens where the models agree — plus the gust continuation above the wind
  median, one faint line per model in that model's hue, gusts dashed, ensemble
  members fainter still, the white median, direction arrows, night shading from
  the sun times and the Now line. Hovering or pressing a column gives a card with
  each model's reading, the spread and the agreement in words.
- **Candles**: one candle per three-hour column — wick for the full model range,
  body for the middle half, tick for the median, filled by the median's own wind
  colour, with a thin warm bar beside it for the gust range.
- **Rows** below the chart, each optional: spread, direction, the median wind and
  the gust maximum, then a marine block where the tide curve is drawn as a faint
  underlay. Each row is a glyph with an explanation on hover, focus or long press.
  The block stacks the sea first — waves, swell, wind sea — then surface weather:
  weather, air, rain, cloud, pressure, sea, and the tide last.
- **Waves** in that marine block, read from a wave manifest: per column, a small
  arrow rotated to where the waves are going, the significant height in metres to
  one decimal, and the peak period in whole seconds beside it, muted. `mi-swan` is
  preferred for a spot it resolves and `gfs-wave` is the fallback; the credits
  line names the source actually used, and the glyph's explanation carries the
  manifest's own coverage note when a location is land-masked or read from the
  water next to it. **Swell** and **wind sea** are separate rows, off by default,
  shown when the source publishes those partitions (`swell1_h/p/d` and
  `shww/mpww/mdww` from GFS-Wave; `hswe` and the derived `shww` from SWAN). Their
  heights add in energy, not in metres, so they do not sum to the total. Wave
  values are never interpolated: a column takes the nearest native forecast step
  within 1.5 hours and is otherwise empty. A spot no wave model resolves hides the
  rows and the filter says "no wave data at this spot".
- **Surface weather** in the same block, read from a `kind: "weather"` manifest
  (`icon-eu-weather` today). **Air** is the two-metre temperature in whole degrees,
  with the hour's dew point and relative humidity in the cell's own tooltip.
  **Rain** is the amount in the interval ending at that column, in millimetres,
  with the cell tinted by how much and the interval named in its tooltip; the run
  hour has no interval to difference and reads as a dash, and a dry interval the
  model did forecast reads as `0`. **Weather** is the WMO present-weather code
  drawn as one of nine inline stroke glyphs — clear, partly, cloudy, fog, drizzle,
  rain, showers, thunder, snow — with the code and its own words in the tooltip;
  a code is read from the cell the spot sits in and is never averaged, blended or
  interpolated. **Cloud** (off by default) is total cover as a percentage with a
  three-level bar beside it for high, medium and low. **Pressure** (off) is mean
  sea level pressure in whole hectopascals. Air and Weather are on by default; Rain
  is opt-in because the weather glyph already shows it. Like the
  waves, these steps are matched to the wind model's columns within 1.5 hours and
  are otherwise dashes, and the credits line names DWD for them.
- **Sea** prefers the **measurement**. Where `marine/sea-temperature.json` has a
  station reporting near the spot, the row is one reading spanning its columns at
  the left — `15.2 °C · M3 buoy, 61 km, 2 h ago` — with the last seven days as a
  13px sparkline beside it and a tooltip naming the station, its network, the
  distance, the sensor depth where one is published, when it was measured and who
  measured it. An observation is not a forecast, so it is shown once rather than
  pretended at every column, the age is recomputed against the page's own clock,
  and the credits line reads "Sea temperature: Marine Institute observations".
  Where no station is in range the row falls back to the model's own ground/skin
  temperature (`t_g`), drawn back and labelled "model skin temperature,
  approximate" in the cell, with the manifest's own reason — "beyond the 60 km
  limit" — in the row's explanation, so the row always says which of the two it is
  showing. **The Sea row is on by default exactly where an observation exists**;
  elsewhere it is off, because an approximation does not earn a row. That default
  holds only until the reader touches the switch: `prefs.touchedRows` records the
  rows they have set by hand, and a touched row is their choice at every spot from
  then on (`rowOn(prefs, key, available)` in `force5/src/prefs.ts` is the whole
  rule). Sea temperature is loaded on the same discipline as the tides — one
  aborting fetch of one manifest — and a 404 simply means no observations, not an
  error.
- **Display options**: row switches, units and the models in the blend, persisted
  to local storage. Units drive the charts, the table and the map readouts
  together. Planned models are listed greyed; rows with no adapter yet say "no
  source yet" rather than disappearing. One switch is a chart layer rather than a
  row: a faint wave band along the chart's foot, on its own nought-to-six-metre
  scale, off by default.

The charts read precomputed per-spot series only and never download a map frame.
An arbitrary map point, or a named spot no selected model publishes a series for,
disables both charts with the reason in the switch's tooltip and shows the Table
view, which samples the grids as it always has. Tide predictions are not committed:
without `npm run tides:refresh` the tide row is hidden and the filter says why.

The dock's columns are the **selected wind model's** own forecast times, which the
wave and weather rows are matched onto. A run that does not overlap the wind model
on screen therefore reads as dashes rather than as a shorter row: with the bundled
snapshots that means HARMONIE (13–16 September) shows no wave or weather numbers
and GFS (16–21 September) or ECMWF (to 28 September) shows them, because the
bundled GFS-Wave run starts on 16 September at 18 UTC and the bundled ICON-EU
surface run is that same hour plus one three-hour step.

A spot with an observation in range adds the Sea row to those defaults, which is
one more 24px row (22px compact). Default dock height, measured with the bundled
snapshots and no observations published: **439px at 1440** and
**373px at 390** (411px and 349px with no tide predictions published). The Table
view is 368px and 334px. The waves and tide rows are 28px, 24px compact; every
surface-weather row takes the standard 24px, 22px compact. The three default-on
weather rows are what grew the dock by 72px and 66px over its previous 367px and
307px, which is the largest thing outstanding about this feature: the per-row
budget is intact, but the phone dock is now 44 % of an 844px viewport, and which
rows deserve to be on by default is a design call rather than a code one.

## Open-tab refresh

A run is replaced every few hours, so a tab left open all morning used to show a
stale forecast until someone reloaded it. It now revalidates itself:

- **Cadence.** Every five minutes while the tab is visible, and on
  `visibilitychange` or `focus` once five minutes have passed. A hidden tab fetches
  nothing at all. The decision is a pure function,
  `revalidateDecision(lastCheck, now, visible, busy)` in
  `force5/src/revalidate.ts`, which answers `go`, `wait` or `defer`;
  `shouldRevalidate` is the same question as a boolean. Both are unit-tested, and
  the hook that drives them is a minute's heartbeat plus those two listeners.
- **What it fetches.** `clearManifestCache(id)` then `loadManifest(id)` for the
  **active map model**, which is a `cache: "no-cache"` request past both the
  five-minute manifest cache and the HTTP cache. If the run is the one already on
  screen, that is the end of it — one small JSON and no re-render.
- **The swap.** A newer `run` is loaded whole through the same `loadModel`
  transaction a model switch uses — manifest, nearest frame to the **selected**
  valid time, and its index — and committed in one React batch, so the map, the
  chart and the scrubber never show two runs at once. The selected time is kept;
  the column number may change, because a newer run starts later.
- **Never under the reader's hand.** While the forecast is playing, while a model
  switch is in flight, while a pointer is down or while the scrubber has focus, a
  due check is deferred and retried a minute later.
- **The chart's other models** are swept on the same cadence through
  `useModelAvailability`, so the blend, the waves and the surface rows pick up
  their own new runs. An unchanged sweep keeps the previous array, so nothing is
  recomputed for nothing.
- **Silence on failure.** A background refresh that fails logs to the console and
  leaves the forecast that is already on screen exactly as it is. The reader is
  never shown an error for work they did not ask for.
- **What it says.** One line in the existing model-message strip: "Updated to the
  16:00 UTC run." — runs are named by their UTC hour, as every source publishes
  them — which dismisses itself after six seconds.

## Sources and limitations

- Weather: [DWD ICON-EU GRIB2](https://opendata.dwd.de/weather/nwp/icon-eu/grib/), [access information](https://opendata.dwd.de/README.txt), [DWD terms/attribution](https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The same source supplies the `icon-eu-weather` surface variables (`t_2m`, `td_2m`, `relhum_2m`, `tot_prec`, `clct`/`clcl`/`clcm`/`clch`, `pmsl`, `vis`, `cape_ml`, `ww`, `t_g`); `t_g` over sea is a model SST **proxy**, not an observation, and `ww` is DWD's WMO present-weather interpretation, not an observed report.
- Basemap: [OpenFreeMap](https://openfreemap.org/quick_start/), with OpenMapTiles/OpenStreetMap attribution. External basemap and Google Fonts requests require internet. Fonts have local fallback stacks.
- Renderer: [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
- GFS: [NOAA NCEP product documentation](https://www.nco.ncep.noaa.gov/pmb/products/gfs/), [NOMADS GRIB filter](https://nomads.ncep.noaa.gov/), [NOAA Open Data registry](https://registry.opendata.aws/noaa-gfs-bdp-pds/), [NWS disclaimer](https://www.weather.gov/disclaimer). US Government work in the public domain; Force5 publishes modified output, which is not official government material, and NOAA/NWS does not endorse this site.
- GEFS: [NOAA NCEP ensemble product documentation](https://www.nco.ncep.noaa.gov/pmb/products/gens/), [NOMADS GEFS 0.25° GRIB filter](https://nomads.ncep.noaa.gov/cgi-bin/filter_gefs_atmos_0p25s.pl), [NOAA Open Data registry](https://registry.opendata.aws/noaa-gefs-pds/), [NWS disclaimer](https://www.weather.gov/disclaimer). Same public-domain terms as GFS: Force5 publishes modified output, which is not official government material, and NOAA/NWS does not endorse this site. Ensemble spread describes model uncertainty, not a measured probability of rideable conditions.
- GFS-Wave: [NOAA/NCEP WAVEWATCH III](https://polar.ncep.noaa.gov/waves/), [NOMADS wave GRIB filter](https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl), same [Open Data bucket](https://registry.opendata.aws/noaa-gfs-bdp-pds/) and [NWS disclaimer](https://www.weather.gov/disclaimer). Public-domain US Government work; Force5 publishes resampled output, not official government material, and NOAA/NWS does not endorse this site. The `arctic.9km` product is the only GFS-Wave grid that covers all Irish waters.
- Tides: [Marine Institute ERDDAP](https://erddap.marine.ie/erddap/tabledap/imiTidePrediction.html), `imiTidePrediction` and `IMI_TidePrediction_HighLow`, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Predictions only; Northern Ireland has no Marine Institute station.
- Sea temperature: Marine Institute ERDDAP in-situ observations, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — the [Irish Coastal Temperature Network](https://erddap.marine.ie/erddap/info/ICTempNetwork/index.html) (`ICTempNetwork`, delayed-mode logger archive), the [Mace Head](https://erddap.marine.ie/erddap/info/compass_mace_head/index.html) and [Lehanagh Pool](https://erddap.marine.ie/erddap/info/sentinel_lehanagh/index.html) sentinel met-ocean buoys, and the [Irish Weather Buoy Network](https://erddap.marine.ie/erddap/info/IWBNetwork/index.html) (`IWBNetwork`, M2/M3/M5/M6). Measurements, not a forecast. Only 9 of the 25 riding locations have a station within 60 km: there is no live Marine Institute inshore station on the north, north-west, south or east coast, and Northern Ireland has none at all. The offshore weather buoys publish no sensor depth, and their real-time rows arrive with an "unknown" quality flag. An offshore reading is not the water at a beach — in summer the open shelf is colder than a bay, in winter warmer.
- Waves: Marine Institute [Irish Shelf SWAN](https://erddap.marine.ie/erddap/info/IMI_IRISH_SHELF_SWAN_WAVE/index.html) and the 200 m [Connemara nest](https://erddap.marine.ie/erddap/info/IMI_CONNEMARA_SWAN_WAVE/index.html), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Wave forecast © Marine Institute; best endeavours, not for safety-critical use. One run a day, and a beach series is the nearest open-water cell, not the shorebreak.
- HARMONIE: [Met Éireann open-data listing](https://data.gov.ie/dataset/numerical-weather-prediction-data/resource/1fefad43-8aa9-46cb-88f6-053e712cdafa), [near-real-time downloads](https://opendata.met.ie/nwp/near-realtime), [model documentation](https://opendata.met.ie/documentation), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The older empty Apache index is not used.

Set `VITE_BASEMAP_STYLE_URL` in `.env.local` to use a compatible hosted or self-hosted MapLibre style (including working glyphs). Restart/rebuild after changing it. The default style has simplified custom city labels; provider attribution remains visible.

This is a **forecast snapshot**, not a live observation feed — with one exception: the Sea row, which is a measurement when a Marine Institute station is reporting near the spot. The browser flags runs older than 18 hours and snapshots whose coverage has ended. An open tab now follows the runs: every five minutes while it is visible it revalidates the active model's manifest and, if a newer run has been published, swaps manifest and frame together at the time the reader had selected (see "Open-tab refresh" below). Spatial interpolation makes the map look smooth but cannot increase native detail (6.5 km ICON-EU / 2 km HARMONIE); shelter, headlands and launch-site turbulence remain unresolved. Tidal predictions, wave series, ICON-EU surface weather and observed sea temperature are all shown in the dock. Where no station is in range the Sea row falls back to the **model's own skin temperature**, labelled as an approximation, and is off by default. There are no marine warning feeds and no rideability scores. The source dialog links to official warnings. Numerical/data-pipeline validation is not a measured forecast-accuracy comparison against observations.

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
