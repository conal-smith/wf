import { describe, expect, it } from "vitest";
import {
  GFS_WAVE_VARIABLES,
  SWAN_VARIABLES,
  ECMWF_WAVE_VARIABLES,
  waveManifest,
} from "../force5/src/testing";
import { WAVE_SOURCE_PREFERENCE, type WaveManifest } from "../force5/src/waves";
import {
  buildWaveBlend,
  checkWaveBlendSpots,
  meanDirection,
  median,
  WAVE_BLEND_MODELS,
  waveBlendHours,
  waveBlendMembers,
} from "./waveBlend";

const NOW = new Date("2026-11-04T18:20:00Z");
const RUN = "2026-11-04T00:00:00Z";
const at = (hour: number) =>
  new Date(Date.parse(RUN) + hour * 3600000).toISOString();

type Values = (h: number) => Record<string, number | null>;

/** Irish Shelf SWAN, hourly for `hours`, its swell and derived wind sea. */
const swan = (
  hours: number[],
  values: Values = (h) => ({
    swh: 1.5 + h / 100,
    pp1d: 10,
    mwd: 350,
    hswe: 1.2,
    shww: 0.8,
  }),
) =>
  waveManifest({
    model: "mi-swan",
    runTime: RUN,
    hours,
    variables: SWAN_VARIABLES,
    values,
  });
/** GFS-Wave: the whole sea, a wind sea and a primary swell. */
const gfs = (
  hours: number[],
  values: Values = (h) => ({
    swh: 2 + h / 100,
    pp1d: 12,
    mwd: 10,
    shww: 1,
    mpww: 5,
    mdww: 250,
    swell1_h: 1.7,
    swell1_p: 13,
    swell1_d: 280,
  }),
) =>
  waveManifest({
    model: "gfs-wave",
    runTime: RUN,
    hours,
    variables: GFS_WAVE_VARIABLES,
    values,
  });

const spot = (manifests: WaveManifest[], members?: string[]) => {
  const blend = buildWaveBlend(manifests, NOW, members);
  return {
    blend,
    place: blend.spotWaveBlend.brandon,
    hours: waveBlendHours(blend, "brandon")!,
  };
};

describe("the median", () => {
  it("is the middle value, or the mean of the two middle ones", () => {
    expect(median([])).toBeNull();
    expect(median([3])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([2, 2.4])).toBeCloseTo(2.2);
  });

  it("is what the blend gives for the height and the peak period, with the models' range", () => {
    const ecmwf = waveManifest({
      model: "ecmwf-wave",
      runTime: RUN,
      hours: [0],
      variables: ECMWF_WAVE_VARIABLES,
      values: () => ({ swh: 3, pp1d: 14, mwd: 0 }),
    });
    const { place } = spot(
      [swan([0]), gfs([0]), ecmwf],
      ["mi-swan", "gfs-wave", "ecmwf-wave"],
    );
    expect(place.height).toEqual([200]);
    expect(place.low).toEqual([150]);
    expect(place.high).toEqual([300]);
    expect(place.period).toEqual([120]);
    expect(place.count).toBe("3");
  });
});

describe("the direction", () => {
  it("is a vector mean, so 350° and 10° make 0°, not 180°", () => {
    expect(
      meanDirection([
        { from: 350, weight: 1 },
        { from: 10, weight: 1 },
      ]),
    ).toBeCloseTo(0, 6);
    expect(
      meanDirection([
        { from: 340, weight: 1 },
        { from: 0, weight: 1 },
      ]),
    ).toBeCloseTo(350, 6);
    expect(meanDirection([{ from: 90, weight: 1 }])).toBeCloseTo(90, 6);
    expect(meanDirection([])).toBeNull();
  });

  it("leans to the higher sea, and counts calm models equally when every one is calm", () => {
    // 3 m from 0° and 1 m from 90°: atan(1/3) ≈ 18.4°.
    expect(
      meanDirection([
        { from: 0, weight: 3 },
        { from: 90, weight: 1 },
      ]),
    ).toBeCloseTo(18.43, 1);
    expect(
      meanDirection([
        { from: 0, weight: 0 },
        { from: 90, weight: 0 },
      ]),
    ).toBeCloseTo(45, 6);
  });

  it("is none where the models point opposite ways", () => {
    expect(
      meanDirection([
        { from: 0, weight: 1 },
        { from: 180, weight: 1 },
      ]),
    ).toBeNull();
  });

  it("is published across north as whole degrees", () => {
    // SWAN 1.5 m from 350°, GFS-Wave 2 m from 10°: weighted toward GFS-Wave.
    const { place } = spot([swan([0]), gfs([0])]);
    expect(place.from[0]).toBe(1);
    expect(place.from.every((d) => d === null || (d >= 0 && d < 360))).toBe(
      true,
    );
  });
});

describe("members dropping out with lead time", () => {
  // SWAN's run ends at +3 h; GFS-Wave goes on to +9 h, three-hourly past +3.
  const { blend, place, hours } = spot([
    swan([0, 1, 2, 3]),
    gfs([0, 1, 2, 3, 6, 9]),
  ]);

  it("puts every model on every time any of them publishes", () => {
    expect(blend.times).toEqual([0, 1, 2, 3, 6, 9].map(at));
    expect(blend.sources.map((s) => s.id)).toEqual(["mi-swan", "gfs-wave"]);
    expect(blend.sources[0].columns).toEqual([0, 1, 2, 3]);
    expect(blend.sources[1].columns).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("records which models fed each time and how many", () => {
    expect(place.fed).toEqual([3, 3, 3, 3, 2, 2]);
    expect(place.count).toBe("222211");
    expect(hours.map((h) => h.models)).toEqual([
      ["mi-swan", "gfs-wave"],
      ["mi-swan", "gfs-wave"],
      ["mi-swan", "gfs-wave"],
      ["mi-swan", "gfs-wave"],
      ["gfs-wave"],
      ["gfs-wave"],
    ]);
    expect(hours.map((h) => h.count)).toEqual([2, 2, 2, 2, 1, 1]);
  });

  it("blends what is left once a model's run ends", () => {
    expect(hours[4].heightM).toBeCloseTo(2.06);
    expect(hours[4].lowM).toBe(hours[4].highM);
    expect(hours[4].from).toBe(10);
    expect(hours[4].periodS).toBe(12);
  });

  it("leaves a model out at a time where its step is all nulls, as land is", () => {
    const masked = swan([0, 1], (h) =>
      h === 1
        ? { swh: null, pp1d: null, mwd: null, hswe: null, shww: null }
        : { swh: 1, pp1d: 9, mwd: 300, hswe: 1, shww: 0.2 },
    );
    const { place } = spot([masked, gfs([0, 1])]);
    expect(place.fed).toEqual([3, 2]);
    expect(place.lead).toBe("01");
  });

  it("never interpolates: a three-hourly step reads only the times within 1.5 h of it", () => {
    const { blend, place } = spot([
      swan([0, 1, 2, 3, 4, 5, 6]),
      gfs([0, 3, 6]),
    ]);
    expect(blend.times).toHaveLength(7);
    expect(place.fed).toEqual([3, 3, 3, 3, 3, 3, 3]);
    // +1 h reads GFS-Wave's +0 h step as it is (2 m), +2 h its +3 h step (2.03 m).
    expect(place.high.slice(0, 3)).toEqual([200, 200, 203]);
  });
});

describe("the partitions", () => {
  // SWAN's last step, +1 h, still answers for +2 h (within 1.5 h), not for +3 h.
  const { blend, place, hours } = spot([swan([0, 1]), gfs([0, 1, 2, 3])]);

  it("come from the lead model alone, in the handover order, never averaged", () => {
    expect(place.lead).toBe("0001");
    expect(hours.map((h) => h.lead)).toEqual([
      "mi-swan",
      "mi-swan",
      "mi-swan",
      "gfs-wave",
    ]);
    // SWAN leads: its whole swell and its wind sea, and no GFS-Wave swell partition.
    expect(hours[0].parts).toEqual({
      windsea: { heightM: 0.8, periodS: null, from: null },
      swell: { heightM: 1.2, periodS: null, from: null },
      swell1: { heightM: null, periodS: null, from: null },
    });
    // GFS-Wave leads once SWAN's run has ended: its own wind sea and primary swell.
    expect(hours[3].parts).toEqual({
      windsea: { heightM: 1, periodS: 5, from: 250 },
      swell: { heightM: null, periodS: null, from: null },
      swell1: { heightM: 1.7, periodS: 13, from: 280 },
    });
  });

  it("say which partitions each model publishes", () => {
    expect(blend.sources.map((s) => [s.id, s.partitions])).toEqual([
      ["mi-swan", ["windsea", "swell"]],
      ["gfs-wave", ["windsea", "swell1"]],
    ]);
  });

  it("are none where the lead model publishes none, though a later one does", () => {
    const ecmwf = waveManifest({
      model: "ecmwf-wave",
      runTime: RUN,
      hours: [0],
      variables: ECMWF_WAVE_VARIABLES,
      values: () => ({ swh: 3, pp1d: 14, mwd: 0 }),
    });
    const { place } = spot([gfs([0]), ecmwf], ["ecmwf-wave", "gfs-wave"]);
    expect(place.lead).toBe("0");
    expect(place.parts.swell1!.height).toEqual([null]);
    expect(place.parts.windsea!.height).toEqual([null]);
  });
});

describe("the members", () => {
  it("are the dock's handover order, less what the catalogue does not publish", () => {
    expect(WAVE_BLEND_MODELS).toBe(WAVE_SOURCE_PREFERENCE);
    // ECMWF Wave is retired in the catalogue until it is published again.
    expect(
      waveBlendMembers(["gfs-wave", "ecmwf-wave", "mi-swan", "harmonie"]),
    ).toEqual(["mi-swan", "gfs-wave"]);
    expect(
      waveBlendMembers(
        ["gfs-wave", "new-wave"],
        ["new-wave", "gfs-wave"],
        ["gfs-wave", "new-wave"],
      ),
    ).toEqual(["new-wave", "gfs-wave"]);
  });

  it("are read in the members' order whatever order the manifests come in", () => {
    const { blend } = spot([gfs([0]), swan([0])]);
    expect(blend.sources.map((s) => s.id)).toEqual(["mi-swan", "gfs-wave"]);
  });

  it("leave out a place no model has a sea state for", () => {
    const land = gfs([0], () => ({ swh: null }));
    expect(buildWaveBlend([land], NOW).spotWaveBlend).toEqual({});
  });
});

describe("a square's places", () => {
  const { blend } = spot([swan([0, 1]), gfs([0, 1, 2, 3, 6])]);

  it("pass the check they were built to", () => {
    expect(checkWaveBlendSpots(blend, blend.spotWaveBlend)).toBe(
      blend.spotWaveBlend,
    );
  });

  it("are refused when a series is short or a code names no model", () => {
    const good = blend.spotWaveBlend.brandon;
    for (const bad of [
      { ...good, height: good.height.slice(1) },
      { ...good, lead: "0" },
      { ...good, lead: "009" },
      { ...good, count: "22z" },
      { ...good, fed: [3, 3, 3, 2, 4] },
      { ...good, parts: { swell9: good.parts.swell } },
    ])
      expect(() => checkWaveBlendSpots(blend, { brandon: bad })).toThrow(
        /brandon/,
      );
  });
});
