import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearManifestCache, loadWaveManifest } from "./manifests";
import {
  ECMWF_WAVE_VARIABLES,
  GFS_WAVE_VARIABLES,
  SWAN_VARIABLES,
  pointerOf,
  waveManifest,
} from "./testing";
import {
  MAX_WAVE_HORIZON_HOURS,
  WAVE_MATCH_HOURS,
  WAVE_SOURCE_PREFERENCE,
  preferredWaveSource,
  validateWaveManifest,
  validateWaveSpots,
  waveAtAxis,
  waveCoverageNote,
  waveFields,
  waveHours,
  waveSeries,
  waveSeriesHasData,
  type WaveManifest,
} from "./waves";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
/**
 * A wave run as the site reads it: the pointer validated as published, without
 * its spot data, and the series as they arrive from the squares.
 */
const checkWave = (m: WaveManifest): WaveManifest => {
  validateWaveManifest(pointerOf(m));
  return validateWaveSpots(m);
};
const broken = (extra: Partial<WaveManifest>) =>
  waveManifest({ extra }) as unknown as WaveManifest;

beforeEach(() => clearManifestCache());
afterEach(() => vi.unstubAllGlobals());

describe("wave manifest contract", () => {
  it("accepts a frameless bundle that declares its horizon", () => {
    const manifest = checkWave(waveManifest());
    expect(manifest.kind).toBe("wave");
    expect(manifest.frames).toEqual([]);
    expect(waveHours(manifest)).toEqual([0, 3, 6]);
  });
  it("accepts a bundle whose frames imply the horizon", () => {
    const manifest = checkWave(
      waveManifest({ withFrames: true, hours: [0, 3, 6, 9] }),
    );
    expect(manifest.frames).toHaveLength(4);
    expect(waveHours(manifest)).toEqual([0, 3, 6, 9]);
  });
  it("expands an explicit cadence ladder", () => {
    expect(
      waveHours({
        stepHours: 3,
        stepRanges: [
          { throughHour: 6, stepHours: 3 },
          { throughHour: 18, stepHours: 6 },
        ],
        frames: [],
      } as unknown as WaveManifest),
    ).toEqual([0, 3, 6, 12, 18]);
  });
  it("rejects a ladder whose declared step is not its first range", () => {
    expect(() =>
      waveHours({
        stepHours: 1,
        stepRanges: [{ throughHour: 6, stepHours: 3 }],
        frames: [],
      } as unknown as WaveManifest),
    ).toThrow(/Invalid wave forecast manifest/);
  });
  it("refuses a missing or wrong kind, version and identity", () => {
    for (const extra of [
      { kind: "wind" },
      { schemaVersion: 1 },
      { model: "" },
      { provider: "  " },
      { attribution: "" },
      { runTime: "not a time" },
    ] as Partial<WaveManifest>[])
      expect(() => checkWave(broken(extra))).toThrow(
        /Invalid wave forecast manifest/,
      );
    expect(() => checkWave(null as unknown as WaveManifest)).toThrow(
      /Invalid wave forecast manifest/,
    );
  });
  it("demands a variable map with units, label and description", () => {
    for (const variables of [
      {},
      { Swh: { units: "m", label: "H", description: "d" } },
      { swh: { units: "m", label: "H" } },
      { swh: { units: " ", label: "H", description: "d" } },
    ])
      expect(() =>
        checkWave(broken({ variables } as Partial<WaveManifest>)),
      ).toThrow(/Invalid wave forecast manifest/);
  });
  it("refuses a frameless bundle with no usable horizon", () => {
    for (const horizonHours of [
      undefined,
      0,
      4,
      MAX_WAVE_HORIZON_HOURS + 3,
      1.5,
    ])
      expect(() =>
        checkWave(
          waveManifest({ extra: { horizonHours } as Partial<WaveManifest> }),
        ),
      ).toThrow(/Invalid wave forecast manifest/);
  });
  it("refuses a horizon that disagrees with the published cadence", () => {
    expect(() =>
      checkWave(
        waveManifest({ withFrames: true, extra: { horizonHours: 99 } }),
      ),
    ).toThrow(/Invalid wave forecast manifest/);
  });
  it("refuses frames that are misordered, mistimed or off-site", () => {
    const manifest = checkWave(waveManifest({ withFrames: true }));
    for (const mutate of [
      (m: WaveManifest) => (m.frames[1].hour = 4),
      (m: WaveManifest) => (m.frames[1].validTime = "2026-01-01T00:00:00Z"),
      (m: WaveManifest) => (m.frames[1].url = "../secrets.json"),
      (m: WaveManifest) => (m.frames[1].url = "https://elsewhere.test/f.json"),
    ]) {
      const copy = JSON.parse(JSON.stringify(manifest)) as WaveManifest;
      mutate(copy);
      expect(() => checkWave(copy)).toThrow(/Invalid wave forecast manifest/);
    }
  });
  it("requires frameVariables to be a distinct subset of the variables", () => {
    expect(
      checkWave(
        waveManifest({
          withFrames: true,
          extra: { frameVariables: ["swh", "mwd"] },
        }),
      ).frameVariables,
    ).toEqual(["swh", "mwd"]);
    for (const frameVariables of [[], ["swh", "swh"], ["swh", "nope"]])
      expect(() =>
        checkWave(
          waveManifest({ withFrames: true, extra: { frameVariables } }),
        ),
      ).toThrow(/Invalid wave forecast manifest/);
  });
  it("requires every spot series to cover every step and every variable", () => {
    const manifest = checkWave(waveManifest());
    for (const mutate of [
      (m: WaveManifest) => m.spotSeries!.brandon.pop(),
      (m: WaveManifest) => (m.spotSeries!.brandon[1].hour = 4),
      (m: WaveManifest) =>
        (m.spotSeries!.brandon[1].validTime = "2026-01-01T00:00:00Z"),
      (m: WaveManifest) => delete m.spotSeries!.brandon[1].values.mwd,
      (m: WaveManifest) => (m.spotSeries!.brandon[1].values.extra = 1),
      // Land and unresolved cells are null, and a value is bounded.
      (m: WaveManifest) => (m.spotSeries!.brandon[1].values.swh = 1e6),
      (m: WaveManifest) =>
        ((m.spotSeries!.brandon[1].values as Record<string, unknown>).swh =
          "1.2"),
    ]) {
      const copy = JSON.parse(JSON.stringify(manifest)) as WaveManifest;
      mutate(copy);
      expect(() => checkWave(copy)).toThrow(/Invalid wave forecast manifest/);
    }
    // A run whose squares carry no series is not a wave run at all; a square
    // read for one place may well hold none of this model's series.
    expect(() =>
      validateWaveManifest(
        pointerOf({ ...manifest, spots: { ...manifest.spots, keys: [] } }),
      ),
    ).toThrow(/Invalid wave forecast manifest/);
    expect(checkWave({ ...manifest, spotSeries: {} }).spotSeries).toEqual({});
  });
  it("accepts an all-null series: a location the model cannot resolve", () => {
    const manifest = checkWave(
      waveManifest({ spotId: "rusheen", values: () => null }),
    );
    expect(waveSeries(manifest, "rusheen")).toHaveLength(3);
    expect(waveSeriesHasData(waveSeries(manifest, "rusheen"))).toBe(false);
  });
});

describe("reading a wave series", () => {
  const manifest = checkWave(waveManifest());
  it("returns a series only for a spot it publishes", () => {
    expect(waveSeries(manifest, "brandon")).toHaveLength(3);
    expect(waveSeries(manifest, "dollymount")).toBeNull();
    expect(waveSeries(manifest, undefined)).toBeNull();
  });
  it("takes the nearest native step inside the tolerance and nothing else", () => {
    const columns = waveAtAxis(manifest.spotSeries!.brandon, [
      "2026-09-16T18:00:00Z", // exactly the run hour
      "2026-09-16T19:00:00Z", // an hour past it, inside 1.5 h
      "2026-09-16T20:00:00Z", // an hour before +3, inside 1.5 h
      "2026-09-17T00:00:00Z", // +6, the last step
      "2026-09-17T03:00:00Z", // three hours past the horizon
      "not a time",
    ]);
    expect(columns.map((step) => step?.hour ?? null)).toEqual([
      0,
      0,
      3,
      6,
      null,
      null,
    ]);
  });
  it("never interpolates between two steps", () => {
    // Half way between +0 and +3 is outside the tolerance from both, so the
    // column is empty rather than holding an averaged sea state.
    const [mid] = waveAtAxis(
      manifest.spotSeries!.brandon,
      ["2026-09-16T19:30:00Z"],
      0.4,
    );
    expect(mid).toBeNull();
    expect(WAVE_MATCH_HOURS).toBe(1.5);
  });
});

describe("coverage notes", () => {
  it("speaks only when GFS-Wave has something to explain", () => {
    const note = "Every cell reaching it is land.";
    const manifest = waveManifest({
      extra: {
        spotCoverage: {
          brandon: { landMasked: false, resolved: true, note: "open water" },
          inchydoney: { landMasked: true, resolved: true, note },
          rusheen: { landMasked: true, resolved: false, note },
        },
      },
    });
    expect(waveCoverageNote(manifest, "brandon")).toBeNull();
    expect(waveCoverageNote(manifest, "inchydoney")).toBe(note);
    expect(waveCoverageNote(manifest, "rusheen")).toBe(note);
    expect(waveCoverageNote(manifest, "unknown-spot")).toBeNull();
    expect(waveCoverageNote(manifest, undefined)).toBeNull();
  });
  it("reads Irish Shelf SWAN's own spot records instead", () => {
    const manifest = waveManifest({
      model: "mi-swan",
      variables: SWAN_VARIABLES,
      extra: {
        spotCells: {
          brandon: { dataset: "shelf", nearestOffsetKm: 0 },
          keel: { dataset: "shelf", nearestOffsetKm: 2.4 },
          "mountshannon-lough-derg": {
            dataset: null,
            reason: "This location is inland.",
          },
        },
      },
    });
    expect(waveCoverageNote(manifest, "brandon")).toBeNull();
    expect(waveCoverageNote(manifest, "keel")).toContain("2.4 km");
    expect(waveCoverageNote(manifest, "mountshannon-lough-derg")).toBe(
      "This location is inland.",
    );
  });
});

describe("partition fields", () => {
  it("maps GFS-Wave's whole spectrum and both partitions", () => {
    expect(waveFields(waveManifest())).toEqual({
      total: { height: "swh", period: "pp1d", direction: "mwd" },
      swell: { height: "swell1_h", period: "swell1_p", direction: "swell1_d" },
      windsea: { height: "shww", period: "mpww", direction: "mdww" },
    });
  });
  it("maps SWAN, whose swell has a height but no period or direction", () => {
    expect(waveFields(waveManifest({ variables: SWAN_VARIABLES }))).toEqual({
      total: { height: "swh", period: "pp1d", direction: "mwd" },
      swell: { height: "hswe", period: null, direction: null },
      windsea: { height: "shww", period: null, direction: null },
    });
  });
  it("reports no partitions when a source publishes only the total sea", () => {
    const fields = waveFields(
      waveManifest({
        variables: {
          swh: GFS_WAVE_VARIABLES.swh,
          mwp: { units: "s", label: "Mean period", description: "tm02" },
        },
      }),
    );
    expect(fields).toEqual({
      total: { height: "swh", period: "mwp", direction: null },
      swell: null,
      windsea: null,
    });
  });
  it("reports nothing at all without a wave height", () => {
    expect(
      waveFields(waveManifest({ variables: { hswe: SWAN_VARIABLES.hswe } })),
    ).toBeNull();
  });
});

describe("choosing a source per spot", () => {
  const swan = waveManifest({
    model: "mi-swan",
    variables: SWAN_VARIABLES,
    values: (hour) => ({ swh: 2 + hour / 10, pp1d: 11, mwd: 280 }),
  });
  const gfs = waveManifest();
  const ecmwf = waveManifest({
    model: "ecmwf-wave",
    variables: ECMWF_WAVE_VARIABLES,
    values: (hour) => ({ swh: 3 + hour / 10, pp1d: 13, mwd: 290, h1417: 1.4 }),
  });
  it("ranks the shelf model, then GFS-Wave, then ECMWF's coarse stream", () => {
    expect(WAVE_SOURCE_PREFERENCE).toEqual([
      "mi-swan",
      "gfs-wave",
      "ecmwf-wave",
    ]);
  });
  it("takes ECMWF Wave last, whatever order the manifests arrive in", () => {
    // 0.25° is the coarsest of the three, so it only wins when nothing finer can
    // see the spot — not because it happened to load first.
    expect(
      preferredWaveSource([ecmwf, gfs, swan], "brandon")?.manifest.model,
    ).toBe("mi-swan");
    expect(preferredWaveSource([ecmwf, gfs], "brandon")?.manifest.model).toBe(
      "gfs-wave",
    );
  });
  it("falls back to ECMWF Wave when both finer models are blind here", () => {
    const blind = (model: string, variables: typeof SWAN_VARIABLES) =>
      waveManifest({ model, variables, values: () => null });
    const source = preferredWaveSource(
      [
        blind("mi-swan", SWAN_VARIABLES),
        blind("gfs-wave", GFS_WAVE_VARIABLES),
        ecmwf,
      ],
      "brandon",
    );
    expect(source?.manifest.model).toBe("ecmwf-wave");
    // Its band heights are not a partition, so only the total row is offered.
    expect(source?.fields.total).toEqual({
      height: "swh",
      period: "pp1d",
      direction: "mwd",
    });
    expect(source?.fields.swell).toBeNull();
    expect(source?.fields.windsea).toBeNull();
  });
  it("explains a spot ECMWF Wave read from the nearest cell it solved", () => {
    const offset = waveManifest({
      model: "ecmwf-wave",
      variables: ECMWF_WAVE_VARIABLES,
      values: () => ({ swh: 2.1, pp1d: 12, mwd: 275 }),
      extra: {
        spotCoverage: {
          brandon: {
            landMasked: true,
            resolved: true,
            nearestOffsetKm: 18.3,
            note: "read 18.3 km offshore",
          },
        },
      },
    });
    expect(preferredWaveSource([offset], "brandon")?.note).toBe(
      "read 18.3 km offshore",
    );
  });
  it("prefers the Irish shelf model when it resolves the spot", () => {
    expect(preferredWaveSource([gfs, swan], "brandon")?.manifest.model).toBe(
      "mi-swan",
    );
  });
  it("falls back to GFS-Wave when the shelf model publishes only nulls", () => {
    const blind = waveManifest({
      model: "mi-swan",
      variables: SWAN_VARIABLES,
      values: () => null,
    });
    expect(preferredWaveSource([gfs, blind], "brandon")?.manifest.model).toBe(
      "gfs-wave",
    );
  });
  it("reports nothing when no source can see the spot", () => {
    expect(preferredWaveSource([gfs, swan], "dollymount")).toBeNull();
    expect(preferredWaveSource([], "brandon")).toBeNull();
  });
  it("carries the coverage note of the source it chose", () => {
    const noted = waveManifest({
      extra: {
        spotCoverage: {
          brandon: { landMasked: true, resolved: true, note: "next cell over" },
        },
      },
    });
    expect(preferredWaveSource([noted], "brandon")?.note).toBe(
      "next cell over",
    );
  });
});

describe("loading a wave manifest", () => {
  it("validates it and serves it from the shared manifest cache", async () => {
    const fetcher = vi.fn(async () =>
      ok(pointerOf(waveManifest({ model: "gfs-wave", withFrames: true }))),
    );
    vi.stubGlobal("fetch", fetcher);
    const first = await loadWaveManifest("gfs-wave");
    expect(first.model).toBe("gfs-wave");
    expect(await loadWaveManifest("gfs-wave")).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses a wind manifest served from a wave URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ schemaVersion: 1, kind: "wind", frames: [] })),
    );
    await expect(loadWaveManifest("gfs-wave")).rejects.toThrow(
      /Invalid wave forecast manifest/,
    );
  });
  it("refuses a wave manifest whose model is not the one requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(pointerOf(waveManifest({ model: "mi-swan" })))),
    );
    await expect(loadWaveManifest("gfs-wave")).rejects.toThrow(
      /does not match/,
    );
  });
});
