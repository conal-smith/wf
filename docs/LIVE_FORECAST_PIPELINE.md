# Running Force5 forecasts live

> **Running this on your own machine instead?** See the
> [local self-hosted deployment](../deploy/local/README.md): one Docker Compose stack —
> site, scheduler, retention and ingest volume on a single origin — with no cloud
> account, no S3 bucket and no secrets. This document describes the AWS design, which
> that option does not need.

## What runs where

We do **not** run the HARMONIE weather simulation ourselves. Met Éireann runs it. Our job downloads a complete run, decodes its wind fields, rotates/regrids/crops them for our map, validates the result and publishes static JSON. No GPU or continuously running forecast API is required for this design.

```text
EventBridge Scheduler
  → ECS Fargate task (Force5 container from ECR)
    → discover/download Met Éireann or DWD model output
    → decode + validate + prepare wind frames and spot time series
    → upload immutable frames + archived manifest to private S3
    → conditionally update latest manifest LAST
      → CloudFront HTTPS endpoint → website / future map clients
```

The website and forecast worker are separate deployments. A forecast refresh must not require rebuilding the website.

## Code supplied

- `force5/Dockerfile`: non-root, one-shot Python worker image containing only the ingest code, the spot catalogues (`public/spots.json` and `public/riding-locations.json`, with `FORCE5_SPOTS_FILE` pointing at the latter) and the local cadence schedule. No saved forecasts, repository history, frontend dependencies or credentials. The root `.dockerignore` is one allowlist shared with the local site image, so the build context also carries the frontend sources; this image does not.
- `force5/ingest/registry.py`: the single model table — script, published manifest path, bundle kind and default freshness limit. `worker.py` derives its `--models` choices and age limits from it and `publish_s3.py` takes manifest paths and the immutable object root from the same entry, so onboarding a model is one registry line plus its fetch script.
- `force5/ingest/worker.py`: invokes any selection of the registered importers, validates each package and optionally publishes. It exits nonzero on failure and logs JSON completion/failure events. A filesystem lock prevents concurrent jobs using the same scratch directory.
- `force5/ingest/publish_s3.py`: validates every referenced frame before uploading anything; uploads gzip-compressed immutable frames and an archived manifest, then updates the public pointer with an ETag conditional write.
- `VITE_FORECAST_BASE_URL`: optional frontend build-time CDN root. All forecast manifests and frames use it; the spot catalogue and application assets remain on the website origin.

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

Use `--run YYYYMMDDHH` only for an available provider run. `--max-age-hours` defaults to 12 for regional models and 24 for ECMWF's twice-daily full-horizon runs; stale/future-dated runs and expired horizons are rejected. `--publish-only` never bypasses validation or freshness checks.

ECMWF is also supported: `--models ecmwf` imports its full 15-day IFS control
forecast (85 frames). It always retains 3-hour steps through +144h, then 6-hour
steps through +360h; `--step` only affects the regional models. Schedule checks
hourly to discover the two full-length 00/12 UTC products when they are published.
The 06/18 cycles are shorter and cannot replace this snapshot. See the
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
member-step, because the bucket holds whole-globe messages — about 2.84 GB per run,
148 times the filter. `--source s3` exists only for a NOMADS outage, and each run
prints its own measured transfer. A default run makes 1,271 filter requests at the
two connections and minimum pause NOMADS asks for, which dominates its wall time;
`--step 3` (81 steps) doubles both to 2,511 requests and about 38 MB.

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

`--models ecmwf-ens` runs `fetch_ecmwf_ens.py`, which imports ECMWF's open-data
ensemble (stream `enfo`, type `pf`) and publishes `weather/ecmwf-ens.json`. It
never requests `type=cf`: IFS Cycle 50r1 retired the `scda` stream and merged the
ENS control into `oper`, which we publish separately as the `ecmwf` model, so
`ensemble.control` is `null`. The worker passes `--source`; member count, step and
horizon are the importer's own options and default to **25 members, 6-hourly to
+144h** (25 steps, `stepHours: 6` with a single-entry `stepRanges` ladder that
describes the cadence exactly).

Only the ensemble **mean** is published as map frames, with the same Ireland crop
and frame contract as the control product. Per-spot member series live in the
manifest (`spotMembers[spotId][index].u/v/gust`, arrays indexed by member), so
browsers never fetch member grids. `spotForecasts` holds the ensemble mean.
The publisher validates member counts, alignment, finiteness and ranges for
every spot and step before uploading anything.

Bandwidth is the operational constraint, not CPU. Measured on 16 September 2026
from the real 0.25° `enfo` index: **0.84 MB** per `10u` member-message, **0.83 MB**
per `10v`, **1.39 MB** per `10fg`, plus a **2.0 MB** index per step — about
3.07 MB per member per step. The default run therefore downloads about **1.95 GB**;
all 50 members to +240h would be **6.35 GB** per run. Each run prints its own
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

Schedule ENS **twice daily** against the 00 and 12 UTC cycles (hourly discovery
checks are fine: the importer refuses a run older than 24 hours and publishes only
a complete member set). The 06/18 cycles exist but stop at +144h; they can be used
by passing `--hours 144`, which the worker does not do. The AWS mirror returned
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
grid, and publishes `weather/gfs-wave.json` with immutable frames beside it. The
worker only passes `--step`/`--run` to wind models, so a wave task takes the
importer's defaults: 0–240 h at three-hour steps, 81 frames. A measured live run
took 75 seconds, downloading 5.3 MB through the NOMADS wave filter (about 70 KB a
step) and publishing 45 MB of frames plus a 372 KB manifest — an order of
magnitude more output than a wind model, so size the volume and CDN accordingly.
Run `fetch_gfswave.py --source s3` directly if the filter service is down; that
path reads whole-grid messages, roughly 3.5 MB per step. The importer refuses to
publish when the cut-out does not land on the source lattice, which is the check
that would catch NOAA changing the grid or the filter's coordinate arithmetic.

ICON-EU surface weather is the first **weather** bundle: `--models icon-eu-weather`
runs `fetch_icon_weather.py`, which reads thirteen ICON-EU single-level parameters
(temperature, dew point, humidity, accumulated precipitation, four cloud layers,
mean-sea-level pressure, visibility, mean-layer CAPE, WMO present weather and ground
temperature) from one cycle and publishes `weather/icon-eu-weather.json` with
immutable frames beside it. The worker passes `--step`/`--run` only to wind models, so
this task takes the importer's defaults: 0–72 h at three-hour steps, 25 frames. Its
registry age limit is 12 hours, the same as ICON-EU wind.

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

## AWS setup checklist

1. Create a private S3 bucket with Block Public Access and versioning enabled. The application data is public through CloudFront, not public bucket ACLs.
2. Create a CloudFront distribution using S3 Origin Access Control. Use HTTPS, for example `forecast.wingfoil.ie`, with a suitable certificate/DNS record. Enable compression.
3. Give the **task role** only the required bucket access. Adapt `force5/deploy/s3-task-policy.example.json`; if using `S3_PREFIX`, include it in the object ARN. `GetObject` supports manifest reads and collision checks; `ListBucket` allows missing-key reads to return 404 instead of ambiguous 403. No delete permission is needed. Configure separate execution-role permissions for ECR pulls and CloudWatch logs. KMS-encrypted buckets require additional scoped KMS permissions.
4. Configure CORS on S3/CloudFront for the actual website origins. `s3-cors.example.json` is a starting point. Allow GET/HEAD; expose ETag if needed. Ensure CloudFront forwards `Origin` and caches responses consistently, or use a response-headers policy with the intended allowed origins. Do not put AWS credentials in the browser.
5. Build the image, push it to your ECR repository and register an ECS Fargate task definition. Start with 2 vCPU / 4 GiB RAM and 20 GiB ephemeral storage, then measure actual runtime and peak memory. Use an image digest for deployments and a tested dependency/base-image lock for reproducible releases.
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
objects, so its only S3 writes are the archived manifest and the pointer. Its `run` is
the **newest observation hour**, so the 48-hour registry limit is the age of the data:
alarm when it is exceeded, and expect it to trip when a buoy goes off station rather
than when the job fails. A station that stops reporting does not fail the run — the spots
it served fall back to a stated reason, and the run keeps publishing for the rest.

These are deployment instructions, not provisioned infrastructure. No bucket, registry, schedule or cloud task has been created by this change.

## Object layout and publication safety

```text
weather/harmonie-RUN-60h-v1/HOUR-HASH.json  immutable HARMONIE frames
weather/RUN.../HOUR-HASH.json              immutable ICON-EU frames
weather/manifests/harmonie/RUN-HASH.json   archived complete manifests
weather/manifests/icon-eu/RUN-HASH.json
weather/harmonie.json                     current HARMONIE pointer + metadata
weather/latest.json                       current ICON-EU pointer + metadata
weather/ecmwf.json                        current ECMWF pointer + metadata
weather/ecmwf-RUN-360h-v2/HOUR-HASH.json    immutable ECMWF wind + gust frames
weather/gfs.json                          current GFS pointer + metadata
weather/gfs-RUN-240h-v1/HOUR-HASH.json      immutable GFS wind + instantaneous gust frames
weather/manifests/gfs/RUN-HASH.json        archived complete GFS manifests
weather/gefs.json                         current GEFS ensemble pointer + member series
weather/gefs-RUN-240h-v1/HOUR-HASH.json     immutable GEFS ensemble-mean frames
weather/manifests/gefs/RUN-HASH.json       archived complete GEFS manifests
weather/mi-swan.json                      current Irish Shelf SWAN wave pointer + spot series
weather/mi-swan-RUN-144h-v1/HOUR-HASH.json  immutable SWAN wave frames, only with --frames
weather/manifests/mi-swan/RUN-HASH.json    archived wave manifests
weather/icon-eu-weather.json               current ICON-EU surface weather pointer + spot series
weather/icon-eu-weather-RUN-72h-v1/HOUR-HASH.json  immutable surface variable grids
weather/manifests/icon-eu-weather/RUN-HASH.json    archived complete weather manifests
weather/gfs-wave.json                      current GFS-Wave pointer + metadata
weather/gfs-wave-RUN-240h-v1/HOUR-HASH.json immutable GFS-Wave variable grids
weather/manifests/gfs-wave/RUN-HASH.json   archived complete GFS-Wave manifests
marine/tides-STATION-FROM-TO-HASH.json     immutable tide curves + high/low events
marine/manifests/tides/RUN-HASH.json       archived tide manifests
marine/tides.json                          current tide pointer + metadata
marine/sea-temperature.json                current sea temperature pointer, readings inline
marine/manifests/sea-temperature/RUN-HASH.json  archived observation manifests
weather/harmonie-eps.json                 current HARMONIE ensemble pointer + member series
weather/harmonie-eps-RUN-48h-v1/HOUR-HASH.json  immutable ensemble-mean frames
weather/manifests/harmonie-eps/RUN-HASH.json    archived complete ensemble manifests
```

Each model's immutable objects and archived manifests sit under the first segment of its
registry manifest path, so a non-`weather/` kind needs no publisher change. Optional
`S3_PREFIX` still goes before that segment.

Bundle kinds are all `schemaVersion` 1 and every added field is optional; see the README
contract section for the field list. `validate_bundle` dispatches on `kind`:

- `wind` (default when `kind` is absent) keeps the existing frame, grid and gust rules,
  and adds `gustKind: "instantaneous"` for sources publishing a surface gust at the valid
  time (`gustIntervalHours: [hour, hour]` on every frame, hour 0 included), plus optional
  `ensemble`/`spotMembers`. An ensemble manifest holds the **mean** in `spotForecasts`
  and may publish an empty `frames` list — only an ensemble may.
- `wave` validates a `variables` map and a `spotSeries` per riding location, plus
  optional frames holding one array per gridded variable with `null` for land. `frames`
  may be empty when `spotSeries` is present, and `horizonHours` then declares the last
  published hour; `frameVariables` may narrow frames to a subset of `variables`.
  Marine Institute Irish Shelf SWAN (`mi-swan`) is the first wave adapter and publishes
  no frames by default.
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
  (`sea-temperature`) is the first observation adapter.

All adapters precompute `spotForecasts` for the 25 ids in `public/riding-locations.json`,
so a browser chart never has to download grid frames. Regenerate that file with
`npm run spots:export`.
weather/ecmwf-ens.json current ECMWF ENS pointer + member series
weather/ecmwf-ens-RUN-144h-25m-v1/HOUR-HASH.json immutable ensemble-mean frames
weather/manifests/ecmwf-ens/RUN-HASH.json archived complete ENS manifests

````

The ENS prefix records the horizon and member count, so changing either publishes
a new immutable frame set instead of colliding with the previous one. The ENS
manifest is larger than the others because it carries every member: a measured
114 kB for 8 spots × 25 steps × 25 members, so roughly 350 kB for a 25-location
catalogue. It is served with the short-lived pointer cache policy and benefits
from compression; a per-spot series endpoint would be the next optimisation.

Keep the importer-generated paths intact. Optional `S3_PREFIX` goes before `weather/`, and the frontend CDN base must include that same prefix.

The publisher:

1. Rejects missing files, nonfinite/invalid vectors, mixed model/run/time/grid identities, unsafe paths and stale/expired runs.
2. Uploads immutable objects with `If-None-Match: *`, gzip encoding and a SHA-256 metadata value. On an existing key, it checks that hash rather than overwriting it.
3. Archives the manifest, then reads the current pointer and conditionally writes using its ETag (`If-Match`), or `If-None-Match` for the initial publication.
4. Rechecks on a write race. An older run cannot replace a newer run, and a three-hourly job cannot replace hourly data for the same run. Identical output is a no-op.

These use [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html). A failed upload can leave unreferenced frame objects, but never an intentionally published half-complete forecast. The last successfully published model remains available. Models are independent transactions, not a simultaneous cross-model switch.

## Caching and client behaviour

| Objects                                        | Worker cache header                               | CloudFront behaviour                                          |
| ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Immutable frames / archived manifests          | `public, max-age=31536000, immutable`             | Long-lived cache; compression enabled                         |
| `weather/harmonie.json`, `weather/latest.json` | `public, max-age=0, s-maxage=60, must-revalidate` | Minimum TTL **0**, cap latest-pointer freshness appropriately |

No whole-distribution invalidation is needed after a normal forecast job. CloudFront's minimum TTL can override origin cache headers, so verify the actual policies, not just the uploaded metadata. See [CloudFront cache settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html).

Set the frontend environment before building:

```text
VITE_FORECAST_BASE_URL=https://forecast.wingfoil.ie/
````

The browser fetches the manifest on page load and model changes, then reads its immutable frame URLs. It **also revalidates an already-open tab**: every five minutes while the tab is visible, and on `visibilitychange`/`focus` once that long has passed, it refetches the active model's manifest with `cache: "no-cache"` (`clearManifestCache(id)` + `loadManifest`). A `run` that matches the displayed one costs one small JSON and changes nothing on screen. A newer one is loaded whole through the same atomic `loadModel` transaction a model switch uses — manifest plus the frame nearest the **selected** valid time — and committed together, so no reader ever sees two runs mixed. The selected time is preserved, and a check that comes due while the reader is scrubbing, playing or switching model is deferred and retried a minute later. The blend's other manifests are swept on the same cadence. A failed background check is logged and otherwise silent: the run already on screen stays. The one visible sign is a dismissible "Updated to the HH:MM UTC run" notice. The browser already labels stale/expired snapshots. **This is what makes the retention rule below load-bearing**: a tab that has been open for hours may still be reading the previous run's frames, so old files must outlive the run that referenced them.

## Monitoring, retries and recovery

- Send container stdout/stderr to CloudWatch. Alarm on `forecast_failed`, ECS nonzero task exit, unusually long task duration, and age of the **published manifest's runTime**. A scheduler successfully starting an ECS task does not prove that the forecast succeeded.
- Configure Scheduler delivery retries/DLQ for failures to start the task. Separately monitor ECS task completion and retry failed jobs; Scheduler delivery retries alone do not handle an ingest process exiting unsuccessfully.
- Measure source publication lag before selecting alert thresholds. For HARMONIE, an initial warning around 3–4 hours without a newer published run is worth testing; keep a separate threshold for ICON-EU's longer cycle. For GFS, allow for the 6-hourly cycle plus its 3.5–5.5 hour publication delay before alerting: a published run older than about 12 hours is a genuine failure. Irish Shelf SWAN runs once a day and is sometimes a day late, so only a published run older than about 40 hours is worth alerting on; a single missed attempt is normal.
- Measure source publication lag before selecting alert thresholds. For HARMONIE, an initial warning around 3–4 hours without a newer published run is worth testing; keep a separate threshold for ICON-EU's longer cycle. For GFS, allow for the 6-hourly cycle plus its 3.5–5.5 hour publication delay before alerting: a published run older than about 12 hours is a genuine failure. GFS-Wave follows the same cycles with a similar delay, so it shares that threshold; its full 240-hour listing appears later than the wind files, and a wave task started too early simply skips the cycle. GEFS is slower still: its 0.25° members finish 4.5–6 hours after run time and not in member order, so a GEFS run one cycle behind the newest is normal and only a published run older than about 18 hours is worth alerting on.
- After first publication, fetch the manifest and every referenced frame through CloudFront; check HTTP status, encoding, CORS, timestamps and numerical validity. Check switching, hourly scrubbing, arbitrary-point forecasts and unavailable-gust handling on phone/desktop.
- Keep S3 versioning and archived manifests. For rollback, an operator can restore a verified archived manifest/version whose frames still exist. The normal worker deliberately refuses an older-run rollback.
- Do not blindly apply age-based deletion to all `weather/*` objects: an outage could leave the active manifest referring to old frames. Start without deletion, then implement garbage collection that protects current manifests and their referenced frames, plus a chosen recovery window. Never expire the latest pointers. `force5/ingest/prune.py` implements exactly that for a filesystem and is what the local deployment schedules; an S3 lifecycle rule is not a substitute, because it cannot see which frames the current manifest references.
- Preserve provider attribution, source links and modification notices in manifests and the UI. Force5 processes provider output; it is not itself a replacement numerical weather model.

## Validation status / remaining launch work

The publisher has local fake-S3 tests for publication order, missing/corrupt input, upload failure, collisions, idempotency and competing newer runs. The frontend supports a separate forecast CDN. The Docker image definition is supplied, but **Docker was not installed in the development environment**, so an actual image build/run and real AWS end-to-end publication remain required.

Open-tab refresh is implemented in the browser and covered by unit and end-to-end tests; what remains untested is its behaviour against a **real** CDN, where a manifest served from a cache with a minimum TTL above zero can hide a new run from a tab for as long as that TTL. Also required before calling the site continuously live: provision the cloud resources, test IAM/CORS/cache policies (including that the latest-pointer TTL is short enough for the five-minute revalidation to see a new run), configure alerts/retries, benchmark hourly processing, and review provider licensing/attribution for the intended service. The current website is still a saved-snapshot prototype until those pieces are deployed.
