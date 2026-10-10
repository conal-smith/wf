# Builds and releases

How a commit on main becomes what wingfoil.ie runs. It is the shape SprintEngine
Studio's release train has: main feeds a nightly, and a release promotes what a
nightly already built rather than building again.

```text
pull request / push to main ──► CI ──────────────────────────────── (gate only)

02:17 UTC, if main moved ──► nightly ──► v2026.10.10-nightly.42 (prerelease)
                             build 3 images + the site once            images :nightly
                             CI gate, image smoke, real-data acceptance

dispatch "release" ──► staging ──► approval ──► production ──► v2026.10.10 (release)
                       same digests :staging     same digests :production, :latest
                       smoke + acceptance again  site to Cloudflare Pages (once set up)
                       site to Pages staging     Mac mini pulls :production
```

## The artifacts

| Image | Built from | What runs it |
| --- | --- | --- |
| `ghcr.io/sprintengine/wingfoil-forecast` | `force5/Dockerfile` | Every ingest job: the Mac mini (Home Compute), the Compose stack, Cloudflare Containers |
| `ghcr.io/sprintengine/wingfoil-web` | `deploy/local/Dockerfile.web` | The self-hosted site (`deploy/local`) |
| `ghcr.io/sprintengine/wingfoil-market` | `market/Dockerfile` | The marketplace/community/Gust API (Railway), off unless asked |

The forecast image is the one that matters most: it is what knows how to fetch
each model and where to publish it. It installs its Python packages under
`force5/ingest/requirements-lock.txt`, so an image built today is the image built
last week. (A fresh build on 10 October 2026 picked up eccodeslib 2.49.0.30,
which crashes on exit beside pyproj and failed every HARMONIE, HARMONIE-EPS and
GFS-Wave job. The lock and the image smoke test are why that cannot ship again.)

Each nightly also builds the static site once (`site.tar.gz` on its release).
One build serves every environment: at deploy time
`scripts/release/release.mjs configure-site` writes the environment's forecast
data address into `index.html` (`<meta name="wingfoil:forecast-base">`, read by
`force5/src/urls.ts`).

Tags: `:<version>` and `:sha-<commit>` for every nightly, then `:nightly`,
`:staging`, `:production` and `:latest` moved onto digests as a build passes
each stage. A tag only ever moves to a digest that has passed everything before it.

## What tests what

| Check | Where | Catches |
| --- | --- | --- |
| `npm run build`, `npm test`, `npm run ui:lint`, API and Worker type checks | CI `web` | the site and its code |
| Ingest unit tests on Python 3.12 under the lock, `deploy/schedules.py --check` | CI `ingest` | the importers, the timetables drifting apart |
| Playwright, desktop and phone, on synthetic sample data | CI `e2e` | the map, dock, spot pages, marketplace, community |
| `scripts/release/worker-image-smoke.sh` | CI `images`, nightly, staging | a module that cannot import or crashes on exit, the unit tests on the image's own Python, entry points, the blend bundle, the non-root user |
| `scripts/release/web-image-smoke.sh` | CI `images`, nightly, staging | health check, every client-side route, asset caching, data 404s |
| `scripts/release/market-image-smoke.sh` | CI `images`, nightly, staging | the compiled API boots |
| `scripts/release/acceptance.sh` | nightly, staging | the worker fetching **real** HARMONIE and GFS runs, `status.py` calling them fresh, publishing to an S3-compatible bucket with every referenced object present, and the site image drawing them in Chromium (`e2e/smoke`) |
| `e2e/smoke` against the deployed URL | staging, production (once Pages is set up) | the deployed site reading its environment's data, CORS included |

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

*Actions → Release → Run workflow → release* (optionally naming a nightly tag;
the default is the newest). It promotes that nightly's commit and digests as
`v<date>` (`v<date>.2` for a second the same day):

1. **Staging** (environment `staging`): the digests get `:staging` and the
   release version; every image smoke test and the real-data acceptance run again,
   against today's providers. If Cloudflare is set up, the site goes to the Pages
   project's `staging` branch, pointed at `STAGING_FORECAST_BASE_URL`, and the
   smoke suite runs against `STAGING_SITE_URL`.
2. **Approval**: the run waits at the `production` environment for its required
   reviewer. Look at staging, then *Review deployments → Approve*.
3. **Production**: the digests get `:production` and `:latest`; the site goes to
   the Pages production branch, pointed at `PRODUCTION_FORECAST_BASE_URL`, and is
   smoke-tested at `PRODUCTION_SITE_URL`; then the `v<date>` release and tag are
   created on the commit.

A commit is released once; promoting a nightly whose commit already shipped is
refused.

### The Mac mini

Production's forecast is the worker image running on the Mac mini. To run the
released image instead of one built from the checkout:

```sh
deploy/home-compute/macmini.sh pull          # ghcr.io/sprintengine/wingfoil-forecast:production
deploy/home-compute/macmini.sh pull ghcr.io/sprintengine/wingfoil-forecast:v2026.10.10
```

`pull` tags it as `wingfoil-forecast:local`, so Home Compute and the menu bar
app need no change; the next job runs it. `macmini.sh image` still builds from
the checkout when you are trying something out. The same image runs anywhere
Docker does, so moving the jobs to Cloudflare Containers later means pointing
`deploy/cloudflare/wrangler.jsonc` at the released image, not a new build.

## One-time setup

Nothing here is needed for CI or the nightly; they work as soon as the workflows
are on main. A release needs the two environments; the site deployment needs
Cloudflare. Until the Cloudflare variables exist, a release promotes and tests
the images and says, in a notice, that no site was deployed.

1. **Environments** (*Settings → Environments*): create `staging`, and
   `production` with yourself as a **required reviewer** — that is the one click.
   Required reviewers on a private repository need a paid plan; on a public one
   they are free.
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

   Add the staging site's origin to the data bucket's CORS rule
   (`force5/deploy/r2-cors.example.json`), or the staging smoke test fails on
   CORS exactly as a visitor would.

The workflows use GitHub-hosted runners only: a public repository must never run
pull-request code on the self-hosted Mac.
