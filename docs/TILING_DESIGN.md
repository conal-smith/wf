# Tiling design: map frames and spot data that scale past Ireland

Status: 11 October 2026. Everything in "How it ships" is built: spot squares,
run directories and the version 2 pointer (decisions 4–6), the tiles and the
map that reads them (decisions 1–3 and 7), and the blend per spot square
(step 5). Where the build differs from the design, and what was measured, is
under the "As built" sections at the end.

## Why

Today every map frame is one file covering a model's whole box. Every model
manifest also carries every spot's full series. At Ireland scale that works.
Beyond Ireland it does not:

- A HARMONIE frame is 72 KB brotli for 233×236 cells (74 KB on average,
  78 KB at most, over the real run of 7 October 2026). ECMWF over Europe
  would be about 40× that per frame, and over the globe about 300×. The
  phone would download all of it to show the screen it is looking at.
- The manifests are already 0.25–3.3 MB raw (34–375 KB gzip). That is 97%
  spot data for 148 spots, and it is fetched on every page load and
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
  Not every host serves ranges: Cloudflare Pages answers each with the whole
  file, which `force5/src/archives.ts` takes and keeps.

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
  Measured: a full HARMONIE tile is 27 KB on average and 30 KB at most, and
  Dublin Bay, on a part-filled tile, costs 17 KB a frame; see "As built: the
  map on tiles".
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
  bookkeeping. (As built, not at once: see "As built: the fix pass".)

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
    frame instead of 72 KB. (Measured: 32 KB in four tiles, against 74 KB.)
  - A desktop showing all of Ireland gets native. (Measured: all nine native
    tiles, 85 KB a frame, 13% more than the whole frame.)
  - Zoomed in on a bay, it gets one or two native tiles, about 22–45 KB.
    (Measured: Dublin Bay is one tile, 17 KB a frame.)
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
  work is the same as today, just on a smaller file. (As built it is on the
  main thread: a 130 × 130 × 3 tile decodes in about 0.1 ms.)
- **A bare map point tapped.** Its series reads the one native tile holding
  the point for each hour. Today it reads every whole frame (about 4.3 MB for
  hourly HARMONIE); with tiles it is roughly 1.3 MB. (Measured per tile: 17 KB
  a frame at Dublin Bay and at most 30 KB anywhere, so 1.0–1.8 MB for 61
  hourly frames.)

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
a square file needs a directory to live in. The map then still drew whole-frame
`.bin` files, at `frames/<HHH>.bin` (wave and weather frames at
`frames/<HHH>.json`) inside the run directory; the tiles have since replaced
them at `t/{level}/{x}/{y}/{HHH}.bin` (see "As built: the map on tiles"). Where
the build differs from the decisions above:

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
  a square. "No frames" is an empty list or none at all, and the series are
  `spotForecasts`, `spotMembers` and `spotSeries` (a wave or weather run's),
  each read at its last step; an adapter's own `horizonHours` stands
  (`squares.series_horizon`, `seriesHorizon` in scripts/runs.mjs).
- **Only the forecast kinds are version 2** (and, since step 5, the blend: see
  below). Tides, sea temperature, wind observations and the job summaries keep
  schemaVersion 1: they are one file, or a pointer and its station files, and
  have no spot series to move.
- **Squares.** Ireland's 148 riding places fall in ten squares, not eight. On
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

## As built: the map on tiles

Steps 1 and 4 of "How it ships" are built: every wind adapter publishes its
frames as tiles, the map draws from them, and whole frames are no longer
published. Where the build differs from the decisions above, and what it
measured:

- **Adapters change by one line.** `f5bin.publish_frame`, which every wind
  adapter already called once an hour, writes the hour's whole pyramid
  (`f5tile.write_pyramid`), every tile of every level, the empty ones too, at
  `t/{level}/{x}/{y}/<HHH>.bin` in the staging directory. The adapters only
  stopped putting a `url` on their frames and an `encoding` on their manifest.
- **Absence is per run, not per hour.** `rundir.write_run` decides it once
  every hour is in: a tile whose owned cells are missing at every hour is
  listed `absent` and deleted; any other is kept for every hour, so a reader
  never meets a tile that exists at one hour and not the next, and a 404 for a
  tile the manifest does not call absent is an error. Today's grids are full,
  so no live run has an absent tile; a land-masked or global field would.
- **The `tiles` block** (decision 5's sketch, with three additions):

  ```jsonc
  "tiles": {
    "size": 128, "border": 1, "encoding": "f5-tile-v1",
    "blocks": ["u", "v", "gust"],          // the most a tile carries; a frame with
                                           // a null gustIntervalHours has u and v
    "url": "t/{level}/{x}/{y}/{hour}.bin", // {hour} zero-padded to three digits
    "levels": [{ "level": 0, "dx": 0.025, "dy": 0.02, "x": [52, 54], "y": [13, 15],
                 "absent": [] }, …]
  }
  ```

  Each level carries its cell size (`dx`, `dy`: the grid's times 2^level,
  exact in binary floating point, so both languages compare them exactly) and
  its `absent` tiles as ordered `[x, y]` pairs. Frames keep `hour`,
  `validTime` and `gustIntervalHours` and lose `url`. The pointer stays
  schemaVersion 2: nothing is live, and a pointer with frames and no `tiles`
  block is refused by both validators, so an old one cannot be misread.
- **Validation, both languages.** `f5tile.check_tiles` (Python) and
  `validateTiles` (TypeScript) hold the block to the grid: on the lattice,
  exactly `levels(grid, size)` with its cell sizes, absent tiles distinct,
  ordered and inside their ranges, `blocks` gust exactly when some frame has a
  gust window. At publish every tile not absent must be there for every hour
  and nothing else may be; each tile's header must repeat its run, hour, level
  and place and carry a gust block exactly where its frame has a gust window;
  every value must be plausible; and a native tile may leave no cell of the
  grid missing. An overview is not checked against the native tiles it
  averages.
- **The poles and the date line.** A global grid keeps its rows at 90° N and
  90° S in every level (an early cut dropped the row at -90°; the third golden
  pyramid, `pole`, runs from pole to pole). A grid that runs past 180° of
  longitude is refused by all three lattice functions (`f5tile.lattice_origin`,
  scripts/f5tile.mjs and force5/src/f5tile.ts `latticeOrigin`) rather than cut
  as a regional grid whose extra columns land in tiles past the date line: a
  global grid that repeats its first column at 180° (GFS's 1441 columns,
  width·dx = 360° + dx) must drop it, and a regional grid crossing 180° is not
  supported. So is one reaching south of -90°.
- **Readers.** Everything that sampled whole frames samples the one native
  tile holding the point (`f5tile.FrameTiles`, which reads tiles lazily):
  the forecast archive (from the bucket it now fetches only the tiles holding
  a station, with no scratch directory) and `backfill_spots.py`. The golden
  pyramids prove level 0 samples exactly as the whole frame did, in both
  languages.
- **The map.** `force5/src/tiledField.ts`. A `Frame` is now an hour's identity
  and a `TiledField`; `loadFrame` resolves once the view's tiles are in, so a
  new hour or model is shown complete as before, and App.tsx did not change.
  The wind layer measures the view when the camera settles (and the map
  publishes it as soon as it exists, before the first frame is asked for): the
  wash's box, a third of the view past each edge, and CSS pixels per degree at
  the centre through MapLibre's own projection. Level: the coarsest whose
  cells are at most `WASH_STEP` (5 CSS px, the wash's sampling step) in both
  directions, never finer than native. HARMONIE's rows are its coarser side on
  screen: 0.02° of latitude is 0.033° of Mercator at 53° N. Tiles:
  `tilesCovering` that box at that level, minus `absent`. While they load, a
  sample tries the wanted level, then coarser levels, then finer, and along
  the domain's edge, where an overview's values stop short at its edge cells'
  centres, a finer tile or nothing. When the tiles arrive, the arrows' field
  and the wash are drawn again (a field `version` is part of the wash's key)
  and the next hour's tiles for the same box are prefetched; App.tsx still
  prefetches the next hour when the time changes.
- **A base under a native view.** Zoomed in far enough for native tiles, the
  field also loads the coarsest level's tiles for the hour on screen (HARMONIE's
  level 2 is one tile of about 10 KB), not waited for and never for a prefetched
  hour (`loadBase`, `base: false` on prefetches). Before, a zoom or pan out
  from a bay showed blank wherever the bay's native tiles did not reach until
  the coarser ones arrived. Nothing is ever sampled outside the grid itself, at
  any level, so a coarser tile held under a native view cannot paint the strip
  an overview's edge block reaches past the domain.
- **Cache.** 96 decoded tiles, LRU, shared by every frame and model, with
  requests in flight shared; a bare point's series reads through it
  (`keep: false`) as it read through the frame cache. The tiles the hour on
  screen draws its view from (and the base under a native view) are pinned, so
  the next hour's prefetch never pushes them out, and the cache stretches to
  twice their number when a large view needs more than half of 96. A tile is held as its
  stored int16 tenths, a quarter of the memory of floats, which keeps 96 tiles
  (about 9.7 MB) near what eight whole frames cost; `value / 10` is bit for
  bit the decoder's number, so nothing samples differently for it.
- **No Web Worker.** Decoding a 130 × 130 × 3 tile takes about 0.1 ms
  (measured in Node; force5/src/tiledField.test.ts prints it), against 5–20 ms
  for a wash paint. A worker would add a second bundle, message passing, and a
  decode path the unit tests could not run, to save well under a frame.
- **Sample bundles.** `scripts/f5tile.mjs` is a second writer, held to the
  Python one byte for byte by the golden pyramids (tests/f5tile-writer.test.ts);
  a run the Node writer published and the same run the Python one published
  land in the same content-named directory. The committed fixtures use tiles of
  16 cells — the size is the manifest's to state — so they stay small and
  still have several tiles and levels; the e2e site's HARMONIE is on the real
  0.025° × 0.02° grid with 128-cell tiles (`--site`), so the map has all three
  levels to choose from. ECMWF's and AIFS's 1° sample grids moved their north
  edge from 56° to 56.4° to sit on the lattice.
- **Wave and weather frames are no longer published.** Nothing read them: the
  browser, the forecast server and the blend read spot series, and
  verification reads wind. GFS-Wave, ECMWF Wave and ICON-EU surface weather
  stopped writing them (ICON-EU's `--frame-variables` went with them) and
  state `horizonHours` instead; Irish Shelf SWAN already wrote none unless
  asked with `--frames`, which stays. The validators still accept wave and
  weather frames for the day a layer needs them, and the sample bundles keep
  some so that path has a fixture. `backfill_spots.py` can no longer recompute
  a wave run's series, and says so, as it always did for SWAN.

### Measured

Sizes on disk are brotli at quality 9, from the real HARMONIE run of
7 October 2026 17 UTC (21 three-hourly frames), published both ways from the
same grids:

| | per frame | tiles | largest tile |
|---|---|---|---|
| Whole frame, as before | 74 KB (78 KB at most) | 1 | — |
| Level 0, native | 85 KB (91 KB at most) | 9 | 30 KB |
| Level 1 | 32 KB | 4 | 14 KB |
| Level 2 | 10 KB | 1 | 10 KB |
| Every level | 127 KB | 14 | — |

What a browser transferred for HARMONIE's frames, the same run served both
ways by scripts/perf-serve.mjs (brotli sidecars, as production), the parent
commit against this one, Playwright counting response bodies:

| | before | after |
|---|---|---|
| Phone (390 × 844), all of Ireland on load | 263 KB, 4 files | 115 KB, 16 tiles (level 1) |
| Then into Dublin Bay (zoom 10.4), extra | 0 | 31 KB, 2 tiles (level 0) |
| Phone, 24 forecast hours scrubbed at that view | 376 KB, 5 files | 161 KB, 20 tiles |
| Desktop (1440 × 900), all of Ireland on load | 263 KB, 4 files | 298 KB, 36 tiles (level 0) |
| Desktop, 24 forecast hours scrubbed | 376 KB, 5 files | 428 KB, 45 tiles |

The four frames on load are two the page asks for before it knows its opening
time (the run's first frame and the one after) and two it then shows (the
opening hour and the next): that first pair is wasted in both layouts and is
not a tiling matter. (It has since gone, so both rows on load now fetch half the
tiles: see "As built: the fix pass".) A phone's first view downloads 44% of
what it did. A
desktop showing all of Ireland downloads 13% more, because nine native tiles
compress less well than one whole frame (borders, and nine shorter windows),
and the view needs all of them; the level rule sends a desktop native there
by design.

The e2e site's synthetic HARMONIE, published both ways, asks for the same
files (four frames against 16 level-1 tiles on a phone, 36 native tiles on a
desktop, one native tile an hour for the bay), but its smooth analytic fields
compress to almost nothing (0.3 KB a whole frame), so its byte counts say
nothing about real weather.

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
  kinds, so the publisher re-hashes its directory, uploads its squares and swaps the
  pointer by compare-and-swap, and the pruners keep it by its `base` and the
  directory it replaced for the grace period. It is no longer a "self-contained"
  kind.
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

## As built: the fix pass

A review of the four steps above found readers left without data when a run
moved on, a pole row dropped, two unsafe merges and a path check a URL could
slip past, and downloads the page threw away. What changed:

### Keeping superseded runs

Decision 4 deleted the superseded run's directory, and the publisher did it the moment
its new pointer was in place. That is exactly when readers still hold the old pointer:
the browser revalidates pointers every five minutes, the CDN caches them for one, the
forecast server and a thread's spot card for five. Each of them then asked for tiles and
squares that had just been deleted, and showed the model as unavailable for minutes.
Yr keeps an old tileset at least 45 minutes for the same reason.

- **The pointer remembers what it replaced**, under `superseded`:
  `[{"base": "harmonie-…-1a2b3c4d/", "at": "2026-10-11T08:52:00Z"}]`, the time being
  the swap's. The publisher works it out from the pointer in the bucket it is replacing,
  inside the compare-and-swap, so the record cannot be lost apart from the swap
  (`squares.retire`); `rundir.write_run` and the blend's writer (scripts/runs.mjs) do
  the same on disk. Six hours of entries, at most 24.
- **Nothing is deleted at the swap.** The local prune and the bucket sweep keep a run
  directory some pointer superseded less than the grace period ago (60 minutes,
  `--grace-minutes` or `FORCE5_SUPERSEDED_GRACE_MINUTES`) and delete it after that. The
  sweep still also needs every object in it older than its six-hour guard, and reads
  the pointers once more just before each directory it deletes.
- **A reused directory is put back.** The same content lands in the same directory and
  `put_immutable` leaves what is there alone, so a republish can reuse a directory the
  sweep is deleting; once its pointer is in place the publisher lists the directory and
  uploads anything missing.

docs/LIVE_FORECAST_PIPELINE.md, "Deleting what is superseded", has the details.

### Recovering when a run's file is gone anyway

A pointer cached past the grace, or a sweep run by hand with a shorter one, can still
leave a reader asking for a deleted file. Every reader of a run's files now treats a
failure as "the run may have been replaced": it reads the model's pointer again past
its cache and, when that names another run directory, tries once more from there.

- Squares in the browser: `withSpots` (force5/src/manifests.ts, `newerPointer`).
  `useSpotSquares` and `useBlendSquares` also read again a square that still fails,
  after 5 s, 30 s and 2 min, instead of keeping the model unavailable until the next
  sweep of the manifests; the blend's first failed square asks for its pointer again
  out of turn (`useSpotBlend`'s `recheck`).
- Tiles: a frame that fails to load already looked for a newer run (`loadNewerRun`);
  now a tile the map needs for a pan or a zoom, or one hour of a bare point's series,
  does the same, once per run on screen (`onTilesFailed` in windLayer.ts, `recoverRun`
  in App.tsx). Before, the map kept drawing the coarser tile, or blank, until the hour
  changed. `loadNewerRun` compares run directories, not run times, so the same run
  republished with new content counts.
- The forecast server and the spot page (`loadCatalog` in mcp/api/forecast.ts, through
  the source's new `forget`) and a thread's spot card (`readSpotSeries`).

### The rest

- **A new run does not blank the dock.** `useSpotSquares` keeps the last answer for
  the same squares on screen while a new run's squares are read (`shownAnswer`);
  before, the blend chart and the waves and weather rows went empty each time a run
  arrived. An answer for other squares is still never shown for a single place.
- **Hardening.** A path inside a run is segments of `A–Z a–z 0–9 _ . -` only, in
  both languages (`checkRunPath`, `squares.run_path`): a browser resolves `%2e%2e`
  as `..` and drops tabs and newlines, so the old check, which only refused `..`, a
  leading `/` and a backslash, let an encoded path climb out of `base`. The square
  loaders merge into records with no prototype and refuse a spot found in two squares
  (`mergeSpots`), the blend's loader included, which used to keep whichever square
  came last; a place called `constructor` or `__proto__` is a place like any other.
  The publisher reads the riding-place catalogue by the adapters' own rule and
  refuses a square holding a spot the catalogue does not put in it.
- **The first frame is the opening frame.** The page asked for the run's first frame,
  and prefetched the second, before it knew the time it opens on (its map time was
  still unset, which read as frame 0), and then for the opening hour and the next.
  Now the opening time is set by a layout effect before the first paint, from the
  strip the dock shows, and no frame is asked for until there is a map time; the
  first time set reaches the map without the scrub throttle's wait. On the e2e site
  (its synthetic HARMONIE, the clock at the sample's, Playwright counting responses
  under `weather/` and `marine/`), a phone's load went from 16 HARMONIE tiles (hours
  0, 1, 17 and 18) and 29 forecast requests to 8 tiles (hours 17 and 18) and 21
  requests, 1.29 MB to 0.75 MB of response bodies; a desktop's from 38 tiles and 51
  requests to 19 and 32, 2.77 MB to 1.49 MB. The synthetic fields compress unlike
  real weather, so the bytes say little; the files halve.

## As built: the second fix pass

A second review looked at what an upgrade over existing data does, at long-running
readers, and at the three implementations side by side. What changed:

- **An old pointer is left out, not fatal.** After an upgrade a volume still holds each
  model's version 1 pointer until that model runs again. The blend (force5/blend/inputs.ts
  and `fetch_blend.read_bucket`) now leaves out and names a pointer that will not
  validate, as it did a missing one, instead of failing every hour. The browser already
  showed such a model as unavailable, but HARMONIE, the map's own model, has no
  fallback, so the local README and the pipeline doc say to run every enabled job once
  after upgrading (`npm run deploy:once`).
- **One square at a time.** The lights of the reader's own blend read each model's
  squares separately (`loadSpotsSettled`): a square that fails leaves its places
  pending and the model in every other place, where one far square used to take the
  model out of every light. Each run keeps its last eight merged sets of squares, and a
  run found replaced is remembered (`currentRun`), so later reads go straight to the new
  one.
- **Caches that stay small.** The forecast server's source keeps no run file (the spot
  loader keeps squares) and sweeps what has expired; the tile cache pins the view on
  screen, so the next hour's prefetch cannot push it out; the archive lets go of each
  frame's tiles once it has sampled it (300 MiB to 5.5 MiB over a synthetic 61-frame
  HARMONIE run).
- **The bucket sweep runs hourly**, now that it is what deletes superseded runs: they
  leave the bucket six to seven hours after publication, not up to thirty.
- **Python, Node and TypeScript agree** on what a fuzzer found them to differ on: NaN in
  JSON, "." as a path, a square with its envelope alone, the form of a `superseded`
  time, longitudes past ±180°, non-ASCII digits in a square's name, and when a frameless
  run's horizon is worked out. tests/fixtures/squares.json, superseded.json and
  run-digest.json hold the edge cases.
