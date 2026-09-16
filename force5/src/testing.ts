// Synthetic manifests for unit tests. Not exported from index.ts and never
// bundled into the app; the bundled snapshots in public/weather remain the
// acceptance data.
import type { WaveManifest, WaveStep, WaveVariable } from "./waves";
import type { Manifest, MemberFrame, Wind } from "./weather";

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
  schemaVersion: 1,
  model,
  modelName: model,
  provider: "test",
  run: runTime.replace(/\D/g, "").slice(0, 10),
  runTime,
  generatedAt: runTime,
  resolutionKm: 2,
  stepHours: 3,
  grid: testGrid,
  frames: [],
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
  return {
    ...base(model, runTime),
    ...(gustKind ? { gustKind } : {}),
    frames: hours.map((hour) => ({
      hour,
      validTime: validTime(runTime, hour),
      url: `weather/${model}-${hour}.json`,
      gustIntervalHours: interval(hour),
    })),
    spotForecasts: {
      [spotId]: hours.map((hour, index) => ({
        hour,
        validTime: validTime(runTime, hour),
        ...wind(hour, index),
      })),
    },
    ...extra,
  };
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
  return {
    ...base(model, runTime),
    ensemble: {
      members,
      control: 0,
      description: `${members} synthetic members`,
    },
    frames: withFrames
      ? hours.map((hour) => ({
          hour,
          validTime: validTime(runTime, hour),
          url: `weather/${model}-${hour}.json`,
          gustIntervalHours: [Math.max(0, hour - 3), hour] as [number, number],
        }))
      : [],
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
  };
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
  return {
    schemaVersion: 1,
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
    frames: withFrames
      ? hours.map((hour) => ({
          hour,
          validTime: validTime(runTime, hour),
          url: `weather/${model}-${hour}.json`,
          gustIntervalHours: null,
        }))
      : [],
    ...(withFrames ? { grid: testGrid } : {}),
    spotSeries: { [spotId]: series },
    sourceUrl: "https://example.test/waves",
    attribution: "Test wave data",
    licenseUrl: "https://example.test/licence",
    ...extra,
  };
}
