# wingfoil.ie on one machine

A self-hosted deployment for a single computer on your LAN or a Tailscale mesh: the
built website and every forecast it reads are served from one origin by one Docker
Compose stack. No cloud account, no S3 bucket, no CDN, no API key and no secret of
any kind. This is the alternative to the AWS design in
[`docs/LIVE_FORECAST_PIPELINE.md`](../../docs/LIVE_FORECAST_PIPELINE.md); the two are
independent, and nothing here creates cloud resources.

```text
docker compose
├── web        Caddy: dist/ on / , the ingest volume on /weather/* and /marine/*
├── scheduler  force5/ingest/scheduler.py: runs the one-shot worker per cadence
├── seed       one-shot: gives a new volume the bundled acceptance snapshots
└── volume     force5-data → /data/public/weather + /data/.cache
```

Because the site and the data share an origin, the frontend needs **no**
`VITE_FORECAST_BASE_URL` and no CORS configuration: manifests are fetched as
`/weather/harmonie.json` and frames as `/weather/<run>/<hour>-<hash>.json`.

## What you need

- Docker with Compose v2 or newer (`docker compose version`). A plain Docker install
  is enough; the build does not depend on the buildx plugin.
- 4–6 GB of RAM available to Docker for the ingest container, and 10–20 GB of disk for
  runs and raw GRIB caches, depending on how many models you enable. On macOS or
  Windows that is the VM's allocation, not the machine's.
- Outbound HTTPS to the forecast providers (Met Éireann, DWD, ECMWF, NOAA). No
  inbound port needs to be open to the internet.

## 1. Build both images

From the repository root:

```sh
npm run deploy:build          # docker compose -f deploy/local/docker-compose.yml build
```

This produces two images from this repository: `force5-web:local` (Node 22 builds
`dist/`, Caddy serves it) and `force5-worker:local` (the existing
`force5/Dockerfile`, non-root, one-shot Python ingest).

Optional: `cp deploy/local/.env.example deploy/local/.env` and edit it. Compose reads
that file automatically because it sits beside the compose file. Every value has a
working default.

## 2. First run

```sh
npm run deploy:up             # starts seed → web + scheduler
npm run deploy:status         # prints each manifest's run age
open http://127.0.0.1:8080/
```

`seed` runs once and copies the repository's bundled acceptance snapshots into a
**new** volume so the map has something to draw before the first ingest finishes. It
never overwrites data that is already there.

Nothing is fresh until a worker job has run. Fetch one immediately instead of waiting
for the next cadence slot — GFS is the quickest at roughly a minute and under a
megabyte:

```sh
npm run deploy:run -- --models gfs --step 3
npm run deploy:run -- --models harmonie --step 1
npm run deploy:run -- --models icon-eu --step 1
npm run deploy:run -- --models ecmwf
npm run deploy:run -- --models ecmwf-ens
npm run deploy:run -- --models aifs
npm run deploy:run -- --models harmonie-eps
npm run deploy:run -- --models arpege --step 3
npm run deploy:run -- --models arome --step 3
npm run deploy:run -- --models gfs-wave
npm run deploy:run -- --models mi-swan
npm run deploy:run -- --models ecmwf-wave
npm run deploy:run -- --models tides
```

Reload the page afterwards. Each model publishes independently: a provider outage
leaves the other models exactly as they were.

## 3. The schedule

Cadences live in [`jobs.toml`](jobs.toml), in UTC, because model cycles are published
in UTC. The shipped schedule is:

| Job               | When (UTC)         | Why                                                   |
| ----------------- | ------------------ | ----------------------------------------------------- |
| `harmonie`        | 06/12 at :00       | twice a day; ~810 MB a run, 24 h age limit           |
| `icon-eu`         | 03 at :30          | once a day, the 00 UTC cycle; 30 h age limit          |
| `icon-eu-weather` | 03 at :40          | once a day, the 00 UTC cycle; 30 h age limit          |
| `ecmwf`           | every hour at :20  | hourly check; downloads only the new 00/12 UTC runs   |
| `harmonie-eps`    | off                | lagged control members; enable knowingly              |
| `ecmwf-ens`       | off (retired)      | 00 UTC run, 10 members, +60h–+144h when enabled       |
| `aifs`            | off (retired)      | all four AIFS cycles when enabled                     |
| `gfs`             | 04/10/16/22 at :00 | 6-hourly cycles plus ~4 h publication lag             |
| `gefs`            | off (retired)      | the 0.25° members finish 4.5–6 h after run time       |
| `arpege`          | off (retired)      | 6-hourly cycles plus ~4 h 50 m; ~107 MB per run       |
| `arome`           | off (retired)      | eight cycles a day plus ~4 h 55 m; ~109 MB per run    |
| `gfs-wave`        | 04/10/16/22 at :30 | same cycles, published about 3 h 50 m after each      |
| `mi-swan`         | 10/14/18 at :15    | one SWAN run a day, published ~09 UTC, sometimes late |
| `ecmwf-wave`      | off (retired)      | the 00/12 wave stream, ~707 MB per run                |
| `tides`           | 01:05 daily        | predictions, not a forecast cycle                     |
| `sea-temperature` | every 3 h at :15   | Marine Institute observations, newest reading         |
| `wind-obs`        | every hour at :50  | Met Éireann and buoy wind observations, last 72 h     |
| `forecast-archive`| every hour at :15  | copies served wind runs and observations to archive/  |
| `verify`          | 07:25 daily        | model and blend scores (docs/VERIFICATION.md)         |
| `prune`           | 05:10 daily        | retention (see below)                                 |
| `status`          | every hour at :55  | a freshness line in the log                           |

Six models are **retired** to keep the home connection's downloads near 80 GB a
month: the ECMWF ensemble, AIFS, GEFS, ARPEGE, AROME and ECMWF waves. Their jobs
ship disabled and `force5/src/manifests.ts` marks them `retired`, so the site,
the blend, the verification replica and the forecast server neither fetch nor list
them. Their adapters are unchanged: to bring one back, enable its job, clear
`retired`, and add it back to `MAP_MODEL_IDS`, `consensus.BLEND_MODELS` and the
forecast server's lists as the tests direct.

Edit the file, then check and apply it:

```sh
npm run deploy:schedule       # prints the resolved schedule and the next slot
docker compose -f deploy/local/docker-compose.yml restart scheduler
```

The scheduler runs **one job at a time**, so jobs never contend for the worker's
filesystem lock. A slot that passes while an earlier job is still running is skipped
and logged rather than queued. Model ids are the ones in
`force5/ingest/registry.py`; a job for a model the registry does not have yet —
`nws-wave`, `gefs`, `arpege` — is rejected with one log line and every other
job keeps running, so you can write its entry before the adapter lands.
Set `FORCE5_RUN_AT_START=1` to fire every enabled job once when the scheduler starts.

The stack restarts with Docker (`restart: unless-stopped`), so it survives a reboot as
long as the Docker daemon starts at boot.

## 4. Watch it

```sh
npm run deploy:logs           # follow web + scheduler
npm run deploy:status         # per-model run age, frame count, horizon
docker compose -f deploy/local/docker-compose.yml ps
```

`status` prints one row per registered model and exits nonzero if any model is
`absent`, `unreadable`, `incomplete` (a manifest referencing an object that is not on
disk), `stale` (older than the registry's limit for that model: 12 h for the regional
models, 24 h for the ECMWF products, 30 h for tides, 36 h for the daily SWAN run) or `expired` (its coverage has
already ended). `--json` emits one object per line for a monitoring script, and
`--models gfs` narrows it to the models you actually serve. `web` also has a Docker
health check on `/healthz`; that only proves the server is up, so judge freshness with
`status`, never with the health check.

Every ingest job logs a JSON `forecast_complete` or `forecast_failed` event, and the
scheduler brackets each job with `job_started` / `job_finished` including its exit
code. The event's `phases` say where the job's time went (finding the run, download,
decode, write, validation and publication, with request and byte counts), the adapter
ends its log with the same as one `Timing:` line, and `status` shows each model's last
job in its final column; see "Where a job's time goes" in
[docs/LIVE_FORECAST_PIPELINE.md](../../docs/LIVE_FORECAST_PIPELINE.md).

## 5. Retention

Only the newest run of each model is served. As soon as a new run has fully arrived and
passed validation, the worker deletes every published object that **no current manifest
references** — superseded station files under `marine/`, the wreckage of a failed
import — except a run directory a pointer replaced less than an hour ago: the new
pointer names it under `superseded`, because a browser tab, the CDN or the forecast
server can still hold the old pointer for a few minutes, and the hourly `prune` job
deletes it once the hour is up (`--grace-minutes`, or
`FORCE5_SUPERSEDED_GRACE_MINUTES`). A browser tab that still meets a deleted run moves
itself to the newest run instead of showing an error.

`prune` is the scheduled backstop (hourly in `jobs.toml`). It does the same sweep, and
also removes anything left under `.cache` older than `FORCE5_CACHE_DAYS` (default 1). Raw
downloads are not kept: the worker deletes a model's downloads as soon as its job ends,
and a failed job downloads afresh. Only small state stays there (station catalogues,
SWAN's last-seen time).
It takes the worker's lock and skips its turn while an import is running, because a
run that is still being written is not referenced by any manifest yet. Pointer
manifests are never deleted — including one for a model the registry has not adopted
yet — nor is the archived-manifest directory, and an unreadable manifest aborts the
whole sweep rather than risking objects that are still in use. `FORCE5_RETAIN_HOURS`
(default 0) keeps superseded runs for that many hours if you ever want them.

```sh
npm run deploy:prune -- --dry-run          # report only
npm run deploy:prune                        # apply the configured window
npm run deploy:prune -- --max-age-hours 12  # tighter window, this run only
```

## 6. Updating

```sh
git pull
npm run deploy:build
npm run deploy:up             # recreates the containers; the volume is untouched
```

Published data lives in the volume, not in the images, so rebuilding never discards a
forecast. A new frontend build changes only `dist/` inside `force5-web:local`.

## 7. Back up (and restore) the volume

```sh
docker run --rm -v force5-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/force5-data.tar.gz -C /data .

docker run --rm -v force5-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/force5-data.tar.gz -C /data'
```

Forecasts are reproducible by re-running the importers, so the backup that matters is
this repository. `.cache` can be excluded; it is only raw downloads.

## 8. LAN and mesh access

By default the site is published on `127.0.0.1:8080` only. To reach it from other
devices, set in `deploy/local/.env`:

```text
FORCE5_WEB_BIND=0.0.0.0
FORCE5_WEB_PORT=8080
```

then `npm run deploy:up` and open `http://<machine-ip>:8080/`.

On a Tailscale mesh, keep the bind on `127.0.0.1` and let Tailscale terminate TLS and
publish the port, so nothing is exposed to the local network:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

The site is then `https://<machine>.<tailnet>.ts.net/` for your devices only. Add
`tailscale funnel` only if you deliberately want it on the public internet; read the
provider licences and attribution requirements first. Caddy itself runs plain HTTP
(`auto_https off`) because it has no public hostname to get a certificate for.

## Cache headers

| Path                                    | `Cache-Control`                       |
| --------------------------------------- | ------------------------------------- |
| `/weather/<run>/…`                      | `public, max-age=31536000, immutable` |
| `/marine/…-<hash>.json` (station files) | `public, max-age=31536000, immutable` |
| `/weather/*.json`, `/marine/tides.json` | `max-age=0, must-revalidate`          |
| `/assets/…` (content-hashed)            | `public, max-age=31536000, immutable` |
| `/`, `/index.html`                      | `max-age=0, must-revalidate`          |

Frame and asset names contain a content hash, so they can be cached forever; the
pointer manifests are replaced in place on every new run and must be revalidated.
Responses are compressed with zstd or gzip, and `.js` is served as
`text/javascript; charset=utf-8` so MapLibre's ES-module worker loads. Verify after a
change:

```sh
curl -I http://127.0.0.1:8080/weather/gfs.json
curl -I http://127.0.0.1:8080/weather/<run-directory>/000-<hash>.json
curl -I http://127.0.0.1:8080/assets/maplibre-gl-worker-<hash>.js
```

`/marine/*` is served from the same volume: `marine/tides.json` and its immutable
per-station prediction files today, plus further marine output as those adapters land
([`docs/MULTI_MODEL_PLAN.md`](../../docs/MULTI_MODEL_PLAN.md)). It returns 404 until
the tides job has run, because the repository ships no bundled marine snapshot.

## Stopping and removing

```sh
npm run deploy:down                                  # keeps the volume
docker compose -f deploy/local/docker-compose.yml down -v   # deletes the forecasts too
```

## Troubleshooting

- **The map says the snapshot is expired.** No successful ingest yet, or the provider
  is behind. Check `npm run deploy:status` and `npm run deploy:logs`.
- **`Workspace is already in use`.** Another ingest job holds `/data/.cache/worker.lock`.
  Wait for it; the scheduler serialises its own jobs, but a manual `deploy:run` can
  collide with a scheduled one.
- **A provider returns 503 or an incomplete run.** Expected: the importers refuse a
  partly published cycle and leave the previous run in place. The next slot retries.
- **The schedule changes had no effect.** `jobs.toml` is bind-mounted; restart the
  `scheduler` service and confirm with `npm run deploy:schedule`.
- **The site loads but data 404s.** The volume is empty. Run `deploy:run` for a model,
  or `docker compose … up seed` to restore the bundled snapshots.
- **Bind mount errors on macOS.** A VM-backed Docker (Colima, Lima, Rancher) only sees
  the host directories it was told to mount; make sure this checkout's path is one of
  them, for example `colima start --mount /Volumes/yourdisk:w`.
