// Validator coverage for the multi-model manifest keys: kind, gust semantics
// and ensembles. The original single-model rules stay in weather.test.ts.
import { describe, expect, it } from "vitest";
import {
  freshness,
  validateManifest,
  validateWindSpots,
  type Manifest,
} from "./weather";
import { ensembleManifest, pointerOf, windManifest } from "./testing";

/**
 * A run as the site reads it: the pointer is validated as published, without
 * its spot data, and the spot data as it arrives from the squares.
 */
const validate = (m: Manifest): Manifest => {
  validateManifest(pointerOf(m));
  return validateWindSpots(m);
};

describe("declared forecast kind", () => {
  it("accepts wind and wave, defaults to wind, rejects anything else", () => {
    expect(validate({ ...windManifest(), kind: "wind" }).kind).toBe("wind");
    expect(validate({ ...windManifest(), kind: "wave" }).kind).toBe("wave");
    expect(validate(windManifest()).kind).toBeUndefined();
    expect(() =>
      validate({
        ...windManifest(),
        kind: "swell" as Manifest["kind"],
      }),
    ).toThrow(/kind/);
  });
});

describe("gust semantics", () => {
  it("requires instantaneous gusts to collapse to the frame hour, hour 0 included", () => {
    const gfs = windManifest({ model: "gfs", gustKind: "instantaneous" });
    expect(validate(gfs).frames.map((f) => f.gustIntervalHours)).toEqual([
      [0, 0],
      [3, 3],
      [6, 6],
    ]);
    const windowed = {
      ...gfs,
      frames: gfs.frames.map((f, i) =>
        i === 1 ? { ...f, gustIntervalHours: [0, 3] as [number, number] } : f,
      ),
    };
    expect(() => validate(windowed)).toThrow(/gust forecast interval/);
  });
  it("forbids missing hours and unknown kinds for instantaneous gusts", () => {
    const gfs = windManifest({ model: "gfs", gustKind: "instantaneous" });
    expect(() => validate({ ...gfs, gustMissingHours: [0] })).toThrow(
      /Instantaneous/,
    );
    expect(() =>
      validate({ ...gfs, gustKind: "point" as Manifest["gustKind"] }),
    ).toThrow(/gust kind/);
  });
  it("keeps interval gusts under the original rule", () => {
    const interval = windManifest();
    expect(validate(interval)).toBe(interval);
    expect(() =>
      validate({
        ...interval,
        frames: interval.frames.map((f) =>
          f.hour === 3
            ? { ...f, gustIntervalHours: [3, 3] as [number, number] }
            : f,
        ),
      }),
    ).toThrow(/gust forecast interval/);
  });
});

describe("ensemble manifests", () => {
  const withMembers = (
    ens: Manifest,
    change: (frames: Manifest["spotMembers"]) => Manifest["spotMembers"],
  ) => ({
    ...ens,
    spotMembers: change(ens.spotMembers),
  });

  it("checks member array lengths against the declared member count", () => {
    const ens = ensembleManifest({ members: 3 });
    expect(validate(ens).ensemble?.members).toBe(3);
    expect(() =>
      validate(
        withMembers(ens, (members) => ({
          brandon: members!.brandon.map((f) => ({ ...f, u: f.u.slice(0, 2) })),
        })),
      ),
    ).toThrow(/ensemble u/);
    expect(() =>
      validate(
        withMembers(ens, (members) => ({
          brandon: members!.brandon.map((f) => ({
            ...f,
            gust: f.gust.slice(0, 1),
          })),
        })),
      ),
    ).toThrow(/ensemble gust/);
  });
  it("rejects non-finite, out-of-range and negative member values", () => {
    const ens = ensembleManifest({ members: 3 });
    expect(() =>
      validate(
        withMembers(ens, (members) => ({
          brandon: members!.brandon.map((f) => ({
            ...f,
            v: f.v.map((v, i) => (i === 1 ? 900 : v)),
          })),
        })),
      ),
    ).toThrow(/ensemble v/);
    expect(() =>
      validate(
        withMembers(ens, (members) => ({
          brandon: members!.brandon.map((f) => ({
            ...f,
            u: f.u.map((u, i) => (i === 0 ? NaN : u)),
          })),
        })),
      ),
    ).toThrow(/ensemble u/);
    expect(() =>
      validate(
        withMembers(ens, (members) => ({
          brandon: members!.brandon.map((f) => ({
            ...f,
            gust: f.gust.map((g, i) => (i === 0 ? -1 : g)),
          })),
        })),
      ),
    ).toThrow(/ensemble gust/);
  });
  it("allows a null member gust but never a shifted member time", () => {
    const ens = ensembleManifest({ members: 2 });
    const nulled = withMembers(ens, (members) => ({
      brandon: members!.brandon.map((f) => ({
        ...f,
        gust: f.gust.map(() => null),
      })),
    }));
    expect(validate(nulled)).toBe(nulled);
    expect(() =>
      validate(
        withMembers(ens, (members) => ({
          brandon: members!.brandon.map((f, i) =>
            i === 1 ? { ...f, validTime: "2026-09-20T00:00:00Z" } : f,
          ),
        })),
      ),
    ).toThrow(/ensemble timeline/);
  });
  it("requires a sound ensemble description beside the member series", () => {
    const ens = ensembleManifest({ members: 3, withFrames: true });
    expect(() => validate({ ...ens, ensemble: undefined })).toThrow(
      /Member series require an ensemble/,
    );
    expect(() =>
      validate({
        ...ens,
        ensemble: {
          members: 3,
          control: 3,
          description: "control out of range",
        },
      }),
    ).toThrow(/ensemble description/);
    expect(
      validate({
        ...ens,
        ensemble: { members: 3, control: null, description: "no control" },
      }).ensemble?.control,
    ).toBeNull();
  });
  it("allows empty frames only for an ensemble, and still reports freshness", () => {
    const chartOnly = ensembleManifest();
    expect(validate(chartOnly).frames).toHaveLength(0);
    expect(freshness(chartOnly, Date.parse("2026-09-14T03:00Z"))).toBe("fresh");
    expect(freshness(chartOnly, Date.parse("2026-09-15T03:00Z"))).toBe(
      "expired",
    );
    expect(() => validate({ ...windManifest(), frames: [] })).toThrow(
      /Invalid forecast manifest/,
    );
  });
  it("still validates map frames when an ensemble publishes them", () => {
    const withFrames = ensembleManifest({ withFrames: true });
    expect(validate(withFrames).frames).toHaveLength(3);
    expect(() =>
      validate({
        ...withFrames,
        frames: [...withFrames.frames].reverse(),
      }),
    ).toThrow(/timeline is invalid/);
  });
});
