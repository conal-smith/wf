import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, type Rider } from "../force5/src/stars";
import { ensembleManifest, windManifest } from "../force5/src/testing";
import { dockColumns } from "../force5/src/timeline";
import { placeHours, type RatedPlace } from "./ratings";
import {
  blendColumnModels,
  buildSpotBlend,
  BLEND_KEY,
  blendPrefix,
  checkBlendSpots,
  ownBlendModels,
  parseSpotBlend,
  placesRatedApart,
  spotBlendHours,
  staleSpotBlend,
  trustedSpotBlend,
  type BlendRun,
} from "./spotBlend";
import { ratePlace } from "./useRatings";

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
// The blend as the job holds it, every place in hand, through JSON as it is written.
const blend = JSON.parse(JSON.stringify(buildSpotBlend(manifests, NOW))) as BlendRun;
/** The pointer the job publishes for it: no places, the squares they are in. */
const pointer = (() => {
  const { [BLEND_KEY]: _places, ...head } = blend;
  return {
    ...head,
    base: `${blendPrefix(blend)}-0a0b0c0d/`,
    spots: { squareDegrees: 2, url: "spots/{square}.json", squares: ["n52w012"], keys: [BLEND_KEY] },
  };
})();

describe("buildSpotBlend", () => {
  it("is named for the hour it was worked out, as the publisher names a run", () => {
    expect(blend.run).toBe("2026091400");
    expect(blend.runTime).toBe("2026-09-14T00:00:00Z");
    expect(blend.coverage).toEqual({ from: blend.times[0], to: blend.times.at(-1) });
    expect(blend.schemaVersion).toBe(2);
    // Its run directory reaches from the hour it was worked out to its last time.
    expect(blendPrefix(blend)).toBe("blend-2026091400-18h-v2");
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

  it("says which models its hours are, and which one each hour is", () => {
    expect(blend.lead).toEqual({ model: "harmonie", then: "ecmwf" });
    const lead = blend.spotBlend.brandon.lead!;
    expect(lead).toHaveLength(blend.times.length);
    const named = [...lead].map((c) =>
      c === "-" ? null : blend.sources[parseInt(c, 36)].id,
    );
    // HARMONIE to +6, then ECMWF alone at +12 and +18.
    expect(named).toEqual([
      ...Array(7).fill("harmonie"),
      "ecmwf",
      "ecmwf",
    ]);
    const hours = spotBlendHours(blend, brandon, blend.times, DEFAULT_RIDER)!;
    expect(hours.map((h) => h.model)).toEqual(named);
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
        expect(got.model).toBe(hour.model);
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

describe("trustedSpotBlend", () => {
  const at = Date.parse(blend.generatedAt);
  const wind = ["harmonie", "ecmwf", "gfs"];

  it("rates from the published blend only while the reader blends every wind model", () => {
    expect(ownBlendModels(wind, wind)).toBe(false);
    expect(ownBlendModels([...wind, "ecmwf-ens"], wind)).toBe(false);
    expect(ownBlendModels(["harmonie", "ecmwf"], wind)).toBe(true);
    expect(trustedSpotBlend(pointer, false, at)).toBe(pointer);
    expect(trustedSpotBlend(pointer, true, at)).toBeNull();
  });

  it("rates from it only for a reader whose stars come from the models it was built with", () => {
    expect(trustedSpotBlend(pointer, false, at, { model: "harmonie", then: "ecmwf" })).toBe(pointer);
    expect(trustedSpotBlend(pointer, false, at, { model: "gfs", then: "ecmwf" })).toBeNull();
    expect(trustedSpotBlend(pointer, false, at, { model: "harmonie", then: "gfs" })).toBeNull();
    // A blend built by the rule before 19 October 2026 names none, and fits nobody.
    const { lead: _lead, ...old } = pointer;
    expect(trustedSpotBlend(old, false, at)).toBeNull();
  });

  it("stops trusting it past six hours, and without one there is none", () => {
    expect(trustedSpotBlend(pointer, false, at + 6 * 3600000)).toBe(pointer);
    expect(trustedSpotBlend(pointer, false, at + 6 * 3600000 + 1)).toBeNull();
    expect(trustedSpotBlend(null, false, at)).toBeNull();
  });
});

describe("ratePlace", () => {
  const dollymount: RatedPlace = { id: "dollymount", lat: 53.365, lon: -6.135, facing: 90 };
  const source = {
    published: blend,
    manifests: [],
    blendModels: ids,
    known: new Set(["n52w012"]),
  };

  it("rates a place whose square has been read", () => {
    expect(ratePlace(brandon, blend.times, DEFAULT_RIDER, source)).toEqual(
      spotBlendHours(blend, brandon, blend.times, DEFAULT_RIDER),
    );
  });

  it("leaves a place whose square has not been read without a row, so its light stays pending", () => {
    // Dollymount is in n52w008, which was not read.
    expect(ratePlace(dollymount, blend.times, DEFAULT_RIDER, source)).toBeNull();
    // Even from the models, which would otherwise call it calm: a row of nulls.
    const own = { ...source, published: null, manifests };
    expect(ratePlace(dollymount, blend.times, DEFAULT_RIDER, own)).toBeNull();
    expect(
      ratePlace(dollymount, blend.times, DEFAULT_RIDER, { ...own, known: null }),
    ).toHaveLength(blend.times.length);
  });

  it("works the reader's own blend out from the models' squares", () => {
    const own = { ...source, published: null, manifests };
    expect(ratePlace(brandon, blend.times, DEFAULT_RIDER, own)).toEqual(
      placeHours(manifests, ids, brandon, blend.times, DEFAULT_RIDER),
    );
  });
});

describe("placesRatedApart", () => {
  const places = [brandon, { ...brandon, id: "portrane" }, { ...brandon, id: "inch" }];
  it("is the rider's spots of their own the blend cannot serve", () => {
    const rider: Rider = {
      ...DEFAULT_RIDER,
      starsFrom: {
        model: "gfs",
        then: "ecmwf",
        spots: { portrane: "harmonie", inch: "icon-eu" },
      },
    };
    // Portrane, rated HARMONIE then ECMWF, is the blend's; Inch is not.
    expect(placesRatedApart(places, rider, blend).map((p) => p.id)).toEqual(["inch"]);
    expect(placesRatedApart(places, rider, null)).toEqual([]);
    expect(placesRatedApart(places, DEFAULT_RIDER, blend)).toEqual([]);
  });
});

describe("ratePlace beside a published blend", () => {
  const rider: Rider = {
    ...DEFAULT_RIDER,
    starsFrom: { model: "harmonie", then: "ecmwf", spots: { brandon: "ecmwf" } },
  };
  const source = {
    published: blend,
    manifests,
    blendModels: ids,
    known: new Set(["n52w012"]),
    modelsKnown: new Set<string>(),
  };
  it("works a spot rated from its own model out from the models, once their square is read", () => {
    expect(ratePlace(brandon, blend.times, rider, source)).toBeNull();
    const read = { ...source, modelsKnown: new Set(["n52w012"]) };
    const hours = ratePlace(brandon, blend.times, rider, read)!;
    expect(hours).toEqual(placeHours(manifests, ids, brandon, blend.times, rider));
    expect(new Set(hours.map((h) => h.model))).toEqual(new Set(["ecmwf"]));
  });
  it("reads every other spot from the blend", () => {
    const other = { ...brandon, id: "nowhere" };
    expect(ratePlace(other, blend.times, rider, source)).toBeNull();
    expect(ratePlace(brandon, blend.times, DEFAULT_RIDER, source)).toEqual(
      spotBlendHours(blend, brandon, blend.times, DEFAULT_RIDER),
    );
  });
});

describe("parseSpotBlend", () => {
  it("takes the published pointer: times, models and squares, no places", () => {
    const parsed = parseSpotBlend(JSON.parse(JSON.stringify(pointer)));
    expect(parsed.spots.squares).toEqual(["n52w012"]);
    expect(parsed.base).toBe(pointer.base);
  });

  it("refuses anything else", () => {
    const cases: Record<string, unknown> = {
      "another kind": { ...pointer, kind: "wind" },
      "the old one-file blend": { ...pointer, schemaVersion: 1 },
      "places inline": { ...pointer, [BLEND_KEY]: blend.spotBlend },
      "a model's keys": { ...pointer, spots: { ...pointer.spots, keys: ["spotForecasts"] } },
      "no squares index": { ...pointer, spots: undefined },
      "a base outside its directory": { ...pointer, base: "../blend-0a0b0c0d/" },
      "a malformed lead": { ...pointer, lead: "harmonie" },
      "a column past the end": {
        ...pointer,
        sources: [{ ...pointer.sources[0], columns: [pointer.times.length] }],
      },
    };
    for (const [name, body] of Object.entries(cases))
      expect(() => parseSpotBlend(body), name).toThrow();
  });
});

describe("checkBlendSpots", () => {
  it("refuses a square whose series do not cover the blend's times, naming the place", () => {
    const broken = JSON.parse(JSON.stringify(blend.spotBlend));
    broken.brandon.wind.pop();
    expect(() => checkBlendSpots(blend, broken)).toThrow(/brandon/);
    const letters = JSON.parse(JSON.stringify(blend.spotBlend));
    letters.brandon.agreement = letters.brandon.agreement.slice(1);
    expect(() => checkBlendSpots(blend, letters)).toThrow(/brandon/);
    const leads = JSON.parse(JSON.stringify(blend.spotBlend));
    leads.brandon.lead = leads.brandon.lead.slice(1);
    expect(() => checkBlendSpots(blend, leads)).toThrow(/brandon/);
    // A place from before the ruling carries no lead, and still reads.
    const old = JSON.parse(JSON.stringify(blend.spotBlend));
    delete old.brandon.lead;
    expect(checkBlendSpots(blend, old)).toBe(old);
    expect(checkBlendSpots(blend, blend.spotBlend)).toBe(blend.spotBlend);
  });
});
