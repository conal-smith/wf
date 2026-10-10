# wingfoil.ie — Ireland wind explorer

The wing-foil forecast for Ireland, drawn as an Admiralty chart crossed with an old broadsheet weather report (see [the brand](docs/BRAND.md)). The map at `/` is the chart: paper land, the sea in EMODnet depth tints with contours and soundings, the coast in ink, the forecast wind as moving ink arrows, and every riding place a light showing its stars for the hour selected. The dock below it is the chosen spot's week, hour by hour. The forecasts are Met Éireann HARMONIE, DWD ICON-EU, ECMWF IFS and AIFS, NOAA GFS and GEFS, Météo-France ARPEGE and AROME, blended.

## Run the website

Requires Node.js 22.12+ (tested with Node 26) and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/** (or the port printed by Vite). Use the numeric address if another local application occupies `localhost` on IPv6.

No forecast data is committed: `public/weather/` is generated and git-ignored. A clean clone therefore starts with no weather at all, and the site says so. Either refresh a real run (see [Refresh the forecast](#refresh-the-forecast)) or write the synthetic sample bundles:

```sh
npm run weather:sample
```

That writes nine bundles in exactly the published format — HARMONIE, ICON-EU, ECMWF, GFS, ARPEGE, AROME, AIFS, GFS-Wave and ICON-EU surface weather — carrying a smooth analytic field rather than a forecast, on a fixed sample calendar covering 13–28 September 2026. Every manifest says what it is in its provider and attribution ("Synthetic sample data for tests — not a forecast"), so it can never be mistaken for model output. The grids are rectangular (dx ≠ dy, as the real HARMONIE grid is), so a sampler that confused the two axes could not pass.

The generator refuses to write into a `public/weather` that holds **anything** that looks like forecast data — any `*.json` manifest, or any run directory. A run directory with no manifest beside it is exactly what an interrupted import leaves, and dropping synthetic manifests next to it would both corrupt the site and make the ingest's prune treat the real runs as junk. Pass `--force` to replace what is there; even then it will not delete a run directory unless a manifest in the same directory claims it and says `provider: "Synthetic sample data"`. `--profile live` anchors the run times to the wall clock instead, and `--out <dir>` writes somewhere else entirely.

The map:

- **The chart.** MapLibre draws the style in `force5/src/chartStyle.ts` (ported from the signed-off mockup's kit, every colour from `ui/theme.css`): OpenStreetMap's coast and places through OpenFreeMap, and the depths from `public/bathy/ireland.pmtiles`, one static PMTiles file read by HTTP range requests ([how it was made](scripts/bathymetry/README.md)). Depth is faint at country zoom, comes up from zoom 9 and is full by 11. Layers turn the tints, contours and soundings, relief and spot names on and off.
- **The wind**, three ways, chosen in Layers and remembered: **Ink** (the default), the arrows **coloured** by speed, or a **faint wash** of colour over the sea with the ink arrows on it. The wash and the coloured arrows are on the rider's own scale (`windBand`): blue below their floor, greens through the sweet spot, yellow at its top, orange to red past what they can hold; the key shows the knots. The arrows are particles whose trails are drawn fresh every frame; they pause while the map moves and stop for reduced motion. The model the map draws is chosen in Layers too.
- **Lights.** Each of the 146 riding places shows the selected hour's stars in a ring, ink at 3–4, magenta at 5, dashed at none, with an arrow blowing downwind. A true offshore hour is struck through in red; cross-offshore gets a red arrow, and is struck for a rider set to Learning. The stars are the dock's own: every model taken once and weighted by how well it verified against Irish stations that far into its run (`MODEL_WEIGHTS`, `force5/src/weights.ts`; docs/VERIFICATION.md), the weighted median wind and gust, rated for the rider (`src/ratings.ts`). The blend is worked out for every place when the forecast is published (`weather/blend.json`, the hourly `blend` job, `src/spotBlend.ts`), so the map reads one ~80 kB file instead of every wind model's manifest; a reader who picks their own models in the blend gets it worked out in the browser, as does any site whose blend is missing or more than six hours old.
- **Focus.** Choosing a spot (a light, the search, your spots) flies there, rings it in the pen with the day's best, puts it in the dock (its stars, wind, shore, wing and tide by the hour, its star toggle and its spot page) and drops the other lights' names, leaving the lights themselves at full strength. Nothing is hung over the chart on the light itself. Escape or a tap on the open map clear it.
- **Your spots** are behind the star under Layers, opening beside the controls as the layers do, on a phone as on a wide screen: the spots you star and the ones you look at, with the selected day's best, kept on this device by `shared/web/favourites.ts`, which the spot page shares.
- **The map's information** is the "i" under Layers: one dialog over the dimmed chart with the key (lights, wind, the pen, depth tints), how the stars are given, the foilable-depth layer's colours and tide, and the sources. Nothing of it sits on the chart; the "?" by the stars and the "i" by the foil layer open it at their part.
- **Tap anywhere** on the open map for that point's forecast in the dock, named by the nearest place or its coordinates: read from the map's model, rated on the wind alone (a point has no shore to face), and focused like a spot.
- **The dock** is fifteen days as one strip of hours, 07:00 to 20:00, under a fixed cursor, with a day slider above it and a play button that steps the map, the lights and the cursor through the hours until a touch stops it. The three- and six-hourly days further out are narrower. Swipe it, shift-scroll it, drag the slider or use the keys; the two move together and a vertical scroll is never taken. Rows: stars (hover or tap for why, and "?" for how they work, in the map's information, which leads on to [the page](/stars)), wind and gust, direction against the shore, wing, and the tide with its turns named. The red pen loops each day's best stretch. Below a fold, one tap away and remembered: waves (height, period, direction), the sky, the air, rain, and the sea's temperature (measured where a station is in range, the model's otherwise). A Blend view draws every model; display options set the units, the rider and the models in the blend. A phone opens it folded.
- **Less text.** Sources and caveats sit behind an "i": the chart's in the corner, the figures' in the dock.

The [location research](data/locations/README.md) retains 46 sourced records alongside the eight original spots (two duplicates merged), plus 121 places read from four public spot guides on 30 September 2026. The public map and search show 146 riding-place references, excluding business listings and broad area pins. Kilcrea and Newtownards use place names with their original coordinate provenance and access caveats. New locations sample the forecast grids on demand. These are source-listed references, not verified launches. Paid business listings are a future product feature, not implemented here.

## Spot pages

`/spot/<id>` (for example [`/spot/brandon`](http://127.0.0.1:5173/spot/brandon))
is a riding place's own page, set as the chart's broadsheet, day by day: a
headline with the week's verdict ("a five-star Friday afternoon on a 5.5 m"),
the shore as a compass with the winds it likes, the week in one ruled strip
(each day's best stars and window), then each day under a header that sticks
while its hours scroll, with the pen's note on it. Every daylight hour is a row
of figures — stars, wind with the gust raised, where it comes from, the sky and
**the chance it rides** (the share of ensemble members windy enough for the
rider) — the dark folded away and never rated; a tap opens the hour's second
line with the session, wing, waves, the models' and members' spread and every
reason a star came off. The pen loops each day's best window, and under each
day runs the tide as a 24-hour curve with the night and twilight behind it,
then the high and low waters and the light as two small tables. A **Rated
for** line (Learning / Riding / Advanced, weight and wings behind a fold)
re-rates everything live and is the same rider as the dock's Display options
(`force5.prefs.v1`); a star keeps the place in your spots, as the map does.
`/spot` lists every place, and `/stars` (the same bundle) is How the stars
work. [The star ratings](docs/STAR_RATINGS.md#on-the-spot-page) say how the
stars and the chance are worked out.

Open it from the map: **Spot page** in the dock's head. It is its own lazy bundle (`spot/web/`, never the
map or MapLibre) and reads the published bundles through the MCP server's own
reduction (`mcp/api/forecast.ts` with the browser-safe `mcp/api/httpSource.ts`),
so the page and an assistant see the same consensus. With `npm run dev` it
needs a forecast in `public/weather` like the map does; tides need
`npm run tides:refresh`.

## Marketplace

`/market` is a free second-hand gear marketplace (listings with photos, seller
profiles, contact reveal, star ratings and seller history) built as a separate
package in [`market/`](market/README.md): a Hono API on Postgres with Clerk
sign-in and S3-compatible photo storage, and React pages drawn in Tailwind from
the shared kit in `ui/` and the theme in `ui/theme.css`. `src/main.tsx` lazy-loads it for `/market` URLs; the map bundle
is otherwise untouched. Run it locally with `FEATURE_MARKET=1 npm run market:api` and
`VITE_FEATURE_MARKET=1 VITE_MARKET_DEV_USER=<name> npm run dev`; deploy the API on Railway from
`market/Dockerfile`. See the package README for the full runbook.

## Feature switches

The marketplace, the community and Gust are each **off** unless switched on,
twice: on the website at build time and on the API at boot. Off, a section
leaves the site menu and its paths draw the map; its API routes answer 404
`off` (the marketplace keeps `/api/market/health` for the container's health
check), and Gust never appears. The map, spot pages and `/ai` are always on.

| Section     | Website (build time)       | API (boot)            |
| ----------- | -------------------------- | --------------------- |
| Gust        | `VITE_FEATURE_GUST=1`      | `FEATURE_GUST=1`      |
| Marketplace | `VITE_FEATURE_MARKET=1`    | `FEATURE_MARKET=1`    |
| Community   | `VITE_FEATURE_COMMUNITY=1` | `FEATURE_COMMUNITY=1` |

The e2e build and API switch all three on (`preview:e2e`, and `createApp`
defaults every section on when not told otherwise).

## AI assistants (MCP)

The forecast is also an MCP server, so Claude, ChatGPT, Cursor, VS Code and
command-line agents can read it. `mcp/api/` serves it at `/api/mcp` from the
same API process as the marketplace: public, read-only, stateless Streamable
HTTP. Its tools are `list_spots`, `get_spot_forecast` (a consensus of every live
wind model per hour, with agreement, waves, weather, tides, sea temperature and
daylight), `find_wind` (spots ranked by hours in a wind range) and
`forecast_sources`. It reads the published bundles and nothing else: set
`FORECAST_BASE_URL` to the site root in production; in development it reads
`public/`. `/ai` (`ai/web/`) is the page that hands it out, with one-click
install links for Claude, Cursor and VS Code and the lines to paste for the
rest.

## Gust, the in-app companion

Gust is the little ink blob with a wing in the map's bottom-right corner (above
the dock and the model picker; a drawer on phones). Tap him, or press
Cmd/Ctrl+J, and ask where and when to go: "Where's best tomorrow?", "Is
Brandon on this weekend?", "What wing should I take?". He reads the same
forecast consensus as the MCP server, rates it with the dock's stars for the
rider in Display options (saying when he assumes 80 kg), and answers with spot
cards, window chips and a short word of judgement, including a warning
whenever the wind is offshore. Cards and chips can move the map (select the
spot, jump the timeline); Gust only moves it himself when asked. He can
propose a rider profile, which is saved only when the rider taps Confirm.
When the selected spot has a four-star window in the next 48 hours, he nudges
with a badge.

- `companion/api/`: the Hono routes at `/api/companion` (`/status`, `/nudge`,
  `/chat`), a manual streaming tool-use loop over the Claude API
  (`@anthropic-ai/sdk`, `claude-haiku-5-5`, at most 6 model calls a turn,
  prompt caching on a frozen system prompt; server-side refusal fallbacks on
  the larger models, which Haiku does not have), and
  five tools: `find_sessions`, `get_spot_forecast`, `list_spots`, `show_on_map`
  and `propose_rider_profile`. The chat is stateless: the browser sends the
  last 20 messages and what it is looking at, and keeps the transcript in
  sessionStorage. Rate-limited per IP.
- `companion/shared/protocol.ts`: the server-sent events both ends share:
  `text`, `tool`, `card`, `action`, `proposal`, `error`, `done`.
- `companion/api/budget.ts`: the monthly allowance. Every model call's
  `usage` is priced at list and added to a per-month (UTC) total in Postgres
  (`companion_usage`). Once the month reaches `COMPANION_MONTHLY_BUDGET_USD`,
  `/status` says `resting` and the site stops showing Gust until the 1st; a
  chat that arrives anyway answers 503 `budget_exhausted`, and a rider who
  was mid-conversation sees why, with a button to `/ai` to use their own
  assistant. The estimate rounds every call up; turns already under way when
  the money runs out finish, so it can overshoot by those few turns.
- `companion/web/`: Gust himself, the launcher and the panel.

| Variable                       | Default            | What it does                                                                                             |
| ------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `FEATURE_GUST`                 | unset              | `1` switches Gust on (see [Feature switches](#feature-switches)). Off, he is hidden and makes no calls.  |
| `ANTHROPIC_API_KEY`            | unset              | Wakes Gust. Unset, `/api/companion/chat` answers 503 `not_configured` and the panel says Gust is asleep. |
| `COMPANION_MONTHLY_BUDGET_USD` | unset              | Required with a key: US dollars Gust may spend a calendar month (UTC) before he rests until the 1st.     |
| `COMPANION_MODEL`              | `claude-haiku-5-5` | The model. It must have a price in `companion/api/budget.ts`, or the API will not start.                 |
| `COMPANION_EFFORT`             | `low`              | `output_config.effort` per call: `low`, `medium`, `high`, `xhigh`, `max`. Low keeps chat quick.          |
| `COMPANION_FAKE`               | unset              | `1` answers from a scripted fake model over the real tools (demos, e2e). Refused in production.          |
| `FORECAST_BASE_URL`            | `public/` in dev   | Where the forecast is read, as for the MCP server.                                                       |

Try it with a real key:

```bash
MARKET_DB=memory MARKET_AUTH_MODE=dev MARKET_STORAGE=local FEATURE_GUST=1 \
  ANTHROPIC_API_KEY=sk-ant-... COMPANION_MONTHLY_BUDGET_USD=1 \
  npm run market:api                                # API on :8787
VITE_FEATURE_GUST=1 npm run dev                     # map on :5173, /api proxied
```

Or without one, scripted: the same with `COMPANION_FAKE=1` in place of the
key and the budget. The e2e suite runs it that way (`e2e/companion.spec.ts`), over the staged
sample forecast and on the browser's frozen clock.

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

The same timetable (`deploy/local/jobs.toml`) also drives two ways of publishing to
the R2 bucket instead of a local volume: [Home Compute on a Mac mini](deploy/home-compute/README.md)
(Bacalhau, launch agents, a menu bar app) and [Cloudflare Containers](deploy/cloudflare/README.md).
`deploy/schedules.py` writes both from the TOML; rerun it after editing the timetable.

## Live forecast worker

See the [live forecast pipeline runbook](docs/LIVE_FORECAST_PIPELINE.md) for the
separate AWS design: container build/run instructions, scheduled ECS tasks, safe S3
publishing, CDN caching, IAM, monitoring and remaining launch checks.

```sh
docker build -f force5/Dockerfile -t force5-forecast:local .
docker run --rm -v force5-work:/data force5-forecast:local --models harmonie --step 1
```

The worker defaults to hourly output and only uploads when `--bucket`/`S3_BUCKET` is supplied. `--models` accepts any registry id: `harmonie icon-eu icon-eu-weather ecmwf gfs gefs arpege arome tides mi-swan`. The bucket is AWS S3 by default; add `--endpoint-url`/`S3_ENDPOINT_URL` (and the standard `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) to publish to **Cloudflare R2** instead, which is the intended deployment — the region defaults to `auto` when an endpoint is given. A publish deletes the objects the run it supersedes referenced, and `python force5/ingest/prune.py --bucket NAME --dry-run` sweeps what failed uploads left behind. See [the live pipeline document](docs/LIVE_FORECAST_PIPELINE.md#cloudflare-r2-and-one-shot-batch-containers); no R2 bucket has been created or verified yet. Configure `VITE_FORECAST_BASE_URL` at website build time to read forecasts from a separate CDN; leave unset for bundled snapshots. A tap on the open map reads that point's forecast into the dock; a double tap zooms without changing the selection.

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
6. Publishes content-hashed binary frames and precomputed spot time series.
7. Atomically replaces `public/weather/latest.json` only after all requested frames pass validation.

Existing published data remains intact on failure. Partial run files may remain unreferenced. Run one refresh process at a time; raw cache and old processed files are retained without automatic pruning in this MVP. The initial download is roughly 90 MB compressed for 75 full-Europe GRIB fields; the cropped snapshot is roughly 8 MB, with only requested/adjacent frames fetched by the browser and an eight-frame cache.

#### The frame file

A **wind** map frame is `HHH-<hash>.bin` in the "F5 int16" encoding: a 24-byte
header (magic, version, block count, width, height, scale, forecast hour and the
run as `YYYYMMDDHH`) followed by one little-endian int16 block per variable —
`u`, `v` and, where the model has it, `gust` — holding tenths of a metre per
second, delta-encoded along each row with wrapping arithmetic. A HARMONIE step is
about 71 KB brotli-compressed against the 225 KB its gzipped JSON cost, and the
display rounds to whole knots, so nothing visible is lost. The job writes
`name.bin.br` and `name.bin.gz` beside each frame for the local Caddy
deployment; the bucket stores one encoding per object instead.

The manifest declares it with `"encoding": "f5-int16-v1"`. A manifest without an
`encoding` field has JSON frames, which the browser still reads. **Wave and
weather frames are JSON**, and per-spot series keep their full 0.01 m/s
precision: every adapter samples the source field, not the frame it publishes.

The one exception is `backfill_spots.py`, which adds a series for a newly
listed spot to a run whose source data is long gone, so it has only the
published frames to resample. Such a series can sit up to 0.06 m/s — under a
tenth of a knot — from what a fresh ingest would have produced, and the next
run replaces it with the exact one.

The format is specified in `force5/ingest/f5bin.py`, read by
`force5/src/f5bin.ts` in the browser and by `scripts/f5bin.mjs` in Node; all
three are pinned to one golden file (`tests/fixtures/f5bin/`) that the Python and
the Vitest suites each decode.

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
each) and a 156 KB manifest. No snapshot is committed; the acceptance bundle the
tests read is the synthetic one in `tests/fixtures/weather`, the same run hours
(18 UTC through +3 h) with sample values. Brandon Bay from the measured live run:
15.6 °C with 97 % cloud and 1016.8 hPa at 18 UTC, then 0.6 mm of rain in 18–21 UTC (`ww` 61, rain)
at 16.0 °C and 1014.6 hPa, 0.5 mm more by midnight with `ww` 80 (showers), and a drier
14.2 °C at 03 UTC with 63 % cloud and 1012.9 hPa.

### ECMWF 15-day refresh

```sh
.venv/bin/pip install -r force5/ingest/requirements-worker.txt
npm run weather:refresh:ecmwf
.venv/bin/python force5/ingest/worker.py --models ecmwf --publish-only
```

Downloads the latest available full-length 00/12 UTC IFS control forecast from
ECMWF's own open-data host using ECMWF's client, with no API key (the AWS and
Google mirrors are selectable with `--source`; the AWS mirror throttles). Publishes 85 validated
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
with ICON-EU or ECMWF gusts. No snapshot is committed; the sample bundle the
tests read is 16 September 2026 at 06 UTC through +24 h.

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

No snapshot is committed; the sample bundle the tests read is 16 September 2026 at
18 UTC through +9 h, 4 frames on a coarse grid. Wave frames carry nine arrays over
12,221 cells, about 560 KB each, so a full 240-hour run is roughly 45 MB.

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

### ECMWF AIFS refresh

```sh
.venv/bin/pip install -r force5/ingest/requirements-worker.txt
npm run weather:refresh:aifs
.venv/bin/python force5/ingest/worker.py --models aifs --ecmwf-source ecmwf --publish-only
# A shorter horizon, or another mirror:
.venv/bin/python force5/ingest/fetch_aifs.py --hours 72
.venv/bin/python force5/ingest/fetch_aifs.py --source google
```

ECMWF **AIFS Single**, the centre's operational machine-learned deterministic model
(`model="aifs-single"`, MARS class `ai`), on the same public 0.25° open-data grid as
the IFS control and with no API key. Model id `aifs`, manifest
`public/weather/aifs.json`. All four cycles reach **+360 h in uniform 6-hour steps**
— 61 frames; the source publishes no 3-hourly file, and `--hours` therefore takes
multiples of 6 only. The crop (18°W–2°E / 48°–59°N, 81 × 45 = 3,645 cells), frame
contract, atomic publication and `decode_handle` validation are the IFS control's,
reused unchanged.

**Identity.** AIFS and IFS share `centre=ecmf` and `dataType=fc`, so those alone
cannot tell them apart. The importer checks `marsClass` (`ai` against the control's
`od`), `marsStream` and `dataType`, all read from the live product on 17 September 2026. `generatingProcessIdentifier` also differs (5 against 161) and is deliberately
not used: it is a process number ECMWF may renumber. `centre` is checked first, so a
file from another centre — which has no MARS section at all — fails with a clear
message rather than a missing-key error.

**There is no gust.** The open-data inventory for `aifs-single` lists 21 surface
parameters — 10 m and 100 m wind, 2 m temperature and dewpoint, pressure, cloud,
precipitation, radiation, skin and soil fields — and no `10fg`/`10fg3` maximum gust
at any step. The manifest therefore declares `gustAvailable: false` with null gust
arrays, null spot gusts and an explicit null `gustIntervalHours` on every frame, and
`gustDescription` says why. No gust is derived from wind speed: a gust factor applied
to a forecast mean is an assumption, not model output.

The manifest declares `stepHours: 6` **and** a one-entry `stepRanges` ladder
(`[{throughHour: 360, stepHours: 6}]`). A uniform step on its own lets the frame count
imply the horizon, so a run that stopped early would publish a shorter timeline without
complaint; the explicit ladder makes the publisher and the browser reject a missing
tail frame instead.

A live run of the 18 UTC cycle on 16 September 2026, cold cache, three readers against
`--source ecmwf`: **21 seconds**, 86.1 MB of ranged GRIB in 61 files (1.39–1.45 MB a
step for the two wind messages), 61 frames totalling 2.4 MB (38.8–39.4 KB each — smaller
than an ECMWF control frame, which carries a gust array too) and a 130 KB manifest.
Brandon Bay from that run: 8.9 m/s (17.2 kt) from 247° at the run hour, 6.9 m/s from
284° at midnight, 8.9 m/s from 286° at 12 UTC on the 17th, easing to 4.8 m/s at midnight
on the 18th, and 4.3 m/s from 187° at the +360 h edge. No AIFS snapshot is committed:
a 61-frame bundle is generated locally.

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

### ARPEGE refresh

```sh
npm run weather:refresh:arpege
# Shorter, hourly, or discovery through the data.gouv.fr catalogue:
.venv/bin/python force5/ingest/fetch_arpege.py --hours 48 --step 3
.venv/bin/python force5/ingest/fetch_arpege.py --hours 24 --step 1
.venv/bin/python force5/ingest/fetch_arpege.py --source datagouv
```

Météo-France's 0.1° ARPEGE, Etalab Open Licence 2.0, no API key. Default: 0–102 h
at three-hour steps (35 frames), which is the model's whole horizon. The 0.1°
**surface** package is hourly all the way to +102 h — the 48-hour hourly limit
applies to the upper-air packages, not to this one — so `--step 1` also reaches
+102 h, at 103 frames.

Météo-France publishes whole packages with no server-side subsetting and no `.idx`
sidecar: the nine time-group files of one ARPEGE `SP1` run are **646 MB** together.
Downloading that for three fields is not defensible, so `meteofrance.py` walks each
package's GRIB2 message headers over HTTP byte ranges — one 1 KB read per message —
and then fetches only the 10 m u, 10 m v and FF_RAF gust messages it will publish.
The byte offsets are cached per run under `.cache/meteofrance/<model>/<run>/`, so a
retried job re-reads no headers at all. The bucket answers a **multi-range** request
with 200 and the entire object, so the client sends one range at a time and refuses
any response that is not a 206 of exactly the requested length.

Runs are discovered from the OVH bucket listing, newest cycle first, and a cycle is
used only when every requested hour's package is already published; runs older than
12 hours or dated in the future are refused. `--source datagouv` discovers the same
files through the `data.gouv.fr` resource catalogue instead — the officially
documented route, which rewrites one resource per time group in place and therefore
shows a mixture while a run is publishing. Both paths download from the same bucket.

The crop is the shared Ireland/Atlantic box, 18°W–2°E and 48–59°N, at the native
0.1°: **201 × 111 cells**. It is taken on integer lattice indices rather than on
ecCodes' coordinate arrays, because 0.1° is not a binary fraction and a plain
`longitude <= east` comparison silently drops the eastern column; the arithmetic
lattice is checked against every coordinate ecCodes reports before it is used. The
packages are **CCSDS/AEC packed** (data representation template 42), which needs an
ecCodes built with libaec; the `eccodes` wheels in `requirements-worker.txt` have it,
and a build without it fails with one sentence naming libaec rather than a C error.

**ARPEGE gusts are FF_RAF: the maximum over the hour ending at each forecast time.**
The window is read from the GRIB2 statistical keys (maximum, one-hour time range),
never from the parameter number, and is published as `gustIntervalHours: [h-1, h]`.
It stays one hour at three-hourly cadence, so a frame describes the hour before it
and not the whole gap. Initialization has no preceding hour, so the manifest declares
`gustMissingHours: [0]` and that frame's gust is null, not zero. FF_RAF turned out to
be plain WMO 0/2/22 under product template 8, not a Météo-France local table code.

Measured on the live 18 UTC run of 16 September 2026, cold cache: **37.1 MB
transferred in 1,236 requests (1,130 of them 1 KB header reads), 32 seconds** wall
time with three concurrent package walks, publishing 35 frames (12 MB of JSON) and a
76 kB manifest for 25 locations. Brandon Bay read 18.2 kn at initialization, 20.1 kn
gusting 29.3 kn at +3 h and 22.6 kn gusting 36.9 kn at +42 h. No snapshot is
committed; the sample bundle the tests read is a 12 UTC run through +12 h, 5 frames.

### AROME refresh

```sh
npm run weather:refresh:arome
# Shorter, hourly, or discovery through the data.gouv.fr catalogue:
.venv/bin/python force5/ingest/fetch_arome.py --hours 24 --step 3
.venv/bin/python force5/ingest/fetch_arome.py --hours 12 --step 1
.venv/bin/python force5/ingest/fetch_arome.py --source datagouv
```

Météo-France's 0.025° AROME, the same licence, key and package client as ARPEGE.
Default: 0–51 h at three-hour steps (18 frames), the model's whole horizon; `--step 1`
gives 52 frames. Eight cycles a day, three hours apart. The `SP1` package set is
461 MB a run and is read the same way, by walking headers over byte ranges.

**AROME's published grid is larger than the model.** The 0.025° `EURW1S40` product is
a latitude/longitude box, 12°W–16°E and 37.5–55.4°N, but the model runs on a rotated
domain inside it and a GRIB2 bitmap masks the rest — about 17% of the box, including
a corner that cuts diagonally across Donegal. On the 55°N row valid data begins only
at **8.45°W**, and the 55.4°N row is masked outright. The model's edge over Ireland is
nothing like a line of latitude, and a naive 55.4°N crop publishes 9999 m/s.

The crop is therefore the largest rectangle wholly inside the unmasked area:
**10.9°W–5°W, 51–54.75°N, 237 × 151 cells** at the native 0.025°, with no resampling.
That covers the west, south and east coasts and Belfast Lough, and stops short of the
north coast. Masked points are decoded as NaN rather than 9999 and any masked cell
inside the crop fails the run, so a future change to the model domain is a loud error
and never a published number.

**Three riding locations are outside AROME:** Pollan Bay, Benone Strand and
Magheraroarty. They keep their place in `spotForecasts` with null `u`, `v` and `gust`
and are named in the manifest's `coverageNote`; `force5/src/series.ts` treats an
all-null series as absent, so the blend shows AROME no line there rather than a flat
zero. Use ARPEGE or HARMONIE for the north coast. Gust semantics are FF_RAF, exactly
as for ARPEGE: a one-hour maximum ending at the frame, with `gustMissingHours: [0]`.

Measured on the live 18 UTC run of 16 September 2026, cold cache: **37.1 MB
transferred in 366 requests (310 of them header reads), 13.6 seconds** wall time,
publishing 18 frames (9.8 MB of JSON) and a 41 kB manifest. Brandon Bay read 21.0 kn
at initialization, 16.2 kn gusting 23.6 kn at +3 h and 26.1 kn gusting 32.9 kn at
+15 h — a little stronger than ARPEGE at the same hours, which is what a 2.5 km model
resolving Brandon Bay against an 11 km one should look like. A 0.025° frame is 600 kB,
so no AROME snapshot is bundled; `public/weather/arome.json` is git-ignored.

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

### ECMWF wave refresh

```sh
.venv/bin/pip install -r force5/ingest/requirements-worker.txt
npm run weather:refresh:ecmwf-wave
.venv/bin/python force5/ingest/worker.py --models ecmwf-wave --ecmwf-source ecmwf --publish-only
# A shorter horizon, or the whole sea without the period bands (half the bytes):
.venv/bin/python force5/ingest/fetch_ecmwf_wave.py --hours 24
.venv/bin/python force5/ingest/fetch_ecmwf_wave.py --no-bands
```

The `wave` stream of ECMWF's open data — the WAM ocean wave model coupled to IFS — at
0.25° with no API key. Model id `ecmwf-wave`, kind `wave`, manifest
`public/weather/ecmwf-wave.json`. The 00 and 12 UTC cycles run to **+360 h on exactly
the ladder the wind control uses**: 3-hourly to +144 h, then 6-hourly to +360 h, 85
frames. The client handles `stream="wave"` unchanged — confirmed against the live index
on 17 September 2026 — so the adapter is the wind importer's crop, `decode_handle`
validation and atomic publication plus a land mask. `--hours` must land on one of the
source's own steps; a 4-hourly or interpolated ladder is refused, in the importer and
again in `cadence.expected_hours`, which now holds `ecmwf` **and** `ecmwf-wave` to that
ladder (whole, or stopped early, but never resampled).

**Ten variables**, all SI. `swh` (significant height of the combined sea), `mwp` (mean
period), `pp1d` (peak period) and `mwd` (mean direction) describe the whole spectrum.
The six band heights `h1012`, `h1214`, `h1417`, `h1721`, `h2125`, `h2530` are the
significant height carried by waves of 10–12, 12–14, 14–17, 17–21, 21–25 and 25–30
seconds. **They are the only swell information this stream publishes** — its inventory
(`cdww`, `h1012`…`h2530`, `mp2`, `mwd`, `mwp`, `pp1d`, `swh`, `wmb`) has no swell
partition at all, so a long-period band height is the nearest thing to "how much
groundswell is arriving, and how long". They are not a partition: the bands add in
energy rather than in metres, they carry no direction, and nothing below 10 s exists,
so a short local wind sea is invisible in them. Read a rising `h1417` as long swell
filling in. `force5/src/waves.ts` therefore finds a total row and no swell or wind-sea
row for this source, which is correct rather than a gap. Identity is the `paramId`: the
band heights share discipline 10, category 0 and parameter number 3 with `swh` and
differ only in the local parameter number, so a category/number check alone cannot tell
a 25–30 s band from the total sea. `marsStream=wave` and `marsClass=od` separate the
stream from AIFS and from the wind control.

**Land is null, never zero.** Unlike the wind fields, a wave field is undefined where
the model did not solve: the messages carry a bitmap and those cells arrive as the
file's own missing value (9999). A field with no bitmap fails the run rather than being
guessed at, a field that is all land fails too, and every published land cell is `null`
— a zero would read as a measured flat calm. The crop is the wind product's exact box:
18°W–2°E / 48°–59°N, 81 × 45 = 3,645 native cells, rows north-to-south, nothing
resampled or downscaled.

**Reading a riding location at 0.25°.** A cell is about 28 km across, so most Irish
beaches sit in one the model calls land. Each location is read bilinearly when all four
cells around it were solved, and otherwise from the nearest solved cell within 40 km,
taken **unchanged** with the distance recorded as `spotCoverage[spot].nearestOffsetKm`;
nothing is extrapolated toward the shore. Beyond 40 km the whole series is null with a
stated reason. Masks are re-read every hour and every variable — `pp1d` has a few more
unsolved cells than `swh`, and ice moves — so a bilinear stencil that loses a cell falls
to null instead of quietly renormalising onto what is left. Directions are interpolated
as unit vectors, never as degrees, so the mean of 350° and 10° is 0° rather than 180°.

**Of the 25 riding locations, 3 are read directly** (Brandon Bay, Maharees, Keel), **21
from the nearest solved cell** (1.5 km at Tullan Strand, median 13.4 km, 37.7 km at
Rusheen Bay) **and 1 has no waves at all** (Mountshannon on Lough Derg, as expected for
an inland lake). Those offsets are the honest cost of the resolution: a 37.7 km reading
describes the open Atlantic off Galway Bay, not Rusheen. This is why the dock prefers
`mi-swan` then `gfs-wave` and takes `ecmwf-wave` last — it is worth having because it is
the only one of the three that reaches 15 days.

A live run of the 12 UTC cycle on 16 September 2026, cold cache, three readers against
`--source ecmwf`: **61 seconds**, 700.3 MB of ranged GRIB in 85 files (8.32–8.41 MB a
step for ten messages), 85 frames totalling 15 MB (182 KB each: ten arrays over 3,645
cells) and a 407 KB manifest. `--no-bands` drops the four whole-sea fields to 3.70 MB a
step, about 315 MB a run. A 24-hour verification run took 7.9 seconds for 9 frames.
Brandon Bay from that run: 1.05 m at 9.8 s from 305° at the run hour, easing to 1.09 m
at 8.7 s from 290° overnight, then building through 1.74 m at 10.6 s to 2.35 m at 13.2 s
from 310° at +27 h and 2.73 m at 14.6 s at +33 h — with `h1417` rising from 0.06 m to
1.50 m over the same window, which is the band heights doing their job. No ECMWF wave
snapshot is committed: a full bundle is 15 MB and is generated locally.

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

## Design

The site is drawn as **the chart**: an Admiralty chart crossed with an old broadsheet weather report. [`docs/BRAND.md`](docs/BRAND.md) is how to draw in it and [`docs/DESIGN_PRINCIPLES.md`](docs/DESIGN_PRINCIPLES.md) the rules and their dated rulings. Every design value is written once, in `ui/theme.css`, and every control comes from the kit in `ui/` (gallery at `/ui` under the dev server).

`design-system/` restates the theme and the kit as a SprintEngine Studio design-system bundle (tokens, principles, components, patterns, glyphs and a catalog at `design-system/catalog/index.html`), to open in the Studio's Design door: point it at the `design-system/` folder. [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) explains how the two are kept equal.

```sh
npm run ui:lint       # theme only, theme == bundle, no new raw controls, the bundle's own lint
npm run design:build  # regenerate the bundle's tokens.css and catalog after a token or component change
```

## Verify / build

```sh
npm test
npm run test:weather
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` and `npm run test:weather` need nothing downloaded: the bundles they read are the small synthetic ones committed under `tests/fixtures/weather/`, written by `npm run weather:fixtures` (`scripts/sample-weather.mjs`). Regenerate them after changing the generator and re-run both suites; they are deterministic, so an unchanged generator rewrites the same bytes.

Browser tests start a preview on port 4173 (`PREVIEW_PORT` overrides it, so several worktrees can run at once) — but not of `dist`. The suite never reads or writes `public/weather`, which in a working checkout holds real ingest output. `scripts/e2e-site.mjs` stages a site of its own under the git-ignored `.e2e/`: the committed files from `public/`, plus freshly generated synthetic sample bundles as `.e2e/public/weather`. `vite.config.ts` then points `publicDir` and `build.outDir` at that tree whenever `E2E_SITE` is set, so `public/weather` is not opened anywhere in the build, and the specs read their expectations from the same staged manifests (`e2e/sample.ts`). Every test also runs at a fixed clock inside the sample calendar (`e2e/fixtures.ts`), so the suite gives the same answers whatever day it is run; a test that needs another moment sets one itself. The tests use the real map, so they require internet for OpenFreeMap. They cover time/units/point inspection, particles, mobile search, failed-frame recovery, missing and expired snapshots, reduced motion, and unavailable basemaps. Screenshots and failure traces go into ignored `test-results/`.

```sh
npm run preview
```

Serve `dist/` through any static web host after building. No secrets or account provisioning is needed. Use HTTPS, compression and proper JS MIME types. MapLibre v6's ES-module worker is bundled with Vite's `?worker&url` import; serving its worker asset is essential.

## Builds and releases

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request and push to main, plus the Python suite on the worker image's Python and every Docker image built and smoke-tested (`scripts/release/*-smoke.sh`). A nightly builds main's head into images on GHCR (`ghcr.io/sprintengine/wingfoil-forecast`, `-web`, `-market`) and runs them against real HARMONIE and GFS runs; a release promotes a nightly's exact image digests through staging to production after one approval. [`docs/RELEASES.md`](docs/RELEASES.md) describes the train and the one-time setup.

## Performance

Two tools time the site as a visitor meets it, rather than as the preview serves it:

```sh
npm run build
npm run perf:serve -- --dir dist --port 4180   # serves dist/ the way deploy/local/Caddyfile does
npm run perf:audit -- --base http://127.0.0.1:4180 --out .perf/audit.json --shots .perf --clock 2026-10-05T09:00:00Z
```

`scripts/perf-serve.mjs` follows the Caddyfile: compression, the `.br`/`.gz` sidecars beside frames, `immutable` hashed assets and content-addressed data, revalidated manifests, byte ranges (the bathymetry is a PMTiles archive read a tile at a time) and the SPA fallback; `--api <origin>` forwards `/api` for the marketplace and community. `vite preview` compresses nothing, caches nothing and answers no ranges, so a page timed against it is timed against a host nobody deploys to.

`scripts/perf-audit.mjs` drives real Chrome headless with its GPU (the map is WebGL; software rendering would time the emulator) under Lighthouse's two profiles — a desktop on a 10 Mbit/s line, and a mid-range phone on 4G at 150 ms, 1.6 Mbit/s and a CPU slowed four times — and reports the median of `--runs` loads of the map, cold and warm, and of the marketplace, community, AI and stars pages: TTFB, FCP, LCP, CLS, total blocking time, the map ready (every riding place on it with its rating), the dock ready, and the bytes and requests by kind. It then times the interactions a rider makes — stepping the forecast, switching model, opening a riding place, switching the dock's view, panning — as wall time and as the worst Event Timing entry (the lab stand-in for INP). `--clock` starts the page's clock inside the ingested run without stopping its timers. On a busy machine, run two builds a run at a time, alternating, so background load falls on both alike.

What keeps the map quick, and what holds it there (`e2e/perf.spec.ts`):

- **Its first requests start with the page.** On a map URL the page's head preloads the map's chunks (`preloadTheMap` in vite.config.ts) and also starts the map model's manifest and the riding places (`force5/src/boot.ts`); the map takes those responses rather than asking again once its code has run. The manifest goes through the same cache the model sweep reads, so it is downloaded and parsed once, not twice.
- **No parse for a manifest that has not changed.** Every five minutes the sweep revalidates every wind manifest. One whose ETag has not moved reuses the parsed copy instead of parsing and validating megabytes of JSON again on the main thread; the open-tab run refresh expires a manifest rather than dropping it, to the same end.
- **MapLibre and React are chunks of their own**, whose names do not change when the site does, so a deploy re-sends the map's few hundred kilobytes rather than its 1.3 MB.
- **Marine bundles are read once per five minutes**, not once per spot: the tide and sea-temperature files and the tide curves are kept, and a spot change shows nothing of the last spot's station while the new one loads.
- **Cheaper renders.** Date and time formatters are built once rather than per cell, the blend chart's ninety-odd model lines are not rebuilt on every mouse move, and a bare point's series reads the run's frames without pushing the map's own frames out of the cache.

The manifests remain the heaviest thing a first visit downloads: about 2.5 MB compressed for the nine wind models, nearly all of it per-spot series for 146 places of which the reader looks at one. Splitting those series out of the manifests at ingest (a file per spot, or per region) is the change that would take most off a phone's first load.

## Files and data contract

```text
force5/ingest/registry.py  The model table: script, manifest, kind, freshness limit
force5/ingest/fetch_forecast.py DWD discovery, download, validation and publication
force5/ingest/fetch_harmonie.py Met Éireann control download, rotation and regridding
force5/ingest/fetch_ecmwf.py ECMWF IFS 15-day open-data download and crop
force5/ingest/fetch_aifs.py  ECMWF AIFS Single (AI model) wind, 6-hourly to +360h, no gust
force5/ingest/fetch_gfs.py  NOAA GFS 0.25° filtered/ranged download and crop
force5/ingest/fetch_gefs.py NOAA GEFS 0.25° ensemble members, mean frames and per-spot series
force5/ingest/fetch_gfswave.py NOAA GFS-Wave 9 km polar-stereo decode and resampling
force5/ingest/fetch_icon_weather.py DWD ICON-EU surface weather variables (temperature to CAPE)
force5/ingest/fetch_tides.py Marine Institute tidal predictions per riding location
force5/ingest/fetch_sea_temperature.py Marine Institute in-situ sea temperature observations
force5/ingest/fetch_ecmwf_ens.py ECMWF ENS members, mean frames and per-spot member series
force5/ingest/fetch_harmonie_eps.py Met Éireann lag-assembled ensemble member series
force5/ingest/fetch_mi_swan.py Marine Institute Irish Shelf SWAN wave series per riding location
force5/ingest/fetch_ecmwf_wave.py ECMWF IFS wave stream: land-masked frames and offset spot series
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
public/weather/aifs.json   AIFS Single's 61-frame 6-hourly timeline, gusts declared unavailable (not committed)
public/weather/ecmwf-wave.json ECMWF wave variables, native 0.25° frames, spot series and cell offsets (not committed)
public/weather/icon-eu-weather.json ICON-EU surface variables, frame subset and 25 spot series
public/weather/<run>/*.json Immutable cropped U/V/gust or wave-variable grids
public/marine/tides.json   Tide stations, spot assignments, coverage and datum notes
public/marine/tides-*.json Immutable per-station curves and high/low events
public/marine/sea-temperature.json Observed sea temperature: stations, per-spot reading and series
public/marine/wind-observations.json Observed wind at Met Éireann stations and buoys, last 72 h (docs/VERIFICATION.md)
public/verify/scores.json  Every model's and the blend's verification scores, 30 and 90 days
public/archive/            What was forecast and observed, kept for verification; never pruned
force5/src/weather.ts      Validation, sampling, units, bearings, frame cache
force5/src/variables.ts    The shared wave/weather bundle contract, validator and axis matching
force5/src/waves.ts        The wave-shaped door onto it: coverage notes, sea-state fields, source order
force5/src/surface.ts      The weather-shaped door: surface fields, source order, WMO present weather
force5/src/seaTemperature.ts Observed sea temperature: manifest contract and per-spot readings
force5/src/WindMap.tsx      MapLibre basemap, raster colours, particle renderer
force5/assets/             Force5 platform branding
src/App.tsx                The map at /: the chart, its boxes, the lights, focus, the dock
src/map.css                The chart's boxes, neatline, lights, popup and small print
src/ForecastDock.tsx       The dock: its head, day slider, play, the strip's Table and More rows
src/strip.ts               The dock's columns and each day's best stretch (pure, unit-tested)
src/ratings.ts             Every spot's week rated at once, for the dock and the lights
src/BlendChart.tsx         The Blend view: models' range by speed, model lines, median
src/WeatherGlyph.tsx       One inline stroke glyph per WMO present-weather group
src/DisplayFilter.tsx      Units, rider and blend models, persisted in preferences
src/chart.ts               Chart geometry, scales and path builders (pure, unit-tested)
src/dock.css               Dock, chart and filter styles
IMPLEMENTATION_PLAN.md     Scope, implementation decisions and next milestone
```

All numeric U/V/gust arrays are in m/s and rounded to 0.01 m/s. `grid` specifies dimensions, spacing and bounds. `runTime` is the forecast initialization; each frame has its own `validTime`. Gust `startStep`/`endStep` are retained as hours since initialization. Gust at forecast hour zero has no accumulation window and is hidden in the main readout. For explicitly unavailable gusts (`gustAvailable: false`), the frame's `gust` array, spot `gust` values and `gustIntervalHours` are `null`, never zero. ECMWF declares `gustMissingHours: [0]` with gusts enabled: only that frame is null; a missing later gust fails publication. A model whose gust is instantaneous rather than a period maximum declares `gustKind: "instantaneous"` and a zero-length `gustIntervalHours` of `[hour, hour]` at every hour, including zero; without that declaration a zero-length interval after initialization is rejected.

`spotForecasts` covers every id in `public/riding-locations.json`. Adapters read
`FORCE5_SPOTS_FILE`, defaulting to that file and falling back to `spots.json` with a
printed warning when it is absent. Regenerate it with `npm run spots:export` after
changing `src/locations.ts` or `data/locations/`; the original eight ids and
coordinates are asserted unchanged, because published manifests refer to those points.
Runs published before the change carried only the original eight; their remaining
series were recomputed from their own frames by `force5/ingest/backfill_spots.py`, so
every manifest now carries all 25, and the sample bundles do too.

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
coverageNote  why some spotForecasts series are null           wind bundles
horizonHours  last published hour                               frameless wave bundles
frameVariables[shortName]  the subset of variables frames carry  wave/weather bundles
```

- **wind** keeps the existing frame rules. `gustKind: "instantaneous"` is for sources
  that publish a surface gust at the valid time rather than a period maximum (NOAA
  GFS and GEFS): every frame, hour 0 included, then carries
  `gustIntervalHours: [hour, hour]`, which the validator accepts only under that
  declaration, and such a model has no `gustMissingHours`. A model whose source has no
  gust field of any kind declares `gustAvailable: false`, and then every frame's `gust`
  array, every spot `gust` and every frame's `gustIntervalHours` is explicitly `null` —
  the key is present and null, because an absent key would read as an undeclared gap.
  ECMWF AIFS Single (`aifs`) is the first model of that sort: no gust is invented from
  wind speed, and `gustDescription` says so.
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
- **coverageNote** is one sentence explaining why a wind model publishes null
  values for some riding locations: its domain does not reach them. The locations
  stay in `spotForecasts` so the catalogue never looks as though it changed, and
  `force5/src/series.ts` treats an all-null series as absent rather than as calm.
  Météo-France AROME is the first model to need it — three north-coast locations sit
  outside its native domain — and the frame arrays themselves never contain nulls,
  because the crop is chosen to stay inside the model.
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
  ECMWF's wave stream (`ecmwf-wave`) publishes native 0.25° frames on the same box as
  the ECMWF wind product, and adds `spotCoverage[spot].nearestOffsetKm`: `0` when a
  location's own four cells were read and a real distance when the adapter had to take
  the nearest cell the model solved, which at 0.25° is most Irish beaches. The offset is
  recorded, never smoothed away, and a location with no solved cell within 40 km gets a
  series of nulls and a stated reason. The dock's preference order is `mi-swan`, then
  `gfs-wave`, then `ecmwf-wave`, finest first; a source whose series for a spot is all
  nulls is skipped rather than shown as dashes.
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
an agreement label. Spread is the full range in metres per second; agreement reads the
standard deviation of the models' speeds against thresholds that tighten with each day
ahead (`agreementFrom`, `force5/src/weights.ts`), and is never `high` from fewer than
three models. Interpolation happens in u/v
space, never between speeds or wrapped bearings, and never across a gap wider than
twice a model's median cadence. The registry lists models whose adapter is still
planned with `planned: true` so the dock shows them greyed and labelled "coming"
instead of hiding them. Model identity hues are permitted on the chart's own lines
and on its filter swatches, and nowhere else; see the ruling of 2026-09-16 in
[`docs/DESIGN_PRINCIPLES.md`](docs/DESIGN_PRINCIPLES.md).

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

The chosen spot's fortnight as one strip of hours under a fixed cursor, on
paper with a double rule along its top (`src/ForecastDock.tsx`, `src/dock.css`).
Its columns come from `src/strip.ts`: 07:00 to 20:00 Irish time, hourly while
the models are, then the coarser three- and six-hourly days further out in
narrower columns.

- **The head**: the star toggle, the spot's name, its shore as a small compass
  and its county; the day's best stretch still ahead ("Best today 13:00–16:00 ·
  ★★★★ · 6.5 m"); a TABLE | BLEND switch; an "i" with the figures' sources and
  the tide station; the display options; the spot page; and the fold. A phone
  opens the dock folded.
- **The day slider and play.** Above the strip, one cell a day tinted magenta
  by its best stars, named in two letters on a phone. The ink play button steps
  the map, the lights and the cursor through the hours; any touch stops it.
  The slider and the strip move together, by swipe, shift-scroll, drag or keys,
  and a vertical scroll is never taken.
- **Table**, the default: the day and its best (the red pen loops each day's
  best stretch), the hour, then **Stars** (hover or tap for the chart's box
  saying why, `ui/RatingTip.tsx`; "?" for [how they work](/stars)), **Wind**
  with the gust, **From** with the shore glyph, **Wing**, and the **Tide** as
  a curve with its turns named.
- **Blend** draws every model in place of the star, wind, direction and wing
  rows (`src/BlendChart.tsx`, loaded when first asked for): the models' range
  coloured by speed, one faint line per model, the median, and a card per
  column with each model's reading and the agreement in words. A point tapped
  on the open map has no blend: it is read from the map's model alone.
- **More**, below its own fold, one tap away and remembered: **Waves** (height,
  period and an arrow for where they come from; `mi-swan` where it resolves the
  spot, `gfs-wave` otherwise), the **Sky** as a WMO present-weather glyph,
  the **Air**, **Rain** tinted by how much, and the **Sea**: the measurement,
  as one line across the row, where a station is in range
  (`marine/sea-temperature.json`), else the model's skin temperature marked as
  approximate. These rows take each source's nearest native step and are never
  interpolated; the wave and weather manifests are only read once More is
  opened. A tapped point says these are for riding places only.
- **Display options** (a dialog, `src/DisplayFilter.tsx`, loaded when first
  opened): the units, the rider (level, weight, wings) the stars, the lights
  and the wing are rated for, and the models in the blend.

Tide predictions are not committed: without `npm run tides:refresh` the tide
row says there is no station near. Heights, measured on the e2e sample site at
Brandon: **276px at 1440** (376px with More open); at 390 **172px folded**,
354px open and 454px with More.

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
- ARPEGE and AROME: [Météo-France public numerical prediction data](https://meteo.data.gouv.fr/), packages [ARPEGE 0.1°](https://www.data.gouv.fr/datasets/paquets-arpege-resolution-0-1deg/) and [AROME 0.025°](https://www.data.gouv.fr/datasets/paquets-arome-resolution-0-025deg/), [Etalab Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/), no key. Attribution as published: "Weather data: Météo-France, ARPEGE and AROME public numerical prediction packages from meteo.data.gouv.fr, Etalab Open Licence 2.0. Cropped, validated and processed by Force5 (wingfoil.ie); this is modified Météo-France output, not official Météo-France material." AROME's 0.025° domain does not reach Ireland's north coast: Pollan Bay, Benone Strand and Magheraroarty have no AROME series at all.
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

## Contributing

Issues and pull requests are welcome; [`CONTRIBUTING.md`](CONTRIBUTING.md) lists the checks a change has to pass. Report security problems privately, as [`SECURITY.md`](SECURITY.md) describes.

## Licence

The code is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`): if you run a modified version as a service, you must offer its source to the people using it. Data the site reads keeps its own licence, credited where it is shown: forecasts from Met Éireann, DWD, ECMWF, NOAA, Météo-France and the Marine Institute; places from Fáilte Ireland (CC BY 4.0), OpenStreetMap (ODbL) and the sources listed in [`data/locations/README.md`](data/locations/README.md); depths from EMODnet Bathymetry (CC BY 4.0).
