// Synthetic manifests for unit tests. Not exported from index.ts and never
// bundled into the app; the bundled snapshots in public/weather remain the
// acceptance data.
//
// Each builder returns a run as a reader holds it once its spot squares have
// been merged in: a schemaVersion 2 pointer (`base`, `spots`, a wind run's
// `tiles` or a wave run's frame urls inside the run directory) with its
// per-spot keys inline. `pointerOf` strips those
// keys again, which is what a validator or the loader is handed, and
// `squareReader` serves the squares the loader would read.
import locations from "../../public/riding-locations.json";
import {
  RUN_SCHEMA_VERSION,
  SPOT_KEYS,
  SQUARE_URL,
  runPath,
  spotSquare,
  type ReadJson,
  type SpotIndex,
  type SpotKey,
} from "./spotData";
import {
  TILE_BORDER,
  TILE_ENCODING,
  TILE_SIZE,
  TILE_URL,
  levelCellDegrees,
  tileLevels,
  type TilesSpec,
} from "./f5tile";
import type { WeatherManifest, WeatherStep } from "./surface";
import type { BundleVariable } from "./variables";
import type { WaveManifest, WaveStep, WaveVariable } from "./waves";
import {
  manifestPath,
  type Grid,
  type Manifest,
  type MemberFrame,
  type Wind,
} from "./weather";

/** Where a test spot is: the riding location of that id, or the middle of Ireland. */
const coordinates = new Map(
  (locations as { id: string; lat: number; lon: number }[]).map((spot) => [
    spot.id,
    spot,
  ]),
);
export const testSquare = (spotId: string): string => {
  const spot = coordinates.get(spotId);
  return spot ? spotSquare(spot.lat, spot.lon) : "n52w010";
};

/** A run directory name for a synthetic run, as the publisher names one. */
export const testBase = (model: string, runTime: string) =>
  `${model}-${runTime.replace(/\D/g, "").slice(0, 10)}-test-v1-0a0b0c0d/`;

/** The `spots` index a run with this spot data publishes. */
export function spotIndexOf(manifest: object): SpotIndex {
  const keys = SPOT_KEYS.filter((key) => key in manifest);
  const squares = new Set<string>();
  for (const key of keys)
    for (const spot of Object.keys(
      (manifest as Record<string, Record<string, unknown>>)[key] ?? {},
    ))
      squares.add(testSquare(spot));
  return {
    squareDegrees: 2,
    url: SQUARE_URL,
    squares: [...squares].sort(),
    keys,
  };
}

/** Recompute a merged fixture's `spots` index after its spot data changed. */
export const indexed = <M extends object>(manifest: M): M => ({
  ...manifest,
  spots: spotIndexOf(manifest),
});

/** The pointer a merged fixture was split from: no per-spot keys. */
export function pointerOf<M extends object>(manifest: M): M {
  const pointer = { ...manifest } as Record<string, unknown>;
  for (const key of SPOT_KEYS) delete pointer[key];
  return pointer as M;
}

/**
 * A reader serving the spot squares of merged fixtures at the paths the loader
 * asks for, and recording every path asked. Anything else is not there.
 */
export function squareReader(
  ...manifests: (Manifest | WaveManifest | WeatherManifest)[]
): ReadJson & { asked: string[] } {
  const files = new Map<string, unknown>();
  for (const manifest of manifests) {
    const index = spotIndexOf(manifest);
    for (const square of index.squares) {
      const file: Record<string, unknown> = {
        schemaVersion: RUN_SCHEMA_VERSION,
        model: manifest.model,
        run: manifest.run,
        square,
      };
      for (const key of index.keys as SpotKey[]) {
        const values = Object.entries(
          (manifest as unknown as Record<string, Record<string, unknown>>)[key],
        ).filter(([spot]) => testSquare(spot) === square);
        if (values.length) file[key] = Object.fromEntries(values);
      }
      files.set(
        runPath(
          manifestPath(manifest),
          manifest.base,
          SQUARE_URL.replace("{square}", square),
        ),
        file,
      );
    }
  }
  const asked: string[] = [];
  const read = (async (path: string) => {
    asked.push(path);
    return files.has(path) ? structuredClone(files.get(path)) : null;
  }) as ReadJson & { asked: string[] };
  read.asked = asked;
  return read;
}

const frameUrl = (hour: number, suffix = "json") =>
  `frames/${String(hour).padStart(3, "0")}.${suffix}`;

/**
 * The `tiles` block a wind run on `grid` publishes, as the publisher writes it
 * (force5/ingest/f5tile.py, `manifest_tiles`): every level, nothing absent
 * unless asked.
 */
export function tilesFor(
  grid: Grid,
  frames: readonly { gustIntervalHours: [number, number] | null }[],
  {
    size = TILE_SIZE,
    absent = {},
  }: { size?: number; absent?: Record<number, [number, number][]> } = {},
): TilesSpec {
  return {
    size,
    border: TILE_BORDER,
    encoding: TILE_ENCODING,
    blocks: frames.some((frame) => frame.gustIntervalHours !== null)
      ? ["u", "v", "gust"]
      : ["u", "v"],
    url: TILE_URL,
    levels: tileLevels(grid, size).map((level) => ({
      ...level,
      ...levelCellDegrees(grid, level.level),
      absent: absent[level.level] ?? [],
    })),
  };
}

export const testGrid = {
  width: 2,
  height: 2,
  west: -10,
  east: -9,
  north: 54,
  south: 53,
  dx: 1,
  dy: 1,
};

const validTime = (runTime: string, hour: number) =>
  new Date(Date.parse(runTime) + hour * 3600000).toISOString();

const base = (model: string, runTime: string): Manifest => ({
  schemaVersion: RUN_SCHEMA_VERSION,
  model,
  modelName: model,
  provider: "test",
  run: runTime.replace(/\D/g, "").slice(0, 10),
  runTime,
  generatedAt: runTime,
  resolutionKm: 2,
  stepHours: 3,
  grid: testGrid,
  base: testBase(model, runTime),
  frames: [],
  spots: spotIndexOf({}),
  spotForecasts: {},
  sourceUrl: "https://example.test/source",
  attribution: "Test data",
  licenseUrl: "https://example.test/licence",
});

export interface WindFixture {
  model?: string;
  runTime?: string;
  hours?: number[];
  spotId?: string;
  /** Series generator; the default ramps a southerly wind. */
  wind?: (hour: number, index: number) => Wind;
  gustKind?: Manifest["gustKind"];
  extra?: Partial<Manifest>;
}

/** A deterministic wind manifest with frames and one precomputed spot series. */
export function windManifest(options: WindFixture = {}): Manifest {
  const {
    model = "icon-eu",
    runTime = "2026-09-14T00:00:00Z",
    hours = [0, 3, 6],
    spotId = "brandon",
    wind = (hour: number) => ({ u: 0, v: hour, gust: hour + 2 }),
    gustKind,
    extra = {},
  } = options;
  const interval = (hour: number): [number, number] =>
    gustKind === "instantaneous" ? [hour, hour] : [Math.max(0, hour - 3), hour];
  const frames = hours.map((hour) => ({
    hour,
    validTime: validTime(runTime, hour),
    gustIntervalHours: interval(hour),
  }));
  return indexed({
    ...base(model, runTime),
    ...(gustKind ? { gustKind } : {}),
    frames,
    tiles: tilesFor(testGrid, frames),
    spotForecasts: {
      [spotId]: hours.map((hour, index) => ({
        hour,
        validTime: validTime(runTime, hour),
        ...wind(hour, index),
      })),
    },
    ...extra,
  });
}

export interface EnsembleFixture extends WindFixture {
  members?: number;
  member?: (member: number, hour: number) => Wind;
  /** Chart-only ensembles publish no map frames. */
  withFrames?: boolean;
}

/** An ensemble manifest: per-member spot series plus the mean in spotForecasts. */
export function ensembleManifest(options: EnsembleFixture = {}): Manifest {
  const {
    model = "ecmwf-ens",
    runTime = "2026-09-14T00:00:00Z",
    hours = [0, 3, 6],
    spotId = "brandon",
    members = 3,
    member = (index: number, hour: number) => ({
      u: 0,
      v: hour + index,
      gust: hour + index + 2,
    }),
    withFrames = false,
    extra = {},
  } = options;
  const spotMembers: MemberFrame[] = hours.map((hour) => ({
    hour,
    validTime: validTime(runTime, hour),
    u: Array.from({ length: members }, (_, i) => member(i, hour).u),
    v: Array.from({ length: members }, (_, i) => member(i, hour).v),
    gust: Array.from({ length: members }, (_, i) => member(i, hour).gust),
  }));
  const mean = (values: (number | null)[]) =>
    values.some((value) => value === null)
      ? null
      : (values as number[]).reduce((sum, value) => sum + value, 0) /
        values.length;
  const frames = withFrames
    ? hours.map((hour) => ({
        hour,
        validTime: validTime(runTime, hour),
        gustIntervalHours: [Math.max(0, hour - 3), hour] as [number, number],
      }))
    : [];
  return indexed({
    ...base(model, runTime),
    ...(withFrames ? {} : { horizonHours: hours[hours.length - 1] }),
    ensemble: {
      members,
      control: 0,
      description: `${members} synthetic members`,
    },
    frames,
    ...(withFrames ? { tiles: tilesFor(testGrid, frames) } : {}),
    spotMembers: { [spotId]: spotMembers },
    spotForecasts: {
      [spotId]: spotMembers.map((frame) => ({
        hour: frame.hour,
        validTime: frame.validTime,
        u: mean(frame.u)!,
        v: mean(frame.v)!,
        gust: mean(frame.gust),
      })),
    },
    ...extra,
  });
}

/** The nine GFS-Wave variables, partitions included, as the importer names them. */
export const GFS_WAVE_VARIABLES: Record<string, WaveVariable> =
  Object.fromEntries(
    (
      [
        ["swh", "m", "Wave height"],
        ["pp1d", "s", "Peak period"],
        ["mwd", "degrees true", "Peak direction"],
        ["shww", "m", "Wind-wave height"],
        ["mpww", "s", "Wind-wave period"],
        ["mdww", "degrees true", "Wind-wave direction"],
        ["swell1_h", "m", "Primary swell height"],
        ["swell1_p", "s", "Primary swell period"],
        ["swell1_d", "degrees true", "Primary swell direction"],
      ] as const
    ).map(([name, units, label]) => [
      name,
      { units, label, description: `${label}, synthetic` },
    ]),
  );
/**
 * ECMWF's 0.25° wave stream: the whole sea, and period-band heights instead of a
 * swell partition, so `waveFields` finds a total row and nothing else.
 */
export const ECMWF_WAVE_VARIABLES: Record<string, WaveVariable> =
  Object.fromEntries(
    (
      [
        ["swh", "m", "Wave height"],
        ["mwd", "degrees true", "Mean wave direction"],
        ["pp1d", "s", "Peak period"],
        ["mwp", "s", "Mean wave period"],
        ["h1012", "m", "10–12 s wave height"],
        ["h1214", "m", "12–14 s wave height"],
        ["h1417", "m", "14–17 s wave height"],
        ["h1721", "m", "17–21 s wave height"],
        ["h2125", "m", "21–25 s wave height"],
        ["h2530", "m", "25–30 s wave height"],
      ] as const
    ).map(([name, units, label]) => [
      name,
      { units, label, description: `${label}, synthetic` },
    ]),
  );
/** Irish Shelf SWAN: a swell height but no swell period, and a derived wind sea. */
export const SWAN_VARIABLES: Record<string, WaveVariable> = Object.fromEntries(
  (
    [
      ["swh", "m", "Wave height"],
      ["hswe", "m", "Swell height"],
      ["shww", "m", "Wind-sea height"],
      ["mwp", "s", "Mean period"],
      ["pp1d", "s", "Peak period"],
      ["mwd", "deg", "Mean direction"],
    ] as const
  ).map(([name, units, label]) => [
    name,
    { units, label, description: `${label}, synthetic` },
  ]),
);

export interface WaveFixture {
  model?: string;
  runTime?: string;
  hours?: number[];
  spotId?: string;
  variables?: Record<string, WaveVariable>;
  /** Value generator; omitted variables are published as null, as land is. */
  values?: (
    hour: number,
    index: number,
  ) => Record<string, number | null> | null;
  withFrames?: boolean;
  extra?: Partial<WaveManifest>;
}

/** A wave manifest with one precomputed spot series and no frames by default. */
export function waveManifest(options: WaveFixture = {}): WaveManifest {
  const {
    model = "gfs-wave",
    runTime = "2026-09-16T18:00:00Z",
    hours = [0, 3, 6],
    spotId = "brandon",
    variables = GFS_WAVE_VARIABLES,
    values = (hour: number): Record<string, number | null> => ({
      swh: 1 + hour / 10,
      pp1d: 9,
      mwd: 300,
    }),
    withFrames = false,
    extra = {},
  } = options;
  const step = hours.length > 1 ? hours[1] - hours[0] : 3;
  const series: WaveStep[] = hours.map((hour, index) => ({
    hour,
    validTime: validTime(runTime, hour),
    values: Object.fromEntries(
      Object.keys(variables).map((name) => [
        name,
        values(hour, index)?.[name] ?? null,
      ]),
    ),
  }));
  return indexed({
    schemaVersion: RUN_SCHEMA_VERSION,
    kind: "wave",
    model,
    modelName: model,
    provider: "test",
    run: runTime.replace(/\D/g, "").slice(0, 10),
    runTime,
    generatedAt: runTime,
    stepHours: step,
    ...(withFrames ? {} : { horizonHours: hours[hours.length - 1] }),
    resolutionKm: 9,
    variables,
    base: testBase(model, runTime),
    frames: withFrames
      ? hours.map((hour) => ({
          hour,
          validTime: validTime(runTime, hour),
          url: frameUrl(hour),
          gustIntervalHours: null,
        }))
      : [],
    spots: spotIndexOf({}),
    ...(withFrames ? { grid: testGrid } : {}),
    spotSeries: { [spotId]: series },
    sourceUrl: "https://example.test/waves",
    attribution: "Test wave data",
    licenseUrl: "https://example.test/licence",
    ...extra,
  });
}

/** ICON-EU's own surface variables, including the present-weather code table. */
export const ICON_WEATHER_VARIABLES: Record<string, BundleVariable> = {
  ...Object.fromEntries(
    (
      [
        ["t2m", "°C", "Air temperature"],
        ["td2m", "°C", "Dew point"],
        ["rh2m", "%", "Relative humidity"],
        ["tp", "mm", "Precipitation since run"],
        ["precip", "mm", "Precipitation"],
        ["clct", "%", "Total cloud"],
        ["clcl", "%", "Low cloud"],
        ["clcm", "%", "Medium cloud"],
        ["clch", "%", "High cloud"],
        ["pmsl", "hPa", "Pressure (MSL)"],
        ["vis", "km", "Visibility"],
        ["cape", "J/kg", "CAPE (mean layer)"],
        ["tg", "°C", "Surface temperature"],
      ] as const
    ).map(([name, units, label]): [string, BundleVariable] => [
      name,
      { units, label, description: `${label}, synthetic` },
    ]),
  ),
  // The one code-table variable: whole codes, never a measurement.
  ww: {
    units: "WMO code",
    label: "Present weather",
    description: "Present-weather code, synthetic",
    kind: "code",
  },
};

export interface WeatherFixture {
  model?: string;
  runTime?: string;
  hours?: number[];
  spotId?: string;
  variables?: Record<string, BundleVariable>;
  /** Value generator; omitted variables are published as null. */
  values?: (
    hour: number,
    index: number,
  ) => Record<string, number | null> | null;
  withFrames?: boolean;
  extra?: Partial<WeatherManifest>;
}

/**
 * A surface-weather manifest with one precomputed spot series. `precip` and its
 * interval are null at hour zero, as the importer publishes them.
 */
export function weatherManifest(options: WeatherFixture = {}): WeatherManifest {
  const {
    model = "icon-eu-weather",
    runTime = "2026-09-16T18:00:00Z",
    hours = [0, 3, 6],
    spotId = "brandon",
    variables = ICON_WEATHER_VARIABLES,
    values = (hour: number): Record<string, number | null> => ({
      t2m: 15 + hour / 10,
      td2m: 12.8,
      rh2m: 83,
      tp: hour / 10,
      precip: hour === 0 ? null : 0.3,
      clct: 97,
      clcl: 89,
      clcm: 73,
      clch: 0,
      pmsl: 1016.8,
      vis: 28.1,
      cape: 7,
      ww: hour === 0 ? 3 : 61,
      tg: 15.7,
    }),
    withFrames = false,
    extra = {},
  } = options;
  const step = hours.length > 1 ? hours[1] - hours[0] : 3;
  const interval = (hour: number): [number, number] | null =>
    hour === hours[0] ? null : [hour - step, hour];
  const series: WeatherStep[] = hours.map((hour, index) => ({
    hour,
    validTime: validTime(runTime, hour),
    precipIntervalHours: interval(hour),
    values: Object.fromEntries(
      Object.keys(variables).map((name) => [
        name,
        values(hour, index)?.[name] ?? null,
      ]),
    ),
  }));
  return indexed({
    schemaVersion: RUN_SCHEMA_VERSION,
    kind: "weather",
    model,
    modelName: model,
    provider: "DWD",
    run: runTime.replace(/\D/g, "").slice(0, 10),
    runTime,
    generatedAt: runTime,
    stepHours: step,
    ...(withFrames ? {} : { horizonHours: hours[hours.length - 1] }),
    resolutionKm: 6.5,
    variables,
    base: testBase(model, runTime),
    frames: withFrames
      ? hours.map((hour) => ({
          hour,
          validTime: validTime(runTime, hour),
          url: frameUrl(hour),
          precipIntervalHours: interval(hour),
        }))
      : [],
    spots: spotIndexOf({}),
    ...(withFrames ? { grid: testGrid } : {}),
    frameVariables: withFrames
      ? ["t2m", "precip", "clct", "pmsl", "ww"]
      : undefined,
    spotSeries: { [spotId]: series },
    sourceUrl: "https://example.test/weather",
    attribution: "Test surface weather",
    licenseUrl: "https://example.test/licence",
    ...extra,
  });
}
