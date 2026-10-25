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
- 2 GB of RAM available to Docker (the enabled jobs, one at a time, peak at 130-360 MB;
  see "What a job uses" in [deploy/home-compute/README.md](../home-compute/README.md)),
  and 10–20 GB of disk for runs and raw GRIB caches, depending on how many models you
  enable. On macOS or Windows that is the VM's allocation, not the machine's, and the
  machine gives all of it up while the VM runs.
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
| `harmonie`        | 05/08/11/16/19/23 at :35 | before each time riders look; ~826 MB a run, 15 h |
| `icon-eu`         | 03 at :30          | once a day, the 00 UTC cycle; 30 h age limit          |
| `icon-eu-weather` | 03 at :40          | once a day, the 00 UTC cycle, hourly steps; 30 h age limit |
| `ecmwf`           | 08/10/20/22 at :20 | the 00 and 12 UTC runs, out ~07:35 and ~19:35; retries |
| `harmonie-eps`    | off                | lagged control members; enable knowingly              |
| `ecmwf-ens`       | off (retired)      | 00 UTC run, 10 members, +60h–+144h when enabled       |
| `aifs`            | off (retired)      | all four AIFS cycles when enabled                     |
| `gfs`             | 04/10/16/22 at :00 | 6-hourly cycles plus ~4 h publication lag; :45 retry  |
| `gefs`            | off (retired)      | the 0.25° members finish 4.5–6 h after run time       |
| `arpege`          | off (retired)      | 6-hourly cycles plus ~4 h 50 m; ~107 MB per run       |
| `arome`           | off (retired)      | eight cycles a day plus ~4 h 55 m; ~109 MB per run    |
| `gfs-wave`        | 04/10/16/22 at :30 | NOAA's 6-hourly wave cycles, ~3 h 50 m late; :55 retry |
| `gfs-weather`     | 05/11/17/23 at :05 | GFS surface weather, 384 h, ~5 h late; :35 retry     |
| `mi-swan`         | 10/14/18 at :15    | one SWAN run a day, published ~09 UTC, sometimes late |
| `currents`        | 03/07/13 at :20    | one ROMS run a day, written ~00:55 UTC; two retries   |
| `ecmwf-wave`      | off (retired)      | the 00/12 wave stream, ~707 MB per run                |
| `tides`           | 01:05 daily        | predictions, not a forecast cycle                     |
| `sea-temperature` | every 3 h at :15   | Marine Institute observations, newest reading         |
| `wind-obs`        | every hour at :50  | Met Éireann and buoy wind observations, last 72 h     |
| `warnings`        | every hour at :25  | Met Éireann's weather warnings, copied unaltered      |
| `forecast-archive`| every hour at :15  | copies served wind runs and observations to archive/  |
| `verify`          | 07:25 daily        | model and blend scores (docs/VERIFICATION.md)         |
| `prune`           | every hour at :10  | retention (see below)                                 |

Six models are **retired** to keep the home connection's downloads near 80 GB a
month: the ECMWF ensemble, AIFS, GEFS, ARPEGE, AROME and ECMWF waves. Their jobs
ship disabled and `force5/src/catalog.ts` marks them `retired`, so the site,
the blend, the verification replica and the forecast server neither fetch nor list
them. Their adapters are unchanged: to bring one back, enable its job, clear
`retired`, and add it back to `MAP_MODEL_IDS`, `consensus.BLEND_MODELS` and the
forecast server's lists as the tests direct.

What the enabled jobs download, at 30 days a month (slots that find their run
already published download nothing):

| Job | Per run | Runs a day | A month |
| --- | --- | --- | --- |
| `harmonie` | ~785 MB (61 whole files) | 2 | ~47 GB |
| `icon-eu-weather` | ~845 MB (949 files, hourly) | 1 | ~25 GB |
| `icon-eu` | ~250 MB | 1 | ~7.5 GB |
| `ecmwf` | ~245 MB | 1 | ~7.4 GB |
| `gfs-weather` | ~21 MB (209 steps) | 4 | ~2.5 GB |
| `gfs`, `gfs-wave`, `mi-swan`, observations, tides | 1-8 MB each | 4-24 | ~1 GB |
| **Total** | | | **~91-93 GB** |

ICON-EU weather and GFS weather went hourly on 24 October 2026, so the dock's rain is
each hour's own and the map has a Rain layer: about 17 GB a month more than the
~75 GB before, over the ~80 GB target. `--step 3` in the `icon-eu-weather` job's
`args` takes it back to ~300 MB a run (and three-hour rain).

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
disk), `stale` (older than the registry's limit for that model, which its schedule
sets: 13 h for GFS and GFS-Wave, 15 h for HARMONIE, 30 h for the once-a-day ICON-EU
and tides, 36 h for the daily SWAN run, 40 h for ECMWF; the map and the MCP call a run
stale at the same limit) or `expired` (its coverage has
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

**After an upgrade that changes the published format, run every enabled job once.**
The upgrade to run directories and spot squares (schemaVersion 2,
[docs/TILING_DESIGN.md](../../docs/TILING_DESIGN.md)) is one: the new site refuses the
old version 1 pointers still in the volume, so each model reads as unavailable until its
next run replaces its pointer — for HARMONIE, scheduled at 07 and 12 UTC, that is up to
19 hours of a map that will not open. The blend leaves an old pointer out and names it
(`blend_input_refused` in the log) rather than failing. Run everything at once instead,
with the scheduler stopped so a slot cannot collide with a manual job over the worker's
lock:

```sh
docker compose -f deploy/local/docker-compose.yml stop scheduler
npm run deploy:once            # every enabled job in jobs.toml, in file order, then exits
docker compose -f deploy/local/docker-compose.yml start scheduler
```

`deploy:once` is `scheduler.py --once`: the wind models first, then the blend, the
archive, verification and the prune, as the file orders them. It takes as long as all
the downloads (HARMONIE alone is about 785 MB) and exits nonzero if any job failed; the
log names it. Afterwards every pointer in the volume (`weather/*.json`) should carry
`"schemaVersion": 2` and a `"base"`. Setting
`FORCE5_RUN_AT_START=1` in `deploy/local/.env` does the same each time the scheduler
starts.

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
