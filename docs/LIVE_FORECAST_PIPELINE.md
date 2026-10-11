# Running Force5 forecasts live

> **Running this on your own machine instead?** See the
> [local self-hosted deployment](../deploy/local/README.md): one Docker Compose stack —
> site, scheduler, retention and ingest volume on a single origin — with no cloud
> account, no S3 bucket and no secrets. This document describes the AWS design, which
> that option does not need.
>
> **The design we are actually deploying** is Cloudflare R2 behind its CDN, with the
> importer run as one-shot batch containers on our own machines: see
> [Cloudflare R2 and one-shot batch containers](#cloudflare-r2-and-one-shot-batch-containers)
> below. It reuses everything here except ECS, CloudFront and the bucket policy.

## What runs where

We do **not** run the HARMONIE weather simulation ourselves. Met Éireann runs it. Our job downloads a complete run, decodes its wind fields, rotates/regrids/crops them for our map, validates the result and publishes static JSON. No GPU or continuously running forecast API is required for this design.

```text
EventBridge Scheduler
  → ECS Fargate task (Force5 container from ECR)
    → discover/download Met Éireann or DWD model output
    → decode + validate + prepare wind frames and spot time series
    → cut each wind frame into a tile pyramid (F5T1 .bin) with .br/.gz sidecars
    → move the spot series into 2° spot squares, name the run directory for its content
    → upload the immutable run directory to private S3
    → conditionally update latest manifest LAST
      → CloudFront HTTPS endpoint → website / future map clients
```

The website and forecast worker are separate deployments. A forecast refresh must not require rebuilding the website.

## Code supplied

- `force5/Dockerfile`: non-root, one-shot Python worker image containing only the ingest code, the spot catalogues (`public/spots.json` and `public/riding-locations.json`, with `FORCE5_SPOTS_FILE` pointing at the latter) and the local cadence schedule. No saved forecasts, repository history, frontend dependencies or credentials. The root `.dockerignore` is one allowlist shared with the local site image, so the build context also carries the frontend sources; this image does not.
- `force5/ingest/registry.py`: the single model table — script, published manifest path, bundle kind and default freshness limit. `worker.py` derives its `--models` choices and age limits from it and `publish_s3.py` takes manifest paths and the immutable object root from the same entry, so onboarding a model is one registry line plus its fetch script.
- `force5/ingest/worker.py`: invokes any selection of the registered importers, validates each package and optionally publishes. It exits nonzero on failure and logs JSON completion/failure events. A filesystem lock prevents concurrent jobs using the same scratch directory.
- `force5/ingest/f5tile.py` and `f5bin.py`: the wind frame as tiles ("F5T1", docs/TILING_DESIGN.md). Every wind adapter publishes its map frames through `f5bin.publish_frame`, which cuts the u/v/gust grids into 128 × 128-cell tiles on a global lattice, with overview levels averaged 2 × 2 until one tile holds the whole domain, each tile stored with a one-cell border as little-endian int16 tenths of a metre per second, row-delta-encoded behind a 24-byte header carrying the run, the forecast hour, the level and the tile's place. It writes every tile of every level for the hour at `t/{level}/{x}/{y}/<HHH>.bin` inside the run's directory, with precompressed `.bin.br` and `.bin.gz` sidecars beside each. `rundir.write_run` then lists the tiles that are empty at every hour as absent and drops them, and gives the pointer a `tiles` block (below). On the real HARMONIE run of 7 October 2026 a frame's nine native tiles are about 85 KB brotli in all (largest 30 KB), its four level-1 tiles 32 KB and its one level-2 tile 10 KB, against 74 KB for the same frame as one whole file. The rounding rule and the wrapping delta arithmetic are f5bin's; `force5/src/f5tile.ts` reads the tiles in the browser and `scripts/f5tile.mjs` writes them for the sample bundles, both pinned to the Python writer by the golden pyramids in `tests/fixtures/f5tile`. Whole frames (`f5-int16-v1`) are no longer published; the format stays as the reference the tiles' level 0 is tested against.
- `force5/ingest/rundir.py` and `squares.py`: the run directory and the spot squares (see "Object layout" below). Every forecast adapter writes its frames into a staging directory as it goes and finishes with one call, `write_run`, instead of writing its pointer itself: it moves the per-spot data into one file per 2° square, drops anything the run does not reference, names the directory for the hash of what is in it, renames it and only then writes the pointer. `squares.load_spot_data` is the one Python reader of the squares, and `force5/src/spotData.ts` the one TypeScript reader.
- `force5/ingest/publish_s3.py`: validates the whole run directory before uploading anything: it must sit beside the pointer, be named for this model, hash to the name it carries and hold exactly the tiles, frames and squares the pointer names — for a wind run every tile its `tiles` block does not call absent, at every hour. The `tiles` block must match the grid (`f5tile.check_tiles`: the grid on the global lattice, exactly the levels and cell sizes the grid gives, absent tiles inside their ranges, gust blocks exactly when some frame has a gust window). Then every tile is checked: its header must name the run, the hour, the level and the place it is published as, carry a gust block exactly where the frame has a gust window, and hold only plausible values, and a native tile may leave no cell of the grid missing; the spot data read back from the squares is checked as the whole manifest used to be. A tile carries no model, so the **model** comes from the path — the run directory must be named for this model, by the same rule the bucket sweep's protection of a model with no pointer uses — and the directory's hash proves the bytes are the ones published under that name. What is therefore _not_ checked: that a tile's numbers are this model's rather than another's, if someone builds one model's run directory out of another's tiles, nor that an overview tile is the mean of the native ones. It uploads one encoding per immutable object: a `.bin` tile brotli-encoded as `application/octet-stream` with `Content-Encoding: br` (`FORCE5_BUCKET_ENCODING=gzip` switches it), JSON gzipped as before, with the sha256 metadata always taken over the uncompressed bytes. It reuses the `.br`/`.gz` sidecar the adapter already wrote — after decompressing it and confirming it is exactly these bytes — rather than compressing the same tile twice. Then the public pointer with an ETag conditional write. The sidecars are for the local Caddy deployment only and are never uploaded as objects of their own.
- `VITE_FORECAST_BASE_URL`: optional frontend build-time CDN root. All forecast manifests and frames use it; the spot catalogue and application assets remain on the website origin.

**Published sizes recorded per model below predate the binary frames and the tiles** and were measured when wind frames were JSON. Divide a wind model's published figure by roughly eleven for one whole binary frame on disk plus its sidecars, or by three against what a browser was sent for one; a frame's tiles at every level are about 1.7 times its whole binary frame on disk (127 KB brotli against 74 KB for HARMONIE), and a browser fetches one level of them for its view. Wave and weather runs no longer publish frames at all.

The worker defaults to **hourly HARMONIE**, with the importer's full 60-hour horizon: 61 frames including hour zero. ICON-EU uses its full 72-hour horizon when selected. The existing bundled website snapshots remain three-hourly until a new snapshot is generated and served. Hourly output is genuine source data, not temporal interpolation. On 13 September 2026 the live Met Éireann inventory was checked and contained all control files from +000 through +060 at one-hour intervals.

## Build and run locally

From the repository root, on a machine with Docker:

```sh
docker build -f force5/Dockerfile -t force5-forecast:local .
docker run --rm force5-forecast:local --help
docker run --rm -v force5-work:/data force5-forecast:local --models harmonie --step 1
```

The named volume retains `/data/.cache` and `/data/public/weather`. No S3 upload happens unless a bucket is supplied. Allow network access to the model providers. Each importer has a default 45-minute timeout; downloads also have per-request timeouts/retries.

```sh
# Both models; each publishes independently.
docker run --rm -v force5-work:/data force5-forecast:local --models harmonie icon-eu --step 1

# Validate an existing volume without downloading a new run.
docker run --rm -v force5-work:/data force5-forecast:local --models harmonie --publish-only
```

For S3 publishing, set `S3_BUCKET` (and optionally `S3_PREFIX`) or supply `--bucket` / `--prefix`. In ECS, provide credentials through the task IAM role; never bake keys into the image or frontend. `AWS_REGION=eu-west-1` is an example region, not a requirement. The default AWS credential chain must be configured separately when testing uploads outside ECS.

Use `--run YYYYMMDDHH` only for an available provider run. `--max-age-hours` defaults to the registry's `maxAgeHours`: 12 for most regional models and 40 for ECMWF's IFS control, which is fetched once a day; stale/future-dated runs and expired horizons are rejected. `--publish-only` never bypasses validation or freshness checks.

ECMWF is also supported: `--models ecmwf` imports its full 15-day IFS control
forecast (85 frames). It always retains 3-hour steps through +144h, then 6-hour
steps through +360h; `--step` only affects the regional models. Only the 00/12 UTC
products reach +360h; the 06/18 cycles are shorter and cannot replace this snapshot.
The shipped timetable takes the 00 UTC run once a day, `--ecmwf-cycle 00` at 08:20
UTC with a 10:20 retry, because open data publishes the whole run at about 07:35 UTC. See the
[ECMWF specification](ECMWF_15_DAY_PLAN.md) for source, contract and acceptance tests.

GFS is supported the same way: `--models gfs` imports NOAA's public-domain 0.25°
deterministic run. The worker's `--step` selects the horizon GFS actually
publishes at that cadence: `--step 3` gives 0–240 h (81 frames) and `--step 1`
gives 0–120 h (121 frames), which is as far as NOAA writes hourly files. No API
key is needed, and through the default NOMADS GRIB filter each step transfers
only about 14 KB because NOAA crops the subregion server-side — well under a
megabyte for a whole run. The `noaa-gfs-bdp-pds` fallback is not wired into the
worker; run `fetch_gfs.py --source s3` directly when NOMADS is unavailable, at
about 2.5 MB per step for whole-globe messages. GFS gusts are instantaneous
surface values, published as `gustKind: "instantaneous"` with `[hour, hour]`
intervals at every hour.

### GEFS (ensemble)

**Retired** (10 October 2026) to keep downloads near 80 GB a month: the job ships
disabled and the site does not fetch it. The adapter below is unchanged; see
`deploy/local/README.md` to bring it back.

`--models gefs` runs `fetch_gefs.py`, which imports NOAA's public-domain 0.25°
Global Ensemble Forecast System and publishes `weather/gefs.json`. It is the second
ensemble bundle and the first one whose **mean is drawn on the map**
(`mapCapable: true`, and `gefs` is in `MAP_MODEL_IDS`). Member 0 is the `gec00`
low-resolution control, so `ensemble.control` is `0` rather than `null`. The worker
passes nothing model-specific: GEFS has no hourly product, so its registry entry
sets `workerStep: false` and the worker never forces its 1/3-hour `--step` on it.
Member count, step and horizon are the importer's own options and default to
**31 members, 6-hourly to +240h** (41 steps).

Bandwidth is not the constraint here; request count is. Measured on the live 18 UTC
cycle of 16 September 2026 at `+006h`, the NOMADS 0.25° ensemble filter
(`filter_gefs_atmos_0p25s.pl`) returns the Ireland subregion for one member-step in
**14.7–15.6 kB** (5.65 kB UGRD, 5.19 kB VGRD, 4.28 kB GUST), averaging 15.2 kB across
all 31 members, so a default run transfers about **19.3 MB**. The same three messages
read from `noaa-gefs-pds` through the `.idx` sidecar are **2.18–2.24 MB** per
member-step, because the bucket holds whole-globe messages — about 2.8 GB per run,
145 times the filter. A GRIB2 message is packed as a whole, so no byte range can
narrow it to Ireland; the three are already the only messages read, and UGRD and VGRD
sit side by side in the file, so they come in one range: an `.idx` read and two ranges
per member-step. A default run makes 1,271 filter requests at the two connections and
0.6 s pause NOMADS asks for, and NOMADS answers each in two to three seconds, so that
is the job's wall time; `--step 3` (81 steps) doubles both to 2,511 requests and about
38 MB. Each run prints its own measured transfer and phases.

The bucket states no such limits, so `--source s3` reads with **12 workers** by
default (up to 16), over one kept-alive connection each and with no pause; from NOMADS
the limit stays two. Measured on 10 October 2026 against the same 06 UTC run, one run
each:

| Source | Requests | Transferred | Download | Decode | Total |
| --- | --- | --- | --- | --- | --- |
| NOMADS, 2 workers | 1,271 (+13 retried) | 18.7 MB | 1,289 s | 2.7 s | 1,393 s |
| S3, 12 workers | 3,813 | 2.78 GB | 116 s | 23 s | 145 s |

Discovery took 101 s of the NOMADS run (a listing that stalled and was retried) and
5 s of the S3 one. Decoding is slower from S3 because every message is the whole
globe. Over 62 member-steps, S3 read 8.6 MB/s with 4 workers, 17 MB/s with 8, 21 MB/s
with 12 and 23 MB/s with 16, which was the connection's ceiling; the old fallback (two
workers, a fresh connection per request, a 0.05 s pause) read 1.4 MB/s and was no
faster than NOMADS. Sixteen workers on fresh connections had new connections refused
for minutes at a time, which is why they are kept alive. The two runs published the
same bundle except one member at one step (member 20 at +120 h), whose values differ by
0.01 m/s: the filter re-packs its subregion, and one value rounded the other way.

The worker passes `--noaa-source` (default `nomads`, or `NOAA_SOURCE` in the
environment) to GEFS as `--source`. Which to use is a trade of bandwidth for time:
NOMADS costs about 19 MB and 23–33 minutes a run, close to the worker's 45-minute
adapter timeout on a slow day; S3 costs about 2.8 GB (11 GB a day at four runs) and
two and a half minutes.

Only the ensemble mean becomes map frames, with the same Ireland crop and frame
contract as the GFS control, including `gustKind: "instantaneous"` and
`[hour, hour]` intervals at every hour. Per-spot member series live in the manifest
(`spotMembers[spotId][step].u/v/gust`, arrays indexed by member with the control at
index 0), so browsers never fetch member grids. Every member message is validated
(centre `kwbc`, `perturbationNumber`, `cf`/`pf` type, 30 declared perturbed members,
a constant grid signature, finite values in range) before anything is published.

Verified against the live 12 UTC run on 16 September 2026: the default settings
transferred **18.4 MB** over 1,271 member-steps (14.5 kB each), validated 3,813
member messages, and published 41 ensemble-mean frames (2.38 MB of JSON) plus a
659 kB manifest for 25 locations × 41 steps × 31 members in **781 seconds** with two
readers. The 18 UTC cycle was skipped because 12 of its 31 members were still being
written about 5.5 hours after run time. The two source routes were also verified to
decode to identical cropped member values. The run wrote only to a scratch work
directory; no AWS resources were created.

An ensemble manifest is much larger than a deterministic one — 659 kB here against a
few tens of kilobytes — so serve it with the short-lived pointer cache policy and
compression, as for ECMWF ENS. A per-spot series endpoint is the next optimisation
for both.

Schedule GEFS **four times a day at cycle + about 5 hours**. The 0.25° members finish
4.5–6 hours after run time and not in member order, so the newest cycle is often still
incomplete at that point and the importer falls back to the previous one, which is
then about 11 hours old against a 12-hour limit. That is deliberately tight: if a
slot finds neither cycle complete it publishes nothing and the next slot retries six
hours later. Widen `maxAgeHours` before moving the slot later.

### ECMWF ENS (ensemble)

**Retired** (10 October 2026) to keep downloads near 80 GB a month: the job ships
disabled and the site does not fetch it. The adapter below is unchanged; see
`deploy/local/README.md` to bring it back.

`--models ecmwf-ens` runs `fetch_ecmwf_ens.py`, which imports ECMWF's open-data
ensemble (stream `enfo`, type `pf`) and publishes `weather/ecmwf-ens.json`. It
never requests `type=cf`: IFS Cycle 50r1 retired the `scda` stream and merged the
ENS control into `oper`, which we publish separately as the `ecmwf` model, so
`ensemble.control` is `null`. The worker passes `--source`; member count, step and
horizon are the importer's own options and default to **10 members of the 00 UTC
run, 6-hourly from +60h to +144h** (15 steps). The ensemble is kept for the days
HARMONIE does not reach: `--from-hour 60` starts where HARMONIE's 2 km forecast
stops, and `--cycle 0` makes discovery look for the 00 UTC run only, so the
service downloads one ensemble a day. Gusts are kept.

With `--from-hour 0` the ensemble **mean** is also published as map frames, with
the same Ireland crop and frame contract as the control product, and a
single-entry `stepRanges` ladder. A later start publishes no frames, no
`stepRanges` and no `gustMissingHours`: it is a chart-only ensemble, which the
publisher and the site both accept. Per-spot member series live in the
manifest (`spotMembers[spotId][index].u/v/gust`, arrays indexed by member), so
browsers never fetch member grids. `spotForecasts` holds the ensemble mean.
The publisher validates member counts, alignment, finiteness and ranges for
every spot and step before uploading anything.

Bandwidth is the operational constraint, not CPU. Measured on 16 September 2026
from the real 0.25° `enfo` index: **0.84 MB** per `10u` member-message, **0.83 MB**
per `10v`, **1.39 MB** per `10fg`, plus a **2.0 MB** index per step — about
3.07 MB per member per step. The default run (10 members × 15 steps plus 15
indexes) therefore downloads about **0.49 GB**; 25 members from +0h was **1.95 GB**,
and all 50 members to +240h would be **6.35 GB** per run. Each run prints its own
measured transfer. Egress-priced environments should count 2 GB × 2 runs per day,
plus the per-step index overhead, which shrinks when fewer, larger steps are asked
for.

Verified against the live 12 UTC run on 16 September 2026: the default settings
transferred **1.954 GB** (1.904 GB of member GRIB plus 50 MB of step indexes) and
completed download, validation of all 1,850 member messages, publication of 25
ensemble-mean frames (1.44 MB of JSON, 39–61 kB each) and bundle validation in
**172 seconds** with two readers against `--source ecmwf`. Source gust maxima were
1-hour intervals through +90h and 3-hour intervals from +96h, recorded per frame.
The run wrote only to a scratch work directory; no AWS resources were created.

Schedule ENS **once a day** against the 00 UTC cycle, at 08:35 UTC with a retry at
10:35 that skips the download once the run is published. The importer refuses a run
older than 24 hours and publishes only a complete member set; the registry's 36-hour
limit covers the day until the next run replaces it. The AWS mirror returned
sustained `503 SlowDown` during development while other jobs were active, so the
importer allows 6 retries with a 10-second backoff and honours `--source ecmwf`
or `--source google`; keep concurrency at 1–2 readers (`--workers`).
`--models harmonie-eps` adds the Met Éireann ensemble adapter, which publishes
per-member spot series for a probability chart plus ensemble-mean frames on the
same 233 × 236 Ireland grid as HARMONIE. It is the one adapter whose members come
from **several model runs**: the portal exposes no coherent perturbed member, so
members are the controls of successive hourly cycles lagged onto one valid-time
axis (see the README for the endpoint evidence). Two facts drive its deployment:

- **Bandwidth.** There is no server-side subsetting, so every member/step is a
  separate 12.9–13.8 MB ZIP. A measured 48 h / 3-hour run with two members
  transferred 443 MB in 18 s and left 8.2 MB in `.cache/harmonie-eps`, publishing
  17 frames (9.3 MB) and a 30 KB manifest. Use `--step 3`; `--step 1` multiplies the
  transfer by three. Budget roughly 0.5–1.5 GB per hourly job and confirm this is
  acceptable to the provider before scheduling it continuously.
- **Member count.** The portal keeps about three hours of publications, so a cold
  run finds two to four members. Validated files persist in the named volume's
  cache and a cycle still counts once cached, so `--step 1` jobs accumulate members
  up to `--max-lag` (default 6) over successive hours. `--min-members` (default 2)
  fails the job rather than publishing a one-member "ensemble".

Gusts are null for this model: the Ireland control subset publishes only signed
gust components. Alarm on `forecast_failed` as for the other models, and treat a
drop in `ensemble.members` between runs as a source-retention signal, not a bug.
Marine Institute Irish Shelf SWAN waves are the first `wave` bundle:
`--models mi-swan` publishes hourly wave series for every riding location through
+144 h. The model runs **once a day** and the aggregate appears around 08:20–09:30
UTC, occasionally a day late, so schedule one attempt at **10:00 UTC and a retry at
14:00 UTC**; the importer refuses a day whose time axis does not end exactly 144 h
after it, so an early or half-updated attempt fails cheaply and the retry picks the
run up. Its registry age limit is 36 hours, which tolerates a day-late run published
in the morning but still rejects a silently stalled aggregate. Map frames are off by
default: the whole shelf grid is far larger than the site needs, and `--frames`
transfers about 3.2 MB per frame. A clean run is roughly 4 seconds, 58 requests at two
concurrent connections and a 0.56 MB manifest, so this job is far cheaper than any
GRIB model.
GFS-Wave is the first **wave** bundle: `--models gfs-wave` imports NOAA's
WAVEWATCH III `arctic.9km` output, nine wave variables on a 0.05° Ireland display
grid, and publishes `weather/gfs-wave.json` with its spot squares beside it. The
worker only passes `--step`/`--run` to wind models, so a wave task takes the
importer's defaults: 0–240 h at three-hour steps, 81 steps. A measured live run
took 75 seconds, downloading 5.3 MB through the NOMADS wave filter (about 70 KB a
step). It used to publish 45 MB of map frames as well, an order of magnitude more
output than a wind model; nothing read them, so it no longer does.
Run `fetch_gfswave.py --source s3` directly if the filter service is down; that
path reads whole-grid messages, roughly 3.5 MB per step. The importer refuses to
publish when the cut-out does not land on the source lattice, which is the check
that would catch NOAA changing the grid or the filter's coordinate arithmetic.

ICON-EU surface weather is the first **weather** bundle: `--models icon-eu-weather`
runs `fetch_icon_weather.py`, which reads thirteen ICON-EU single-level parameters
(temperature, dew point, humidity, accumulated precipitation, four cloud layers,
mean-sea-level pressure, visibility, mean-layer CAPE, WMO present weather and ground
temperature) from one cycle and publishes `weather/icon-eu-weather.json` with its
spot squares beside it, and no map frames: nothing reads them. The worker passes
`--step`/`--run` only to wind models, so this task takes the importer's defaults:
0–72 h at three-hour steps, 25 steps. Its registry age limit is 12 hours, the same as
ICON-EU wind.

Bandwidth is the operational constraint. DWD publishes one whole-Europe file per
parameter per step with no server-side subsetting, so a default run transfers **301 MB
in 325 bz2 GRIB files** (measured against the live 18 UTC run on 16 September 2026)
and completes download, validation, cropping and publication in **67 seconds**,
writing 25 frames of 1.19–1.27 MB (30.3 MB) and a 156 KB manifest. `--step 1` triples
that transfer. The cache lives in the same `.cache/grib/<run>/` directory as the wind
importer under distinct parameter names, so a volume holding both ICON jobs for one
run needs roughly 400 MB.

Frames carry a declared subset of the variables (`t2m`, `precip`, `clct`, `pmsl`,
`ww`) because thirteen arrays over 56,817 cells would be about 3 MB per frame;
`spotSeries` carries every variable at every hour, which is what a chart reads.
`precip` is differenced from DWD's `tot_prec` accumulation and is `null` at hour 0;
`ww` is a WMO code that must never be interpolated or blended; `tg` over sea is a
model SST **proxy** and must be labelled as one wherever it is shown. Schedule it on
the same four cycles as ICON-EU wind with a publication lag of about 3.5 hours
(`deploy/local/jobs.toml` runs it at 03/09/15/21 UTC, ten minutes after the wind job
so the two never share the worker lock), and alarm on the same 12-hour threshold.

### ARPEGE and AROME (Météo-France)

**Retired** (10 October 2026) to keep downloads near 80 GB a month: the job ships
disabled and the site does not fetch it. The adapter below is unchanged; see
`deploy/local/README.md` to bring it back.

`--models arpege arome` runs `fetch_arpege.py` and `fetch_arome.py`, which share
`meteofrance.py` and publish `weather/arpege.json` and `weather/arome.json`. Both are
ordinary deterministic wind bundles: map frames, a series for all 25 riding locations,
Etalab Open Licence 2.0 and no key. The worker passes only `--step`; the schedule
sends `--step 3`, and `--step 1` reaches the same horizon for both models.

The interesting part is transfer. Météo-France publishes whole packages with **no
server-side subsetting and no `.idx` sidecar**: one ARPEGE `SP1` run is 646 MB across
nine time-group files and one AROME `SP1` run is 461 MB. The client therefore walks
each package's GRIB2 message headers over HTTP byte ranges, 1 KB at a time, and
downloads only the 10 m u, 10 m v and FF_RAF messages. Three package files are walked
at once, one socket per thread; the resulting byte offsets are cached per run, so a
retry re-reads nothing. **The bucket ignores a multi-range request and answers 200
with the whole object**, so the client sends one range per request and treats anything
but a 206 of the requested length as a fault, closing the connection without reading
the body. Packages are CCSDS/AEC packed (template 42) and need an ecCodes with libaec.

Measured cold against the live 18 UTC run of 16 September 2026, three workers:

| Model  | Requests           | Transferred | Wall time | Published                         |
| ------ | ------------------ | ----------- | --------- | --------------------------------- |
| ARPEGE | 1,236 (1,130 head) | 37.1 MB     | 32 s      | 35 frames, 12 MB, 76 kB manifest  |
| AROME  | 366 (310 head)     | 37.1 MB     | 13.6 s    | 18 frames, 9.8 MB, 41 kB manifest |

That is 1.7% of the ARPEGE package set and 8% of the AROME one. Header reads dominate
ARPEGE's request count because the packages are laid out parameter-major and the gust
block sits about 130 messages into each file; the walk stops there rather than reading
to end of file.

The bucket now and then never answers a request at all: about one in thirty on the
afternoon of 10 October 2026, when AROME took 618 s instead of 13 because each stall
sat out a 120 s socket timeout. A read now gives up after 15 s of silence and is
retried on a fresh connection, which answers at once; on the same day an ARPEGE run
with one stall took 46 s against 28 s without. The `index` phase in the job's event
shows the header walk's requests and retries on their own. The walk cannot be
skipped: the run's prefix holds only the packages, no index beside them (checked 10
October 2026), every message's offset depends on the compressed length of the one
before it, so neither one file's walk can be split between workers nor any run's
offsets reused for the next.

Schedule **ARPEGE four times a day at cycle + 4 h 50 m** (00/06/12/18 UTC) and **AROME
eight times a day at cycle + 4 h 55 m** (every three hours). Measured completion of the
`SP1` package set: ARPEGE 3 h 07 m to 4 h 21 m after run time, AROME 3 h 57 m to
5 h 05 m. Both use `maxAgeHours: 12`, so a slot that finds the newest cycle incomplete
falls back to the previous one and still publishes.

**AROME's published grid is larger than the model.** Its 0.025° `EURW1S40` box spans
12°W–16°E and 37.5–55.4°N, but the model runs on a rotated domain inside it and a GRIB2
bitmap masks about 17% of the box — a corner that cuts diagonally across Donegal. Valid
data on the 55°N row starts only at 8.45°W and the 55.4°N row is masked outright, so the
crop is the largest rectangle wholly inside the unmasked area: 10.9°W–5°W, 51–54.75°N at
237 × 151 native cells. Pollan Bay, Benone Strand and Magheraroarty fall outside it and
are published with null series plus a manifest `coverageNote`; ARPEGE (18°W–2°E,
48–59°N at 201 × 111) is the fallback there. A masked cell inside either crop fails the
run, so a change to the model domain is a loud error, never a published 9999.

Gusts are FF_RAF for both: the maximum over the **hour ending at each forecast time**,
read from the GRIB2 statistical keys and published as `gustIntervalHours: [h-1, h]`
with `gustMissingHours: [0]`. The window stays one hour at three-hourly cadence, so a
frame describes the hour before it and not the whole gap; these are interval maxima and
must not be compared with the instantaneous gusts GFS and GEFS publish.

### AIFS Single (ECMWF's AI model)

**Retired** (10 October 2026) to keep downloads near 80 GB a month: the job ships
disabled and the site does not fetch it. The adapter below is unchanged; see
`deploy/local/README.md` to bring it back.

`--models aifs` runs `fetch_aifs.py`, which imports ECMWF's operational machine-learned
deterministic forecast (`model="aifs-single"`, MARS class `ai`) from the same public
0.25° open data as the IFS control, with no API key. It publishes
`weather/aifs.json`: 61 frames in uniform 6-hour steps to +360 h, on the same
81 × 45 Ireland/Atlantic crop as `ecmwf`. The registry marks it `workerStep: False`, so
the worker never forces its 1/3-hour `--step` on a source whose only cadence is six
hours; it does pass `--ecmwf-source`, like the other three ECMWF adapters.

Three facts drive its deployment:

- **All four cycles reach the full horizon**, unlike the IFS control's 00/12-only 15-day
  product, so there are four slots a day rather than two. Each is published about six
  hours after run time; `deploy/local/jobs.toml` runs it at 00/06/12/18 UTC + 25 minutes
  and the registry age limit is **12 hours**, which is exactly one cycle of slack.
- **There is no gust.** The `aifs-single` inventory has no `10fg`/`10fg3` at any step, so
  the bundle declares `gustAvailable: false` with null gust arrays and null
  `gustIntervalHours` on every frame. `publish_s3.already_current` will refuse to let a
  gustless manifest replace one that had gusts, which is the right protection for the
  wind control and a no-op here because every AIFS run declares the same absence. Do not
  alarm on missing AIFS gusts; alarm on a missing AIFS _run_.
- **Bandwidth is modest.** A verified run of the live 18 UTC cycle on 16 September 2026
  transferred **86.1 MB** in 61 ranged reads (1.39–1.45 MB a step for `10u` + `10v`) and
  completed download, validation, cropping and publication in **21 seconds** with three
  readers against `--source ecmwf`. It wrote 61 frames of 38.8–39.4 KB (2.4 MB) and a
  130 KB manifest, into a scratch work directory; no AWS resources were created.

AIFS is a _different_ model, not a correction of IFS: where the two disagree, neither is
the other's error term. Present it as its own row, and do not fold it into an IFS
average.

### ECMWF wave stream

**Retired** (10 October 2026) to keep downloads near 80 GB a month: the job ships
disabled and the site does not fetch it. The adapter below is unchanged; see
`deploy/local/README.md` to bring it back.

`--models ecmwf-wave` runs `fetch_ecmwf_wave.py`, which imports the `wave` stream of the
same open data — the WAM ocean wave model coupled to IFS — and publishes the
`kind: "wave"` bundle `weather/ecmwf-wave.json`. The 00 and 12 UTC cycles run to +360 h
on exactly the wind control's ladder (3-hourly to +144 h, then 6-hourly), 85 frames of
ten variables at native 0.25° on the same crop as `ecmwf`. `cadence.expected_hours` now
holds both `ecmwf` and `ecmwf-wave` to that ladder, whole or stopped early but never
resampled, so a truncated or interpolated cadence cannot publish under either id.

- **Bandwidth is the operational constraint.** There is no server-side subsetting, so a
  full run transfers **700.3 MB** in 85 ranged reads (8.32–8.41 MB a step for ten
  messages). A verified run of the live 12 UTC cycle on 16 September 2026 completed in
  **61 seconds** with three readers against `--source ecmwf`, writing 85 frames of
  182 KB (15 MB) and a 407 KB manifest. `--no-bands` drops the six period-band heights
  for about 315 MB a run; the bands are the only swell information the stream has, so
  drop them only under real bandwidth pressure.
- **Schedule it twice daily.** `deploy/local/jobs.toml` runs it at 08 and 20 UTC + 45
  minutes, about eight hours after each cycle, with a 24-hour registry age limit — the
  same shape as the wind control. Every ECMWF adapter and the worker now default to
  the ECMWF-hosted source; the AWS mirror returned sustained `503 SlowDown` during
  development and remains available as `--ecmwf-source aws`.
- **Coverage is the thing to communicate, not a fault to fix.** A 0.25° cell is about
  28 km across. Of the 25 riding locations, 3 are read from their own four cells
  (Brandon Bay, Maharees, Keel), 21 from the nearest cell the model solved (1.5 km at
  Tullan Strand, median 13.4 km, 37.7 km at Rusheen Bay) and 1 has none within 40 km
  (Mountshannon on Lough Derg). Every offset is published as
  `spotCoverage[spot].nearestOffsetKm` with a sentence the UI shows. That is why the
  dock's preference is `mi-swan`, then `gfs-wave`, then `ecmwf-wave`: this source earns
  its place by reaching 15 days, not by resolving a beach.

## AWS setup checklist

1. Create a private S3 bucket with Block Public Access and versioning enabled. The application data is public through CloudFront, not public bucket ACLs.
2. Create a CloudFront distribution using S3 Origin Access Control. Use HTTPS, for example `forecast.wingfoil.ie`, with a suitable certificate/DNS record. Enable compression.
3. Give the **task role** only the required bucket access. Adapt `force5/deploy/s3-task-policy.example.json`; if using `S3_PREFIX`, include it in the object ARN. `GetObject` supports manifest reads and collision checks; `ListBucket` allows missing-key reads to return 404 instead of ambiguous 403, and lets the publisher check its run directory is whole after the swap. The publisher needs no delete permission; the bucket sweep (`prune.py --bucket`), which deletes superseded runs after their grace period, does. Configure separate execution-role permissions for ECR pulls and CloudWatch logs. KMS-encrypted buckets require additional scoped KMS permissions.
4. Configure CORS on S3/CloudFront for the actual website origins. `s3-cors.example.json` is a starting point. Allow GET/HEAD; expose ETag if needed. Ensure CloudFront forwards `Origin` and caches responses consistently, or use a response-headers policy with the intended allowed origins. Do not put AWS credentials in the browser.
5. Build the image, push it to your ECR repository and register an ECS Fargate task definition. Start with 2 vCPU / 4 GiB RAM and 20 GiB ephemeral storage, then measure actual runtime and peak memory: every event reports both in `resources`, and no enabled job measured above 360 MB in October 2026 (deploy/home-compute/README.md, "What a job uses"), so 1 vCPU / 1 GiB fits each. Use an image digest for deployments and a tested dependency/base-image lock for reproducible releases.
6. Give tasks outbound HTTPS access to providers, ECR, S3 and logging (appropriate public-subnet/public-IP routing or private-subnet NAT/endpoints). No inbound port is needed. Use a fresh writable scratch directory per task; persistent shared storage is not required.
7. Run a manual task and verify an entire published forecast through the CDN before enabling the schedule.
8. Schedule HARMONIE and the HARMONIE ensemble checks hourly, the ensemble with `--step 3` because of its bandwidth; use a separate ICON-EU task schedule matching the full-horizon main cycles, initially every six hours with an appropriate publication delay; give `icon-eu-weather` its own slot on those same cycles rather than adding it to the wind task, because it transfers about 300 MB and must not delay the wind publication. GFS runs four cycles a day (00/06/12/18 UTC) and publishes its longer lead times roughly 3.5–5.5 hours after each run time, so check hourly in the window after a cycle rather than firing once at a fixed offset; the importer refuses a cycle whose requested steps are not all listed yet. The importers discover the latest **complete** run, rather than assuming a scheduled run is ready. Tune scheduling against actual publication latency. See [scheduling ECS tasks with EventBridge Scheduler](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html).

Suggested container arguments:

```text
HARMONIE: --models harmonie --step 1 --bucket YOUR_FORECAST_BUCKET
ICON-EU:  --models icon-eu --step 1 --bucket YOUR_FORECAST_BUCKET
ICON-EU WEATHER: --models icon-eu-weather --bucket YOUR_FORECAST_BUCKET
ECMWF:    --models ecmwf --bucket YOUR_FORECAST_BUCKET
GFS:      --models gfs --step 3 --bucket YOUR_FORECAST_BUCKET
GFS-WAVE: --models gfs-wave --bucket YOUR_FORECAST_BUCKET
GEFS:     --models gefs --bucket YOUR_FORECAST_BUCKET
ARPEGE:   --models arpege --step 3 --bucket YOUR_FORECAST_BUCKET
AROME:    --models arome --step 3 --bucket YOUR_FORECAST_BUCKET
TIDES:    --models tides --bucket YOUR_FORECAST_BUCKET
SEA TEMPERATURE: --models sea-temperature --bucket YOUR_FORECAST_BUCKET
ECMWF ENS: --models ecmwf-ens --bucket YOUR_FORECAST_BUCKET
HARMONIE EPS: --models harmonie-eps --step 3 --bucket YOUR_FORECAST_BUCKET
MI-SWAN:  --models mi-swan --bucket YOUR_FORECAST_BUCKET
```

Tides need one nightly run: predictions extend to 2029, so the schedule only refreshes the
published nine-day window. The manifest's `run` is the ingest hour, which keeps the
existing staleness and compare-and-swap rules working unchanged; its default age limit is
30 hours.

Sea temperature is an **observation** feed, not a cycle: run it every three hours
(`deploy/local/jobs.toml` uses 00/03/…/21 UTC at :15, sharing that minute with the SWAN
job, which the one-job-at-a-time loop serialises). A run takes about 3 seconds, transfers
a few hundred kilobytes of CSV and publishes a single ~30 KB file with no immutable
objects, so its only S3 write is the pointer. Its `run` is
the **newest observation hour**, so the 48-hour registry limit is the age of the data:
alarm when it is exceeded, and expect it to trip when a buoy goes off station rather
than when the job fails. A station that stops reporting does not fail the run — the spots
it served fall back to a stated reason, and the run keeps publishing for the rest.

These are deployment instructions, not provisioned infrastructure. No bucket, registry, schedule or cloud task has been created by this change.

## Cloudflare R2 and one-shot batch containers

This is the deployment [the forecast data plan](FORECAST_DATA_PLAN.md) Phase 1 chose,
and it replaces the ECS/CloudFront design above rather than adding to it. Two things
change, and everything else in this document still applies.

**Where it runs.** "Home Compute" starts the importer image as a **one-shot batch
container** on whichever of our machines is free. Every run therefore begins with a
**completely empty disk**: no `public/` from last time and no `.cache`. Overlapping
runs of the same job are prevented by Home Compute; jobs for **different models run
at the same time on different machines**, which is why nothing in the publisher
depends on the workspace lock or on a bucket listing. The lock still exists and is
still taken, because two containers could share a mount.

**Where it goes.** A **Cloudflare R2** bucket over the S3 API, with Cloudflare's CDN
in front of it on a custom domain. `publish_s3.py` talks to it through boto3 with an
explicit endpoint URL; nothing else differs from S3.

### Environment

| Variable                                      | Meaning                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `S3_BUCKET`                                   | The R2 bucket name. Without it the worker only writes locally.                                                                                                                                                                                                                                                                                   |
| `S3_ENDPOINT_URL`                             | `https://<account-id>.r2.cloudflarestorage.com`. Unset for AWS S3.                                                                                                                                                                                                                                                                               |
| `AWS_REGION`                                  | Optional. Defaults to `auto` whenever an endpoint URL is given, which is what R2 wants; boto3 insists on having some region.                                                                                                                                                                                                                     |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | An R2 API token with object read/write **and delete** on this bucket. The standard chain; never baked into the image, never logged, never sent to the browser.                                                                                                                                                                                   |
| `S3_PREFIX`                                   | Optional object prefix, before `weather/`. The frontend's `VITE_FORECAST_BASE_URL` must include it.                                                                                                                                                                                                                                              |
| `FORCE5_WORK_DIR`                             | Scratch directory, `/data` in the image. Discarded when the container exits.                                                                                                                                                                                                                                                                     |
| `FORCE5_SPOTS_FILE`                           | `/app/public/riding-locations.json`, baked into the image. Adding a spot means rebuilding the image.                                                                                                                                                                                                                                             |
| `FORCE5_SWEEP_MIN_AGE_HOURS`                  | Bucket sweep only. Default for `--min-age-hours`; 6 unless you have a reason.                                                                                                                                                                                                                                                                    |
| `FORCE5_SIDECARS`                             | `0` to stop writing `.bin.br`/`.bin.gz` beside every wind tile. **A job that only uploads to the bucket should set this**: the bucket stores one encoding per object and serves no sidecar, so writing them spends a brotli and a gzip per tile on bytes nothing will read. Default `1`, which is what the local Caddy deployment serves from.   |
| `FORCE5_BUCKET_ENCODING`                      | `br` (default) or `gzip`: how a `.bin` frame is stored in the bucket, and the `Content-Encoding` it is served with. One encoding per object either way. The way back if a CDN ever mangles brotli.                                                                                                                                               |
| `FORCE5_BROTLI_QUALITY`                       | 0–11, default 9. Raising it shrinks frames a little and costs a lot of ingest time — see the table in docs/FORECAST_DATA_PLAN.md. A value outside that range fails the job with a sentence naming this variable.                                                                                                                                 |

`FORCE5_PUBLISHED_RUN` is set **by** the worker for the adapters that read it and must
not be set in a job's environment; the worker clears any inherited value.

Unlike the AWS design, the token **does** need `DeleteObject`, for the sweep: it removes
superseded runs once their grace period is over, and failed uploads. The publisher itself
deletes nothing.

### One-shot invocations, as Home Compute runs them

Every job is the same image with a different `--models`. `--endpoint-url` can be left
out when `S3_ENDPOINT_URL` is set in the job's environment; it is spelled out here.

**Put `FORCE5_SIDECARS=0` in `r2.env`.** These jobs upload and then throw their disk
away: the bucket stores one encoding per object and never serves a `.bin.br` or
`.bin.gz`, so writing them costs a brotli and a gzip per wind frame for bytes nothing
reads. With it unset — the default, which is what the local Caddy deployment needs —
the uploader at least reuses the sidecar rather than compressing the frame twice, but
the gzip is still wasted. A HARMONIE frame costs 18.9 ms to publish with it set
against 37.7 ms without.

```sh
R2="--bucket wingfoil-forecast --endpoint-url https://ACCOUNT.r2.cloudflarestorage.com"

# Twice a day (HARMONIE), once a day (ECMWF's 00 UTC run, 08:20 and a 10:20 retry)
docker run --rm --env-file r2.env force5-forecast:latest --models harmonie --step 1 $R2
docker run --rm --env-file r2.env force5-forecast:latest --models ecmwf --ecmwf-cycle 00 $R2

# Four cycles a day
docker run --rm --env-file r2.env force5-forecast:latest --models icon-eu --step 1 $R2
docker run --rm --env-file r2.env force5-forecast:latest --models icon-eu-weather $R2
docker run --rm --env-file r2.env force5-forecast:latest --models gfs --step 3 $R2
docker run --rm --env-file r2.env force5-forecast:latest --models gefs $R2
docker run --rm --env-file r2.env force5-forecast:latest --models aifs $R2
docker run --rm --env-file r2.env force5-forecast:latest --models arpege --step 3 $R2

# Eight times a day / twice daily / daily
docker run --rm --env-file r2.env force5-forecast:latest --models arome --step 3 $R2
docker run --rm --env-file r2.env force5-forecast:latest --models ecmwf-ens $R2
docker run --rm --env-file r2.env force5-forecast:latest --models ecmwf-wave $R2
docker run --rm --env-file r2.env force5-forecast:latest --models gfs-wave $R2
docker run --rm --env-file r2.env force5-forecast:latest --models mi-swan $R2
docker run --rm --env-file r2.env force5-forecast:latest --models sea-temperature $R2
docker run --rm --env-file r2.env force5-forecast:latest --models tides $R2

# Hourly, after the wind jobs: every spot's blend, read from what the bucket serves
docker run --rm --env-file r2.env force5-forecast:latest --models blend $R2

# Verification (docs/VERIFICATION.md): observed wind hourly; the archive hourly after
# the blend, before the sweep deletes what it copies; the scores once a day
docker run --rm --env-file r2.env force5-forecast:latest --models wind-obs $R2
docker run --rm --env-file r2.env force5-forecast:latest --models forecast-archive $R2
docker run --rm --env-file r2.env force5-forecast:latest --models verify $R2

# Retention: the bucket sweep, hourly at :10, any machine. --dry-run first.
docker run --rm --env-file r2.env --entrypoint python force5-forecast:latest \
  /app/force5/ingest/prune.py --bucket wingfoil-forecast \
  --endpoint-url https://ACCOUNT.r2.cloudflarestorage.com --dry-run
```

Cadence and publication lags are unchanged; see the per-model sections above and
`deploy/local/jobs.toml`, which remains the reference schedule.

### After upgrading, run every enabled job once

An upgrade that changes what is published leaves the old pointers in place until each
model's next run replaces them. The move to run directories and spot squares
(schemaVersion 2, docs/TILING_DESIGN.md) is one: the new site refuses a version 1
pointer and shows that model as unavailable, and HARMONIE, the map's own model, is
scheduled at 07 and 12 UTC only, so the map could stay closed for up to 19 hours. The
blend leaves out a pointer it cannot use and names it (`blend_input_refused` from
`fetch_blend.read_bucket`, "left out …, whose pointer will not validate" from
`force5/blend/build.ts`) rather than failing; the other readers already skip one
model's unreadable run. So, once the new image is deployed, run every enabled job once,
wind models first and the blend after them:

- **The local deployment:** stop the scheduler, `npm run deploy:once`
  (`scheduler.py --once`: every enabled job in `jobs.toml`, in file order), start it
  again; see "Updating" in [deploy/local/README.md](../deploy/local/README.md).
- **Home Compute or Cloudflare:** run each enabled job's command above once, in the
  order `jobs.toml` lists them (`.venv/bin/python deploy/schedules.py --list` prints
  it), or trigger each job from the Home Compute Bar app.

Afterwards every model's pointer should name a run directory (`"base"`) and carry
`"schemaVersion": 2`; `status.py` reports a model's run and age, not its format.

### Nothing new costs nothing

`ecmwf` has a retry slot two hours after its morning slot (about 250 MB a run), and
`ecmwf-ens` was scheduled twice per run (about 2 GB). The others meet the same run more than once in
quieter ways: a manual `harmonie` run soon after a scheduled one finds the newest
complete cycle in the portal's window is the one that slot published, `gefs`, `arpege` and `arome` fall back
to the previous cycle while the newest is still publishing, and `mi-swan` checks its one
daily run three times. Raw downloads are not kept, so without a check each such slot
would re-download a run it has already published. On an empty disk there is
nothing local to check, so the **bucket is the truth**: when a bucket is configured the
worker reads the model's current pointer manifest and passes its run to the adapter in
`FORCE5_PUBLISHED_RUN`. An adapter that resolves that same run, and was not given an
explicit `--run`, writes nothing and exits `UNCHANGED_EXIT` (3). The worker logs

```json
{
  "event": "forecast_unchanged",
  "model": "ecmwf",
  "run": "2026091700",
  "seconds": 4
}
```

and exits **0**, without validating anything, because there is no bundle to validate.

**Only the bucket's answer ends a job.** `already_published` returns `"bucket"`,
`"local"` or `False`, and the two truthy answers are not interchangeable. Finding the
run on disk means only that an earlier attempt wrote it — its publish may have failed,
and on a persistent work directory (`deploy/local`, or `-v force5-work:/data`) the
bucket can still be serving an older run. That case returns **0**, skipping only the
download, so the worker validates and publishes what is on disk exactly as it did
before any of this existed. Collapsing the two would leave the site stale for a whole
source cycle while the worker logged success.

Symmetrically, the worker accepts exit 3 as "nothing new" **only from an adapter that
declares `readsPublishedRun` in the registry and that it actually gave
`FORCE5_PUBLISHED_RUN` to**. If the pointer could not be read, or the adapter is not
part of the contract, exit 3 is an ordinary failure. The variable is also stripped from
the inherited environment before each job, so a stray value cannot make a job claim
success.

Every forecast adapter is in the contract: `harmonie`, `icon-eu`, `icon-eu-weather`,
`ecmwf`, `ecmwf-ens`, `aifs`, `ecmwf-wave`, `gfs`, `gefs`, `arpege`, `arome`,
`harmonie-eps`, `gfs-wave` and `mi-swan`. Each decides from the discovery step it
already makes (an inventory listing, a package listing, ECMWF's `latest()` probe,
SWAN's info page and `time[last]`), after its freshness check, so a stale or
incomplete source still fails rather than reading as "nothing new". `ecmwf` and
`ecmwf-ens` use `fetch_forecast.already_published`, both halves; the rest use only its
bucket half, `fetch_forecast.published_in_bucket`, because they cannot name their bundle
before downloading, so a local run without `FORCE5_PUBLISHED_RUN` behaves exactly as it
always did. Two models stay out, because their `run` is not a provider run: `tides`
stamps the hour the job ran, so it never repeats, and `sea-temperature`'s newest
observation hour is known only after every reading is fetched, and can stay the same
while other stations catch up. `test_contract.py` fails if a registry flag and its
adapter's code disagree.

The bucket answer compares the **run id** only. So a change to an adapter's object
prefix (`ecmwf-RUN-360h-v2` → `v3`), member count or horizon does not force an immediate
re-import of the run already published: the new objects land with the source's next
cycle (within a day for ECMWF and SWAN). Pass `--run YYYYMMDDHH` to re-import the current one at once —
an explicit `--run` always skips the check.

### The blend: every spot's stars, by spot square

The map rates all 141 riding places at once, and before this it did so in the browser
from every wind model's manifest: about 2.4 MB compressed, which on a slow phone kept
the lights pending for some 20 seconds. The `blend` job works that consensus out once
an hour instead and publishes it as a run, the way the models are published: the
pointer `weather/blend.json` (about 1 kB compressed) and a run directory beside it,
`weather/blend-RUN-HOURSh-v2-HASH8/spots/<square>.json`, one file per 2° spot square
(about 81 kB compressed between Ireland's ten, the largest, around Dublin, 22 kB):

- **What it holds.** Each place's weighted median wind and gust (tenths of a knot),
  mean bearing (whole degrees) and agreement letter, on every time a deterministic
  model publishes, plus a summary of each model's run so the dock can build its
  columns without the manifests. No stars: those depend on the reader's weight, level
  and wings, and the browser rates an hour in microseconds (`src/spotBlend.ts`).
  The pointer (`schemaVersion` 2) holds the times, the models and the square index,
  `"spots": {"squareDegrees": 2, "url": "spots/{square}.json", "squares": [...],
  "keys": ["spotBlend"]}`; each square holds its places under `spotBlend`, in the same
  envelope as a model's squares. Each place goes in the square the riding-place
  catalogue puts it in, the catalogue the models were split by; a place the catalogue
  no longer lists is left out and named in the job's log.
- **The weighting.** Each model counts by how well it verified against Irish stations
  that far into its run (`MODEL_WEIGHTS` in `force5/src/weights.ts`; the backtest is in
  docs/VERIFICATION.md, "Blend weights"): HARMONIE 4 for as long as it runs, AROME and
  ICON-EU 2 on day 0 and 1 after, GFS 2 for two days, the ensemble means and AIFS rising
  to 1.5 from day 2, ECMWF IFS and ARPEGE 0.5 throughout. A model the backtest has not
  judged counts by its grid (3 km or finer three times, up to 8 km twice, coarser once).
  The agreement reads the standard deviation of every model's speed, more strictly the
  further ahead the hour is. The dock's blend chart, Gust and the MCP server use the
  same weights.
- **How it runs.** `force5/ingest/fetch_blend.py` reads every wind pointer the bucket
  serves into a scratch directory (never over a persistent work directory's own) and
  runs `force5/blend/build.ts`, the site's own TypeScript bundled into the image with
  esbuild, so there is one implementation of the blend. Without a bucket it reads
  `public/weather`; `npm run blend` does the same in a checkout. `build.ts` writes the
  run directory with `scripts/runs.mjs`, the JavaScript twin of `rundir.py` held to
  the same hash fixture, and the pointer last. The worker then validates it as it
  validates a model's run (the directory's hash, exactly the squares the pointer
  lists, then `validate_blend_bundle` over the places merged back in), uploads the
  squares and swaps the pointer, which names the run directory it replaced under
  `superseded`; the pruners keep the blend's directory by its `base`, and the one it
  replaced for the grace period, like any model's.
- **Its run** is the hour it was worked out, so the hourly job (`:05`, after HARMONIE's
  `:45` slot) publishes a new one each hour; `maxAgeHours` is 3.
- **The browser** reads the pointer when the map mounts and revalidates it every five
  minutes. The lights read only the squares in view — the map's bounds grown by a
  third on every side, recomputed when the camera settles, at most 36 squares, the
  nearest the centre — plus the squares of the open spot and of the reader's starred
  and frequent spots wherever they are, which the dock and the panel of their spots
  read. A place whose square has not been read keeps a pending light rather than a
  wrong one. It falls back to the old path, the blend worked out in the browser from
  the models' squares for the same places, when the reader has picked their own
  models, when the pointer is missing or malformed, when it is more than six hours
  old, or when none of the squares asked for can be read. The blend chart and the
  model list still fetch the manifests, but only once they are opened.

### Verification: what we forecast, against what blew

Superseded runs are deleted, so a run's forecast survives only if it is copied while it
is still served. The hourly `forecast-archive` job does that, sampling every new wind
run at Met Éireann's stations and the Marine Institute's buoys and keeping each spot's
series, into `archive/forecasts/<model>/<run>.json`; it also merges the hourly
`wind-obs` observations into `archive/observations/YYYY-MM-DD.json`. The daily `verify`
job scores every model, and the blend as the site works it out, against them and
publishes `verify/scores.json`. `archive/` is outside every data root and every delete
path refuses it by name. Everything about it — sources, licences, the scores and what
they cannot say — is in [VERIFICATION.md](VERIFICATION.md).

### Deleting what is superseded

A run directory is deleted once nothing can still want it, and not at the moment its
pointer moves on. Readers hold a pointer for a while after a swap: the browser
revalidates every five minutes (`MANIFEST_REVALIDATE_MS`), the CDN caches a pointer for
a minute (`s-maxage=60`), the forecast server for five (`SOURCE_TTL_MS`), and a thread's
spot card for five. Deleting the old directory right after the swap, as the publisher
used to, sent each of them to 404s for minutes, and the model read as unavailable. So,
as MET Norway keeps an old tileset at least 45 minutes:

- **The pointer remembers what it replaced.** A pointer whose `base` replaces another
  names the old one under `superseded`, with the time of the swap:
  `"superseded": [{"base": "harmonie-2026101106-61h-v3-1a2b3c4d/", "at": "2026-10-11T08:52:00Z"}]`.
  The publisher works the list out from the pointer **in the bucket** it is replacing,
  inside the same compare-and-swap, so the record and the swap are one write
  (`publish_s3.pointer_body`, `squares.retire`); `rundir.write_run` does the same from
  the pointer on disk for the local deployment. Entries are kept for six hours, at most
  24 of them, and a directory the new pointer names again is dropped from the list.
  Readers ignore the field.
- **The grace period** is 60 minutes by default: `prune.py --grace-minutes`, or
  `FORCE5_SUPERSEDED_GRACE_MINUTES`, for both the local prune and the bucket sweep, at
  most the six hours a pointer remembers. A directory any pointer superseded less than
  that long ago is kept whatever its age. An entry's time is read only as written,
  `YYYY-MM-DDTHH:MM:SS`, an optional fraction (dropped) and `Z` or `±HH:MM`, and only
  for a date that exists; anything else cannot be read and counts as just now, by the
  pruners and by the next swap, which writes the swap's own time for it, so it leaves
  the list six hours later (`squares.superseded_time`, `supersededTime` in
  scripts/runs.mjs, held to tests/fixtures/superseded.json).
- **The publisher deletes nothing.** The bucket sweep below deletes a superseded run
  directory once its grace is over and it has passed the sweep's own age guard, so it
  runs every hour (at :10 in the generated Home Compute and Cloudflare schedules,
  `deploy/schedules.py`): a superseded run leaves the bucket six to seven hours after it
  was published. Run once a day, as it was while the publisher still deleted at the
  swap, it left each one there for up to 30 hours. Locally,
  the worker's prune after each publish keeps the replaced run for the grace period and
  the hourly prune job collects it.
- **A reused directory is put back.** The same content always lands in the same
  directory, and `put_immutable` leaves an object that is already there alone, so a
  republish of content superseded long ago reuses a directory the sweep may be deleting
  at that very moment. The sweep reads the pointers again just before each directory it
  deletes, which catches a pointer that already names it; the publisher, once its own
  pointer is in place, lists its run directory once and puts back anything missing
  (`publish_s3.restore_missing`, logged `run_directory_restored`), which catches the
  rest.
- The guards on what may be deleted at all are unchanged: a path must sit directly under
  a data root, pointer manifests, anything under `manifests/` and anything under the
  forecast archive's `archive/` ([VERIFICATION.md](VERIFICATION.md)) are never deleted,
  and a `superseded` entry can only name a run directory beside its own pointer
  (`squares.check_base`).
- **Tide station files** are not run directories and have no grace list: a station file
  the tide pointer no longer names is deleted by the next sweep once it is past the age
  guard. Their names change once a day, so a reader holding yesterday's tide pointer for
  the minutes after the swap can miss its curve; the forecast server says the tides
  could not be read just now and the next read recovers.

**Manifests are not archived.** Earlier versions also wrote every published manifest to
`<root>/manifests/<model>/RUN-HASH.json`. Nothing read them, and because only the newest
run's frames are kept they could never be restored, so the publisher no longer writes
them. The publisher and the sweep still leave a `manifests/` directory alone, so any
copies from before the change stay until they are deleted by hand.

### The bucket sweep

The sweep deletes superseded run directories once their grace is over, and the objects
a failed or interrupted upload left that nothing references. `prune.py --bucket` is the
bucket-side equivalent of the local `prune_published`, sharing its
`manifest_urls`/`referenced`/`retiring` logic:

1. Read **every** registry pointer manifest from the bucket. A manifest that is present
   but unreadable **aborts the sweep without deleting anything**, because everything it
   references would otherwise look unreferenced. A manifest that is **absent** is just
   as dangerous the other way — every object that model has ever written would look
   unreferenced — so the sweep keeps everything named for such a model and reports it
   under `noPointer`/`protectedModels`. That covers a first run, a model being
   onboarded and a pointer deleted by hand.
2. List every object under each data root, **paginated**.
3. Keep anything referenced, a pointer or an archived manifest, and any run directory a
   pointer superseded within the grace period (counted as `withinGrace`). A run
   directory is judged whole, by its newest object: it is deleted only when every object
   in it is **older than `--min-age-hours` (default 6, or
   `FORCE5_SWEEP_MIN_AGE_HOURS`)**, so the sweep never takes half a run. That guard is
   what protects an upload in flight: jobs run on different machines, a run's files go
   up before its pointer does, and six hours is longer than any job timeout, so a run
   another machine is still uploading is never mistaken for wreckage.
4. A two-segment `.json` object that reads like a pointer manifest is kept even for a
   model the registry has not adopted yet, exactly as on disk. So is anything that
   cannot be read: the sweep never deletes on a guess.
5. **Read the pointer manifests again, after the listing**, and delete only what is
   unreferenced, and past its grace, in both reads. Then, **immediately before deleting
   each run directory, read them once more** and skip it if any pointer now names or
   has just superseded it. The listing is slow and paginated, and the age guard cannot
   cover everything: `put_immutable` leaves an object that is already there untouched,
   so a stable key a new run re-references — a tide station file, whose name only
   changes with the day, or a run directory a republish of the same content reuses —
   keeps its old `LastModified` and would look both unreferenced and long past the
   guard. Every read aborts on an unreadable manifest and contributes to `noPointer`.
   The last read costs a GET per pointer per directory deleted; the sweep runs hourly
   and deletes a few directories each time.

`--bucket` must be given **explicitly**; it is deliberately not defaulted from
`S3_BUCKET`, because the scheduler's environment carries that for the worker and
picking it up here would silently turn the hourly local retention job into a bucket
sweep. Combining `--bucket` with `--root`, `--max-age-hours` or `--cache-days` is an
error rather than a silent no-op, for the same reason.

`--dry-run` reports without deleting and is worth running first. The command logs
`sweep_complete` (or `sweep_failed`, exit 1) with `removed`, `keptObjects`,
`withinGuard`, `withinGrace`, `graceMinutes`, `protectedObjects`, `protectedModels`,
`noPointer` and `freedBytes` — note that the **local** sweep's `kept` is a list of
reasons while the bucket sweep's `keptObjects` is a count, hence the different key.
`prune` is already in the scheduler's `KNOWN_COMMANDS`, so the local deployment can
schedule it with `args = ["--bucket", "..."]` and no scheduler change.

### CORS and cache headers

R2's S3 API takes the same `PutBucketCors` document as S3, so
`force5/deploy/s3-cors.example.json` works unchanged. The **Cloudflare dashboard**
takes the rules as a bare JSON array instead, without the `CORSRules` wrapper; that
form is `force5/deploy/r2-cors.example.json`. Allow `GET`/`HEAD` only and expose
`ETag`, which the open-tab refresh revalidates against.

Cache headers are set by the uploader and unchanged from the AWS design:

| Objects                                               | Header                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| Run directories (frames, spot squares), station files | `public, max-age=31536000, immutable`             |
| Pointer manifests (`weather/*.json`, `marine/*.json`) | `public, max-age=0, s-maxage=60, must-revalidate` |

Cloudflare cache rules can override origin headers, so verify the served response, not
just the uploaded metadata — in particular that the pointer's edge TTL is short enough
for the browser's five-minute revalidation to see a new run.

### Conditional writes on R2

`put_immutable` writes each immutable object with `If-None-Match: *`, which is what
makes a re-run cost one request per object and makes an overwrite impossible. **R2's
support for it is unverified** — no credentials exist yet. So the publisher asks, and
distinguishes two answers: `PreconditionFailed`/`412` means the object is already there
(check its `sha256` metadata, as before), while **`NotImplemented`/`501` only** means
the backend does not have the feature. On the second it logs
`conditional_put_unsupported` **once**, then falls back to `head_object` + sha256
compare + plain put for the rest of that publish, so a 250-frame ECMWF run does not pay
the extra round trip 250 times. Collision detection is identical on both paths; only
the atomicity of the check-and-write is lost.

The trigger is deliberately narrow. `InvalidArgument` and `InvalidRequest` are **not**
treated as "no conditional writes": they also mean "your request was malformed", and on
the pointer path the fallback gives up the compare-and-swap entirely, so a bug must not
be able to buy that. Anything outside the narrow list fails the job loudly instead.
**The code R2 actually returns has to be confirmed against a live bucket** before this
list is trusted — and if R2 turns out to support `If-None-Match`, the fallback should be
deleted rather than left in. When the pointer write does degrade it logs a second,
distinct `pointer_put_unconditional` event, because losing compare-and-swap on the one
mutable object is worth seeing in the logs; it is safe here only because one job per
model runs at a time and the pointer is re-read immediately before the write.

### What an empty disk changes, per adapter

Audited against every entry in `registry.py`:

- **Clean, no change needed.** `harmonie`, `icon-eu`, `icon-eu-weather`, `gfs`,
  `gefs`, `gfs-wave`, `aifs`, `ecmwf-wave`, `arpege`, `arome`, `sea-temperature`: all
  cache under `.cache/<model>/<run>/` and only ever read files they wrote earlier in
  the same process.
- **Re-derived, one extra request.** `tides` re-downloads the ERDDAP station
  catalogue every run instead of reusing a 7-day-old copy; an empty catalogue still
  fails the run loudly. `mi-swan` re-reads its dataset info and last-time files
  live — which also **removes a latent bug**, because those two cache files had no
  freshness check and a stale pair could republish yesterday's SWAN run under today's
  manifest.
- **`harmonie-eps` publishes a smaller ensemble.** Its members are the controls of
  successive hourly cycles, and cycles whose source files the portal has already
  dropped were kept only in `.cache`. With no cache it can use only the portal's
  three-hour window, so expect roughly 3–4 members instead of up to 7, and a
  `RuntimeError` when fewer than `--min-members` (default 2) are retrievable. The job
  is **disabled** in `deploy/local/jobs.toml` and stays disabled. Fixing it properly
  means pulling previous cycles' GRIB back from the bucket at start-up, which is a
  design decision, not a patch.
- **`status.py` no longer means anything in a batch container.** It inspects the local
  `public/`, defaults to all registered models, and the disk is gone when the
  container exits. Until it is taught to read the bucket, monitor
  `forecast_complete` / `forecast_unchanged` / `forecast_failed` in the container logs
  and the age of each published manifest's `runTime` through the CDN.
- **`backfill_spots.py`** needs previously published output and must be run against a
  local mirror of the bucket (`--public /path/to/mirror`), never inside a batch
  container.
- **The spot catalogue is safe.** `FORCE5_SPOTS_FILE` points at
  `/app/public/riding-locations.json`, which is copied into the **image**, not the
  work directory, so an empty `/data` cannot silently reduce the run to eight spots.
- **`/data` ownership is the thing to check first on the real platform.** The image
  runs as uid 10001 and pre-creates `/data`. If Home Compute mounts a fresh
  root-owned directory over it, every write fails with `EACCES`. The `VOLUME`
  declaration has been removed so plain Docker no longer leaves an anonymous volume
  behind per run.

### Still to verify against a live bucket

No R2 credentials exist, so **none of this has been run against real R2**. Everything
above is covered by unit tests against a fake S3 (superseded runs kept for their
grace, a reused directory put back, the sweep's age guard and its reads before each
delete, unreadable-manifest abort and pagination, the
conditional-put fallback and collision detection without it, and the unchanged-run
skip path), and no test makes a network call. Before this is called live: create the
bucket and token, confirm whether R2 accepts `If-None-Match: *` (and remove the
fallback if it does), check the CORS and cache-rule behaviour through the CDN, run one
job of each model end to end, confirm the sweep deletes the first run's objects once a
second run has been live past the grace period, and run the sweep with `--dry-run` and
read its output before letting it delete.

## Object layout and publication safety

Every forecast run (wind, wave, weather) is one **run directory** beside its pointer,
named `<model>-<run>-<hours>h-v<N>-<hash8>`: the adapter's own prefix and the first 8
hex digits of a sha256 over the sorted lines `<path> <sha256 of the file's bytes>`, one
per file inside it, sidecars left out (`force5/ingest/rundir.py`). The same content
always lands in the same directory, so republishing a run is a no-op; changed content
lands in a new one; nothing inside a directory is ever rewritten, which is why all of
it is cached as `immutable`. Files inside need no hash of their own:

```text
weather/harmonie.json                                        the pointer (schemaVersion 2), a few KB
weather/harmonie-RUN-60h-v2-HASH8/t/0/53/14/000.bin          one native wind tile (and .br/.gz on disk)
weather/harmonie-RUN-60h-v2-HASH8/t/1/26/6/000.bin           an overview tile, 2 × 2 cells averaged
weather/harmonie-RUN-60h-v2-HASH8/spots/n52w008.json         every spot's series in one 2° square
weather/latest.json                                         ICON-EU's pointer
weather/icon-eu-RUN-72h-v1-HASH8/t/LEVEL/X/Y/HOUR.bin       ICON-EU's tiles
weather/ecmwf.json, weather/ecmwf-RUN-360h-v2-HASH8/        ECMWF wind + gust
weather/gfs.json, weather/gfs-RUN-240h-v1-HASH8/            GFS wind + instantaneous gust
weather/gefs.json, weather/gefs-RUN-240h-v1-HASH8/          GEFS: mean frames, members in the squares
weather/ecmwf-ens.json, weather/ecmwf-ens-RUN-144h-25m-v1-HASH8/  ECMWF ENS, likewise
weather/harmonie-eps.json, weather/harmonie-eps-RUN-48h-v1-HASH8/ HARMONIE EPS, likewise
weather/mi-swan.json, weather/mi-swan-RUN-144h-v1-HASH8/    Irish Shelf SWAN: squares, frames only with --frames
weather/icon-eu-weather.json, weather/icon-eu-weather-RUN-72h-v1-HASH8/  surface weather: squares only
weather/gfs-wave.json, weather/gfs-wave-RUN-240h-v1-HASH8/  GFS-Wave: squares only
weather/ecmwf-wave.json, weather/ecmwf-wave-RUN-360h-10v-v1-HASH8/  ECMWF Wave: squares only
weather/blend.json, weather/blend-RUN-HOURSh-v2-HASH8/spots/SQUARE.json   every place's blend, by square; no frames
marine/tides-STATION-FROM-TO-HASH.json     immutable tide curves + high/low events
marine/tides.json                          current tide pointer + metadata
marine/sea-temperature.json                current sea temperature pointer, readings inline
marine/wind-observations.json              current wind observations, 72 h of readings inline
verify/forecast-archive.json               what the archive job copied in its last hour
verify/scores.json                         current verification scores
archive/forecasts/MODEL/RUN.json           every wind run, sampled at stations; never deleted
archive/observations/YYYY-MM-DD.json       every wind observation, by UTC day; never deleted
archive/verify/sums/YYYY-MM-DD.json        one day's verification sums; never deleted
```

A forecast pointer is `schemaVersion` 2 and carries everything a reader needs to
choose a run and draw it — run, grid, cadence, gust rules, ensemble size — with its
files relative to `"base": "<run directory>/"`, which is itself relative to the
pointer's directory. A wind run's frames name no file: they are its tiles, and the
pointer says where they are in a `tiles` block:

```jsonc
"tiles": {
  "size": 128, "border": 1, "encoding": "f5-tile-v1",
  "blocks": ["u", "v", "gust"],               // the most a tile carries; a frame whose
                                              // gustIntervalHours is null has u and v
  "url": "t/{level}/{x}/{y}/{hour}.bin",      // {hour} zero-padded to three digits
  "levels": [                                 // exactly what f5tile.levels(grid) gives
    {"level": 0, "dx": 0.025, "dy": 0.02, "x": [52, 54], "y": [13, 15], "absent": []},
    {"level": 1, "dx": 0.05,  "dy": 0.04, "x": [26, 27], "y": [6, 7],   "absent": []},
    {"level": 2, "dx": 0.1,   "dy": 0.08, "x": [13, 13], "y": [3, 3],   "absent": []}
  ]
},
"frames": [{"hour": 0, "validTime": "…", "gustIntervalHours": null}, …]
```

`x` and `y` are inclusive tile ranges on the global lattice at that level. `absent`
lists, as `[x, y]` pairs in order, the tiles inside the ranges whose every owned cell
is missing at every hour (all land, or all outside a cropped domain): they are never
written and never requested. Absence is per run, not per hour, so every other tile
exists for every frame hour and a 404 for one is an error. A run without frames (a
frameless ensemble) has no `tiles`. Wave and weather runs no longer publish map
frames at all — nothing reads them — and state their reach in `horizonHours`; their
validator still accepts JSON frames for the day a map layer needs them. Its per-spot data (`spotForecasts`, `spotSeries`, `spotCoverage`,
`spotMembers`, and SWAN's `spotCells`) is **not** in it but in
`spots/<square>.json` inside the run directory, one file per 2° × 2° spot square named
by its south-west corner (`n52w010` covers 52–54° N, 10–8° W):
`{schemaVersion: 2, model, run, square, …the same per-spot keys, for the spots in that square}`.
The pointer lists them:
`"spots": {"squareDegrees": 2, "url": "spots/{square}.json", "squares": [...], "keys": [...]}`,
`keys` naming the per-spot keys the squares carry. A run with no frames states its
reach in `horizonHours`, so freshness never needs a square. A spot page, the dock and
the forecast server read the one square holding the spot; the browser's own blend reads
the squares in view and the reader's own spots'; the blend job reads them all. Ireland's
141 riding places fall in ten squares. The blend is published the same way, its places
under `spotBlend` (see "The blend" above).

The split happens in one place, `rundir.write_run`, as the adapter finishes: adapters
still build the whole manifest in memory and none of them knows squares exist.
`backfill_spots.py`, which recomputes spot series for a run already on disk (sampling
the one native tile holding each spot), publishes the result the same way, as a new
run directory with the tiles linked in unchanged. Without wave frames it can no longer
recompute a wave run's series, and says so.

Each model's immutable objects sit under the first segment of its
registry manifest path, so a non-`weather/` kind needs no publisher change. Optional
`S3_PREFIX` still goes before that segment.

Forecast bundles (`wind`, `wave`, `weather`) and the blend are `schemaVersion` 2 run
pointers as above; the others are `schemaVersion` 1. Every added field is optional; see the README
contract section for the field list. `validate_bundle` dispatches on `kind`, and for a
forecast checks its per-spot data as read back from its squares:

- `wind` (default when `kind` is absent) keeps the existing frame, grid and gust rules,
  checks the `tiles` block and every tile as above, and adds `gustKind:
  "instantaneous"` for sources publishing a surface gust at the valid time
  (`gustIntervalHours: [hour, hour]` on every frame, hour 0 included), plus optional
  `ensemble`/`spotMembers`. An ensemble manifest holds the **mean** in `spotForecasts`
  and may publish an empty `frames` list — only an ensemble may. A manifest declaring
  a whole-frame `encoding` is refused: that format is retired.
- `wave` validates a `variables` map and a `spotSeries` per riding location, plus
  optional frames holding one array per gridded variable with `null` for land. `frames`
  may be empty when `spotSeries` is present, and `horizonHours` then declares the last
  published hour; `frameVariables` may narrow frames to a subset of `variables`. No
  adapter publishes wave frames any more (GFS-Wave and ECMWF Wave stopped; Irish Shelf
  SWAN only with its opt-in `--frames`), because nothing reads them.
- `weather` runs the same validator as `wave` for surface variables. It allows
  measurements up to 100,000 (hectopascals, millimetres, J/kg) instead of 1,000, and a
  variable may declare `"kind": "code"` for a whole code-table entry such as WMO present
  weather, which is checked for being a small integer rather than range-checked.
  ICON-EU surface weather (`icon-eu-weather`) is the first weather adapter.
- `tide` validates the station manifest and every referenced station file: monotonic
  times, heights within −1 to 8 m above LAT, and event heights agreeing with the curve
  extremes to within 0.15 m.
- `observation` validates a self-contained measurement bundle and returns **no** objects
  to upload: stations with a known network and an optional sensor depth, values within
  −2 to 35 °C, times that parse and do not lie in the future, a strictly increasing
  per-spot series, a stated reason for every spot with no station, and a `run` equal to
  the newest observation hour the manifest publishes. Sea temperature
  (`sea-temperature`) is the first observation adapter. Wind observations (`wind-obs`,
  `"observes": "wind"`) are the second: classed stations with a window of
  `[time, speed, gust, direction]` readings in m/s, no gust below its speed, and no
  spot assignments, because they exist to verify forecasts.
- `archive` and `verification` are the summaries the forecast archive and the
  verification jobs publish (`verify/forecast-archive.json`, `verify/scores.json`). Both
  are self-contained, must have been generated in the hour their `run` names, and carry
  no `url` for the pruner to follow. See [VERIFICATION.md](VERIFICATION.md).
- `blend` is a run of spot squares with no frames: its times in order, its coverage
  their first and last, each source's columns inside them, and for every place under
  `spotBlend` a wind, gust and bearing per time within range and an agreement letter
  per time (`h`, `m`, `l` or `-`). Its squares carry `spotBlend` and nothing else.

All adapters precompute their spot series for every place in
`public/riding-locations.json`, so a browser chart never has to download grid frames.
Regenerate that file with `npm run spots:export`. The same catalogue gives each spot
its square; a spot a manifest names that the catalogue does not is refused. The
publisher checks it again: it reads the catalogue by the adapters' rule
(`squares.catalogue_file`: `FORCE5_SPOTS_FILE`, else `public/riding-locations.json`,
else `public/spots.json`) and refuses a run whose square files hold a spot the
catalogue does not have, or puts in another square, since a reader looks for a spot in
the one square its own coordinates name and would never find it.

The ENS prefix records the horizon and member count, so changing either publishes a
new run directory instead of colliding with the previous one. Its members, which made
the ENS manifest the largest of all (588 KB gzipped for 146 spots), are in the squares
now: the pointer is under 2 KB and the square holding a spot about 4–170 KB gzipped.

Keep the importer-generated paths intact. Optional `S3_PREFIX` goes before `weather/`, and the frontend CDN base must include that same prefix.

The publisher:

1. Rejects missing or unreferenced files, a run directory whose content does not hash to its name, nonfinite/invalid vectors and spot series, a spot filed in a square the catalogue does not give it, mixed model/run/time/grid identities, unsafe paths (a path inside a run is segments of `A–Z a–z 0–9 _ . -` only, never `.` or `..`, so no percent-encoding, whitespace, `?`, `#` or `\` a browser would read as something else; the browser's `checkRunPath` holds the same rule) and stale/expired runs.
2. Uploads every file of the run directory with `If-None-Match: *`, brotli for `.bin` tiles and gzip for JSON, and a SHA-256 metadata value. On an existing key, it checks that hash rather than overwriting it.
3. Reads the current pointer and conditionally writes using its ETag (`If-Match`), or `If-None-Match` for the initial publication. The pointer it writes names the run directory the replaced pointer named, if it is not this one, under `superseded` with the time of the swap; nothing is deleted. Then it lists its own run directory once and puts back anything a sweep removed between its uploads and the swap (a republish that reused a directory superseded long ago).
4. Rechecks on a write race. An older run cannot replace a newer run, and a three-hourly job cannot replace hourly data for the same run. Identical output is a no-op.

These use [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html). A failed upload can leave unreferenced frame objects, but never an intentionally published half-complete forecast. The last successfully published model remains available. Models are independent transactions, not a simultaneous cross-model switch.

## Caching and client behaviour

| Objects                                        | Worker cache header                               | CloudFront behaviour                                          |
| ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Run directories (frames, spot squares)         | `public, max-age=31536000, immutable`             | Long-lived cache; compression enabled                         |
| `weather/harmonie.json`, `weather/latest.json` | `public, max-age=0, s-maxage=60, must-revalidate` | Minimum TTL **0**, cap latest-pointer freshness appropriately |

No whole-distribution invalidation is needed after a normal forecast job. CloudFront's minimum TTL can override origin cache headers, so verify the actual policies, not just the uploaded metadata. See [CloudFront cache settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html).

Set the frontend environment before building:

```text
VITE_FORECAST_BASE_URL=https://forecast.wingfoil.ie/
````

The browser fetches the manifest on page load and model changes, then reads the immutable tiles the view needs, at the level the screen can show (force5/src/tiledField.ts). It **also revalidates an already-open tab**: every five minutes while the tab is visible, and on `visibilitychange`/`focus` once that long has passed, it refetches the active model's manifest with `cache: "no-cache"` (`clearManifestCache(id)` + `loadManifest`). A `run` that matches the displayed one costs one small JSON and changes nothing on screen. A newer one is loaded whole through the same atomic `loadModel` transaction a model switch uses — manifest plus the frame nearest the **selected** valid time — and committed together, so no reader ever sees two runs mixed. The selected time is preserved, and a check that comes due while the reader is scrubbing, playing or switching model is deferred and retried a minute later. The blend's other manifests are swept on the same cadence. A failed background check is logged and otherwise silent: the run already on screen stays. The one visible sign is a dismissible "Updated to the HH:MM UTC run" notice. The browser already labels stale/expired snapshots. A superseded run directory is kept for an hour after its pointer stopped naming it (see "Deleting what is superseded"), well past the five minutes a tab, the CDN (one) or the forecast server (five) holds a pointer, so a tab that has not yet seen the swap still reads the run it shows. Should a tile or a square fail anyway, the reader re-reads that model's pointer and tries once more against the run it names now: a failed frame request loads the newest run at the selected time (`loadNewerRun`).

## Monitoring, retries and recovery

- **What runs today**: `.github/workflows/monitor.yml` checks production every two hours, from outside: each live model's pointer, its age against `registry.py`'s `maxAgeHours` plus an hour, the spot squares and a sample of tiles it names, and the cache and encoding headers. A problem opens a GitHub issue. docs/RELEASES.md, "The production monitor", has the details. The bullets below are the fuller plan from the AWS design.
- Send container stdout/stderr to CloudWatch. Alarm on `forecast_failed`, ECS nonzero task exit, unusually long task duration, and age of the **published manifest's runTime**. A scheduler successfully starting an ECS task does not prove that the forecast succeeded.
- Configure Scheduler delivery retries/DLQ for failures to start the task. Separately monitor ECS task completion and retry failed jobs; Scheduler delivery retries alone do not handle an ingest process exiting unsuccessfully.
- Measure source publication lag before selecting alert thresholds. HARMONIE is fetched at 07 and 12 UTC, each time about three hours behind its cycle, so its run is about 22 hours old before the morning slot and only one older than its 30-hour `maxAgeHours` is worth alerting on; ICON-EU, once a day, likewise at 30 hours, and ECMWF's once-a-day 00 UTC run at 40. For GFS, allow for the 6-hourly cycle plus its 3.5–5.5 hour publication delay before alerting: a published run older than about 12 hours is a genuine failure. Irish Shelf SWAN runs once a day and is sometimes a day late, so only a published run older than about 40 hours is worth alerting on; a single missed attempt is normal.
- Measure source publication lag before selecting alert thresholds. HARMONIE is fetched at 07 and 12 UTC, each time about three hours behind its cycle, so its run is about 22 hours old before the morning slot and only one older than its 30-hour `maxAgeHours` is worth alerting on; ICON-EU, once a day, likewise at 30 hours, and ECMWF's once-a-day 00 UTC run at 40. For GFS, allow for the 6-hourly cycle plus its 3.5–5.5 hour publication delay before alerting: a published run older than about 12 hours is a genuine failure. GFS-Wave follows the same cycles with a similar delay, so it shares that threshold; its full 240-hour listing appears later than the wind files, and a wave task started too early simply skips the cycle. GEFS is slower still: its 0.25° members finish 4.5–6 hours after run time and not in member order, so a GEFS run one cycle behind the newest is normal and only a published run older than about 18 hours is worth alerting on.
- After first publication, fetch the manifest and every referenced frame through CloudFront; check HTTP status, encoding, CORS, timestamps and numerical validity. Check switching, hourly scrubbing, arbitrary-point forecasts and unavailable-gust handling on phone/desktop.
- Keep S3 versioning. For rollback, an operator can restore a pointer version whose frames still exist. The normal worker deliberately refuses an older-run rollback. **This does not carry over to the R2 design**, which keeps only the newest run and uses no object versioning: a superseded run's directory is deleted once its hour of grace is over, so there is nothing to roll back to after that.
- Do not blindly apply age-based deletion to all `weather/*` objects: an outage could leave the active manifest referring to old frames. Start without deletion, then implement garbage collection that protects current manifests and their referenced frames, and never touches a run that is still being written. Never expire the latest pointers. `force5/ingest/prune.py` implements exactly that for a filesystem: the worker calls it as soon as a new run is published, keeping only the newest run per model, and the local deployment schedules it hourly as a backstop. In the bucket the publisher deletes nothing: its new pointer names the run directory it replaced under `superseded`, and `prune.py --bucket` deletes that once the grace period is over, along with objects that failed uploads left behind, guarded by age. Locally the worker's prune keeps the replaced run for the same grace period and the hourly job collects it. See "Cloudflare R2 and one-shot batch containers" above. A bucket lifecycle rule is still not a substitute, because it cannot see which frames the current manifest references.
- Preserve provider attribution, source links and modification notices in manifests and the UI. Force5 processes provider output; it is not itself a replacement numerical weather model.

### Where a job's time goes

Every `forecast_complete`, `forecast_unchanged` and `forecast_failed` event carries
`phases`, so a slow job says whether it was slow finding its run, downloading,
decoding or writing. The adapter records its own phases (`force5/ingest/timing.py`) in
the file the worker names in `FORCE5_TIMINGS_FILE`, and the worker adds its own two:

| phase | who | what it covers |
| --- | --- | --- |
| `discover` | adapter | finding the run: listings, inventories, the `latest` probe, the published-run check |
| `index` | adapter | Météo-France only: walking the package's GRIB headers to find the messages |
| `download` | adapter | the download pool, and anything the pool does per file |
| `decode` | adapter | GRIB decode, validation, crop, regrid and spot sampling |
| `write` | adapter | encoding frames, their sidecars and the manifest, on local disk |
| `validate` | worker | `validate_bundle`: every referenced object re-read and checked |
| `publish` | worker | the bucket upload (nothing without one), the pointer swap and the check that its run directory is whole |

`archive` and `score` are the forecast archive's and the verification's single stages.
Each phase has `seconds` of wall time, and may have `requests`, `bytes`, `workers` (the
concurrency it ran with), `retries` (failed attempts tried again) and `failures`
(requests given up on); counters that stayed at zero are left out. Main-thread phases
nest and their time is exclusive, so a frame written in the middle of the decode loop
counts as `write`, and the phases add up to the job's `seconds` less process start-up.
Work done inside a download pool, such as GFS validating each step as it lands, runs
alongside the download, so it is reported as `threadSeconds` (summed across the
workers) with `within` naming the phase it ran inside, rather than as wall time:

```json
{
  "event": "forecast_complete", "model": "gfs", "run": "2026101006", "seconds": 242,
  "phases": {
    "discover": {"seconds": 9.6, "retries": 3, "failures": 1, "requests": 1, "bytes": 53595},
    "download": {"seconds": 231.7, "workers": 2, "requests": 81, "bytes": 1190818, "retries": 4},
    "decode": {"seconds": 0.0, "threadSeconds": 0.2, "within": "download"},
    "write": {"seconds": 0.3}, "validate": {"seconds": 0.1}, "publish": {"seconds": 0.0}
  }
}
```

That run spent its discovery asking three more times for a 12 UTC cycle NOMADS did not
have yet, and its download waiting on NOMADS, three seconds a request.

Every event also carries `resources`, from `getrusage` in the worker:

```json
"resources": {"cpuSeconds": 41.3, "peakRssMb": {"worker": 72, "adapter": 388}}
```

`cpuSeconds` is user plus system time of the worker and its adapter for this model.
`peakRssMb.worker` is the worker's own peak (it validates and uploads the bundle),
`peakRssMb.adapter` the largest process it waited for, which counts the adapter's own
children such as the blend's Node build. The worker stays resident while its adapter
runs, so their sum bounds what the job's container held at once: that, with headroom,
is what its memory ceiling in `deploy/schedules.py` must cover, because Bacalhau kills a
container that exceeds it. `status.py` adds the sum to its last-job note
(`complete in 242 s, 96% download, 460 MB`). The adapter also
prints the same thing as one line at its end, failed or not:

```text
Timing: discover 9.6 s (1 req, 53.6 kB, 3 retried, 1 failed) · download 232 s (81 req, 1.2 MB, 2 at a time, 4 retried) · decode 0.0 s (+0.2 s across download workers) · write 0.3 s · total 242 s
```

The adapter rewrites its record every half minute while a download is running, so a
job killed by its timeout still reports how far it got. The worker keeps each model's
last event in `.cache/jobs/<model>.json`, and `status.py` adds it to that model's row as
`lastJob` (`outcome`, `run`, `at`, `seconds`, `phases`, and `error` for a failure), and
to the text report as e.g. `complete in 1,964 s, 96% download`. It is informational and
never changes a row's state; like the rest of `.cache` it ages out after
`FORCE5_CACHE_DAYS`, and in a one-shot container it is gone with the disk, so there the
event in the log is the record.

## Validation status / remaining launch work

The publisher has local fake-S3 tests for publication order, missing/corrupt input, upload failure, collisions, idempotency, competing newer runs, superseded runs named and kept, a reused directory put back, the conditional-put fallback, the bucket sweep (grace period, age guard, the reads before each delete, unreadable-manifest abort, pagination, prefix) and the unchanged-run skip path. **No credentials for Cloudflare R2 exist, so nothing has been run against a real bucket of any kind.** The frontend supports a separate forecast CDN. The Docker image definition is supplied, but **Docker was not installed in the development environment**, so an actual image build/run and real AWS end-to-end publication remain required.

Open-tab refresh is implemented in the browser and covered by unit and end-to-end tests; what remains untested is its behaviour against a **real** CDN, where a manifest served from a cache with a minimum TTL above zero can hide a new run from a tab for as long as that TTL. Also required before calling the site continuously live: provision the cloud resources, test IAM/CORS/cache policies (including that the latest-pointer TTL is short enough for the five-minute revalidation to see a new run), configure alerts/retries, benchmark hourly processing, and review provider licensing/attribution for the intended service. The current website is still a saved-snapshot prototype until those pieces are deployed.
