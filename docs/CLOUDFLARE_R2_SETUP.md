# Cloudflare R2 setup checklist

What has to exist on the Cloudflare side before the importer can publish there,
what is already done, and what happens once it is. Dashboard steps are written
from memory of Cloudflare's menus, so a label may differ slightly. The design
this serves is in [FORECAST_DATA_PLAN.md](FORECAST_DATA_PLAN.md) (Phase 1) and
the importer's R2 reference is in
[LIVE_FORECAST_PIPELINE.md](LIVE_FORECAST_PIPELINE.md#cloudflare-r2-and-one-shot-batch-containers).

Status, 17 September 2026:

| Step | State |
|---|---|
| 1. wingfoil.ie DNS on Cloudflare | to confirm |
| 2. R2 enabled | **done** |
| 3. Bucket created | **done**: `force5-forecast` |
| 4. Custom domain on the bucket | waiting (owner) |
| 5. CORS rule | to do |
| 6. API token for the importer | to do |
| 7. Settings where the importer reads them | to do |
| 8. First live test | blocked on 6 and 7 (4 for the browser half) |

## Values

| What | Value | Secret? |
|---|---|---|
| Bucket | `force5-forecast` | no |
| Account ID | `29e356a26664bc14b4e5fd88cf533433` | no |
| S3 endpoint (`S3_ENDPOINT_URL`) | `https://29e356a26664bc14b4e5fd88cf533433.r2.cloudflarestorage.com` | no |
| Data domain | to be decided, e.g. `data.wingfoil.ie` | no |
| Access Key ID / Secret Access Key | from step 6 | **yes: never in git, never in chat** |

The dashboard shows the S3 API address as
`https://<account-id>.r2.cloudflarestorage.com/force5-forecast`. The importer
wants the two parts **separately**: the endpoint is the address **without**
`/force5-forecast`, and the bucket name goes in `S3_BUCKET`.

## Steps

### 1. wingfoil.ie's DNS on Cloudflare

An R2 bucket can only take a custom domain from a zone in the same Cloudflare
account. If wingfoil.ie's DNS is already there, nothing to do. If not: add the
site in the dashboard (free plan) and switch the nameservers at the registrar to
the two Cloudflare gives.

### 2. Turn on R2 (done)

### 3. Create the bucket (done)

`force5-forecast`, Standard storage class. Leave public access off; the custom
domain in step 4 is what makes it public.

### 4. Attach a custom domain

Bucket, Settings, Custom Domains, add `data.wingfoil.ie` (or another name).
Cloudflare creates the DNS record itself.

Use the custom domain, **not** the `r2.dev` public URL: `r2.dev` skips the CDN
cache and is rate-limited. The cache is the point: hashed frame files are
immutable, so after the first request they are served from Cloudflare's edge and
never reach the bucket again.

### 5. CORS rule

Bucket, Settings, CORS policy. Paste the contents of
[`force5/deploy/r2-cors.example.json`](../force5/deploy/r2-cors.example.json).
It allows `https://wingfoil.ie` and `https://www.wingfoil.ie`. If the site is
ever previewed from another address (a Pages preview URL, `http://localhost:5173`),
add that address to `AllowedOrigins`, or the browser will refuse the data.

### 6. API token for the importer

R2, Manage API tokens, Create token:

- permission **Object Read & Write**. The importer reads the current manifest,
  writes objects, and deletes the run it replaces, so read-only or write-only is
  not enough;
- scope it to **`force5-forecast` only**, not every bucket;
- no expiry, or a long one with a reminder: an expired token stops every import.

It shows an **Access Key ID** and a **Secret Access Key** once. Save both
somewhere safe straight away.

### 7. Put the settings where the importer reads them

In the Home Compute job's environment, or in a local `r2.env` file for the first
test. `r2.env` must never be committed (`.env*` is already gitignored; keep the
file name inside that pattern or outside the repo).

```
S3_BUCKET=force5-forecast
S3_ENDPOINT_URL=https://29e356a26664bc14b4e5fd88cf533433.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<from step 6>
AWS_SECRET_ACCESS_KEY=<from step 6>
FORCE5_SIDECARS=0
```

- The region needs no setting: it defaults to `auto` when an endpoint is given,
  which is what R2 wants.
- `FORCE5_SIDECARS=0` stops a bucket-only job writing the `.br`/`.gz` copies
  that only the local Caddy deployment serves. It halves the frame-publishing
  cost.
- Do **not** set `FORCE5_PUBLISHED_RUN`; the worker sets it itself.
- Do not mount anything at `/data`. The image runs as a non-root user (uid
  10001) and cannot write to a root-owned mount; a real GFS import on the
  container's own empty disk works (tested 17 September 2026), a bind mount
  failed with `Permission denied: '/data/.cache'`.

### 8. First live test (Claude, once 6 and 7 exist)

Nothing has run against real R2 yet. Everything was built against a fake S3, so
these are the things only the real service can answer:

1. Publish one small model with the image built from this branch:
   `docker run --rm --env-file r2.env force5-worker:integration --models gfs --step 3`
   (about a minute, 81 frames, a few MB).
2. **Conditional writes.** The uploader sends `If-None-Match: *` so an immutable
   object is never overwritten. If R2 rejects that header the fallback
   (head, compare sha256, plain put) takes over and logs an event. If R2
   accepts it, the fallback can be deleted.
3. **Brotli through Cloudflare.** Binary frames are stored brotli-encoded with
   `Content-Encoding: br`. Check with
   `curl -sI -H 'Accept-Encoding: br' https://<data-domain>/weather/<run>/<frame>.bin`
   that the header and the immutable `Cache-Control` come through untouched, and
   that the browser decodes the frame. If Cloudflare mangles it,
   `FORCE5_BUCKET_ENCODING=gzip` is the one-variable fallback.
4. **Pointer manifests** (`weather/gfs.json`) must come back with
   `max-age=0, must-revalidate`, so a new run is seen at once.
5. Publish a second, newer run and confirm the first run's objects are
   **deleted from the bucket** (only the newest run is kept), and that
   `python force5/ingest/prune.py --bucket force5-forecast --endpoint-url … --dry-run`
   finds nothing left over.
6. Build the site with `VITE_FORECAST_BASE_URL=https://<data-domain>/` and
   confirm the map and dock load from it, with no CORS errors in the console.

Steps 1, 2 and 5 need only the token (the S3 endpoint works without the custom
domain). Steps 3, 4 and 6 need the custom domain.

## Later, not blocking

- **The website itself on Cloudflare Pages**: connect the GitHub repo in the
  dashboard, build command `npm run build`, output `dist`, with
  `VITE_FORECAST_BASE_URL` set to the data domain. Free, and beside the data.
- **An outside freshness check.** The site stays up if the importing machine is
  down; the forecast just ages. Something external should alert when a
  manifest's `runTime` gets too old, e.g. a scheduled check of
  `https://<data-domain>/weather/harmonie.json`.
- **The orphan sweep as a daily job**: `prune.py --bucket …` removes what failed
  uploads leave behind, only once it is 6 hours old. Deletes are free on R2.
- **Expected bill: zero.** R2 charges nothing for visitor traffic. Free each
  month: 10 GB stored, 1 million writes, 10 million reads. We keep one run per
  model (well under 1 GB) and write roughly 80,000 objects a month (estimate).
