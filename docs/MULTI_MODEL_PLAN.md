# Multi-model forecast plan

Status: in progress, 16 September 2026. Research verified against live endpoints on
that date. Mockup of the target dock: https://claude.ai/artifact/SsCHYWDuqLkfMBrpTokaVU

**Update, 10 October 2026:** to keep downloads near 80 GB a month, six adapters
below are retired: the ECMWF ensemble, AIFS, GEFS, ARPEGE, AROME and the ECMWF wave
stream. Their code is intact and their jobs ship disabled; the site serves HARMONIE,
ICON-EU, ECMWF and GFS for wind, and MI SWAN and GFS-Wave for waves. See
`deploy/local/README.md`.

## Delivered so far (16 September 2026)

- Ingest foundations: `force5/ingest/registry.py` (one line per model), manifest
  `kind` (wind / wave / weather / tide), `gustKind`, `ensemble` + `spotMembers`, precomputed
  series for all 25 riding locations (`public/riding-locations.json`, `npm run
spots:export`).
- Wind adapters: `gfs` (NOMADS subregion, ~0.6 MB per run, bundled snapshot),
  `gefs` (31 members, 6-hourly to +240 h, ~19 MB per run through the NOMADS 0.25°
  ensemble filter; the first ensemble whose mean the map draws),
  `ecmwf-ens` (10 members of the 00 UTC run, 6-hourly from +60 h to +144 h, ~0.49 GB a day), `harmonie-eps` (a
  time-lagged control ensemble only: see the correction under Wind models; shipped
  disabled in the schedule).
  Météo-France `arpege` (0.1°, +102 h hourly, ~37 MB per run) and `arome`
  (0.025° native, +51 h, ~37 MB per run), both read out of whole-domain packages
  by walking GRIB2 headers over byte ranges; see the correction below.
- Wave adapters: `gfs-wave` (9 km Arctic grid resampled to 0.05°, bundled snapshot)
  and `mi-swan` (Marine Institute Irish Shelf SWAN, per-spot hourly series, 3 s per
  run). Tides: `tides` (Marine Institute predictions, 15 stations for 25 spots).
- Weather variables: `icon-eu-weather` (DWD ICON-EU surface fields as a `weather`
  bundle sharing the wave validator, 14 variables, 25 frames and 25 spot series per run,
  301 MB in and 30 MB out; bundled two-frame snapshot). `ww` is a code table and `t_g` a
  labelled SST proxy.
- Frontend data layer in `force5/src`: `units`, `manifests` (catalogue + cache),
  `series`, `blend` (common axis, quantiles, candles), `sun`, `prefs`, `tides`.
- Local deployment: `deploy/local/` Docker Compose stack (worker, scheduler sidecar
  reading `jobs.toml`, Caddy on one origin, retention and status scripts).
- Forecast dock in `src/`: `ForecastDock`, `ForecastHeader`, `BlendChart`,
  `CandleChart`, `DisplayFilter`, `RowLabel` (see "Forecast dock" in the root README),
  with a `design/forecast-chart` component and the dated hue ruling.
- Second wave (17 September): 25-spot series backfilled into every bundled snapshot
  (`backfill_spots.py`), HARMONIE scalar gusts from the control's gust components
  (component magnitude matches the provider's scalar to 0.0014 m/s), ICON-EU surface
  weather (`icon-eu-weather`), NOAA GEFS (31 members, ~19 MB per run via the NOMADS
  filter), and wave rows in the dock reading `gfs-wave` / `mi-swan` through
  `force5/src/waves.ts`.
- Third wave (17 September): surface weather rows in the dock, Météo-France ARPEGE and
  AROME (byte-range header walk, ~37 MB per run each; AROME's masked domain excludes
  three northern spots), ECMWF AIFS and the IFS wave stream, Marine Institute observed
  sea temperature (6 live stations, 9 of 25 spots) shown in the Sea row, and open-tab
  refresh. ECMWF adapters default to the ECMWF-hosted source.
- Still open: Northern Ireland tides, a wider sea-temperature source, ICON global and
  UKV, a temperature raster on the map, and the dock height on phones (which rows are
  on by default).

## Goal

Differentiate wingfoil.ie by showing forecast _uncertainty_ rather than one model's
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

| #   | Model                        | Res / length / cycles                 | Access                                                               | Key  | Gust            | Notes                                                                                                                                     |
| --- | ---------------------------- | ------------------------------------- | -------------------------------------------------------------------- | ---- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Met Éireann DINI-EPS members | 2 km, 60 h, hourly cycles             | `opendata2.met.ie/nwp/<run>/mbrNNN/`                                 | none | fg              | **Perturbed members are not obtainable.** See the correction below; `fetch_harmonie_eps.py` ships a time-lagged control ensemble instead. |
| 2   | ECMWF ENS (`enfo`)           | 0.25°, 360 h at 00/12, 144 h at 06/18 | `ecmwf-opendata`, stream `enfo`                                      | none | 10fg per member | 50 members. Same client and `.index` byte ranges as `fetch_ecmwf.py`.                                                                     |
| 3   | NOAA GFS 0.25°               | 0.25°, 384 h, 4/day, hourly to 120 h  | NOMADS grib filter with subregion, or S3 `noaa-gfs-bdp-pds` + `.idx` | none | GUST            | Independent of the European stack. ~2 KB per step for our box via the filter. Respect 120 hits/min.                                       |
| 4   | NOAA GEFS 0.25°              | 31 members, 240 h, 4/day, 3 h         | S3 `noaa-gefs-pds` + `.idx`                                          | none | GUST            | Second independent ensemble.                                                                                                              |
| 5   | Météo-France ARPEGE 0.1°     | 0.1°, 102 h hourly, 4/day             | `meteofrance-pnt` bucket, ranged header walk                         | none | FF_RAF scalar   | **Built.** Etalab 2.0. The surface package is hourly to +102 h, not 48 h. Covers the whole box with margin.                               |
| 6   | Météo-France AROME 0.025°    | 2.5 km, 51 h, 8/day, hourly           | same                                                                 | none | FF_RAF          | **Built.** The published box is masked: see the correction below. Crop 10.9°W–5°W, 51–54.75°N; three riding locations have no series.     |
| 7   | DWD ICON global              | 13 km, 180 h                          | `opendata.dwd.de/weather/nwp/icon/`                                  | none | VMAX_10M        | Icosahedral only; needs CDO or a stored grid file. No regular lat/lon product exists.                                                     |
| 8   | DWD ICON-EU-EPS              | 13 km, 40 members, 120 h              | `opendata.dwd.de/.../icon-eu-eps/`                                   | none | VMAX            | Icosahedral; members bundled per file (~10 MB per field-step).                                                                            |
| 9   | Met Office UKV 2 km          | 2 km regrid, 54/120 h, hourly cycles  | AWS `met-office-atmospheric-model-data` (NetCDF)                     | none | yes             | CC BY-SA, "unsupported, no SLA". DataHub is the supported paid route.                                                                     |
| 10  | ECMWF AIFS single            | 0.25°, 360 h, 6 h                     | same client, `model="aifs-single"`                                   | none | none            | Trivial to add; wind-speed member only.                                                                                                   |
| 11  | ECCC GDPS / GEPS             | 0.15° / 0.5°                          | `dd.weather.gc.ca`                                                   | none | unverified      | Licence and latency unverified.                                                                                                           |

Drop from the candidate list: ICON-D2 (domain ends at 3.84°W), ALADIN (no product
reaches Ireland), NEMS (proprietary), HRRR/NAM (North America), Open-Meteo as a live
dependency (free tier is non-commercial; self-hosting is a separate project).

Correction, verified 16 September 2026 while building `fetch_harmonie_eps.py`: the
"lag six cycles to assemble 1+30" plan does not work. `opendata2.met.ie/nwp/<cycle>/`
does keep twelve hourly cycles and does rotate through 30 perturbed members
(cycle 12 → `mbr001`–`mbr005`, cycle 13 → `mbr006`–`mbr010`, … cycle 18 → `mbr001`
again), but each perturbed directory publishes only eight surface parameters and
**no 10 m wind**; only `mbr000` publishes `ws`/`wdir`/`fg`, on the full
1909 × 1609 DINI grid at 4–7 MB per field-step. The near-real-time portal does carry
member wind in `fcYYYYMMDDHH+HHHgrib2_enIoI` — including the scalar gust
`max_i10fg` the control subset lacks — but all six files a cycle writes for one step
share that one name, and `download/nwp?files=<name>` returns an arbitrary one of
them that changes from step to step (cycle 2026091619 gave members 7, 7, 10, 6, 6,
9, 0, 7, 9, 7 … for +000…+048). No `member`, `timestamp`, `size` or
`perturbationNumber` parameter disambiguates it, `enIRL25` resolves to the same
member as `enIoI`, and the inventory endpoint refuses windows wider than three
hours or ending in the past. Real DINI-EPS members therefore need the authenticated
archive or a request to Met Éireann for member-addressable names; ECMWF ENS
(item 2) is the cheapest route to a genuine member ensemble.

Correction, verified 17 September 2026 while building `fetch_arpege.py` and
`fetch_arome.py`:

- **AROME's published grid is larger than the model.** The 0.025° `EURW1S40` product is
  a latitude/longitude box (12°W–16°E, 37.5–55.4°N), but the model runs on a rotated
  domain inside it and a GRIB2 bitmap masks about 17% of the box. The masked corner
  cuts diagonally across Donegal: on the 55°N row valid data begins only at 8.45°W and
  the 55.4°N row is masked outright. "Malin Head is covered by ~2 km" is wrong — Malin
  Head is outside. The usable rectangle is 10.9°W–5°W, 51–54.75°N, and Pollan Bay,
  Benone Strand and Magheraroarty have no AROME forecast at all.
- **ARPEGE's 0.1° surface package is hourly to +102 h.** The three-hourly-beyond-48-h
  cadence applies to the upper-air packages (`HP1` halves in size at +49 h); `SP1` does
  not.
- **FF_RAF is not a local table code.** In both models it is WMO 0/2/22 under product
  definition template 8, master table 15 with local table 0, with
  `typeOfStatisticalProcessing` 2 and a one-hour range — the maximum over the hour
  ending at the frame. The packages also carry the gust component pair 0/2/23 and
  0/2/24, which we do not need because the scalar is present.
- **There is no subsetting and no `.idx`.** An ARPEGE `SP1` run is 646 MB and an AROME
  one 461 MB. Walking each package's GRIB2 message headers over byte ranges and
  fetching only the wanted messages costs 37 MB and 13–32 s per run, so the WCS
  endpoint on `portail-api.meteofrance.fr` (free key, real subsetting) is worth
  documenting but was not needed. The bucket **ignores multi-range requests** and
  answers 200 with the whole object, which makes a careless `Range` header a 71 MB
  download.
- `meteo.data.gouv.fr` resources are rewritten in place, so the catalogue shows only
  the newest run, and a mixture of two while one is publishing. The `meteofrance-pnt`
  bucket is publicly listable (`list-type=2`) and keeps about two weeks of runs, which
  is the better discovery route; `--source datagouv` keeps the documented one.

Findings that touch existing code: ECMWF Cycle 50r1 (May 2026) retired the `scda`
stream and merged the ENS control into `oper`; 06/18 `oper` now reaches 144 h. Our
adapter only uses `oper` at 00/12 and is unaffected, but the `ecmwf-opendata` README
step tables are stale.

## Wave models

| #   | Source                                            | Coverage / res / length                          | Access                                                                           | Key          | Partitions                         | Notes                                                                                                                         |
| --- | ------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- | ------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | NOAA GFS-Wave `arctic.9km` (+ `global.0p25` tail) | yes, 9 km polar stereo, 384 h, 4/day             | NOMADS filter with subregion (~40 KB/step all params) or S3 `.idx`               | none         | wind sea + 3 swell                 | Verified valid SWH in Irish Sea and west-coast bays. Avoid `global.0p16` (stops 52.5°N) and `atlocn.0p16` (west Atlantic).    |
| 2   | Met Office NWS Wave 1.5 km                        | 16°W–13°E, 46–62.7°N, 60 h, 4/day, hourly        | anonymous S3 `met-office-nws-wave-model-data`, NetCDF, one file per param        | none         | wind sea + 3 swell                 | Best coastal resolution. No spatial subsetting; read one timestep chunk at a time. CC BY-SA.                                  |
| 3   | Marine Institute Irish Shelf SWAN                 | 15°W–3°W, 49–56°N, 0.025°, 6 days, 1/day, hourly | ERDDAP griddap with true bbox/time subsetting; ~14 KB per spot for the whole run | none         | swell Hs only                      | Only Irish-authority wave model. One run/day at ~9 h latency, sometimes late. 200 m Connemara nest for Galway Bay. CC BY 4.0. |
| 4   | ECMWF `stream="wave"`                             | global 0.25°, 360 h                              | existing client + `.index`                                                       | none         | none (period-band heights instead) | Cheapest integration; 15-day horizon. `aifs-single` wave is ~2 h fresher.                                                     |
| 5   | CMEMS IBI wave (MFWAM)                            | 19°W–5°E, 2.7 km, 10 days, hourly                | `copernicusmarine` subset (ARCO tiles ~50–100 KB/var per spot)                   | free account | WW + SW1 + SW2                     | Best quality; ~13.5 h latency. Attribution DOI required.                                                                      |
| 6   | DWD EWAM                                          | clipped at 10.5°W, ~6 km, 78 h, 2/day            | `opendata.dwd.de/weather/maritime/wave_models/ewam/`                             | none         | full split                         | Misses the Atlantic-exposed spots that matter most. Second opinion only.                                                      |

Met Éireann publishes no wave data. Met Office DataHub has no wave product.

## Tides, sun, weather variables

- **Tides (Republic):** Marine Institute ERDDAP `imiTidePrediction` (5-minute curve
  above LAT and OD Malin) and `IMI_TidePrediction_HighLow` (events), 39 stations,
  coverage to 2029, CC BY 4.0, no key. Ingest nightly; map each spot to its nearest
  station; publish a per-spot JSON. Show datum on every reading. Optionally add
  `imiSurgePrediction` as a separate line.
- **Tides (Northern Ireland):** no MI station east of 6.01°W, so done (October 2026)
  with our own harmonic constants, committed in `force5/ingest/tide_stations_ni.json`
  and predicted at ingest in plain numpy (`harmonics.py`, `tides_ni.py`): Portrush and
  Bangor from a month of the Environment Agency's open gauge levels (OGL v3.0), seven
  more stations round to Dundrum Bay from EOT20 (CC BY 4.0), Strangford Lough as
  Killard's tide 100 minutes later. 0.19–0.21 m RMS against the gauges' 2012–2024
  record (the weather alone leaves 0.17–0.19), high water within 13–20 minutes RMS;
  the same methods are 0.06–0.10 m from the MI's own predictions at Malin Head, Howth,
  Port Oriel and Skerries. Method, licences and numbers: `scripts/tides/README.md`.
  Neither the UKHO's data nor BODC's copies are used; no Admiralty offsets are transcribed.
  Freshwater lakes (Lough Neagh, Lough Derg, Blessington, Keel Lough) say "No tide".
- **Sunrise/sunset/civil twilight:** pure algorithm (`suncalc` in the browser or
  `astral` in Python). Compute in UTC, format with `Europe/Dublin`.
- **Weather variables:** delivered for ICON-EU as the `icon-eu-weather` adapter
  (`t_2m`, `td_2m`, `relhum_2m`, `tot_prec` plus a derived per-step `precip`, `clct`,
  `clcl`, `clcm`, `clch`, `pmsl`, `vis`, `cape_ml`, `ww`, `t_g` as a labelled SST proxy);
  all thirteen directories exist in the live index. Still open: the same rows from
  HARMONIE and ECMWF for a multi-model weather blend, and a browser reader for the
  `weather` kind. HARMONIE `ieIoI` files
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
6. **Local deployment** — **built**, see [`deploy/local/README.md`](../deploy/local/README.md):
   a Compose stack with the worker image, a `force5/ingest/scheduler.py` sidecar running
   per-model cadences from an editable `deploy/local/jobs.toml`, a named volume for
   `/data`, and Caddy serving `/weather/*` and `/marine/*` from that volume beside the
   built site on one origin. `force5/ingest/prune.py` is the retention job and protects
   current manifests; `force5/ingest/status.py` reports run ages. A new adapter needs a
   `[[jobs]]` entry; an id with no importer is rejected on its own without disturbing the
   other jobs, and new tide/wave output should publish under `marine/`.
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
   Docker Compose + scheduler (done). Tides adapter and sun times (cheap, high value).
2. **Wind breadth**: HARMONIE EPS members, ECMWF ENS, GFS. This alone gives 80+
   members for the cone.
3. **Frontend uncertainty views**: common axis, ribbon, candles, hover card, night
   shading, multi-select picker.
4. **Waves**: GFS-Wave, then Met Office NWS 1.5 km, then Marine Institute SWAN; wave
   rows in the dock.
5. **Weather rows** from ICON-EU/HARMONIE; sea temperature.
6. **More wind**: GEFS, ARPEGE and AROME (done); ICON global, UKV. Then NI tides.

## Open questions

- Model identity colours vs the one-hue design rule.
- Whether to show the map for ensemble models (mean vs control vs member picker).
- NI tide source: UKHO terms vs self-computed harmonics.
- CMEMS account: worth holding a credential for the best wave product?
- Local hosting target: which machine, storage budget for raw caches, LAN vs mesh URL.
