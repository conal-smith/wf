# Forecast data plan: smaller downloads, 15-day dock, more named spots

Status: reviewed draft, revision 3, 17 September 2026. Architecture diagram
(drawn for revision 2, so it still shows the dropped point squares):
https://claude.ai/artifact/XxZuDqdwucvdchQ2pDK9Sc

## Build status (17 September 2026, branch `forecast-data-plan`)

Each piece was built by one agent, reviewed by a second, fixed, then merged.

| Piece | State |
|---|---|
| Keep only the newest run; no raw download cache | built, tested |
| Synthetic sample data; e2e runs from its own `.e2e/` site with a pinned clock and never touches `public/weather` | built, tested |
| R2 publishing: endpoint, delete what a publish supersedes, orphan sweep, "already published" read from the bucket | built against a fake S3; **live R2 test pending** ([setup checklist](CLOUDFLARE_R2_SETUP.md)) |
| Phase 3, binary wind frames (all nine wind adapters, validator, uploader, Caddy, browser) | built, tested; a real GFS import in the worker image produced valid binary frames |
| Phase 2, 15-day dock keyed on time, model band, "Show … on the map" chip, back to now | built, tested |
| Phase 4, bare map point: one model, loaded from now outwards | built, tested |
| Phase 4, more named spots; per-spot files past ~50 spots | not started |
| Phase 0 payload script; Phase 5 smaller wins | not started |

Decisions made while building, where they differ from the text below:

- **Table cells between a coarse map model's steps are interpolated**, by the
  same rule the blend uses, and marked as such ("Between ECMWF's 3-hourly
  steps"). Without this a 6-hourly model on the map printed one value in three
  columns and the table disagreed with the chart.
- **The axis gets a long-range "head" only when the finest run starts after
  now**, so there is a column for now. Otherwise it opens on the finest run and
  there is one seam, as planned.
- **An expired map run answers no cells**, and the band marks expired as well
  as older-than-18 h runs.
- **A binary frame proves its model by where it is filed and what it is
  named**: it must sit under a run directory named for the model, and its file
  name must be the sha256 of its bytes. The header carries run and hour, not
  the model.
- **The delta axis is row**, and brotli quality is 9; both were measured (see
  the format section).

Revision 3 **drops the any-point blend and its "point square" files**. Blend
and Candles stay on named spots, and we add more named spots instead. See
"Decided against" below for the reasons.

Revision 2 folds in an independent review. That review found:

- the ingest validator and Caddy both assume JSON;
- a `selectTime` handler and `timeline.ts` already exist;
- the square sizes in revision 1 left out the overlap;
- ECMWF-ENS members would blow the budget;
- auto-switching the map model on a far click would be a UX trap.

## What we want

1. The dock shows **15 days** whatever model the map is drawing. Later days have
   fewer models, and the dock says so.
2. Blend and Candles stay on **named spots**, and it is cheap to **add more
   spots** so the places people actually ride are covered.
3. The browser downloads **far less data**, on a phone as well as a desktop.
   Clicking a bare map point still shows its forecast, from one model, at about
   a quarter of today's download.
4. It still runs as plain files. No database, no API server, and **no paid
   compute**: the importer runs on our own always-on machine, and the files are
   served from Cloudflare (R2 storage behind the CDN).

## Why it doesn't work today

- The dock's columns are the map model's frames (`src/ForecastDock.tsx:355`,
  `axis = manifest.frames`). HARMONIE ends at +60 h, so the dock does too.
- The blend reads only the precomputed `spotForecasts` in each manifest
  (`src/useBlend.ts`). A map point has none, so Blend/Candles are disabled
  (`chartUnavailable`, `ForecastDock.tsx:504`).
- A map point's series is sampled by downloading **every frame** of the map
  model, two at a time (`src/usePointSeries.ts`). Frames are whole-Ireland JSON
  grids.

## Measured sizes (real files, 17 September runs)

| File                          | JSON   | JSON gzip (sent before) | int16 + row delta, brotli       |
| ----------------------------- | ------ | ----------------------- | ------------------------------- |
| HARMONIE frame, 54,988 points | 926 KB | 225 KB                  | **71 KB** (62 KB at quality 11) |
| ECMWF frame, 3,645 points     | 62 KB  | 20 KB                   | **8 KB**                        |

The brotli column is what Phase 3 actually shipped, at quality 9; quality 11
reaches the 62 KB this table first promised but costs eleven times the encode
time, which the ingest budget does not have. See "The new file format" for the
full comparison.

| What the visitor does                             | Today                                                     | After this plan                                                  |
| ------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| Open a named spot (table, Blend, Candles)         | 0 extra (series are in the manifests)                     | 0 extra                                                          |
| Click a bare map point (table from the map model) | ~10 MB (3-hourly HARMONIE); ~14 MB (hourly, as scheduled) | **~3.8 MB** hourly HARMONIE, useful after ~1.3 MB; ~0.6 MB ECMWF |
| Scrub one HARMONIE time step                      | 225 KB                                                    | **71 KB** (measured)                                             |

### Disk space on the server

A download is small, but the server holds **every frame of every run** until
`prune.py` removes it. HARMONIE runs **hourly** in production
(`deploy/local/jobs.toml`), 61 frames a run, and retention used to be 48 h with
a daily sweep, so about 48 runs sat on disk at once.

A superseded run is never shown again, so **nothing old is kept** past the
hour readers may still hold its pointer. As soon as a new run has fully arrived
and passed validation, the worker prunes (`worker.py`, `drop_superseded`),
under the same lock every import holds, so a run that is still being written is
never touched; the run it replaced is named under the new pointer's
`superseded` and kept for an hour, and the hourly `prune` job deletes it after
that and ages the raw cache (docs/TILING_DESIGN.md, "As built: the fix pass"). A browser tab that asks
for a frame of a deleted run loads the newest run at the same time instead of
showing an error (`App.tsx`, `loadNewerRun`). One run per model is on disk:

| HARMONIE on disk                  | One run (now)        | 48 h kept (before) |
| --------------------------------- | -------------------- | ------------------ |
| Today, JSON                       | 61 × 926 KB ≈ 56 MB  | ≈ 2.7 GB           |
| This plan: `.bin` + `.br` + `.gz` | 61 × ~480 KB ≈ 29 MB | ≈ 1.4 GB           |

Raw downloads (the whole-domain source files, about 2 GB for one ECMWF-ENS
run) are **not kept either**. The worker deletes a model's downloads as soon as
its job ends (`drop_downloads`); a failed job downloads afresh. Because nothing
is cached, every forecast importer first asks whether the run it would import
is already published (`readsPublishedRun` in `registry.py`) and downloads
nothing if it is: a slot that fires before its source has a newer run costs a
listing, not an import. Tides and sea temperature are the exceptions, because
their run label cannot say whether anything is new.

## What we learned from Open-Meteo

Repos read: `open-meteo/om-file-format`, `typescript-omfiles`,
`weather-map-layer`, `maps` (cloned 17 September 2026).

- **OM files**: arrays are stored as int16 (value × scale factor), chunked,
  delta-encoded in 2D and packed with a fast integer codec (TurboPFor `vp4`).
  A lookup table at the end of the file lets a reader fetch only the chunks it
  needs with HTTP range requests.
- **Their map** (`weather-map-layer`) is a MapLibre `addProtocol('om', …)`
  handler. Web workers read the chunks for the tiles on screen. Their spatial
  files are **one file per time step, global, all variables** (ICON: 170 MB per
  file). Range reads are what make that usable.
- **Point forecasts** on their site come from their server API, not from these
  files.
- **Licence: GPL-2.0-only** for everything. The WASM reader is 2.1 MB (196 KB
  gzip).

**Decision: we don't use Open-Meteo at all.** Our data comes straight from
Met Éireann, DWD, NOAA and ECMWF. Nothing from Open-Meteo is installed, called
or depended on. We only borrow ideas from their design, and write our own code.

Why we don't adopt their format either:

- Range reads into global files solve a problem our Ireland-cropped frames don't
  have.
- The WASM reader alone (196 KB) costs more than three HARMONIE frames.
- Our own format is ~60 lines of numpy and ~60 lines of TypeScript, with no WASM.

Revisit OM files if we go beyond Ireland or add many variables per frame.

## The new file format

**Built, September 2026.** Wind frames only: wave and weather frames stay JSON.
The encoder and the layout are documented in `force5/ingest/f5bin.py`; the
readers are `force5/src/f5bin.ts` (browser) and `scripts/f5bin.mjs` (Node, for
the sample generator).

Frames use one encoding, "F5 int16":

- Little-endian `Int16Array`. Value = round(x × 10), i.e. 0.1 m/s. Measured
  better than ×100, and the display rounds to whole knots.
- **Rounding is half away from zero**, written out as
  `floor(abs(x × 10) + 0.5) × sign(x × 10)` on every side. It is not numpy's
  `round` (half to even, so 2.5 → 2) and not JavaScript's `Math.round`
  (half towards +∞, so -0.5 → -0). 0.05 m/s encodes to 1 and -0.05 m/s to -1
  everywhere.
- Missing value = `-32768`.
- **Delta encoding uses wrapping int16 arithmetic**, so a missing value can
  never overflow:
  - Python: `((current - previous + 32768) & 0xFFFF) - 32768`;
  - TypeScript: `((prev + d) << 16) >> 16`.
    A delta of exactly -32768 is an ordinary delta, not a second marker: only a
    _reconstructed_ value of -32768 is missing.
- The decoder still range-checks values (±150 m/s, gust ≥ 0), as `validateFrame`
  does today. A wind frame has never been allowed a hole, so a missing value
  decodes to `NaN`/`None` and `validateFrame` refuses it exactly as it refused a
  JSON `null`. The marker exists so the format can carry a field that does have
  holes later.
- **Delta axis: row** (west to east, stride 1), fixed, not per frame. Measured on
  the real runs of 17 September 2026, brotli 11, eight frames per model:

  | Model                 | row Δ + br | column Δ + br | column vs row |
  | --------------------- | ---------- | ------------- | ------------- |
  | HARMONIE (54,988 pts) | 62,025 B   | 60,229 B      | −2.9%         |
  | ICON-EU (56,817 pts)  | 76,965 B   | 79,971 B      | +3.9%         |
  | ECMWF (3,645 pts)     | 6,912 B    | 7,412 B       | +7.2%         |
  | GFS (3,645 pts)       | 6,962 B    | 7,176 B       | +3.1%         |

  Column delta wins only on HARMONIE, and loses on the other three; over all
  four it is 1.6% larger. Revision 3 guessed the other way from a partial
  measurement. Delta encoding itself is worth 19% against no delta at all.

- No compression inside the file. The job writes `name.bin` plus precompressed
  `name.bin.br` and `name.bin.gz` sidecars, for the local Caddy deployment. The
  bucket stores one encoding per object instead (see Phase 1), and
  `FORCE5_SIDECARS=0` stops a bucket-only job writing sidecars it will never
  serve.
- **Brotli quality 9** (`FORCE5_BROTLI_QUALITY` overrides it; 0–11, and a value
  outside that range fails the job with a sentence naming the variable rather
  than a traceback out of every adapter). Higher qualities are not worth their
  cost here:

  | Quality | HARMONIE frame | vs q9 | Encode + compress | vs the JSON it replaces |
  | ------- | -------------- | ----- | ----------------- | ----------------------- |
  | 9       | 70.7 KB        | —     | 37.2 ms           | ×0.99                   |
  | 10      | 64.3 KB        | −9%   | 173 ms            | ×4.4                    |
  | 11      | 62.0 KB        | −12%  | 444 ms            | ×11                     |

  Larger windows (`lgwin` 24, `lgblock` 24) buy nothing at q9.

- **Each frame is compressed once, for the destination it has.** The first
  version of this got that wrong: the adapter wrote a `.br` sidecar and the
  uploader then brotli'd the same bytes again at the same quality, so a job that
  both served locally and uploaded paid for brotli twice. The uploader now reuses
  the sidecar — after decompressing it and confirming it is exactly these bytes,
  because reuse is only safe when it is checked rather than trusted, and a
  decompress is about half a millisecond against nineteen for a compress. Per
  HARMONIE frame, against the 37.7 ms the JSON path spent hashing and serialising
  the same frame:

  | Job                                   | Work per frame                  | Cost    | vs the JSON it replaces |
  | ------------------------------------- | ------------------------------- | ------- | ----------------------- |
  | Local serving only                    | encode + br + gz                | 37.2 ms | ×0.99                   |
  | Local **and** bucket, before this fix | encode + br + gz + **br again** | 53.3 ms | ×1.41                   |
  | Local **and** bucket, now             | encode + br + gz + verify       | 37.7 ms | ×1.00                   |
  | Bucket only, `FORCE5_SIDECARS=0`      | encode + br                     | 18.9 ms | ×0.50                   |

  ICON-EU's frames are a little larger and land at ×1.14 for a local-and-bucket
  job; ECMWF's are small enough to be noise. These are the cost of the
  frame-publishing step alone, which is a small part of a job otherwise spent
  downloading a few hundred GRIB files and decoding them.

- File names keep the content hash — now the sha256 of the frame's own bytes,
  which include the header and therefore the run and the hour — so they stay
  immutable.
- Precision note: `spotForecasts` stay at 0.01 m/s, sampled from the
  full-precision field. Frames at 0.1 m/s can differ from them by up to 0.05 m/s
  after a bilinear sample, plus 0.005 for each rounding to hundredths. That is
  invisible in knots, but every frame-against-series comparison needs a
  tolerance of 0.06 **when the manifest is binary and only then**:
  `backfill_spots.BINARY_TOLERANCE` and `tests/snapshot.test.ts`.

### What it actually saved

Per frame, measured over eight frames of each model's 17 September run:

| Model    | JSON   | JSON gzip (sent before) | bin    | bin + brotli q9 | bin + gzip |
| -------- | ------ | ----------------------- | ------ | --------------- | ---------- |
| HARMONIE | 851 KB | 235 KB                  | 316 KB | **70.7 KB**     | 74.9 KB    |
| ICON-EU  | 921 KB | 268 KB                  | 341 KB | **88.6 KB**     | 93.4 KB    |
| ECMWF    | 55 KB  | 18.4 KB                 | 21 KB  | **8.0 KB**      | 8.5 KB     |
| GFS      | 58 KB  | 17.9 KB                 | 22 KB  | **7.8 KB**      | 8.4 KB     |

A HARMONIE scrub step is 3.3× smaller than the gzipped JSON it replaces, inside
the ≤ 80 KB budget under "Done when". A whole hourly HARMONIE run is about
4.3 MB over the wire instead of 14 MB.

### Frame file (`HHH-hash.bin`)

A 24-byte header, then one block per variable present:

```
0   4  magic "F5F1"
4   1  version        (1)
5   1  blockCount     (2 = u,v; 3 = u,v,gust)
6   2  width          uint16
8   2  height         uint16
10  2  scale          (10)
12  2  hour           uint16, forecast hour
14  4  run            uint32, YYYYMMDDHH as a decimal number
18  6  reserved       (zero; every reader refuses a frame that uses them)
24  …  u, v[, gust] blocks: width × height int16 each
```

The header length is even because the browser views the payload as an
`Int16Array` at that offset, and an odd offset throws. There is no `deltaAxis`
field: the axis is fixed at row, so a file cannot disagree with its readers
about it.

**The header carries the run identity.** `validateFrame` and the Python
validator have always refused a frame whose model, run, hour, valid time or grid
did not match its manifest. A header cannot hold all of that, so it holds what
makes a file from the wrong run or the wrong step recognisable on its own — the
run, the forecast hour and the grid size — each refused with the message it
always produced.

**What is checked how, for a binary frame.** Everything else was in the JSON
frame and is not in the binary one, so the checks that used to read it out of the
file have to be made some other way, and it is worth being exact about which:

|                                  | JSON frame  | Binary frame                                                                                                                                                         |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run, hour, grid size             | in the file | **in the header**                                                                                                                                                    |
| model                            | in the file | **the run directory must be named for this model**, by the same rule `prune.model_owns` applies — plus the file name, which must be the sha256 of the bytes it holds |
| valid time, grid geometry        | in the file | the manifest's, whose own run/hour/validTime arithmetic is checked                                                                                                   |
| gust window                      | in the file | the manifest's; what is checked against the frame is whether the gust **block** is present at all                                                                    |
| the bytes are the published ones | uncheckable | **checkable**: the name is a content hash, so a frame swapped for another of the same shape is caught                                                                |

The directory rule is not a nicety. Every wind model's objects live under
`weather/`, so without it a HARMONIE manifest could reference a GFS run's frames
— same run, same hour, same grid — and be accepted; HARMONIE would then upload
objects into GFS's namespace, and GFS's next publish would delete them out from
under a live HARMONIE pointer. The rule is the one the superseded delete and the
bucket sweep already assumed, now enforced where objects are read as well.

**What is still not checked**: that a binary frame's _numbers_ belong to this
model, if a frame is placed under the right model's directory under its own
correct content-addressed name. Closing that would mean putting the model in the
header, which the format deliberately does not do.

### Manifest additions (backwards compatible)

```jsonc
"encoding": "f5-int16-v1",          // absent = today's JSON frames
"frames": [{ "url": "…/000-ab12.bin", … }]
```

Only a wind manifest may declare it; the validator refuses `encoding` on a wave,
weather, tide or observation bundle, and refuses any value it does not know
rather than falling back to reading the file as JSON.

## Implementation phases

Each phase ships on its own, and every phase leaves the site working.

### Phase 0 — Baseline and budget (small)

- `scripts/measure-payload.mjs`: runs Playwright against the built site and
  records bytes for three actions: open the page, scrub 12 steps, click a map
  point.
- Record whether each number is **gzip or brotli**. Browsers only offer `br`
  over HTTPS (Chrome also treats localhost as secure; Safari over LAN http gets
  `.gz`).
- Record today's numbers here and turn "Done when" into an e2e check.

### Phase 1 — Hosting: our machine imports, Cloudflare serves

Revision 3 drops Railway. Paying for a 24/7 container only to run batch jobs
makes no sense when we have an always-on machine (and our own mesh of machines
to orchestrate it later).

- **Importer**: `deploy/local`'s scheduler and worker, on our machine, as today.
  It needs no inbound access from the internet.
- **Storage and serving**: a **Cloudflare R2** bucket on a custom domain, so
  Cloudflare's CDN sits in front of it. R2 speaks the S3 API, so the existing
  `publish_s3.py` uploads to it by pointing boto3 at the R2 endpoint
  (`AWS_ENDPOINT_URL_S3` plus an R2 key). The uploader already validates the
  bundle **before** uploading, which closes the "bad data goes live before it
  is checked" gap for the public site.
- **Website**: the static build on Cloudflare Pages (or the same bucket), built
  with `VITE_FORECAST_BASE_URL` pointing at the data domain.
- **Cost** (prices checked 17 September 2026): R2 charges **nothing for visitor
  traffic**. Free each month: 10 GB stored, 1 million writes, 10 million reads.
  We store well under 1 GB and write roughly 80,000 objects a month, so the
  expected bill is zero. The same traffic on S3 costs $0.09/GB after the first
  100 GB a month.
- **To build**:
  - delete superseded objects from the bucket after a publish (deletes are
    free on R2). Today `publish_s3.py` only adds; without this the bucket
    grows for ever. Same rule as the local disk: keep what the current
    manifests reference, nothing else.
  - check that R2 accepts the conditional `IfNoneMatch="*"` put that
    `put_immutable` relies on.
  - CORS on the bucket for the site's origin, and the cache headers below.
- Cache headers unchanged:
  - hashed files: `immutable, max-age=31536000` (served from Cloudflare's edge
    after the first request);
  - manifests: `max-age=0, must-revalidate`.
- **Compression** (built in Phase 3): `put_immutable` stores a `.bin` frame
  brotli-encoded with `Content-Encoding: br` and JSON gzipped as before, one
  encoding per object, so there are no `.br`/`.gz` sidecars in the bucket.
  `FORCE5_BUCKET_ENCODING=gzip` is the way back. **Still to measure against a
  live bucket**: whether Cloudflare passes a stored `br` body through untouched
  to a browser that asked for it, and what it does for one that did not.
- **Monitoring**: `status.py` already writes freshness; upload
  `weather/status.json` too, so an outside uptime check can alert when the
  importer has stopped. The site itself stays up and keeps showing the last
  forecast if our machine is down.
- **Disk on our machine**: one run per model, and raw downloads are deleted as
  each job ends (`worker.py`, `drop_downloads`), so it stays well under 1 GB.

### Phase 2 — 15-day dock (frontend only)

**Stable columns**

- The dock's column set no longer depends on the map model. It is built by
  `dockColumns(windModels)`, added to the existing `force5/src/timeline.ts`:
  - the finest fresh short-range model's times (HARMONIE, else ICON-EU);
  - then the longest fresh model's times (ECMWF, else GFS);
  - **one seam only**;
  - a model counts unless its run has **expired**
    (`freshness(m) !== "expired"`, `weather.ts:493`). The 18-hour "stale" mark
    does **not** remove a model from the columns: ECMWF only runs at 00/12 UTC
    and lands 8–9 h late, so it is "stale" for about three hours twice a day,
    and gating on it would shrink the dock to GFS's 10 days each time. An
    older run keeps its columns, and the model band labels it "older run".

**Always the newest run**

- Nobody can view a superseded run; it is not a feature. `useRunRefresh` moves
  an open tab to the newest run, and a frame request that fails because its run
  was deleted does the same, silently (done: `loadNewerRun`).
- Still to do in this phase: when a new run is swapped in, or the tab comes
  back into view, and the selected time is **in the past**, the selection
  jumps to now. A time the reader chose in the future is kept.

**The map model's role**

- The map model only decides which columns have a map frame: the map frame
  nearest the column's time, within that model's cadence.
- Selecting a column the map model can't reach keeps the map on its last frame
  and shows a chip: **"Show ECMWF on the map"**. Nothing switches implicitly.
  - The chip calls `chooseModel(id, targetTime)`; `chooseModel` gains the
    `targetTime` argument and stays one atomic commit.
- **The selected time is stored as a time, not a column number.** Today
  `App.tsx` keeps `requestedIndex`, an index into the map model's frames, and
  playback, `useRunRefresh` and `chooseModel` all key on it. With columns from
  two models, an index means different times in different lists. So the state
  becomes `selectedTime` (an ISO valid time); the dock column and the map frame
  index are both **derived** from it, and there is one handler,
  `selectTime(validTime)`.
- `useModelAvailability` moves up from `ForecastDock` to `App`, because the
  column set needs every model's manifest. Until that sweep resolves, the
  columns are the map model's frames; the selection survives the change
  because it is a time.

**Cells and chart**

- For a **named spot**, every table cell has a value. Cells past the map model
  are filled from the owning model's `spotForecasts`, which are already in the
  manifests, so this costs no download.
- A **bare map point** has no precomputed series. See Phase 4 for what it shows.
- A thin model band in the header, like the day band, shows who owns each
  stretch.
- The chart shows the number of models per stretch. The band is drawn dashed
  where fewer than 3 models contribute, instead of looking confidently narrow.

**Code that must take columns instead of frames**

- `timeX` / `framePosition` (`ForecastDock.tsx:281`)
- `sliderMax` / `sliderValue` (`:878`)
- `columnWeights` (`src/chart.ts:68`)
- `dayGroups`, `dayNights`, `ForecastHeader`, `ForecastSheet`
- `windTrackBackground`
- `useSpotWaves`, `useSpotWeather`, `tideValues` (their `axis`)
- `usePointSeries` values (indexed by map-frame index → map through the column's
  frame)

**Tests**

- Unit tests for `dockColumns`:
  - mixed 1/3/6-hour cadences;
  - an expired model excluded; a run older than 18 h still owns its columns;
  - map model not in the column set (e.g. GFS on the map);
  - seam placement.
- Update e2e:
  - `e2e/dock.spec.ts:316` asserts wind cells = HARMONIE frame count;
  - the wave tests around `:461` assume map-model columns.
- New e2e: 15 days with HARMONIE on the map; far column → chip → ECMWF.
- New e2e: a 404 on a frame swaps to the newest run with no error shown; a tab
  returning with a past selection lands on now.

### Phase 3 — Binary frames (ingest, serving, frontend) — **done**

**Ingest**

- `force5/ingest/f5bin.py` provides `encode_frame`, `decode_frame`,
  `read_header`, `write_with_sidecars` (`.bin`, `.bin.br`, `.bin.gz`, each
  replaced atomically) and `publish_frame`, which encodes, names and writes one
  frame and returns the manifest's url.
- Every wind adapter calls `publish_frame` where it used to hash a JSON payload
  and call `write_json`, and adds `"encoding"` to its manifest: harmonie,
  icon-eu (`fetch_forecast.py`), ecmwf, ecmwf-ens, aifs, gfs, gefs,
  harmonie-eps, and arpege/arome through `meteofrance.py`. Ten models, nine
  files, three lines each. Wave and weather adapters are untouched.
- Spot series are still sampled by every adapter from the full-precision field,
  not from the quantised frame, so nothing a reader sees in a table or a chart
  got coarser. The exception is `backfill_spots.py`, which adds a series to a run
  whose source data is gone and so has only the published frames to resample: a
  backfilled series can sit up to 0.06 m/s from what a fresh ingest would have
  produced, and the next run replaces it with the exact one.
- New dependency: pip `brotli`, in `requirements.txt` because the fetch scripts
  need it, not only the worker.

**Validator** (`publish_s3.py`)

- `validate_wind_bundle` branches on `manifest.encoding` through `wind_frame()`,
  which decodes a binary body, checks the run, the hour and the grid size from
  the header and fills the rest from the manifest. The cadence, value-range,
  grid-size, gust-availability and horizon checks all run unchanged; the model
  and the gust window are checked differently, because a binary frame carries
  neither — see "What is checked how, for a binary frame" above.
- `referenced()` now requires every object a manifest points at to sit under a
  run directory **named for that model**, for JSON and binary alike, closing the
  cross-model hole described above. Every adapter already names its objects that
  way, and the superseded delete already relied on it.
- `put_immutable` takes the content type and encoding from the key:
  `.bin` is `application/octet-stream` with a brotli body and
  `Content-Encoding: br`, switchable to gzip by `FORCE5_BUCKET_ENCODING` or the
  `encoding=` argument; everything else stays gzipped JSON. The sha256 in the
  object's metadata is still over the **uncompressed** bytes, so the collision
  check compares frames rather than compressors. It reuses the `.br`/`.gz`
  sidecar the adapter already wrote when decompressing it gives back exactly
  these bytes, so a frame is never compressed twice.
- Sidecars are never uploaded: the uploader only ever sees the paths a manifest
  references, and no manifest references a sidecar.

**Other ingest scripts**

- `backfill_spots.py` decodes binary frames and compares with
  `BINARY_TOLERANCE = 0.06` when, and only when, the manifest is binary.
- `prune.py` needed no change: the sweep keeps or removes a whole run directory,
  so sidecars live and die with their run. There is now a test that says so.
- `test_contract.py` has binary bundle cases: wrong run, wrong hour, wrong grid,
  truncated, oversized, foreign bytes, out-of-range values, the gust rules, an
  unknown encoding, and `encoding` on a non-wind bundle.

**Caddy** (`deploy/local/Caddyfile`)

- `/weather/*` no longer forces `application/json` on everything: `@json` and
  `@bin` matchers type them separately, and `@bin` is
  `application/octet-stream`.
- `file_server { precompressed br gzip }` sits inside the `@immutable` handle.
- Verified, not reasoned about: `caddy validate` passes, and a `caddy:2-alpine`
  container serving a real frame answers `Content-Encoding: br` (131 B) to
  `Accept-Encoding: br, gzip`, `gzip` (151 B) to gzip alone, and the plain
  596-byte file to `identity`, all as `application/octet-stream` with the
  immutable cache header, while manifests still answer as JSON with
  `must-revalidate`.

**Frontend**

- `force5/src/f5bin.ts`: `decodeFrame(buffer, manifest, info)` returns today's
  `Frame`, so `WindMap`, `sample()` and the particle layer are unchanged.
- `loadFrame` picks the JSON or binary path from `manifest.encoding`;
  `validateManifest` refuses an encoding it does not know.
- `decodeFrame` checks the run and the hour the header carries and then hands
  the frame to `validateFrame`, which applies every rule it always did.

**Migration**

- `scripts/sample-weather.mjs` writes binary wind frames through
  `scripts/f5bin.mjs`. ARPEGE stays JSON so the readers' legacy path keeps a
  fixture; move it over when JSON frame support is dropped.
- The committed fixtures fell from 151 JSON frames to 827 KiB in total.
- The frontend keeps reading JSON manifests without `encoding` for one release.

**Tests**

- `tests/fixtures/f5bin/golden.bin` and its `golden.json`, decoded by
  `force5/ingest/test_f5bin.py` and `tests/f5bin.test.ts` and re-encoded through
  `scripts/f5bin.mjs`, so all three implementations are pinned to one another.
  The golden carries a missing value inside a delta run, both wrap-around
  directions, halves in both signs, both ends of the range and a zero gust.
- A wrong hour, a wrong run, a wrong grid, truncated and oversized buffers and a
  newer format version are each refused, in both languages.

### Phase 4 — Map points stay, one model at a time; more named spots

**A click on a bare map point**

- Any point on the map still gets its forecast table, automatically, as today.
  It comes from **the model the map is showing**, one model at a time; pick
  another model and the table reloads from that one.
- Why not the blend: a named spot's series for every model is precomputed and
  sits in the manifests, so its blend costs nothing. A bare point has no
  precomputed series. The app has to read the value at that point out of each
  map file, one file per time step, so one model is 61 files for hourly
  HARMONIE, and a blend would be that for every model at once. Blend, Candles,
  waves, weather and tide therefore stay named-spot-only.
- Make the one-model load cheap instead of removing it:
  - binary frames (Phase 3) take hourly HARMONIE from about 14 MB to about
    3.8 MB, ECMWF's 85 frames to about 0.6 MB, and the files are immutable, so
    scrubbing afterwards reads them from the browser cache;
  - load **from now outwards** rather than from the first frame, and for an
    hourly model load every third hour first, then fill in the rest, so the
    table is useful after about a third of the download;
  - stop at once when the reader picks another point or model (already done).
- Past the map model's range (HARMONIE ends at +60 h) a bare point's cells are
  empty, and the "Show ECMWF on the map" chip from Phase 2 is how the reader
  gets the long range for that point.

**Adding spots**

- A spot is one entry in `public/riding-locations.json`. Every adapter computes
  its series at ingest. The file is baked into the worker image
  (`force5/Dockerfile`), so adding a spot means a redeploy.
- `backfill_spots.py` fills the deterministic runs already published, so the
  table and most of the blend work at once. It refuses ensembles (members
  cannot be rebuilt from mean frames), so a new spot gets its ensemble lines
  at the next ENS/GEFS run, within about 12 hours.
- Cost of a spot: about 7 KB raw (1 KB gzip) in each deterministic manifest
  (`ecmwf.json` is 180 KB for 25 spots). Ensemble `spotMembers` are much
  heavier: 51 members × 85 steps is roughly 80 KB raw per spot in the
  ECMWF-ENS manifest. Phase 0 measures the real figures.
- Manifests are fetched on page load and revalidated every five minutes, so
  they must not grow without limit. **Past about 50 spots**, move the series
  out of the manifests into one small hashed file per spot per run
  (`<run>/spots/<id>.json`), fetched when the spot is opened. The manifest
  keeps only the list of spot ids. Until then, nothing changes.
- Tests: a new spot appears in every model's manifest after one run;
  `backfill_spots.py` agrees with a fresh ingest within tolerance.

### Phase 5 — Smaller wins (optional, after measuring)

- While dragging the scrubber, fetch frames only when the thumb pauses (about
  150 ms); still prefetch the next frame.
- Lower-resolution frames for zoomed-out views, if Phase 0 shows first map paint
  is the slow part.

## Done when

- The dock shows 15 days with any map model, the columns don't move when the
  map model changes, and the map changes model only when the reader asks.
- A named spot shows all 15 days, Blend and Candles with no download beyond
  the manifests. Adding a spot is one JSON entry plus a backfill.
- Budgets (Phase 0 script, **brotli over HTTPS**; gzip allowances in brackets):
  - click a bare map point with hourly HARMONIE on the map ≤ 4.5 MB in total,
    first useful table (every third hour) ≤ 1.5 MB;
  - one HARMONIE scrub step ≤ 80 KB (≤ 100 KB);
  - first page load of forecast data ≤ 150 KB (≤ 200 KB), excluding the
    basemap.
- Ingest time per model grows by no more than 10%.
- The volume stays under the limit set in Phase 1, with published runs and
  `.cache` reported separately by `status.py`.
- All existing unit, ingest and e2e tests pass, updated where the column model
  changed, plus the new tests listed per phase.

## Risks and open questions

- **Compression through Cloudflare**: the uploader stores binary frames
  brotli-encoded and the local Caddy deployment serves `.br`/`.gz` sidecars —
  the Caddy half is verified against a real container, the R2 half is not, for
  want of a bucket. A CDN that re-encoded or stripped `Content-Encoding: br`
  would be caught by the first browser that loaded a frame; the fallback is one
  environment variable.
- **Our machine is the only importer.** If it is down the site stays up but the
  forecast ages. The mesh of machines is the later answer. It needs its own design: the
  worker lock is a file lock on one machine, so two importers must be told
  which of them owns which model.
- **The seam** between the short-range and long-range model can show a jump.
  The model band makes it visible rather than hiding it.
- **Manifest growth** as spots are added. Ensemble member series are the heavy
  part; the per-spot files in Phase 4 are the answer once it matters.
- **Snapshot regeneration** (99 MB) touches git history size; consider moving
  bundled snapshots out of git at the same time.

## Decided against: any-point blend (revision 2's point squares)

Revision 2 cut Ireland into small squares and wrote, for every model run, one
file per square holding every time step, so Blend and Candles could work at any
clicked point. We dropped it:

- **Disk**: the squares store the whole grid a second time with overlap, in
  three copies. HARMONIE alone went from about 1.4 GB to about 4.8 GB at 48 h
  retention, and about 1,500 files per hourly run.
- **The ensemble maths had no good answer.** ECMWF-ENS members were too big for
  a square, and the quantile summary that replaced them cannot be pooled with
  the other models the way `blendStats` works, so a map point beside a named
  spot would have shown a different band from the spot itself.
- **Two whole phases of work**, plus validator, prune and status changes.
- **People ride at known places.** A named spot is already instant and already
  has waves, weather and tide, which a map point never would. Adding a spot is
  one JSON entry.

Revisit only if readers ask for forecasts at places that cannot sensibly be
named spots.
