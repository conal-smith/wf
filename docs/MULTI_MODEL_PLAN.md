# Multi-model forecast plan

Status: proposal, 16 September 2026. Research verified against live endpoints on that
date. Nothing here is implemented yet. Mockup of the target dock:
https://claude.ai/artifact/SsCHYWDuqLkfMBrpTokaVU

## Goal

Differentiate wingfoil.ie by showing forecast *uncertainty* rather than one model's
answer: a probability ribbon and a candlestick view built from many models and
ensemble members, plus waves, tides, sunrise/sunset and general weather in the same
bottom dock. Everything runs in the existing one-shot Docker worker on a local
machine and publishes static JSON, exactly like the three adapters we already have.

## What already exists (the seams we build on)

- `force5/ingest/fetch_{forecast,harmonie,ecmwf}.py`: one adapter per model, all
  publishing the same manifest + immutable frame contract. `worker.py` runs any
  subset, `publish_s3.py` validates and uploads. `force5/Dockerfile` packages it.
- Manifest contract (`force5/src/weather.ts`, `validateManifest`): grid, frames with
  `hour`/`validTime`/`url`/`gustIntervalHours`, `stepRanges`, gust semantics,
  attribution, and `spotForecasts` (precomputed series for the eight original spots).
- Frontend: single active model (`force5/src/models.ts`, `App.tsx`), 8-entry frame
  LRU, `ForecastSheet` dock, `framePosition()` in `timeline.ts` already maps
  wall-clock time onto any model's frame list. No charting code anywhere.
- Design system in `design/` (untracked in git) with a lint gate; the product does
  not consume its tokens yet.

## Wind models

Ranked by value to the spread and ease of onboarding. All cover Irish waters
(11°W–5°W, 51°N–56°N) unless noted.

| # | Model | Res / length / cycles | Access | Key | Gust | Notes |
|---|---|---|---|---|---|---|
| 1 | Met Éireann DINI-EPS members | 2 km, 54 h, hourly cycles | `opendata2.met.ie/nwp/<run>/mbrNNN/` | none | fg | Same portal/grid we already decode. Each hourly cycle adds control + 5 members; lag six cycles to assemble 1+30. Biggest cone-quality gain per line of code. |
| 2 | ECMWF ENS (`enfo`) | 0.25°, 360 h at 00/12, 144 h at 06/18 | `ecmwf-opendata`, stream `enfo` | none | 10fg per member | 50 members. Same client and `.index` byte ranges as `fetch_ecmwf.py`. |
| 3 | NOAA GFS 0.25° | 0.25°, 384 h, 4/day, hourly to 120 h | NOMADS grib filter with subregion, or S3 `noaa-gfs-bdp-pds` + `.idx` | none | GUST | Independent of the European stack. ~2 KB per step for our box via the filter. Respect 120 hits/min. |
| 4 | NOAA GEFS 0.25° | 31 members, 240 h, 4/day, 3 h | S3 `noaa-gefs-pds` + `.idx` | none | GUST | Second independent ensemble. |
| 5 | Météo-France ARPEGE 0.1° | 0.1°, ~102 h, 4/day | `meteo.data.gouv.fr` bulk GRIB2 | none | FF_RAF scalar | Etalab 2.0. Covers whole box with margin. |
| 6 | Météo-France AROME 0.025° | 2.5 km, 51 h, ~8/day, hourly | same | none | FF_RAF | Domain 12°W–16°E, 37.5°N–55.4°N: island covered, Malin Head by ~2 km, north Donegal waters NOT. Needs an in-domain check per spot, ARPEGE fallback. |
| 7 | DWD ICON global | 13 km, 180 h | `opendata.dwd.de/weather/nwp/icon/` | none | VMAX_10M | Icosahedral only; needs CDO or a stored grid file. No regular lat/lon product exists. |
| 8 | DWD ICON-EU-EPS | 13 km, 40 members, 120 h | `opendata.dwd.de/.../icon-eu-eps/` | none | VMAX | Icosahedral; members bundled per file (~10 MB per field-step). |
| 9 | Met Office UKV 2 km | 2 km regrid, 54/120 h, hourly cycles | AWS `met-office-atmospheric-model-data` (NetCDF) | none | yes | CC BY-SA, "unsupported, no SLA". DataHub is the supported paid route. |
| 10 | ECMWF AIFS single | 0.25°, 360 h, 6 h | same client, `model="aifs-single"` | none | none | Trivial to add; wind-speed member only. |
| 11 | ECCC GDPS / GEPS | 0.15° / 0.5° | `dd.weather.gc.ca` | none | unverified | Licence and latency unverified. |

Drop from the candidate list: ICON-D2 (domain ends at 3.84°W), ALADIN (no product
reaches Ireland), NEMS (proprietary), HRRR/NAM (North America), Open-Meteo as a live
dependency (free tier is non-commercial; self-hosting is a separate project).

Findings that touch existing code: ECMWF Cycle 50r1 (May 2026) retired the `scda`
stream and merged the ENS control into `oper`; 06/18 `oper` now reaches 144 h. Our
adapter only uses `oper` at 00/12 and is unaffected, but the `ecmwf-opendata` README
step tables are stale.

## Wave models

| # | Source | Coverage / res / length | Access | Key | Partitions | Notes |
|---|---|---|---|---|---|---|
| 1 | NOAA GFS-Wave `arctic.9km` (+ `global.0p25` tail) | yes, 9 km polar stereo, 384 h, 4/day | NOMADS filter with subregion (~40 KB/step all params) or S3 `.idx` | none | wind sea + 3 swell | Verified valid SWH in Irish Sea and west-coast bays. Avoid `global.0p16` (stops 52.5°N) and `atlocn.0p16` (west Atlantic). |
| 2 | Met Office NWS Wave 1.5 km | 16°W–13°E, 46–62.7°N, 60 h, 4/day, hourly | anonymous S3 `met-office-nws-wave-model-data`, NetCDF, one file per param | none | wind sea + 3 swell | Best coastal resolution. No spatial subsetting; read one timestep chunk at a time. CC BY-SA. |
| 3 | Marine Institute Irish Shelf SWAN | 15°W–3°W, 49–56°N, 0.025°, 6 days, 1/day, hourly | ERDDAP griddap with true bbox/time subsetting; ~14 KB per spot for the whole run | none | swell Hs only | Only Irish-authority wave model. One run/day at ~9 h latency, sometimes late. 200 m Connemara nest for Galway Bay. CC BY 4.0. |
| 4 | ECMWF `stream="wave"` | global 0.25°, 360 h | existing client + `.index` | none | none (period-band heights instead) | Cheapest integration; 15-day horizon. `aifs-single` wave is ~2 h fresher. |
| 5 | CMEMS IBI wave (MFWAM) | 19°W–5°E, 2.7 km, 10 days, hourly | `copernicusmarine` subset (ARCO tiles ~50–100 KB/var per spot) | free account | WW + SW1 + SW2 | Best quality; ~13.5 h latency. Attribution DOI required. |
| 6 | DWD EWAM | clipped at 10.5°W, ~6 km, 78 h, 2/day | `opendata.dwd.de/weather/maritime/wave_models/ewam/` | none | full split | Misses the Atlantic-exposed spots that matter most. Second opinion only. |

Met Éireann publishes no wave data. Met Office DataHub has no wave product.

## Tides, sun, weather variables

- **Tides (Republic):** Marine Institute ERDDAP `imiTidePrediction` (5-minute curve
  above LAT and OD Malin) and `IMI_TidePrediction_HighLow` (events), 39 stations,
  coverage to 2029, CC BY 4.0, no key. Ingest nightly; map each spot to its nearest
  station; publish a per-spot JSON. Show datum on every reading. Optionally add
  `imiSurgePrediction` as a separate line.
- **Tides (Northern Ireland):** no MI station east of 6.01°W. Options: UKHO Admiralty
  API Discovery tier (free, 10k calls/month, no caching allowed, Crown copyright
  line), or UTide harmonic constants fitted to BODC Bangor/Portrush gauge records
  and evaluated locally (verify BODC licence). Do not transcribe Admiralty secondary-port
  offsets. Avoid TPXO for a public site.
- **Sunrise/sunset/civil twilight:** pure algorithm (`suncalc` in the browser or
  `astral` in Python). Compute in UTC, format with `Europe/Dublin`.
- **Weather variables:** ICON-EU has everything (`t_2m`, `tot_prec`, `clct`, `pmsl`,
  `vis`, `relhum_2m`, `cape_ml`, `ww`, `t_g` as SST proxy). HARMONIE `ieIoI` files
  carry T2m, dew point, precipitation, MSLP, visibility, CAPE; cloud/humidity fields use
  local GRIB tables that need `grib_ls` confirmation. ECMWF open data has `2t`, `tp`,
  `tcc`, `msl`, `sp`, `mucape`, `ptype`, `skt` but no visibility.
- **Sea temperature:** Marine Institute `ICTempNetwork` (in-situ coastal, CC BY 4.0)
  first; CMEMS OSTIA or model skin temperature as fallback.

## Ingest architecture changes

1. **Generalise the manifest** (`schemaVersion` 2, backward compatible): add
   `kind: "wind" | "wave" | "tide"`, `members` (count, or list of member ids), and a
   `variables` map so frames can carry fields other than `u`/`v`/`gust`.
2. **Spot series for every riding location, every model.** Today only eight spots
   are precomputed; the other 17 sample frames in the browser. The multi-model chart
   must never download frames. Extend `spots.json` (or read `data/locations`) so each
   adapter writes `spotForecasts` for all 25 spots, including per-member values for
   ensembles. Frames stay optional for models we only show on the chart.
3. **Ensemble adapters** publish spot series per member plus grid frames for a
   chosen subset (mean, or the control) so the map still has something to draw.
4. **New adapters**, in order: `fetch_harmonie_eps.py`, `fetch_ecmwf_ens.py`,
   `fetch_gfs.py`, `fetch_gefs.py`, `fetch_arpege.py`, `fetch_arome.py`; waves
   `fetch_gfswave.py`, `fetch_nws_wave.py`, `fetch_mi_swan.py`, `fetch_ecmwf_wave.py`;
   `fetch_tides.py`. Each follows `fetch_ecmwf.py`: discover latest complete run,
   cache raw files, validate with ecCodes, crop, publish immutable frames and an
   atomic manifest. Register in `worker.py` `SCRIPTS` and `publish_s3.py` `MANIFESTS`.
5. **Shared helpers**: `.idx`/`.index` byte-range fetch (NOAA and ECMWF), NOMADS
   grib-filter client with rate limiting, NetCDF reader for Met Office S3.
6. **Local deployment**: `docker-compose.yml` with the worker image, a scheduler
   container (cron or `ofelia`) running per-model cadences, a named volume for
   `/data`, and a static file server (nginx or Caddy) serving `public/weather` plus the
   built site on the LAN/mesh. Retention job that protects current manifests.
7. **Dependencies**: `requests`, `boto3` (unsigned), `netCDF4`/`xarray` for NetCDF
   sources, `copernicusmarine` only if CMEMS is adopted. Pin ecCodes with libaec.

## Frontend changes

1. **Model manifest cache**: extract `loadManifest()` from `loadModel()`, keep a
   `Map<ModelId, Manifest>` with in-flight dedupe and abort discipline.
2. **Multi-model series**: lift the per-spot series into `App` as
   `Map<ModelId, Series>`, keyed by `${model}/${run}/${lon}/${lat}` as today.
3. **Common time axis**: interpolate every model's series onto a shared hourly axis
   with `framePosition()`; compute min, max, quantiles, median, spread and an
   agreement label per hour. One reusable primitive feeds both the ribbon and candles.
4. **Dock views**: a Table / Ribbon / Candles switch in the timeline controls. The
   ribbon is inline SVG sized to `frames.length * --forecast-column-width` so it shares
   the existing scroller and Now line. Ribbon = stacked quantile bands filled with the
   wind gradient of the median, thin per-model lines, white median. Candles = one per
   column, body = middle half, wick = full range, tick = median, fill = median colour.
5. **Rows**: waves (height, period, direction with swell split where available), sea
   and air temperature, cloud, precipitation, tide curve with high/low labels,
   sunrise/sunset in the day header, night shading behind charts.
6. **Model picker** becomes a multi-select chip row with a max-height scroll; keep the
   single "map model" concept separate from the set of chart models.
7. **Design system**: add a `design/forecast-chart` trio and a ruling on model
   identity colours (currently a fifth hue family is forbidden). Start consuming
   `--sem-*` tokens in the new components.
8. **Tests**: `tests/snapshot.test.ts` validates every manifest and frame, so each new
   model needs a small bundled acceptance snapshot. `e2e/model-layout.spec.ts` asserts
   identical dock geometry across models and will need updating for the new views.

## Phases

1. **Foundations** (ingest): manifest v2, all-spot series, shared byte-range helper,
   Docker Compose + scheduler. Tides adapter and sun times (cheap, high value).
2. **Wind breadth**: HARMONIE EPS members, ECMWF ENS, GFS. This alone gives 80+
   members for the cone.
3. **Frontend uncertainty views**: common axis, ribbon, candles, hover card, night
   shading, multi-select picker.
4. **Waves**: GFS-Wave, then Met Office NWS 1.5 km, then Marine Institute SWAN; wave
   rows in the dock.
5. **Weather rows** from ICON-EU/HARMONIE; sea temperature.
6. **More wind**: GEFS, ARPEGE, AROME, ICON global, UKV. Then NI tides.

## Open questions

- Model identity colours vs the one-hue design rule.
- Whether to show the map for ensemble models (mean vs control vs member picker).
- NI tide source: UKHO terms vs self-computed harmonics.
- CMEMS account: worth holding a credential for the best wave product?
- Local hosting target: which machine, storage budget for raw caches, LAN vs mesh URL.
