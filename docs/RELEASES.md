# Builds and releases

How a commit on main becomes what wingfoil.ie runs. It is the shape SprintEngine
Studio's release train has: main feeds a nightly, a release stages what a nightly
already built rather than building again, and a promote puts exactly what staging
tested into production.

```text
pull request / push to main ──► CI ──────────────────────────────── (gate only)

02:17 UTC, if main moved ──► nightly ──► v2026.10.10-nightly.42 (prerelease)
                             build 3 images + the site once            images :nightly
                             CI gate, image smoke, real-data acceptance

dispatch "release" ──► staging ──► v2026.10.11-rc.57 (prerelease: images.json,
                       same digests :staging        site.tar.gz, staged.json)
                       smoke + acceptance again
                       site to Pages staging, smoke-tested

          you look at staging (STAGING_SITE_URL)

dispatch "promote" ──► production ──► v2026.10.11 (release)
                       the staged files, checked byte for byte
                       same digests :production, :latest
                       the same site build to Pages production, smoke-tested
                       Mac mini pulls :production
```

## The artifacts

| Image | Built from | What runs it |
| --- | --- | --- |
| `ghcr.io/sprintengine/wingfoil-forecast` | `force5/Dockerfile` | Every ingest job: the Mac mini or Cloudflare Containers (both through Home Compute), the Compose stack |
| `ghcr.io/sprintengine/wingfoil-web` | `deploy/local/Dockerfile.web` | The self-hosted site (`deploy/local`) |
| `ghcr.io/sprintengine/wingfoil-market` | `market/Dockerfile` | The marketplace/community/Gust API (Railway), off unless asked |

The forecast image is the one that matters most: it is what knows how to fetch
each model and where to publish it. It installs its Python packages under
`force5/ingest/requirements-lock.txt`, so an image built today is the image built
last week. (A fresh build on 10 October 2026 picked up eccodeslib 2.49.0.30,
which crashes on exit beside pyproj and failed every HARMONIE, HARMONIE-EPS and
GFS-Wave job. The lock and the image smoke test are why that cannot ship again.)

It is published as one manifest list for **linux/amd64** and **linux/arm64**.
The nightly builds each platform on a native runner (`ubuntu-24.04` and
`ubuntu-24.04-arm`, no QEMU) and merges the digests with
`docker buildx imagetools create`. The digest in `images.json` is that list.
`:nightly`, `:staging`, `:production` and `:latest` are moved onto it with the
same `imagetools create` as before, so a promote carries both platforms. The
site and marketplace images stay linux/amd64. Pip installs wheels only
(`--only-binary`), and the Dockerfile installs the esbuild binary named for
`TARGETARCH`, then refuses a node or a native library for the other CPU.

Each nightly also builds the static site once (`site.tar.gz` on its release).
One build serves every environment: at deploy time
`scripts/release/release.mjs configure-site` writes the environment's forecast
data address into `index.html` (`<meta name="wingfoil:forecast-base">`, read by
`force5/src/urls.ts`).

Tags: `:<version>` and `:sha-<commit>` for every nightly, `:<date>-rc.<run>` for
a staged candidate and `:<date>` for a release, then `:nightly`, `:staging`,
`:production` and `:latest` moved onto digests as a build passes each stage. A
tag only ever moves to a digest that has passed everything before it.

## What tests what

| Check | Where | Catches |
| --- | --- | --- |
| `npm run build`, `npm test`, `npm run ui:lint`, API and Worker type checks | CI `web` | the site and its code |
| Ingest unit tests on Python 3.12 under the lock, `deploy/schedules.py --check` | CI `ingest` | the importers, the timetables drifting apart |
| Playwright, desktop and phone, on synthetic sample data | CI `e2e` | the map, dock, spot pages, marketplace, community |
| `scripts/release/worker-image-smoke.sh` | CI `forecast` (linux/amd64 and linux/arm64), nightly, staging | a module that cannot import or crashes on exit, the unit tests on the image's own Python, entry points, the blend bundle, the non-root user |
| `scripts/release/manifest_platforms.py` | CI `forecast-manifest`, nightly merge | a forecast manifest list that is missing linux/amd64 or linux/arm64 |
| `scripts/release/web-image-smoke.sh` | CI `images`, nightly, staging | health check, every client-side route, asset caching, data 404s |
| `scripts/release/market-image-smoke.sh` | CI `images`, nightly, staging | the compiled API boots |
| `scripts/release/acceptance.sh` | nightly, staging | the worker fetching **real** HARMONIE and GFS runs, `status.py` calling them fresh, publishing to an S3-compatible bucket with every referenced object present, and the site image drawing them in Chromium (`e2e/smoke`) |
| `e2e/smoke` against the deployed URL | staging, production (once Pages is set up) | the deployed site reading its environment's data, CORS included |
| `npm run ci` and both Metro bundles in `mobile/` | CI `mobile`, nightly | the app's types, lints, unit tests and bundles ([MOBILE.md](MOBILE.md), "What tests what") |
| `scripts/release/monitor.py` | every two hours, against production | a model gone stale, a pointer naming files that are not there, wrong cache headers, the site pointed at the wrong data (see "The production monitor") |

Run any of them locally against an image you built; each script's header says how.

## The nightly

`.github/workflows/release.yml` on its 02:17 UTC schedule builds main's head
only if main has commits the last nightly did not build, and refuses (red) if main
no longer contains the last nightly at all. *Run workflow → nightly* builds now,
gate skipped. Nothing is published until the CI gate, every image smoke test and
the acceptance run have passed; then the prerelease `v<date>-nightly.<run>` is
created with `images.json` (the three digests) and `site.tar.gz`, and the images'
`:nightly` tag moves. Only the newest seven nightly releases are kept; their tags
stay.

## A release

Two buttons, with you in between. Both are *Actions → Release → Run workflow*.

1. **Stage: channel `release`** (optionally naming a nightly tag; the default is
   the newest). Staging only; nothing in production moves.
   - The nightly's digests get `:staging` and `:<date>-rc.<run>`; every image
     smoke test and the real-data acceptance run again, against today's
     providers.
   - If Cloudflare is set up, the nightly's `site.tar.gz` goes to the Pages
     project's `staging` branch, pointed at `STAGING_FORECAST_BASE_URL`, and the
     smoke suite runs against `STAGING_SITE_URL`.
     The build carries `_worker.js` (mcp/pages/worker.ts) and `_routes.json`,
     so Pages itself answers the MCP endpoint at `/api/mcp`, reading the same
     data as the map, and serves the spot pages, `/stars` and `/ai` under
     their own title and description (mcp/pages/head.ts) for search engines
     and link previews; every other path stays a static file, with
     `_headers` (public/) caching the content-hashed `/assets/*` as
     `immutable` for a year. The build also
     writes `sitemap.xml` (scripts/build-sitemap.mjs), which `robots.txt`
     names.
   - Then, and only then, what passed is recorded as the prerelease
     `v<date>-rc.<run>` (the workflow run's number), tagged on the commit and
     carrying `images.json`, `site.tar.gz` and `staged.json`: the digests, the
     sha256 of both files, the nightly it came from, the commit, and the
     workflow run and attempt that staged it. A staging that fails records
     nothing. The run's summary names the candidate.
2. **Look at staging.** `STAGING_SITE_URL` reads production's forecast data with
   the candidate's site: click about, on a phone too.
3. **Promote: channel `promote`** (optionally naming a candidate in `staged`;
   the default is the newest one whose staging passed). Production only.
   - Before anything moves, the candidate is vetted: its `staged.json` must
     describe its own tag and commit; GitHub must say the *Staging* job of the
     run it names completed successfully; its commit must not be released
     already; it must contain what production runs; and if a site is to be
     deployed, staging must have deployed one.
   - The candidate's `images.json` and `site.tar.gz` are downloaded and checked
     against the hashes and digests in `staged.json`.
   - The digests get `:production`, `:latest` and `:<date>`; the same
     `site.tar.gz` goes to the Pages production branch, pointed at
     `PRODUCTION_FORECAST_BASE_URL`, and is smoke-tested at
     `PRODUCTION_SITE_URL`; then the `v<date>` release (`v<date>.2` for a second
     the same day) and its tag are created on the commit.

What is refused, and why:

| Refused | At | Why |
| --- | --- | --- |
| A nightly or candidate whose commit is already released | release, promote | a commit is released once |
| A candidate whose staging job failed, or has not finished | promote | only what passed staging reaches production |
| A nightly or candidate that does not contain the commit production runs | release, promote | production only moves forward |
| A site staging never deployed, once Pages is set up | promote | nobody has looked at it |
| Files that differ from what staging recorded | promote (production job) | production gets exactly what staging tested |

"Older than production" is decided by ancestry, not by date: production's commit
must be an ancestor of the candidate's. A date test would let through an older
nightly staged after a newer one shipped, or a nightly of a main rewritten since,
and both would take changes back out of production. To go back, ship a revert
through the train (or, in an emergency, move `:production` onto an earlier
release's digest by hand: `docker buildx imagetools create -t …:production <digest>`).

Staging and production run the train's own logic (`scripts/release/release.mjs`)
from the workflow's commit, and the tests from the commit being shipped, so a
candidate staged before a change to the train can still be promoted by it.

Why two dispatches and not one run that waits for an approval: an environment's
**required reviewers** are what would make the run wait, and on a private
repository they need a paid plan (GitHub refuses the setting on the free plan).
The production job keeps `environment: production`, so if the repository is ever
public — where required reviewers are free — adding yourself as one makes every
promote wait for a click as well.

### The app

The app ([MOBILE.md](MOBILE.md)) rides the same two dispatches. A nightly
publishes its JavaScript once, as an EAS update on a branch named for the
nightly, and attaches `mobile.json`; a release points the `staging` channel at
that branch (building and submitting a staging binary only when none runs its
runtime), and you try Wingfoil Staging from TestFlight or Play internal testing
alongside the staging site; a promote points `production` at the same branch,
checked to hold exactly the update groups staging ran, publishes
`app/latest.json` with the site, tells riders, and builds a production binary
for the stores only when the native code changed. Every app step is a notice
until `EXPO_TOKEN` and `EAS_PROJECT_ID` exist, so nothing here changes the
site's train until then. MOBILE.md has the diagram, the setup and how to roll
the app back.

### The forecast jobs

A promote does not move the forecast jobs. Since 18 October 2026 every job runs
on Cloudflare Containers through Home Compute's hosted control plane (its
scheduler is hc-core); the Mac mini is drained and kept as a fallback. Each job
is pinned to the worker image's multi-platform ghcr digest, and Cloudflare cannot
pull from ghcr.io, so after each promote the new image is copied into
Cloudflare's registry, hc-core is deployed with it, and every job is pointed at
the new digest. Until then production keeps running the previous release's
image. From a Home Compute checkout on its `main` (Home Compute's
[docs/cloudflare-containers.md](https://github.com/sprintengine/home-compute/blob/main/docs/cloudflare-containers.md)
and [docs/deploy.md](https://github.com/sprintengine/home-compute/blob/main/docs/deploy.md)
have the detail):

1. **The digest.** `crane digest ghcr.io/sprintengine/wingfoil-forecast:<date>`
   (image tags have no `v`: release `v2026.10.23.2` is `:2026.10.23.2`), after
   `gh auth token | crane auth login ghcr.io -u <github user> --password-stdin`
   with a token that has `read:packages`. Check that `crane config … --platform
   linux/amd64` has `org.opencontainers.image.revision` set to the release's commit.
2. **Copy it to Cloudflare** (`npx wrangler login` first), without deploying:
   `cloud/scripts/set-container-image.sh ghcr.io/sprintengine/wingfoil-forecast:<date>`.
   It copies the linux/amd64 image (several minutes for the worker image) and
   rewrites the three image lines in `cloud/wrangler.core.jsonc`; `git diff`
   should show nothing else.
3. **Pick a quiet window.** A run whose pinned digest is not the deployed image
   fails at once rather than waiting, so swap between slots: from :25 to :45 in
   an hour with no job at :20 to :45 (00, 01, 02, 06, 09, 12, 14, 15, 18 and
   21 UTC with today's `jobs.toml`). Start the admin session,
   `HC_ADMIN=http://127.0.0.1:8790; cloud/scripts/local-admin.sh` (or use an
   Access service token against hc-web), and check that `GET $HC_ADMIN/v1/snapshot`
   lists no `activeRuns`.
4. **Swap.** Drain the executor so nothing starts mid-swap
   (`PATCH $HC_ADMIN/v1/machines/m_cloudflarecontainer0000000 {"drain":true}`),
   deploy hc-core (`npx wrangler deploy -c wrangler.core.jsonc` from `cloud/`),
   point every Cloudflare job at the new digest
   (`PATCH $HC_ADMIN/v1/jobs/<id>/image {"image":"ghcr.io/sprintengine/wingfoil-forecast@sha256:<digest>"}`),
   then undrain (`{"drain":false}`). Runs that came due meanwhile start at the
   next cron minute.
5. **Commit the image lines** (and any preset change) to Home Compute's `main`
   through a pull request, so the next hc-core deploy does not put the old image
   back.
6. **A new job** in `deploy/local/jobs.toml` is not added by any of this. Run
   `deploy/schedules.py --check`, then import only the new jobs from
   `deploy/home-compute/home-compute.json` with Home Compute's
   `node src/cli.mjs cloud import <file> --preset wingfoil --image ghcr.io/sprintengine/wingfoil-forecast@sha256:<digest> --dry-run`
   (then again without `--dry-run`; the import never touches jobs that are not in
   the file). Cloudflare refuses a run longer than 1200 s and the import gives a
   job its total timeout less its queue time, so set the new job's
   `timeouts.runSeconds` to 1200 or less with `PUT $HC_ADMIN/v1/jobs/<id>`
   (`If-Match: <revision>`). Add its model to the preset's `freshness` map
   (`presets/wingfoil.json`, the `maxAgeHours` of `force5/ingest/registry.py`) for
   the stale alert. Start its first run with `POST $HC_ADMIN/v1/jobs/<id>/run`.
7. **Check** the jobs' next runs on the dashboard, then run the production
   monitor (*Actions → Production monitor → Run workflow*).

**The Mac mini fallback.** `deploy/home-compute/macmini.sh pull [image]` pulls
the released image (`:production` by default; Colima is linux/arm64, so it takes
that platform from the manifest list) and tags it `wingfoil-forecast:local` for
jobs placed on the Mac mini. `macmini.sh image` builds from the checkout when you
are trying something out.

## The production monitor

`.github/workflows/monitor.yml` runs `scripts/release/monitor.py` at 41 minutes
past every second hour (UTC), and on *Run workflow*. It reads production's data
at `PRODUCTION_FORECAST_BASE_URL` and changes nothing there.

**Which models.** Worked out from the checkout, so retiring or reviving a model
changes the monitor with it: every model of an enabled worker job in
`deploy/local/jobs.toml`, plus any the site lists (`force5/src/catalog.ts`),
minus every model the site calls `retired` or `planned`. Today that is HARMONIE,
ICON-EU, ICON-EU weather, ECMWF, GFS, GFS-Wave, MI SWAN, tides, sea temperature,
the blend, wind observations, the forecast archive and the verification scores.

**What it checks**, per model:

- the pointer answers 200 and parses: a run (`wind`, `wave`, `weather`, the
  blend) as schemaVersion 2 with a usable `base` and spot square index, the
  other bundles as the schemaVersion 1 files they are, each naming its own model;
- its `run` is no older than `maxAgeHours` in `force5/ingest/registry.py` (the
  limit `status.py` calls stale) plus one hour, and its coverage has not ended;
- with HEAD requests, not downloads: every spot square it lists; for a tiled run
  every tile of the coarsest level and the first level-0 tile at the first
  frame, never one the pointer calls `absent`; for tides, every station file it
  names by `url`. About 140 requests in all, a few seconds;
- headers: every one of those files cached `immutable` and every tile served
  `br` or `gzip`; the pointer itself not cached for longer than five minutes;
- once `MONITOR_SITE_URL` is set (leave it unset until the first production
  release has deployed the site): the site answers 200 with the
  `wingfoil:forecast-base` meta naming the data domain, the first `/assets/`
  script it names is cached `immutable` (public/_headers), and the data
  domain's CORS lets the site's origin read a pointer. No browser.

Every request has a 10-second timeout and is retried twice on a dropped
connection, a timeout, a 429 or a 5xx, so one lost request is not an alarm. The
run's summary is a table: model, run, age, limit, files checked, status.

**Where alerts go.** Any problem fails the run and opens the issue *Production
monitor: forecast data problem* (label `monitor`), with the failing rows and a
link to the run; GitHub notifies you of it as of any issue in a repository you
watch (web, and email if your notification settings send it). While it is open,
a run comments only when the set of problems changes (a model joining or
leaving, a new kind of fault), not every two hours; the first clean run comments
and closes it. Separately, GitHub emails a scheduled workflow's failures to the
user who last edited its `cron` line, so whoever last touched `monitor.yml`'s
schedule gets a mail per failing run as well. The job's token can write issues
and read the repository, nothing else.

**Cost.** One job on `ubuntu-latest` with its own `python3`, a sparse checkout
of the five files it reads and no installs: well under a minute, billed as one.
Twelve runs a day is about 360 of the 2,000 free Actions minutes a month.

Run it by hand with `npm run -s monitor` (or
`python3 scripts/release/monitor.py check --base https://data.wingfoil.ie/ --site …`);
its tests are `npm run -s test:monitor`, and CI runs them in the ingest job.

## One-time setup

Nothing here is needed for CI or the nightly; they work as soon as the workflows
are on main. A release and a promote need the two environments; the site
deployment needs Cloudflare. Until the Cloudflare variables exist, a release
stages and tests the images and says, in a notice, that no site was deployed, and
a promote moves the image tags only.

1. **Environments** (*Settings → Environments*): create `staging` and
   `production`. Neither needs protection rules: the gate is that production
   only moves when someone dispatches a promote. Required reviewers on a private
   repository need a paid plan (the API refuses them on the free one); if the
   repository goes public they are free, and adding yourself to `production`
   makes each promote wait for your click too.
2. **Packages**: after the first nightly, open each of the three packages
   (*Your profile → Packages*), set them **public**, and check *Manage Actions
   access* lists this repository with write access. Public packages are what let
   the Mac mini (and anyone self-hosting) pull without a token.
3. **Cloudflare Pages** (when the site goes live): create a Pages project with
   direct uploads (no Git connection: the workflow uploads the tested build), its
   production branch `main`. Then set, under *Settings → Secrets and variables →
   Actions*:

   | Name | Kind | Example |
   | --- | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | secret | a token with *Cloudflare Pages: Edit* |
   | `CLOUDFLARE_ACCOUNT_ID` | variable | the account's ID |
   | `CLOUDFLARE_PAGES_PROJECT` | variable | `wingfoil` |
   | `STAGING_SITE_URL` | variable | `https://staging.wingfoil.pages.dev` |
   | `STAGING_FORECAST_BASE_URL` | variable | `https://data.wingfoil.ie/` (production's data, read-only) |
   | `PRODUCTION_SITE_URL` | variable | `https://wingfoil.ie` |
   | `PRODUCTION_FORECAST_BASE_URL` | variable | `https://data.wingfoil.ie/` |
   | `MONITOR_SITE_URL` | variable | `https://wingfoil.ie`, once the first promote has deployed it |

   Add the staging site's origin to the data bucket's CORS rule
   (`force5/deploy/r2-cors.example.json`), or the staging smoke test fails on
   CORS exactly as a visitor would.

The workflows use GitHub-hosted runners only, including `ubuntu-24.04-arm` for
the forecast image's arm64 build: a public repository must never run
pull-request code on the self-hosted Mac.
