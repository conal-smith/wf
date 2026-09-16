// Synthetic manifests for unit tests. Not exported from index.ts and never
// bundled into the app; the bundled snapshots in public/weather remain the
// acceptance data.
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
