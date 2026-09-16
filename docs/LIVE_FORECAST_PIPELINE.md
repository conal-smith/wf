# Running Force5 forecasts live

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

- `force5/Dockerfile`: non-root, one-shot Python worker image; only ingest code and the spot catalogue enter the build context. No saved forecasts, Git history, frontend dependencies or credentials.
- `force5/ingest/worker.py`: invokes any selection of the three importers, validates each package and optionally publishes. It exits nonzero on failure and logs JSON completion/failure events. A filesystem lock prevents concurrent jobs using the same scratch directory.
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
all 50 members to +240h would be **6.35 GB** per run. Measured transfer on the
ECMWF mirror was roughly 5–8 MB/s with one or two concurrent readers, so a default
run moves its ~2 GB in a few minutes. Each run prints its own measured transfer.
Egress-priced environments should count 2 GB × 2 runs per day, plus per-step index
overhead that shrinks when fewer, larger steps are requested.

Schedule ENS **twice daily** against the 00 and 12 UTC cycles (hourly discovery
checks are fine: the importer refuses a run older than 24 hours and publishes only
a complete member set). The 06/18 cycles exist but stop at +144h; they can be used
by passing `--hours 144`, which the worker does not do. The AWS mirror returned
sustained `503 SlowDown` during development while other jobs were active, so the
importer allows 6 retries with a 10-second backoff and honours `--source ecmwf`
or `--source google`; keep concurrency at 1–2 readers (`--workers`).

## AWS setup checklist

1. Create a private S3 bucket with Block Public Access and versioning enabled. The application data is public through CloudFront, not public bucket ACLs.
2. Create a CloudFront distribution using S3 Origin Access Control. Use HTTPS, for example `forecast.wingfoil.ie`, with a suitable certificate/DNS record. Enable compression.
3. Give the **task role** only the required bucket access. Adapt `force5/deploy/s3-task-policy.example.json`; if using `S3_PREFIX`, include it in the object ARN. `GetObject` supports manifest reads and collision checks; `ListBucket` allows missing-key reads to return 404 instead of ambiguous 403. No delete permission is needed. Configure separate execution-role permissions for ECR pulls and CloudWatch logs. KMS-encrypted buckets require additional scoped KMS permissions.
4. Configure CORS on S3/CloudFront for the actual website origins. `s3-cors.example.json` is a starting point. Allow GET/HEAD; expose ETag if needed. Ensure CloudFront forwards `Origin` and caches responses consistently, or use a response-headers policy with the intended allowed origins. Do not put AWS credentials in the browser.
5. Build the image, push it to your ECR repository and register an ECS Fargate task definition. Start with 2 vCPU / 4 GiB RAM and 20 GiB ephemeral storage, then measure actual runtime and peak memory. Use an image digest for deployments and a tested dependency/base-image lock for reproducible releases.
6. Give tasks outbound HTTPS access to providers, ECR, S3 and logging (appropriate public-subnet/public-IP routing or private-subnet NAT/endpoints). No inbound port is needed. Use a fresh writable scratch directory per task; persistent shared storage is not required.
7. Run a manual task and verify an entire published forecast through the CDN before enabling the schedule.
8. Schedule HARMONIE checks hourly; use a separate ICON-EU task schedule matching the full-horizon main cycles, initially every six hours with an appropriate publication delay. The importers discover the latest **complete** run, rather than assuming a scheduled run is ready. Tune scheduling against actual publication latency. See [scheduling ECS tasks with EventBridge Scheduler](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html).

Suggested container arguments:

```text
HARMONIE: --models harmonie --step 1 --bucket YOUR_FORECAST_BUCKET
ICON-EU:  --models icon-eu --step 1 --bucket YOUR_FORECAST_BUCKET
ECMWF:    --models ecmwf --bucket YOUR_FORECAST_BUCKET
ECMWF ENS: --models ecmwf-ens --bucket YOUR_FORECAST_BUCKET
```

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
weather/ecmwf-ens.json                    current ECMWF ENS pointer + member series
weather/ecmwf-ens-RUN-144h-25m-v1/HOUR-HASH.json  immutable ensemble-mean frames
weather/manifests/ecmwf-ens/RUN-HASH.json  archived complete ENS manifests
```

The ENS prefix records the horizon and member count, so changing either publishes
a new immutable frame set instead of colliding with the previous one. The ENS
manifest is larger than the others because it carries every member: about 16 KB
for 8 spots × 5 steps × 6 members, so roughly 1 MB for 25 spots × 25 steps ×
25 members. It is served with the short-lived pointer cache policy and benefits
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
```

The current browser fetches the manifest on page load and model changes, then reads its immutable frame URLs. It does **not yet automatically replace the run in an already-open tab**. Before public launch, add periodic/visibility-triggered manifest revalidation (for example every five minutes), using the existing atomic model/frame validation path, preserving the selected valid time and avoiding changes while the user is scrubbing. Until then a reload obtains the latest run. The browser already labels stale/expired snapshots.

## Monitoring, retries and recovery

- Send container stdout/stderr to CloudWatch. Alarm on `forecast_failed`, ECS nonzero task exit, unusually long task duration, and age of the **published manifest's runTime**. A scheduler successfully starting an ECS task does not prove that the forecast succeeded.
- Configure Scheduler delivery retries/DLQ for failures to start the task. Separately monitor ECS task completion and retry failed jobs; Scheduler delivery retries alone do not handle an ingest process exiting unsuccessfully.
- Measure source publication lag before selecting alert thresholds. For HARMONIE, an initial warning around 3–4 hours without a newer published run is worth testing; keep a separate threshold for ICON-EU's longer cycle.
- After first publication, fetch the manifest and every referenced frame through CloudFront; check HTTP status, encoding, CORS, timestamps and numerical validity. Check switching, hourly scrubbing, arbitrary-point forecasts and unavailable-gust handling on phone/desktop.
- Keep S3 versioning and archived manifests. For rollback, an operator can restore a verified archived manifest/version whose frames still exist. The normal worker deliberately refuses an older-run rollback.
- Do not blindly apply age-based deletion to all `weather/*` objects: an outage could leave the active manifest referring to old frames. Start without deletion, then implement garbage collection that protects current manifests and their referenced frames, plus a chosen recovery window. Never expire the latest pointers.
- Preserve provider attribution, source links and modification notices in manifests and the UI. Force5 processes provider output; it is not itself a replacement numerical weather model.

## Validation status / remaining launch work

The publisher has local fake-S3 tests for publication order, missing/corrupt input, upload failure, collisions, idempotency and competing newer runs. The frontend supports a separate forecast CDN. The Docker image definition is supplied, but **Docker was not installed in the development environment**, so an actual image build/run and real AWS end-to-end publication remain required.

Also required before calling the site continuously live: provision the cloud resources, test IAM/CORS/cache policies, add open-tab refresh, configure alerts/retries, benchmark hourly processing, and review provider licensing/attribution for the intended service. The current website is still a saved-snapshot prototype until those pieces are deployed.
