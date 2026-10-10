import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, type Rider } from "../force5/src/stars";
import { ensembleManifest, windManifest } from "../force5/src/testing";
import { dockColumns } from "../force5/src/timeline";
import { placeHours, type RatedPlace } from "./ratings";
import {
  blendColumnModels,
  buildSpotBlend,
  parseSpotBlend,
  spotBlendHours,
  staleSpotBlend,
} from "./spotBlend";

const harmonie = windManifest({
  model: "harmonie",
  hours: [0, 1, 2, 3, 4, 5, 6],
  wind: (h) => ({ u: 5 + h, v: -2 + h / 2, gust: 9 + h }),
  extra: { resolutionKm: 2 },
});
const ecmwf = windManifest({
  model: "ecmwf",
  hours: [0, 3, 6, 12, 18],
  wind: (h) => ({ u: -2 + h / 4, v: 6 - h / 3, gust: h % 2 ? null : 11 }),
  extra: { resolutionKm: null },
});
const ens = ensembleManifest({
  hours: [0, 6, 12],
  members: 4,
  member: (m, h) => ({ u: m + 1, v: h / 3 - m, gust: h + 6 }),
  extra: { resolutionKm: null },
});
const manifests = [harmonie, ecmwf, ens];
const ids = manifests.map((m) => m.model);
const brandon: RatedPlace = { id: "brandon", lat: 52.27, lon: -10.16, facing: 315 };
const NOW = new Date("2026-09-14T00:20:00Z");
const blend = parseSpotBlend(JSON.parse(JSON.stringify(buildSpotBlend(manifests, NOW))));

describe("buildSpotBlend", () => {
  it("is named for the hour it was worked out, as the publisher names a run", () => {
    expect(blend.run).toBe("2026091400");
    expect(blend.runTime).toBe("2026-09-14T00:00:00Z");
    expect(blend.coverage).toEqual({ from: blend.times[0], to: blend.times.at(-1) });
  });

  it("keeps every time a deterministic model publishes, and no ensemble's", () => {
    const hours = blend.times.map(
      (t) => (Date.parse(t) - Date.parse("2026-09-14T00:00:00Z")) / 3600000,
    );
    expect(hours).toEqual([0, 1, 2, 3, 4, 5, 6, 12, 18]);
    const sources = Object.fromEntries(blend.sources.map((s) => [s.id, s]));
    expect(sources["ecmwf-ens"].columns).toEqual([]);
    expect(sources["ecmwf-ens"].ensemble).toBe(true);
    expect(sources.harmonie.weight).toBe(4);
    expect(sources.ecmwf.weight).toBe(0.5);
  });
});

describe("spotBlendHours", () => {
  const axis = blend.times;
  const riders: Rider[] = [
    DEFAULT_RIDER,
    { weightKg: 95, skill: "beginner", wings: [5] },
    { weightKg: 60, skill: "advanced", wings: [3, 4.5] },
  ];

  it("rates what the browser would have worked out from the manifests", () => {
    for (const rider of riders) {
      const fromBlend = spotBlendHours(blend, brandon, axis, rider)!;
      const fromManifests = placeHours(manifests, ids, brandon, axis, rider);
      fromManifests.forEach((hour, at) => {
        const got = fromBlend[at];
        // Kept to a tenth of a knot and a whole degree, which no star turns on.
        expect(got.windKn).toBeCloseTo(hour.windKn!, 1);
        expect(got.gustKn).toBeCloseTo(hour.gustKn!, 1);
        expect(Math.abs(got.from! - hour.from!)).toBeLessThanOrEqual(0.5);
        expect(got.agreement).toBe(hour.agreement);
        expect(got.daylight).toBe(hour.daylight);
        expect(got.rating?.stars ?? null).toBe(hour.rating?.stars ?? null);
      });
    }
  });

  it("has nothing for a time it does not hold, and no row for a place it does not know", () => {
    const hours = spotBlendHours(blend, brandon, ["2026-09-14T00:30:00Z"], DEFAULT_RIDER)!;
    expect(hours[0]).toMatchObject({ windKn: null, gustKn: null, from: null, rating: null });
    expect(spotBlendHours(blend, { ...brandon, id: "nowhere" }, axis, DEFAULT_RIDER)).toBeNull();
  });
});

describe("blendColumnModels", () => {
  it("gives the dock the columns the manifests would have", () => {
    const fromManifests = dockColumns(
      manifests.map((m) => ({ id: m.model, manifest: m, ensemble: !!m.ensemble })),
      NOW.getTime(),
    );
    expect(dockColumns(blendColumnModels(blend), NOW.getTime())).toEqual(fromManifests);
  });
});

describe("staleSpotBlend", () => {
  it("trusts a blend for six hours after it was worked out", () => {
    const at = Date.parse(blend.generatedAt);
    expect(staleSpotBlend(blend, at + 6 * 3600000)).toBe(false);
    expect(staleSpotBlend(blend, at + 6 * 3600000 + 1)).toBe(true);
    // A page clock behind the blend's (a test's, or a wrong one) is not stale.
    expect(staleSpotBlend(blend, at - 3600000)).toBe(false);
  });
});

describe("parseSpotBlend", () => {
  it("refuses a file whose series do not cover its times", () => {
    const broken = JSON.parse(JSON.stringify(blend));
    broken.spots.brandon.wind.pop();
    expect(() => parseSpotBlend(broken)).toThrow(/brandon/);
    expect(() => parseSpotBlend({ ...blend, kind: "wind" })).toThrow();
    expect(() => parseSpotBlend({ ...blend, schemaVersion: 2 })).toThrow(/schema/);
  });
});
