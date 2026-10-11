/**
 * The wind field the map draws, read from a run's tile pyramid a tile at a
 * time: only the tiles the view needs, at the coarsest level the screen can
 * tell apart from native (docs/TILING_DESIGN.md, decision 7).
 *
 * A `TiledField` is one frame — one forecast hour of one run — and answers the
 * question the particles and the wash ask, `sample(lat, lon)`, from whatever
 * tiles it holds:
 *
 *   - the level the view wants, when that tile is loaded;
 *   - else the nearest coarser level loaded, so a zoom in never goes blank;
 *   - else a finer one: along the domain's edge an overview's values stop at
 *     the centres of its edge cells, leaving a strip only finer levels cover.
 *
 * A tile the manifest lists as absent is all missing and is never requested;
 * any other tile exists for every hour, so a failed request is an error.
 *
 * Tiles are cached by url, decoded, in one LRU of `TILE_CACHE_SIZE` shared by
 * every frame and every model, with requests in flight shared too. A tile is
 * kept as its stored int16 tenths (f5tile.ts, `decodeTileValues`), so a
 * hundred of them cost about what the eight whole frames this replaces did, and
 * `value / 10` is bit for bit the number a whole frame held: at level 0 a
 * sample here is exactly `sample()` over the whole grid.
 *
 * Decoding runs on the main thread. A 130 × 130 tile with three blocks is
 * 50,700 delta sums, well under a millisecond (force5/src/tiledField.test.ts
 * measures it), against the 5–20 ms the wash itself takes to paint; a worker
 * would add a second bundle, message passing and a decode path the unit tests
 * could not run, to save less than one frame's budget.
 */
import {
  TILE_MISSING,
  TILE_SCALE,
  decodeTileValues,
  latticeOrigin,
  tileOf,
  tilePath,
  tilesCovering,
  type TileValues,
  type TilesLevel,
  type TilesSpec,
} from "./f5tile";
import {
  runFileUrl,
  type Frame,
  type Grid,
  type Manifest,
  type Wind,
} from "./weather";

/** The wash's sampling step in CSS pixels (windLayer.ts paints one pixel per 5). */
export const WASH_STEP = 5;
/** Decoded tiles kept: a phone's view at two hours, and the levels either side. */
export const TILE_CACHE_SIZE = 96;

/**
 * What the map shows, as the tiles see it: the box the wash paints — the view
 * and a third of it again on every side — and the screen's scale at the
 * view's centre, in CSS pixels per degree, the unit the wash steps in.
 */
export interface MapView {
  west: number;
  south: number;
  east: number;
  north: number;
  /** CSS pixels per degree of longitude at the view's centre. */
  pxPerLon: number;
  /** CSS pixels per degree of latitude at the view's centre. */
  pxPerLat: number;
}

let currentView: MapView | null = null;
/**
 * The map's view, set by the wind layer whenever the camera settles, read by
 * `loadFrame` so a new hour or a new model loads just the tiles on screen.
 */
export const setMapView = (view: MapView | null) => {
  currentView = view;
};
export const mapView = () => currentView;

/**
 * The level to draw at: the coarsest whose cells, at the view's centre, are no
 * bigger than the wash's step in either direction, and never finer than
 * native. A phone showing all of Ireland gets HARMONIE's level 1; zoomed into
 * a bay, level 0.
 */
export function chooseLevel(
  tiles: Pick<TilesSpec, "levels">,
  view: Pick<MapView, "pxPerLon" | "pxPerLat">,
  step = WASH_STEP,
): number {
  let chosen = tiles.levels[0]?.level ?? 0;
  for (const level of tiles.levels) {
    const pixels = Math.max(level.dx * view.pxPerLon, level.dy * view.pxPerLat);
    if (!(pixels <= step)) break;
    chosen = level.level;
  }
  return chosen;
}

/** A view of the whole grid at any scale, for a load before the map has one. */
function wholeView(grid: Grid): MapView {
  return { ...grid, pxPerLon: 0, pxPerLat: 0 };
}

/* ---- the tile cache ---- */

const cache = new Map<string, TileValues>();
const pending = new Map<string, Promise<TileValues>>();

function remember(url: string, tile: TileValues) {
  cache.delete(url);
  cache.set(url, tile);
  while (cache.size > TILE_CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** A cached tile, marked as just used, or undefined. */
function cached(url: string): TileValues | undefined {
  const tile = cache.get(url);
  if (tile) remember(url, tile);
  return tile;
}

/** For tests: forget every tile. */
export function clearTileCache() {
  cache.clear();
  pending.clear();
}
/** For tests and the perf probe: how many decoded tiles are held. */
export const tileCacheSize = () => cache.size;

const UNAVAILABLE = "This forecast frame could not be loaded. Try again.";

/**
 * One tile, from the cache or the network. `keep: false` reads through the
 * cache without filling it: a bare point's series walks every hour of the run,
 * and keeping each tile would push out the ones the map is drawing.
 */
function fetchTile(
  url: string,
  request: Parameters<typeof decodeTileValues>[1],
  keep: boolean,
): Promise<TileValues> {
  const found = cached(url);
  if (found) return Promise.resolve(found);
  const inflight = pending.get(url);
  if (inflight)
    return inflight.then((tile) => {
      // Joined a read-through request: this caller wants the tile kept.
      if (keep && !cache.has(url)) remember(url, tile);
      return tile;
    });
  const loading = fetch(url, { signal: AbortSignal.timeout(20000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(UNAVAILABLE);
      const tile = decodeTileValues(await response.arrayBuffer(), request);
      if (keep) remember(url, tile);
      return tile;
    })
    .finally(() => pending.delete(url));
  pending.set(url, loading);
  return loading;
}

/* ---- one level's lattice, worked out once ---- */

/**
 * Everything a sample needs about one level that does not depend on the
 * point: the same arithmetic as `position` in f5tile.ts, with the constants
 * hoisted. Its tiles are held in `slots`, one per tile in the level's
 * published ranges: undefined until loaded, null for an absent tile.
 */
interface LevelPlan {
  spec: TilesLevel;
  level: number;
  scale: number;
  half: number;
  rowShift: number;
  firstRow: number;
  lastRow: number;
  columnShift: number;
  firstColumn: number;
  lastColumn: number;
  /** Native columns round the globe for a global grid, else 0. */
  native: number;
  wrap: number;
  column0: number;
  slots: (TileValues | null | undefined)[];
  absent: Set<number>;
  across: number;
}

function plans(grid: Grid, tiles: TilesSpec): LevelPlan[] {
  const { column: column0, row: row0 } = latticeOrigin(grid);
  const native = Math.abs(grid.width - 360 / grid.dx) <= 1e-6 ? grid.width : 0;
  return tiles.levels.map((spec) => {
    const scale = 2 ** spec.level;
    const firstRow = Math.floor(row0 / scale);
    const firstColumn = native ? 0 : Math.floor(column0 / scale);
    const across = spec.x[1] - spec.x[0] + 1;
    const plan: LevelPlan = {
      spec,
      level: spec.level,
      scale,
      half: (scale - 1) / 2,
      rowShift: row0 - firstRow * scale,
      firstRow,
      lastRow: Math.floor((row0 + grid.height - 1) / scale) - firstRow,
      columnShift: column0 - firstColumn * scale,
      firstColumn,
      lastColumn: native
        ? Math.ceil(native / scale) - 1
        : Math.floor((column0 + grid.width - 1) / scale) - firstColumn,
      native,
      wrap: native ? Math.ceil(native / scale) : 0,
      column0,
      slots: new Array(across * (spec.y[1] - spec.y[0] + 1)),
      absent: new Set(),
      across,
    };
    for (const [x, y] of spec.absent) {
      const at = (y - spec.y[0]) * across + x - spec.x[0];
      plan.absent.add(at);
      plan.slots[at] = null;
    }
    return plan;
  });
}

/** The slot of tile (x, y) in a level, or -1 outside its published ranges. */
function slotOf(plan: LevelPlan, x: number, y: number) {
  const { spec } = plan;
  if (x < spec.x[0] || x > spec.x[1] || y < spec.y[0] || y > spec.y[1])
    return -1;
  return (y - spec.y[0]) * plan.across + x - spec.x[0];
}

/* ---- the field ---- */

/** What a sample found at one level: a wind, a definite nothing, or no tile yet. */
const NOT_LOADED = 1;

export class TiledField {
  readonly grid: Grid;
  readonly hour: number;
  /** The level the view last asked for, which `sample` tries first. */
  level: number;
  /** Bumped whenever a tile arrives, so a painter knows to paint again. */
  version = 0;
  private readonly tiles: TilesSpec;
  private readonly levels: LevelPlan[];
  private readonly blocks: 2 | 3;
  // A sample's result travels through these, not a fresh object per call: the
  // wash takes a hundred thousand samples a paint.
  private u = 0;
  private v = 0;
  private gust: number | null = null;

  constructor(
    readonly manifest: Manifest,
    readonly index: number,
  ) {
    const info = manifest.frames[index];
    if (!info) throw new Error("This forecast has no such frame.");
    if (!manifest.tiles) throw new Error("This forecast has no map tiles.");
    this.grid = manifest.grid;
    this.hour = info.hour;
    this.tiles = manifest.tiles;
    this.levels = plans(manifest.grid, manifest.tiles);
    this.level = this.levels[this.levels.length - 1].level;
    this.blocks = info.gustIntervalHours === null ? 2 : 3;
    // Whatever the cache already holds for this hour is there to draw from.
    for (const plan of this.levels)
      for (let at = 0; at < plan.slots.length; at++) {
        if (plan.slots[at] === null) continue;
        const x = plan.spec.x[0] + (at % plan.across);
        const y = plan.spec.y[0] + Math.floor(at / plan.across);
        const tile = cache.get(this.url(plan.level, x, y));
        if (tile) plan.slots[at] = tile;
      }
  }

  url(level: number, x: number, y: number) {
    return runFileUrl(this.manifest, tilePath(level, x, y, this.hour));
  }

  /** The level and the tiles a view needs: those covering it, absent ones left out. */
  want(view: MapView): { level: number; tiles: { x: number; y: number }[] } {
    const level = chooseLevel(this.tiles, view);
    const plan = this.levels.find((entry) => entry.level === level)!;
    const tiles = tilesCovering(
      this.grid,
      plan.spec,
      view,
      this.tiles.size,
    ).filter(({ x, y }) => !plan.absent.has(slotOf(plan, x, y)));
    return { level, tiles };
  }

  /**
   * Draw at the level `view` wants from now on, and load the tiles it needs.
   * Null when they are all here already; otherwise a promise that settles once
   * they are, while `sample` draws from whatever else is loaded.
   */
  request(
    view: MapView,
    { keep = true }: { keep?: boolean } = {},
  ): Promise<void> | null {
    const { level, tiles } = this.want(view);
    this.level = level;
    const plan = this.levels.find((entry) => entry.level === level)!;
    const missing = tiles.filter(({ x, y }) => {
      const at = slotOf(plan, x, y);
      const held = plan.slots[at];
      if (held) {
        // In use: keep it at the fresh end of the cache.
        if (keep) cached(this.url(level, x, y));
        return false;
      }
      const tile = keep
        ? cached(this.url(level, x, y))
        : cache.get(this.url(level, x, y));
      if (tile) {
        plan.slots[at] = tile;
        this.version++;
        return false;
      }
      return true;
    });
    if (!missing.length) return null;
    return Promise.all(
      missing.map(({ x, y }) => this.loadTile(plan, x, y, keep)),
    ).then(() => undefined);
  }

  /** Load the tiles `view` needs; resolves once they are all drawable. */
  load(view: MapView, options: { keep?: boolean } = {}): Promise<void> {
    return this.request(view, options) ?? Promise.resolve();
  }

  private loadTile(plan: LevelPlan, x: number, y: number, keep: boolean) {
    return fetchTile(
      this.url(plan.level, x, y),
      {
        level: plan.level,
        x,
        y,
        hour: this.hour,
        run: this.manifest.run,
        size: this.tiles.size,
        border: this.tiles.border,
        blocks: this.blocks,
      },
      keep,
    ).then((tile) => {
      const at = slotOf(plan, x, y);
      if (plan.slots[at] !== tile) {
        plan.slots[at] = tile;
        this.version++;
      }
      return tile;
    });
  }

  /**
   * The wind at a point from the native tile holding it, loading that one tile
   * (and no other) if need be. What a bare point's series is read from.
   */
  async point(
    lat: number,
    lon: number,
    { keep = true }: { keep?: boolean } = {},
  ): Promise<Wind | null> {
    const plan = this.levels[0];
    const tile = tileOf(this.grid, plan.level, lat, lon, this.tiles.size);
    if (!tile) return null;
    const at = slotOf(plan, tile.x, tile.y);
    if (at < 0 || plan.slots[at] === null) return null;
    if (plan.slots[at] === undefined)
      await this.loadTile(plan, tile.x, tile.y, keep);
    return this.sampleLevel(
      plan,
      (lon - this.grid.west) / this.grid.dx,
      (this.grid.north - lat) / this.grid.dy,
    ) === true
      ? this.wind()
      : null;
  }

  /**
   * Load the next hour's tiles for this view, as the map prefetches the next
   * frame, so stepping forward draws at once. Errors are the next hour's own
   * to report when it is asked for.
   */
  prefetchNext(view: MapView) {
    if (this.index + 1 >= this.manifest.frames.length) return;
    void new TiledField(this.manifest, this.index + 1)
      .load(view)
      .catch(() => {});
  }

  /**
   * Bilinear u, v and gust at (lat, lon) from the best tile loaded, or null
   * where the field has no value or nothing covering the point is loaded.
   * Level 0 gives exactly `sample()` over the whole frame.
   */
  sample(lat: number, lon: number): Wind | null {
    const x = (lon - this.grid.west) / this.grid.dx;
    const y = (this.grid.north - lat) / this.grid.dy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const levels = this.levels;
    const start = levels.findIndex((plan) => plan.level === this.level);
    // The wanted level, then coarser, then finer.
    for (let i = start; i < levels.length; i++) {
      const found = this.sampleLevel(levels[i], x, y);
      if (found !== NOT_LOADED) return found ? this.wind() : null;
    }
    for (let i = start - 1; i >= 0; i--) {
      const found = this.sampleLevel(levels[i], x, y);
      if (found !== NOT_LOADED) return found ? this.wind() : null;
    }
    return null;
  }

  /**
   * The sampled values written to u, v and gust: true; false where this level
   * definitely has no value (missing cells, an absent tile); NOT_LOADED where
   * it cannot say — outside its sampleable area, or its tile is not loaded.
   * `position` in f5tile.ts, operation for operation.
   */
  private sampleLevel(
    plan: LevelPlan,
    x: number,
    y: number,
  ): boolean | typeof NOT_LOADED {
    const down = (y + plan.rowShift - plan.half) / plan.scale;
    if (plan.lastRow < 1 || down < 0 || down > plan.lastRow) return NOT_LOADED;
    const r = Math.min(Math.floor(down), plan.lastRow - 1);
    const ty = down - r;
    const row = plan.firstRow + r;
    let column: number, tx: number;
    if (plan.native) {
      const value = x + plan.column0;
      const remainder = value % plan.native;
      const across =
        ((remainder < 0 ? remainder + plan.native : remainder) +
          0 -
          plan.half) /
        plan.scale;
      const c = Math.floor(across);
      const wrapped = c % plan.wrap;
      column = wrapped < 0 ? wrapped + plan.wrap : wrapped;
      tx = across - c;
    } else {
      const across = (x + plan.columnShift - plan.half) / plan.scale;
      if (plan.lastColumn < 1 || across < 0 || across > plan.lastColumn)
        return NOT_LOADED;
      const c = Math.min(Math.floor(across), plan.lastColumn - 1);
      column = plan.firstColumn + c;
      tx = across - c;
    }
    const size = this.tiles.size;
    const tileX = Math.floor(column / size),
      tileY = Math.floor(row / size);
    const at = slotOf(plan, tileX, tileY);
    if (at < 0) return NOT_LOADED;
    const tile = plan.slots[at];
    if (tile === undefined) return NOT_LOADED;
    if (tile === null) return false;
    const { border, side } = tile;
    const i =
      (row - (tileY * size - border)) * side + column - (tileX * size - border);
    const u = bilinear(tile.u, i, side, tx, ty);
    const v = bilinear(tile.v, i, side, tx, ty);
    if (Number.isNaN(u) || Number.isNaN(v)) return false;
    this.u = u;
    this.v = v;
    this.gust = tile.gust ? bilinear(tile.gust, i, side, tx, ty) : NaN;
    if (Number.isNaN(this.gust)) this.gust = null;
    return true;
  }

  private wind(): Wind {
    return { u: this.u, v: this.v, gust: this.gust };
  }
}

/**
 * f5tile.ts's `sampleTile` bilinear over stored tenths: each corner as
 * `value / 10`, the very number `decodeTile` gives, so the result is the same
 * to the bit. NaN when any corner is missing.
 */
function bilinear(
  values: Int16Array,
  i: number,
  side: number,
  tx: number,
  ty: number,
) {
  const a = values[i],
    b = values[i + 1],
    c = values[i + side],
    d = values[i + side + 1];
  if (
    a === TILE_MISSING ||
    b === TILE_MISSING ||
    c === TILE_MISSING ||
    d === TILE_MISSING
  )
    return NaN;
  return (
    ((a / TILE_SCALE) * (1 - tx) + (b / TILE_SCALE) * tx) * (1 - ty) +
    ((c / TILE_SCALE) * (1 - tx) + (d / TILE_SCALE) * tx) * ty
  );
}

/**
 * One map frame: the frame's identity and a field loaded for the map's view
 * (`mapView`), or for the whole grid at its coarsest before there is a view.
 * The promise settles once the tiles the view needs are drawable, so a new
 * hour or a new model is shown complete, as a whole frame used to be.
 */
export async function loadFrame(
  manifest: Manifest,
  index: number,
  { keep = true }: { keep?: boolean } = {},
): Promise<Frame> {
  const info = manifest.frames[index];
  const field = new TiledField(manifest, index);
  await field.load(currentView ?? wholeView(manifest.grid), { keep });
  return {
    model: manifest.model,
    run: manifest.run,
    hour: info.hour,
    validTime: info.validTime,
    grid: manifest.grid,
    gustIntervalHours: info.gustIntervalHours,
    field,
  };
}

/**
 * The wind at a point at one hour of a run, from the one native tile holding
 * it: what a bare point's series reads, a tile per hour rather than a frame.
 */
export function samplePoint(
  manifest: Manifest,
  index: number,
  lat: number,
  lon: number,
  options: { keep?: boolean } = {},
): Promise<Wind | null> {
  return new TiledField(manifest, index).point(lat, lon, options);
}
