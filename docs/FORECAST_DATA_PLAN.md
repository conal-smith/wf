# Forecast data plan: smaller downloads, 15-day dock, more named spots

Status: reviewed draft, revision 3, 17 September 2026. Architecture diagram
(drawn for revision 2, so it still shows the dropped point squares):
https://claude.ai/artifact/XxZuDqdwucvdchQ2pDK9Sc

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
   Clicking a bare map point costs nothing unless the reader asks for more.
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

| File | JSON | JSON gzip (sent today) | int16 + delta, brotli |
|---|---|---|---|
| HARMONIE frame, 54,988 points | 926 KB | 225 KB | **62 KB** |
| ECMWF frame, 3,645 points | 62 KB | 20 KB | **7 KB** |

| What the visitor does | Today | After this plan |
|---|---|---|
| Open a named spot (table, Blend, Candles) | 0 extra (series are in the manifests) | 0 extra |
| Click a bare map point | ~10 MB (3-hourly HARMONIE); ~14 MB (hourly, as scheduled) | **0** (reads the frame already on screen); ~3.8 MB only if the reader asks for the full series |
| Scrub one HARMONIE time step | 225 KB | **~62–80 KB** |

### Disk space on the server

A download is small, but the server holds **every frame of every run** until
`prune.py` removes it. HARMONIE runs **hourly** in production
(`deploy/local/jobs.toml`), 61 frames a run, and retention used to be 48 h with
a daily sweep, so about 48 runs sat on disk at once.

A superseded run is never shown again, so **nothing old is kept**. As soon as
a new run has fully arrived and passed validation, the worker deletes the run
it replaced (`worker.py`, `drop_superseded`), under the same lock every import
holds, so a run that is still being written is never touched. The hourly
`prune` job is only a backstop and ages the raw cache. A browser tab that asks
for a frame of a deleted run loads the newest run at the same time instead of
showing an error (`App.tsx`, `loadNewerRun`). One run per model is on disk:

| HARMONIE on disk | One run (now) | 48 h kept (before) |
|---|---|---|
| Today, JSON | 61 × 926 KB ≈ 56 MB | ≈ 2.7 GB |
| This plan: `.bin` + `.br` + `.gz` | 61 × ~480 KB ≈ 29 MB | ≈ 1.4 GB |

Raw downloads (the whole-domain source files, about 2 GB for one ECMWF-ENS
run) are **not kept either**. The worker deletes a model's downloads as soon as
its job ends (`drop_downloads`); a failed job downloads afresh. Because nothing
is cached, the two importers that are scheduled more often than their source
publishes (`ecmwf` hourly, `ecmwf-ens` twice per run) first ask whether the run
is already published (`already_published`) and download nothing if it is.

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

Frames use one encoding, "F5 int16":

- Little-endian `Int16Array`. Value = round(x × 10), i.e. 0.1 m/s. Measured
  better than ×100, and the display rounds to whole knots.
- Missing value = `-32768`.
- **Delta encoding uses wrapping int16 arithmetic**, so a missing value can
  never overflow:
  - numpy: `np.diff(...).astype(np.int16)`;
  - TypeScript: `((prev + d) << 16) >> 16`.
- The decoder still range-checks values (±150 m/s), as `validateFrame` does
  today (`force5/src/weather.ts:425-455`).
- Delta axis: row or column, whichever measures smaller (the review measured
  column delta about 3% smaller on HARMONIE).
- No compression inside the file. The job writes `name.bin` plus precompressed
  `name.bin.br` and `name.bin.gz` sidecars.
- File names keep the content hash, so they stay immutable.
- Precision note: `spotForecasts` stay at 0.01 m/s. Frames at 0.1 m/s can
  differ from them by up to 0.05 m/s. That is invisible in knots,
  but any byte-for-byte comparison must use a tolerance (see
  `backfill_spots.py`).

### Frame file (`HHH-hash.bin`)

A 16-byte header, then one block per variable present:

```
0   4  magic "F5F1"
4   2  width          6   2  height
8   1  blockCount     (2 = u,v; 3 = u,v,gust)
9   1  deltaAxis      (0 = row, 1 = column)
10  2  scale (10)
12  2  hour           (forecast hour; keeps today's "file matches run" check)
14  2  reserved
16  …  u, v[, gust] blocks: width × height int16 each
```

Everything else (grid, valid time, gust window) stays in the manifest.

### Manifest additions (backwards compatible)

```jsonc
"encoding": "f5-int16-v1",          // absent = today's JSON frames
"frames": [{ "url": "…/000-ab12.bin", … }]
```

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
- **Compression**: the uploader stores each object gzip-encoded today. With
  binary frames, measure a brotli-encoded upload against gzip through
  Cloudflare; one encoding per object, so no `.br`/`.gz` sidecars in the bucket.
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
- A **bare map point** has no long-range series. See Phase 4 for what it shows.
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

### Phase 3 — Binary frames (ingest, serving, frontend)

**Ingest**

- `force5/ingest/f5bin.py` provides:
  - `encode_frame`, `decode_frame`;
  - `write_with_sidecars`, which writes `.bin`, `.br` (pip `brotli`) and `.gz`.
- A shared `publish_frame()` so each wind fetch script changes by a line or two.

**Validator** (`publish_s3.py`)

- `validate_wind_bundle` (`:105-165`) `json.loads` every frame. Branch on
  `manifest.encoding` and use `decode_frame`.
- `put_immutable` (`:464-469`) hard-codes `application/json` + gzip. Pass the
  content type, and upload the sidecar bytes with the matching
  `Content-Encoding`.

**Other ingest scripts**

- `backfill_spots.py` (`:39-48`) reads JSON frames and compares with
  `TOLERANCE = 0.005`. It must decode binary and use a tolerance ≥ 0.05. It stays:
  it is how a newly added spot gets a series in runs already published.
- `prune.py` already keeps whole referenced run directories (`:63-77`), so
  sidecars survive with their run. It needs no change, only a
  test.
- `test_contract.py`: binary bundle cases.

**Caddy** (`deploy/local/Caddyfile`)

- Today `/weather/*` is forced to `application/json` (`:26`), and `encode`
  (`:14`) only compresses its default content types.
- Add an `@bin path *.bin` rule setting `Content-Type application/octet-stream`.
- Put `file_server { precompressed br gzip }` inside the `@immutable` handle
  only.
- Check the headers with `curl -H 'Accept-Encoding: br'`.

**Frontend**

- `force5/src/f5bin.ts`: `decodeFrame(buffer, manifest, info)` returns today's
  `Frame` shape, so `WindMap`, `sample()` and the particles stay unchanged.
- `loadFrame` picks the JSON or binary path from `manifest.encoding`.
- Validation matches today's, including the `hour` check.

**Migration**

- The bundled snapshots are 99 MB, 275 files in git, copied by the compose
  `seed` step. Regenerate them in binary in the same change, then drop JSON
  frame writing.
- The frontend keeps reading JSON manifests without `encoding` for one release.

**Tests**

- A shared golden file decoded by Python and TypeScript.
- A missing value inside a delta run.
- A wrong `hour` is rejected.

### Phase 4 — Map points cost nothing, and more named spots

**A click on a bare map point**

- Today it downloads every frame of the map model (`src/usePointSeries.ts`).
  That stops being automatic.
- The click reads the wind at that point from the **frame already on screen**
  (`sample()`), which is 0 bytes, and the dock offers the **nearest named
  spot** with its distance: "Dollymount, 3 km — open".
- A button, "Load this point's forecast", runs today's every-frame sampling for
  readers who really want it (about 3.8 MB for hourly HARMONIE in binary). It
  covers the map model's range only. Blend, Candles, waves, weather and tide
  stay named-spot-only.

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
  - click a bare map point: 0 bytes of forecast data;
  - one HARMONIE scrub step ≤ 80 KB (≤ 100 KB);
  - first page load of forecast data ≤ 150 KB (≤ 200 KB), excluding the
    basemap.
- Ingest time per model grows by no more than 10%.
- The volume stays under the limit set in Phase 1, with published runs and
  `.cache` reported separately by `status.py`.
- All existing unit, ingest and e2e tests pass, updated where the column model
  changed, plus the new tests listed per phase.

## Risks and open questions

- **Compression through Cloudflare**: brotli-encoded objects against gzip, to
  be measured in Phase 1. The local Caddy deployment keeps the `.br`/`.gz`
  sidecars; the bucket gets one encoding per object.
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
