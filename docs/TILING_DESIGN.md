# Tiling design: map frames and spot data that scale past Ireland

Status: draft for review, 11 October 2026. Spot squares, run directories and
the version 2 pointer (decisions 4–6) are built, and so is the blend per square
(step 5); where the build differs from the design is under "As built" at the
end. The tiles are not built yet.

## Why

Today every map frame is one file covering a model's whole box. Every model
manifest also carries every spot's full series. At Ireland scale that works.
Beyond Ireland it does not:

- A HARMONIE frame is 72 KB brotli for 233×236 cells. ECMWF over Europe
  would be about 40× that per frame, and over the globe about 300×. The
  phone would download all of it to show the screen it is looking at.
- The manifests are already 0.25–3.3 MB raw (34–375 KB gzip). That is 97%
  spot data for 146 spots, and it is fetched on every page load and
  revalidated every five minutes. A thousand spots would make each manifest
  7× bigger.
- Zoomed out to the whole of Ireland on a phone, the map downloads more
  detail than the screen can show. Each HARMONIE cell is under 2 screen pixels
  across there, and the wash only samples every 5 px.

The fix is the standard one for gridded data on the web: a **tile pyramid**.
The data is cut into fixed tiles at several resolutions, and the map fetches
only the tiles in view at the resolution the zoom needs. Spot data moves out
of the manifests into small files keyed by location.

The site has not published to R2 yet, so this is the cheapest moment to
change the format. Afterwards it would be a migration on a live site.

## What others do

- **Display tiles (OpenStreetMap, Google, Mapbox, MET Norway's Yr maps).**
  These use Web Mercator z/x/y "slippy" tiles. Yr's wind tiles are images
  with u and v packed into the red and green channels at 0.5 m/s steps, and
  each model run is a new versioned tileset. The old tileset stays available
  for at least 45 minutes after a new one appears.
  ([Yr dataset concepts](https://client.yr-maps.met.no/concepts))
- **Analysis-ready gridded data (Cloud-Optimized GeoTIFF, Zarr, Open-Meteo's
  OM files).** These keep the model's own grid, cut it into fixed chunks
  (typically 256 or 512 cells), and add **overviews**: the same grid averaged
  2×2, 4×4 and so on. A reader fetches just the chunks it needs at the level
  it needs. Open-Meteo's map reads its int16, delta-encoded chunks this way
  (FORECAST_DATA_PLAN.md, "What we learned from Open-Meteo").
- **Windy** ties its maximum overlay zoom to the model's resolution and
  interpolates between grid points above that
  ([Windy community](https://community.windy.com/topic/19991/increase-web-app-zoom-level-where-weather-overlays-are-displayed)).
  Its tile format is not documented.
- **Archives in one file (PMTiles).** One file per tileset, read by HTTP
  range. We already use this for bathymetry and foil depth. Protomaps
  recommends R2 for it, but range reads are harder for a CDN to cache than
  whole files ([Protomaps](https://docs.protomaps.com/pmtiles/cloud-storage)).

## The decisions

### 1. Tile each model's own grid with overviews (COG-style), not Web Mercator

The tiles cut the model's own regular lat/lon grid. Each tile is **128 × 128
cells**. Above the native level sit overview levels, each averaged 2×2 from
the one below, until a single tile covers the model's whole domain.

Tiles per frame for today's boxes, on the global lattice of decision 2:

| Level | Cell size | HARMONIE (0.025° × 0.02°) | ICON-EU (0.0625°) | ECMWF / GFS (0.25°) |
|---|---|---|---|---|
| 0, native | 1× | ~2 km, 3×3 tiles | ~7 km, 3×3 tiles | 2 tiles (the box crosses a tile edge at 58° N) |
| 1 | 2× | 2×2 | 2×2 | 1 |
| 2 | 4× | 1 | 2 | — |
| 3 | 8× | — | 1 | — |

Why not Web Mercator tiles:

- **Resampling.** Reprojecting into Mercator interpolates every value once
  more, on top of the bilinear sample the map already does. The values in a
  tile would no longer be the model's own grid values, which the dock, the
  blend and verification all read.
- **No gain for our renderer.** The wind layer is our own canvas code. It
  samples the field with `sample(lat, lon)` and does not use MapLibre's raster
  sources. Mercator tiles would only help a MapLibre raster layer.
- **Wasted cells.** Mercator tiles over-sample high latitudes. The model grid
  is already regular in lat/lon.

Why 128 cells rather than 256:

- At Ireland scale one 256-cell HARMONIE tile is the whole country, so tiling
  would save nothing.
- With 128, a phone zoomed in on a coast needs one or two native HARMONIE
  tiles. That is about 22–45 KB, against 72 KB for the whole frame today.
  (At today's 1.3 bytes a cell after brotli, a 130 × 130 tile is about 22 KB.)
- The tile size is a manifest field per model, so a model can use 256 later
  without a format change.

All tile sizes in this doc are estimates from the measured whole-frame
compression. The prototype measures them for real (see "Done when").

### 2. One global lattice per model, so keys never change as coverage grows

Tile (x, y) at level k is anchored to a global origin, not to our crop box:

```
cell = (dx·2^k, dy·2^k)
x = floor((lon + 180) / (128 · cell.dx))
y = floor((90 − lat)  / (128 · cell.dy))
```

Growing from Ireland to the UK, Europe or the globe only **adds tiles**. No
key, URL or client code changes.

Requirement: a model's grid must sit on that lattice, meaning its west and
north edges are whole numbers of cells from −180° and 90°. Every grid we
publish already does:

- HARMONIE −10.9 / 55.7 at 0.025 / 0.02
- ICON-EU −18 / 59 at 0.0625
- ECMWF and GFS at 0.25

The validator will enforce it.

Longitude wraps (x modulo the tiles around the globe), so a global model
crosses the date line without special cases.

### 3. A tile file is the current F5 frame format, cut smaller

Each tile is a binary file in the same format as today's frames:

- **Header:** a 24-byte header with magic `F5T1`, plus level, x and y in the
  bytes that are reserved today.
- **Data:** int16 blocks for u, v and, where present, gust, in 0.1 m/s,
  delta-encoded along each row.
- **Compression:** stored brotli-compressed on R2 and served with
  `Content-Encoding: br`, as now.

Each tile stores a **1-cell border** shared with its neighbours (130 × 130
cells on disk, 128 owned). That lets bilinear sampling and a future WebGL
shader work inside one tile without fetching its neighbour. It costs about 3%.

Why not PNG like Yr:

- 8-bit channels give 0.5 m/s steps. The stars and the dock need 0.1.
- A browser canvas can alter 16-bit PNG values as it decodes them.
- Our int16 plus brotli is already smaller and exact, and the decoder exists
  (`force5/src/f5bin.ts`). Open-Meteo and Mapbox's raster-array tiles make
  the same choice of numbers over images.

How overviews are averaged:

- u and v as a vector mean of the 2×2 cells beneath, ignoring missing cells.
- Gust as a plain mean.
- Overviews are for drawing only. Spot series, the dock and the blend always
  come from the native grid.

The same tile writer takes any number of named blocks. A future wave or
temperature map layer is a new set of blocks, not a new format. (The wave and
weather JSON frames published today are never read by the browser. They
should stop being published until a layer needs them.)

### 4. Separate files per frame, level and tile, in a run directory

```
weather/harmonie.json                                     ← pointer = the run's manifest, a few KB
weather/harmonie-2026101106-61h-v3-1a2b3c4d/t/{level}/{x}/{y}/{hour}.bin
weather/harmonie-2026101106-61h-v3-1a2b3c4d/spots/{square}.json
```

- **Immutable by run directory, not by file hash.** The directory name ends
  in a short hash of everything inside it. A run republished with the same
  content lands in the same directory; changed content lands in a new one.
  Nothing in a directory is ever rewritten (`IfNoneMatch: "*"`, as now), so
  every file in it is cached as `immutable`. The URLs inside follow a
  template, so the manifest does not list them one by one. Each object still
  carries its sha256 in metadata for the collision check.
- **Separate files, not PMTiles.** Each tile is a whole-file GET with
  `immutable` cache headers, which every CDN caches perfectly. A per-run
  archive would mean range reads, harder caching and a rebuilt archive for
  each run.
- **Pruning gets simpler.** Delete the superseded run's directory. No URL
  bookkeeping.

**Request cost.** The estimate is about 850 objects per HARMONIE run (14
tiles × 61 hours) and about 1,200 per ICON-EU run (16 × 73). All live models
come to roughly 130,000 writes a month, inside R2's free 1 million Class A
operations. A global ECMWF would add about 100 tiles per frame, roughly
500,000 writes a month, which is still free or a few dollars.

### 5. The pointer is still the manifest, now a few KB

The pointer stays where it is (`weather/<model>.json`) and stays the whole
manifest, as today. A separate manifest file would cost every page load a
second round trip. Without the spot series it is a few KB, so revalidating
it every five minutes is cheap.

```jsonc
{
  "schemaVersion": 2,
  "model": "harmonie", "run": "2026101106", "runTime": "…", "resolutionKm": 2.5,
  "base": "harmonie-2026101106-61h-v3-1a2b3c4d/",
  "grid": { "west": -10.9, "north": 55.7, "dx": 0.025, "dy": 0.02, "width": 233, "height": 236, … },
  "tiles": {
    "size": 128, "border": 1, "encoding": "f5-tile-v1", "blocks": ["u", "v", "gust"],
    "url": "t/{level}/{x}/{y}/{hour}.bin",
    "levels": [ { "level": 0, "x": [52, 54], "y": [13, 15] }, { "level": 1, "x": [26, 27], "y": [6, 7] }, { "level": 2, "x": [13, 13], "y": [3, 3] } ]
  },
  "frames": [ { "hour": 0, "validTime": "…", "gustIntervalHours": 1 }, … ],
  "spots": { "squareDegrees": 2, "url": "spots/{square}.json", "squares": ["n52w010", "n54w008", …] }
}
```

`base` and the templates are relative to the pointer's own directory.

### 6. Spot data moves into 2° spot squares

Each model run writes its spot series (`spotForecasts`, `spotSeries`,
`spotMembers`) into one file per 2° × 2° square. The square is named by its
south-west corner on even degrees, the way SRTM elevation tiles are named
(`n52w010` covers 52–54° N, 10–8° W). A spot's square is computed from its
own coordinates, by the same rule in Python and TypeScript.

Ireland's spots fall in about eight squares.

| Reader | What it fetches |
|---|---|
| A spot page | One square per model, roughly 15 KB gzip each against up to 375 KB for a manifest today |
| Readers that need every spot (the blend, the browser's own blend when a reader picks their own models) | Every square the manifest lists, through one loader that takes a list of squares |

The loader that takes a list of squares is the primitive that later lets the
map load only the squares in view.

The split happens in one place, at publish. The adapters keep building the
full manifest in memory, and the shared writer moves the spot data out into
squares. So every adapter, retired ones included, gets it for free.

The same key carries everything else spot-shaped as it grows:

- **The blend.** The map's star lights come from `blend.json`, which holds
  every spot. It becomes one blend file per spot square, and the map loads
  the squares in view.
- **The spot list.** `spots.json` splits by square once it reaches a few
  thousand spots. Until then it stays one file.
- **The MCP server's `find_wind`.** It reads the squares for the region
  asked about, not every spot in the world.

### 7. The map loads the right level, and never shows a blank

The client gets a `TiledField` with the same `sample(lat, lon)` the
renderer calls today, so the particle and wash code barely changes.

- **Picking a level.** Use the coarsest level whose cells are no bigger than
  the wash's sampling step (5 screen px), measured at the view's centre, and
  never finer than native.
  - A phone showing all of Ireland gets HARMONIE level 1: about 18 KB a
    frame instead of 72 KB.
  - A desktop showing all of Ireland gets native.
  - Zoomed in on a bay, it gets one or two native tiles, about 22–45 KB.
- **Which tiles.** The tiles covering the view plus a margin of a third of
  the view on each side, the same margin the wash already paints.
- **While loading.** Draw from the coarser parent tile already in memory, then
  swap in the finer one. This is how every slippy map behaves, so the screen
  never goes blank.
- **Cache.** The cache holds tiles, not frames: an LRU of about 96 decoded
  tiles. Requests are de-duplicated in flight, as now.
- **Scrubbing.** Prefetch the next hour's tiles for the current view, as the
  next frame is prefetched now.
- **Decoding.** Done in a Web Worker so it never blocks a frame. The decode
  work is the same as today, just on a smaller file.
- **A bare map point tapped.** Its series reads the one native tile holding
  the point for each hour. Today it reads every whole frame (about 4.3 MB for
  hourly HARMONIE); with tiles it is roughly 1.3 MB.

The renderer stays on the CPU canvas. A WebGL layer can come later. The
1-cell border and the per-tile layout are the shape a shader wants, so that
change would not touch the data.

## What changes where

| Area | Change |
|---|---|
| `force5/ingest/f5bin.py` | Tile writer: cut, border, overviews, `F5T1` header. Golden fixtures shared with TS. |
| Wind adapters | Call the tile writer instead of `publish_frame`. Grids are already lattice-aligned; add the check. |
| `force5/ingest/publish_s3.py`, `prune.py` | Run-directory layout, manifest v2, directory delete. |
| `force5/src/f5bin.ts`, `weather.ts` | Tile decoder, manifest v2 validation, `TiledField`. |
| `force5/src/windLayer.ts`, `App.tsx` | Level choice, tiles in view, parent fallback. Particles and wash unchanged. |
| `src/usePointSeries.ts` | Bare point reads one native tile per hour. |
| `mcp/api/forecast.ts`, spot pages, dock, browser blend, ingest readers (`consensus.py`, `archive_forecasts.py`, `verify.py`, `backfill_spots.py`, `status.py`) | Read spot series from spot squares through one loader per language. |
| `force5/ingest/fetch_blend.py`, map lights | Blend per spot square. |
| Caddy, `perf-serve.mjs`, e2e staging | Serve the new paths with the same rules. |

## How it ships

The new format can ship in one go, without running two formats side by side,
because nothing is live on R2. In order:

1. **Tile format and writer/reader**, with golden fixtures, behind the
   existing manifest. No visible change.
2. **Spot squares.** Manifests shrink to KB. Spot pages, dock and MCP read
   the squares.
3. **Run directories and manifest v2.** Publisher and prune.
4. **The map on tiles.** `TiledField`, level choice, parent fallback, bare
   point.
5. **Blend per square.**

Each step lands with its tests and the e2e suite, the same way as the
download changes. If the site goes live on R2 before the map moves to
tiles, the publisher writes both formats for one release, then drops the old one.

## Done when

- Payloads are measured against today with the perf script, phone and
  desktop, for:
  - all of Ireland on load
  - zoomed in on a bay
  - a 24-hour scrub
  - a spot page
- First map paint on a phone downloads less than today. Target: under half
  for the all-of-Ireland view, which is where the overviews help.
- A synthetic "Europe" ICON-EU run (the full 0.0625° European grid) publishes
  and renders with no code change: only more tiles.
- Manifests and the pointer are under 10 KB gzip, whatever the number of
  spots.

## Not doing (yet), and why

- **Time-chunked tiles**, several hours in one file the way Zarr chunks time.
  They would speed up a bare-point series but slow the first paint. Revisit
  if bare-point taps become common.
- **WebGL renderer.** Not needed for the data change. The format is ready
  for it.
- **Mercator display tiles.** Only useful for a MapLibre raster layer, which
  we do not use.

## As built: spot squares, run directories and the version 2 pointer

Steps 2 and 3 of "How it ships" went in together, ahead of the tiles, because
a square file needs a directory to live in. The map still draws whole-frame
`.bin` files; they now sit at `frames/<HHH>.bin` (wave and weather frames at
`frames/<HHH>.json`) inside the run directory, and the tiles will join them at
`t/{level}/{x}/{y}/{HHH}.bin`. Where the build differs from the decisions
above:

- **The hash.** The run directory's name ends in the first 8 hex digits of a
  sha256 over the sorted lines `<path> <sha256 of the file's bytes>\n`, one per
  file in the directory, the `.br`/`.gz` sidecars left out
  (`force5/ingest/rundir.py`; `scripts/runs.mjs` for the sample generator,
  both held to `tests/fixtures/run-digest.json`). An adapter writes into a
  staging directory named with its prefix alone and finishes with
  `rundir.write_run`, which writes the squares, drops anything the run does not
  reference, hashes, renames and only then writes the pointer.
- **The `spots` block has a fourth field**, `keys`: the per-spot keys the
  squares carry (`spotForecasts`, `spotMembers`, …). It lets a reader see an
  ensemble, and lets the loader answer every declared key even for a square
  that holds none of a model's spots, so a split and a merge give back exactly
  what was split.
- **More keys move than the three named.** `spotCoverage` (GFS-Wave and ECMWF
  Wave) and Irish Shelf SWAN's per-spot cell records move too. SWAN's were
  called `spots`, which is now the square index, so they are `spotCells`.
- **A run with no frames states `horizonHours` in the pointer**, set by the
  split from its longest series, so freshness and the dock's axis never need
  a square.
- **Only the forecast kinds are version 2** (and, since step 5, the blend: see
  below). Tides, sea temperature, wind observations and the job summaries keep
  schemaVersion 1: they are one file, or a pointer and its station files, and
  have no spot series to move.
- **Squares.** Ireland's 146 riding places fall in ten squares, not eight. On
  the real runs of 7 October 2026 every pointer is 0.9–2.7 KB gzipped (from
  27–1,197 KB), and the largest square, `n52w008` around Dublin, is 9.5 KB
  gzipped for HARMONIE, 38 KB for ECMWF and 107 KB for Irish Shelf SWAN.
- **Integrity moved from the file to the directory.** A frame's own name no
  longer carries its hash, so the publisher checks the whole directory against
  its name before uploading anything. Readers after that (the archive job,
  `backfill_spots.py`) trust the path and the frame header, as they trust the
  pointer.
- **The blend** was still one file at this step; step 5, below, cut it into
  squares. It is still worked out from every square of every model, through the
  same loader.

## As built: the blend per square

Step 5. The blend is published as a run, like a model's, at schemaVersion 2:

```text
weather/blend.json                                     the pointer: times, sources, coverage, run, base, spots
weather/blend-2026101106-360h-v2-1a2b3c4d/spots/n52w008.json   {schemaVersion, model: "blend", run, square, spotBlend: {id: {wind, gust, from, agreement}}}
```

The pointer's `spots` block has the models' shape,
`{"squareDegrees": 2, "url": "spots/{square}.json", "squares": [...], "keys": ["spotBlend"]}`.
`spotBlend` is the old per-place `spots` record under a new name, since `spots`
is now the square index; it joins the per-spot keys in both languages. A blend
has no frames.

- **Who writes it.** The arithmetic was already TypeScript (force5/blend/build.ts
  runs `buildSpotBlend`), and the e2e site and `npm run blend` run it without the
  Python pipeline, so build.ts writes the run itself with `scripts/runs.mjs`, the
  JavaScript twin of rundir.py that the sample generator already used. Both are
  held to tests/fixtures/run-digest.json, and the Python validator re-hashes the
  directory, so the two writers cannot drift unnoticed. The directory is written
  under a staging name and renamed whole, then the pointer. `--spots` is the
  riding-place catalogue (fetch_blend.py passes the one the models were split
  by); a blended place the catalogue no longer has is left out and named rather
  than failing the job. The image's build stage copies `scripts/runs.mjs` in.
- **Publishing and pruning** need nothing of their own: the blend joins the run
  kinds, so the publisher re-hashes its directory, uploads its squares, swaps the
  pointer by compare-and-swap and deletes the directory it replaced, and the
  pruner keeps it by its `base`. It is no longer a "self-contained" kind.
- **What the map reads.** The lights read the squares in view: the map's bounds,
  grown by a third on every side (decision 7's margin), read when the camera
  settles (`moveend`), intersected with the squares the blend lists, at most 36
  of them, the nearest the centre (`squaresInView`, force5/src/squares.ts). The
  open spot's square and those of the reader's starred and frequent spots are
  always added, wherever they are, since the dock and the panel of their spots
  rate them too. At the all-Ireland view that is all ten squares; zoomed in on a
  bay it is one or two; over open sea or a country with no places it is none, and
  no request is made. The last squares read stay shown while the next are read.
  A place whose square has not been read gets no row and keeps its pending light,
  never a calm one: this holds for the browser's own blend too, where a place
  with no model data would otherwise rate as an hour of no wind.
- **The browser's own blend** (the reader picked their own models, or the
  published blend is more than six hours old, or none of its squares can be read)
  reads the same squares from each wind model, rather than every square of every
  model. Those two rules are unchanged (`trustedSpotBlend`); a square of the
  published blend that fails alone leaves its places pending and the rest shown.
- **Sizes**, on the real blend of 9 October 2026 (146 places, 126 times): one
  file of 247 KB raw, 77 KB gzipped, became a pointer of 5.7 KB raw, 1.2 KB
  gzipped, and ten squares of 1.7–71 KB raw, 0.8–22 KB gzipped, 81 KB gzipped in
  all. The all-Ireland view reads about 6% more than before, in eleven requests
  instead of one; a view of Dublin Bay reads the pointer, `n52w008` and the open
  spot's square, about 31 KB; and a view anywhere else reads only the pointer.
- **Dock.** The dock's stars come from the same table as the lights, so its
  spot's square is always among those read. Its blend chart already read the
  one square of the models it needs.
