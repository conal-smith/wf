// Force5's provider-neutral forecast contract and sampling utilities.
import { isStale, modelEntry } from "./catalog";
import { validateTiles, type TilesSpec } from "./f5tile";
import {
  RUN_SCHEMA_VERSION,
  SPOT_KEYS,
  checkBase,
  checkRunPath,
  checkSpotIndex,
  runPath,
  type SpotIndex,
} from "./spotData";
import type { TiledField } from "./tiledField";
import { forecastUrl } from "./urls";
// Units live in units.ts; re-exported so existing weather imports keep working.
export {
  KNOTS,
  UNITS,
  convert,
  formatSpeed,
  isUnits,
  unitLabel,
} from "./units";
export type { Units } from "./units";
export interface Grid {
  width: number;
  height: number;
  west: number;
  east: number;
  north: number;
  south: number;
  dx: number;
  dy: number;
}
export interface Wind {
  u: number;
  v: number;
  gust: number | null;
}
/**
 * One forecast hour a wind run publishes. Its map data is the run's tiles
 * (`Manifest.tiles`), so the frame names no file of its own.
 */
export interface FrameInfo {
  hour: number;
  validTime: string;
  gustIntervalHours: [number, number] | null;
}
/**
 * One map frame: a forecast hour of a run, and the field the map samples it
 * from, read a tile at a time for the view (tiledField.ts).
 */
export interface Frame {
  model: string;
  run: string;
  hour: number;
  validTime: string;
  grid: Grid;
  gustIntervalHours: [number, number] | null;
  field: TiledField;
}
/**
 * A whole frame's grids, as the retired whole-frame files held them
 * (force5/src/f5bin.ts). Nothing is published this way any more; it is the
 * reference the tiles are tested against, and `sample` reads it.
 */
export interface GridFrame extends WindArrays {
  model: string;
  run: string;
  hour: number;
  validTime: string;
  grid: Grid;
  gustIntervalHours: [number, number] | null;
}
interface WindArrays {
  u: number[];
  v: number[];
  gust: number[] | null;
}
export interface Spot extends Point {
  id: string;
  name: string;
  county: string;
  lat: number;
  lon: number;
  note: string;
}
export interface Point {
  name: string;
  county?: string;
  lat: number;
  lon: number;
  id?: string;
  note?: string;
  kind?: "spot" | "operator" | "club" | "area";
  aliases?: string[];
  website?: string;
  sports?: string[];
  /**
   * The bearing the shore looks out to sea along, in degrees, where it is clear
   * enough to rate against; null or absent means rate on the wind alone.
   */
  facing?: number | null;
  locationSources?: {
    name: string;
    url: string;
    licence: string;
    lat: number;
    lon: number;
  }[];
}
/** What a manifest describes. Absent means wind, the original contract. */
export type ManifestKind = "wind" | "wave" | "weather" | "tide";
/**
 * `interval` gusts are a maximum over the source accumulation window ending at
 * the frame; `instantaneous` gusts are a point value, so their window collapses
 * to `[hour, hour]` at every frame, including initialization.
 */
export type GustKind = "interval" | "instantaneous";
export interface Ensemble {
  members: number;
  control: number | null;
  description: string;
}
/** One ensemble time step for one spot; every array is indexed by member. */
export interface MemberFrame {
  hour: number;
  validTime: string;
  u: number[];
  v: number[];
  gust: (number | null)[];
}
/** The per-spot data of a wind run, read from its spot squares (spotData.ts). */
export interface WindSpotData {
  /**
   * One precomputed series per riding location. A model whose domain does not
   * reach a location still lists it, with null values and a `coverageNote`
   * naming it, so the catalogue never looks as though it changed.
   */
  spotForecasts: Record<string, (Wind & { hour: number; validTime: string })[]>;
  spotMembers?: Record<string, MemberFrame[]>;
}
/**
 * A wind run's pointer (schemaVersion 2). Its frames and its spot squares live
 * in the run directory `base` names, beside the pointer; `spotForecasts` and
 * `spotMembers` are present only once the squares a reader asked for have been
 * merged in (`loadSpotSquares`), and then only for the spots in them.
 */
export interface Manifest extends Partial<WindSpotData> {
  schemaVersion: number;
  model: string;
  modelName: string;
  provider: string;
  run: string;
  runTime: string;
  generatedAt: string;
  resolutionKm: number | null;
  resolutionLabel?: string;
  stepHours: number;
  stepRanges?: { throughHour: number; stepHours: number }[];
  grid: Grid;
  /**
   * Where the run's map frames are: a pyramid of tiles in the run directory
   * (f5tile.ts). Present exactly when there are frames.
   */
  tiles?: TilesSpec;
  /** The run directory, relative to the pointer's own directory. */
  base: string;
  frames: FrameInfo[];
  /** The spot squares the run publishes (spotData.ts). */
  spots: SpotIndex;
  /** The last published hour of a run with no map frames. */
  horizonHours?: number;
  sourceUrl: string;
  attribution: string;
  licenseUrl: string;
  termsUrl?: string;
  gustAvailable?: boolean;
  gustMissingHours?: number[];
  gustDescription?: string;
  modelDetail?: string;
  processing?: string;
  kind?: ManifestKind;
  gustKind?: GustKind;
  /** Present only for ensembles; `spotForecasts` then holds the member mean. */
  ensemble?: Ensemble;
  /** Why a spot may carry a null series: a crop edge or a model domain edge. */
  coverageNote?: string;
  spotForecastsDescription?: string;
}
export const speed = (wind: Pick<Wind, "u" | "v">) =>
  Math.hypot(wind.u, wind.v);
export const direction = (u: number, v: number) =>
  ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
export const compass = (degrees: number) =>
  [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ][Math.round(degrees / 22.5) % 16];

/**
 * Bilinear wind at a point of a whole grid. The map samples tiles
 * (`TiledField.sample`, which takes lat then lon); this is the whole-grid
 * reference level 0 of the tiles matches to the bit.
 */
export function sample(
  frame: Pick<GridFrame, "grid" | "u" | "v" | "gust">,
  lon: number,
  lat: number,
): Wind | null {
  const g = frame.grid;
  const x = (lon - g.west) / g.dx,
    y = (g.north - lat) / g.dy;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > g.width - 1 ||
    y > g.height - 1
  )
    return null;
  const x0 = Math.min(Math.floor(x), g.width - 2),
    y0 = Math.min(Math.floor(y), g.height - 2);
  const tx = x - x0,
    ty = y - y0,
    i = y0 * g.width + x0;
  const bilinear = (a: number[]) =>
    (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) +
    (a[i + g.width] * (1 - tx) + a[i + g.width + 1] * tx) * ty;
  return {
    u: bilinear(frame.u),
    v: bilinear(frame.v),
    gust: frame.gust === null ? null : bilinear(frame.gust),
  };
}

export type Rgb = [number, number, number];

/**
 * The wind scale, in knots: the same for every rider, as Windy, Windguru and
 * Windfinder draw theirs. Pale blue in a calm, deepening toward 10 kn; greens
 * from 10 to 20; yellow by the high 20s; orange to red from 30 to 40; red to
 * purple by 50; dark purple to nearly black past 60. Speed bands, not safety
 * or ability ratings: the stars are the rider's, the colours are not.
 */
export const PALETTE: [number, Rgb][] = [
  [0, [170, 203, 234]],
  [5, [128, 174, 224]],
  [9, [79, 128, 200]],
  [10, [73, 168, 138]],
  [15, [76, 179, 90]],
  [20, [111, 191, 62]],
  [25, [181, 207, 58]],
  [30, [236, 210, 58]],
  [35, [242, 160, 58]],
  [40, [224, 90, 51]],
  [45, [200, 48, 74]],
  [50, [155, 47, 134]],
  [60, [90, 35, 104]],
  [65, [35, 22, 40]],
];
/** The colour at a speed on PALETTE, between its stops, held at either end. */
export function windColor(knots: number): Rgb {
  const k = Math.max(0, Math.min(65, knots));
  let i = 1;
  while (i < PALETTE.length - 1 && k > PALETTE[i][0]) i++;
  const [a, ca] = PALETTE[i - 1],
    [b, cb] = PALETTE[i];
  return ca.map((v, c) =>
    Math.round(v + ((cb[c] - v) * (k - a)) / (b - a)),
  ) as Rgb;
}

/** `windColor` as CSS writes it, for a fill or a background. */
export const windCss = (knots: number) => `rgb(${windColor(knots).join(" ")})`;

export function validateGrid(g: Grid): void {
  if (
    !g ||
    !Number.isInteger(g.width) ||
    !Number.isInteger(g.height) ||
    g.width < 2 ||
    g.height < 2 ||
    g.width * g.height > 2_000_000 ||
    ![g.west, g.east, g.north, g.south, g.dx, g.dy].every(Number.isFinite) ||
    g.dx <= 0 ||
    g.dy <= 0 ||
    g.north > 85 ||
    g.south < -85 ||
    g.west < -180 ||
    g.east > 180 ||
    Math.abs(g.east - g.west - (g.width - 1) * g.dx) > 0.00001 ||
    Math.abs(g.north - g.south - (g.height - 1) * g.dy) > 0.00001
  )
    throw new Error("Invalid forecast grid. Refresh the weather snapshot.");
}
const KINDS: ManifestKind[] = ["wind", "wave", "weather", "tide"];
function validateEnsemble(e: Ensemble): void {
  if (
    !e ||
    !Number.isInteger(e.members) ||
    e.members < 1 ||
    e.members > 200 ||
    !(
      e.control === null ||
      (Number.isInteger(e.control) && e.control >= 0 && e.control < e.members)
    ) ||
    typeof e.description !== "string" ||
    !e.description
  )
    throw new Error("Invalid ensemble description.");
}
function validateSpotMembers(m: Manifest & WindSpotData): void {
  const members = m.ensemble?.members;
  if (!members)
    throw new Error("Member series require an ensemble description.");
  for (const [spot, series] of Object.entries(m.spotMembers!)) {
    if (!Array.isArray(series) || !series.length)
      throw new Error(`Invalid ensemble series for ${spot}.`);
    let previous = -1;
    for (const f of series) {
      if (
        !Number.isFinite(f.hour) ||
        f.hour <= previous ||
        !Number.isFinite(Date.parse(f.validTime)) ||
        Date.parse(f.validTime) !== Date.parse(m.runTime) + f.hour * 3600000
      )
        throw new Error(`Invalid ensemble timeline for ${spot}.`);
      previous = f.hour;
      for (const field of ["u", "v"] as const) {
        if (
          !Array.isArray(f[field]) ||
          f[field].length !== members ||
          !f[field].every((v) => Number.isFinite(v) && Math.abs(v) <= 150)
        )
          throw new Error(`Invalid ensemble ${field} values for ${spot}.`);
      }
      if (
        !Array.isArray(f.gust) ||
        f.gust.length !== members ||
        !f.gust.every(
          (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 150),
        )
      )
        throw new Error(`Invalid ensemble gust values for ${spot}.`);
    }
  }
}
/**
 * A wind run's spot data, read from its squares, checked against its pointer:
 * every member series as long as the ensemble says, on the run's own clock.
 * Returns the manifest it was given, so a merged run can be checked in place.
 */
export function validateWindSpots<M extends Manifest>(m: M): M {
  if (m.spotForecasts !== undefined && !isRecord(m.spotForecasts))
    throw new Error("Invalid spot forecasts.");
  if (m.spotMembers) validateSpotMembers(m as M & WindSpotData);
  return m;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * A run pointer's own shape: schemaVersion 2, a run directory beside it, no
 * spot data inline. Shared with the wave and weather validators (variables.ts).
 */
export function validateRunPointer(m: {
  schemaVersion: number;
  base: string;
  spots: unknown;
}): void {
  if (m.schemaVersion !== RUN_SCHEMA_VERSION)
    throw new Error("This forecast is an old format. Refresh the forecast.");
  checkBase(m.base);
  checkSpotIndex(m.spots);
  const inline = SPOT_KEYS.filter((key) => key in m);
  if (inline.length)
    throw new Error(
      `Spot data belongs in the spot squares, not the forecast: ${inline.join(", ")}.`,
    );
}
export function validateManifest(m: Manifest): Manifest {
  if (
    !m ||
    !Array.isArray(m.frames) ||
    // Chart-only ensembles publish member series without map frames.
    (!m.frames.length && !m.ensemble) ||
    !Number.isFinite(Date.parse(m.runTime))
  )
    throw new Error("Invalid forecast manifest. Run npm run weather:refresh.");
  validateRunPointer(m);
  if (
    !m.frames.length &&
    (!Number.isInteger(m.horizonHours) || m.horizonHours! <= 0)
  )
    throw new Error("A forecast without map frames must state its horizon.");
  if (m.kind !== undefined && !KINDS.includes(m.kind))
    throw new Error("Unknown forecast kind.");
  // Whole-frame encodings are retired: a run with frames publishes tiles.
  if ("encoding" in m)
    throw new Error("This forecast is an old format. Refresh the forecast.");
  if (
    m.gustKind !== undefined &&
    m.gustKind !== "interval" &&
    m.gustKind !== "instantaneous"
  )
    throw new Error("Unknown gust kind.");
  if (m.gustKind === "instantaneous" && m.gustMissingHours)
    throw new Error("Instantaneous gusts have no missing hours.");
  if (m.ensemble !== undefined) validateEnsemble(m.ensemble);
  if (m.grid || m.frames.length) validateGrid(m.grid);
  if (m.frames.length) validateTiles(m.grid, m.frames, m.tiles);
  else if (m.tiles !== undefined)
    throw new Error("A forecast without map frames has no tiles.");
  if (
    m.gustMissingHours &&
    (!Array.isArray(m.gustMissingHours) ||
      m.gustMissingHours.length !== 1 ||
      m.gustMissingHours[0] !== 0 ||
      !m.frames.length ||
      m.frames[0].hour !== 0)
  )
    throw new Error(
      "Invalid missing gust hours; only initialization may be absent.",
    );
  if (m.stepRanges) {
    let end = 0;
    const hours = [0];
    for (const range of m.stepRanges) {
      if (
        !Number.isInteger(range.stepHours) ||
        range.stepHours <= 0 ||
        !Number.isInteger(range.throughHour) ||
        range.throughHour <= end ||
        range.throughHour > 1000 ||
        (range.throughHour - end) % range.stepHours !== 0
      )
        throw new Error("Forecast cadence is invalid.");
      for (
        let h = end + range.stepHours;
        h <= range.throughHour;
        h += range.stepHours
      )
        hours.push(h);
      end = range.throughHour;
    }
    if (
      hours.length !== m.frames.length ||
      hours.some((h, i) => h !== m.frames[i].hour)
    )
      throw new Error("Forecast timeline does not match source cadence.");
  }
  let previous = -1;
  for (const f of m.frames) {
    if (
      !Number.isFinite(f.hour) ||
      f.hour <= previous ||
      !Number.isFinite(Date.parse(f.validTime)) ||
      Date.parse(f.validTime) !== Date.parse(m.runTime) + f.hour * 3600000
    )
      throw new Error("Forecast timeline is invalid.");
    if (m.gustAvailable === false || m.gustMissingHours?.includes(f.hour)) {
      if (f.gustIntervalHours !== null)
        throw new Error("Unavailable gusts must not declare an interval.");
    } else if (m.gustKind === "instantaneous") {
      // A point gust has no window: every frame, hour 0 included, is [hour, hour].
      if (
        !Array.isArray(f.gustIntervalHours) ||
        f.gustIntervalHours.length !== 2 ||
        f.gustIntervalHours[0] !== f.hour ||
        f.gustIntervalHours[1] !== f.hour
      )
        throw new Error("Invalid gust forecast interval.");
    } else if (
      !Array.isArray(f.gustIntervalHours) ||
      f.gustIntervalHours.length !== 2 ||
      !f.gustIntervalHours.every(Number.isFinite) ||
      f.gustIntervalHours[0] < 0 ||
      f.gustIntervalHours[0] > f.gustIntervalHours[1] ||
      f.gustIntervalHours[1] !== f.hour ||
      (f.hour > 0 && f.gustIntervalHours[0] === f.gustIntervalHours[1])
    ) {
      throw new Error("Invalid gust forecast interval.");
    }
    previous = f.hour;
  }
  return m;
}
/** A url inside the run directory, which is all a frame url may be. */
export function usableRunPath(url: unknown): boolean {
  try {
    checkRunPath(url);
    return true;
  } catch {
    return false;
  }
}
/**
 * Where a manifest is published: its catalogue path, which its run directory is
 * relative to. A model the catalogue does not know is read from beside the
 * others, under `weather/`.
 */
export const manifestPath = (manifest: Pick<Manifest, "model">): string =>
  modelEntry(manifest.model)?.manifestUrl ?? `weather/${manifest.model}.json`;
/** The URL of one of a run's own files: `base` and the path, from the pointer. */
export const runFileUrl = (
  manifest: Pick<Manifest, "model" | "base">,
  relative: string,
): string =>
  forecastUrl(runPath(manifestPath(manifest), manifest.base, relative));

/** A whole frame's grids against its manifest: the reference the tiles are tested to. */
export function validateFrame(
  f: GridFrame,
  manifest: Manifest,
  info: FrameInfo,
): GridFrame {
  if (
    !f ||
    f.run !== manifest.run ||
    f.model !== manifest.model ||
    f.hour !== info.hour ||
    f.validTime !== info.validTime
  )
    throw new Error(
      "Forecast file does not match the selected model run. Refresh the page.",
    );
  validateGrid(f.grid);
  if (
    JSON.stringify(f.gustIntervalHours) !==
    JSON.stringify(info.gustIntervalHours)
  )
    throw new Error("Gust period does not match the selected forecast.");
  for (const key of [
    "width",
    "height",
    "west",
    "east",
    "north",
    "south",
    "dx",
    "dy",
  ] as const) {
    if (f.grid[key] !== manifest.grid[key])
      throw new Error("Forecast grids do not match.");
  }
  for (const field of ["u", "v", "gust"] as const) {
    if (
      field === "gust" &&
      (manifest.gustAvailable === false ||
        manifest.gustMissingHours?.includes(info.hour))
    ) {
      if (f.gust !== null)
        throw new Error("Unavailable gust data must be null.");
      continue;
    }
    if (
      !Array.isArray(f[field]) ||
      f[field].length !== f.grid.width * f.grid.height ||
      !f[field].every(
        (v) =>
          Number.isFinite(v) &&
          Math.abs(v) <= 150 &&
          (field !== "gust" || v >= 0),
      )
    )
      throw new Error(`Invalid ${field} wind data.`);
  }
  return f;
}

export function nearestFrame(
  frames: readonly Pick<FrameInfo, "validTime">[],
  now = Date.now(),
): number {
  return frames.reduce(
    (best, f, i) =>
      Math.abs(Date.parse(f.validTime) - now) <
      Math.abs(Date.parse(frames[best].validTime) - now)
        ? i
        : best,
    0,
  );
}
/**
 * What a run's age and reach are read from: when it started and the times it
 * publishes. A whole manifest is one; so is the blend's summary of a run
 * (src/spotBlend.ts), which carries the times and nothing else. A run with no
 * map frames states how far it reaches in `horizonHours`; its spot series, when
 * they have been read, say the same.
 */
export interface RunTimes {
  /** The catalog id, which sets how old a run may get before it is stale. */
  model?: string;
  runTime: string;
  frames: readonly Pick<FrameInfo, "validTime">[];
  horizonHours?: number;
  spotForecasts?: Readonly<Record<string, readonly { validTime: string }[]>>;
  spotMembers?: Readonly<Record<string, readonly { validTime: string }[]>>;
}

/** Last time the manifest covers: its last frame, or its stated horizon. */
export function lastValidTime(m: RunTimes): number | null {
  if (m.frames.length)
    return Date.parse(m.frames[m.frames.length - 1].validTime);
  if (Number.isFinite(m.horizonHours) && Number.isFinite(Date.parse(m.runTime)))
    return Date.parse(m.runTime) + m.horizonHours! * 3600000;
  const times = [
    ...Object.values(m.spotForecasts ?? {}),
    ...Object.values(m.spotMembers ?? {}),
  ].flatMap((series) =>
    series.length ? [Date.parse(series[series.length - 1].validTime)] : [],
  );
  return times.length ? Math.max(...times) : null;
}
/**
 * `expired` once the run's last hour is behind us; `stale` once it is older
 * than its model's schedule allows (catalog.ts's `staleAfterHours`), which a
 * once-a-day run on time never is; otherwise `fresh`.
 */
export function freshness(
  m: RunTimes,
  now = Date.now(),
): "expired" | "stale" | "fresh" {
  const last = lastValidTime(m);
  if (last === null || last < now) return "expired";
  if (isStale(m.model, Date.parse(m.runTime), now)) return "stale";
  return "fresh";
}
// Built once: a formatter costs tens of microseconds to construct and well
// under one to use, and the dock labels several hundred cells per render.
const TIME_LABEL = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DAY_LABEL = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  weekday: "short",
  day: "numeric",
  month: "short",
});
export const timeLabel = (iso: string) => TIME_LABEL.format(new Date(iso));
export const dayLabel = (iso: string) => DAY_LABEL.format(new Date(iso));
