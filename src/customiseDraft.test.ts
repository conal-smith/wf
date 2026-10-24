import { describe, expect, it } from "vitest";
import {
  defaultPrefs,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "../force5/src/prefs";
import {
  rateHour,
  standardRating,
  type CustomRating,
  type Rider,
} from "../force5/src/stars";
import {
  NEVER,
  applyDraft,
  costLabel,
  draftOf,
  draftRider,
  hourWhy,
  levelRating,
  nearest,
  onItsLevel,
  parseWings,
  rateSample,
  sampleDay,
  spotChanges,
  withLevel,
  withShore,
  type SampleDay,
} from "./customiseDraft";
import type { PlaceHour } from "./ratings";
import { offerTour, TOUR_KEY, TOUR_TEST_KEY } from "./tourOffer";

const NOW = new Date("2026-10-23T12:00:00Z");
const prefs = (rider: Partial<Rider> = {}): Prefs => ({
  ...defaultPrefs(),
  rider: { ...defaultPrefs().rider, ...rider },
});
/** An hour on a west-facing beach, in daylight. */
const rate = (rider: Rider, windKn: number, from = 225, gustKn = windKn + 4) =>
  rateHour({ windKn, gustKn, from, daylight: true }, { facing: 270 }, rider)!;

describe("the draft", () => {
  it("starts from the level that rates, and its band and shore", () => {
    const draft = draftOf(prefs({ skill: "advanced", weightKg: 95 }), ["a"]);
    expect(draft.skill).toBe("advanced");
    expect(draft.custom).toEqual(
      standardRating(prefs({ skill: "advanced", weightKg: 95 }).rider),
    );
    expect(draft.starred).toEqual(["a"]);
    // Advanced starts 35° into the wind.
    expect(draft.upwind).toBe(35);
    expect(draft.gusty).toBe("some");
    expect(draftOf(prefs({ gusty: "lots" }), []).gusty).toBe("lots");
  });
  it("starts from the rider's own degrees into the wind, when they have them", () => {
    expect(draftOf(prefs({ upwind: 5 }), []).upwind).toBe(5);
    expect(draftOf(prefs(), []).upwind).toBe(20);
  });
  it("starts from the rider's own rating while it rates, at the level it started from", () => {
    const own: CustomRating = {
      ...standardRating(prefs().rider, "advanced"),
      wind: { min: 9, sweetLow: 12, sweetHigh: 26, max: 33 },
    };
    const draft = draftOf(prefs({ skill: "beginner", custom: own }), []);
    expect(draft.skill).toBe("advanced");
    expect(draft.custom).toEqual(own);
  });
  it("starts again from a new level's band and shore", () => {
    const draft = withShore(draftOf(prefs(), []), "cross", NEVER);
    const learner = withLevel(draft, "beginner", 60);
    expect(learner.custom).toEqual(levelRating("beginner", 60));
    expect(learner.custom.wind.min).toBeLessThan(
      levelRating("beginner", 80).wind.min,
    );
  });
  it("starts the degrees into the wind again with a new level, and keeps them with a new weight", () => {
    const draft = { ...draftOf(prefs(), []), upwind: 30 };
    expect(withLevel(draft, "intermediate", 90).upwind).toBe(30);
    expect(withLevel(draft, "beginner", null).upwind).toBe(0);
    expect(withLevel(draft, "advanced", null).upwind).toBe(35);
  });
});

describe("the shore", () => {
  const draft = draftOf(prefs(), []);
  it("says each cost as no cost, stars off, or never", () => {
    expect([0, 0.5, 1.5, 4, 5].map(costLabel)).toEqual([
      "no cost",
      "−0.5★",
      "−1.5★",
      "−4★",
      "never",
    ]);
  });
  it("sets a way of wind in half stars, from none to never, as a dot is dragged", () => {
    expect(withShore(draft, "cross", 1.3).custom.direction.cross).toBe(1.5);
    expect(withShore(draft, "cross", 7).custom.direction.cross).toBe(NEVER);
    expect(withShore(draft, "crossOff", -1).custom.direction.crossOff).toBe(0);
    // A drag that lands on the same half star changes nothing.
    expect(withShore(draft, "crossOff", 1.6)).toBe(draft);
  });
  it("rates never as no stars in any wind, and no cost as nothing off", () => {
    const never = withShore(draft, "crossOn", NEVER);
    expect(never.custom.direction.crossOn).toBe(NEVER);
    const rider = draftRider(never, prefs().rider);
    for (const kn of [12, 16, 20, 26]) expect(rate(rider, kn).stars).toBe(0);
    // Offshore at no cost: the wind alone rates it.
    const ride = draftRider(withShore(draft, "offshore", 0), prefs().rider);
    expect(rate(ride, 18, 90).stars).toBe(rate(ride, 18, 225).stars);
  });
  it("holds offshore at never for a learner", () => {
    const learner = withLevel(draft, "beginner", null);
    expect(learner.custom.direction.offshore).toBe(NEVER);
    expect(withShore(learner, "offshore", 0)).toBe(learner);
    const own = {
      ...standardRating(prefs().rider, "beginner"),
      direction: {
        ...standardRating(prefs().rider, "beginner").direction,
        offshore: 0,
      },
    };
    expect(
      draftOf(prefs({ skill: "beginner", custom: own }), []).custom.direction
        .offshore,
    ).toBe(NEVER);
  });
});

describe("the wings", () => {
  it("reads every number typed, and keeps them with the rider", () => {
    expect(parseWings("4, 5.5")).toEqual([4, 5.5]);
    expect(parseWings("4 and 5.5m")).toEqual([4, 5.5]);
    expect(parseWings("")).toEqual([]);
    const before = prefs({ wings: [3] });
    const draft = draftOf(before, []);
    expect(draft.wings).toEqual([3]);
    const next = applyDraft(before, { ...draft, wings: [4, 5.5] }, NOW);
    expect(next.rider.wings).toEqual([4, 5.5]);
    // And the draft rates with them: a 2 m² wing alone is small for 12 knots.
    const small = draftRider({ ...draft, wings: [2] }, before.rider);
    expect(rate(small, 14).reasons.join(" ")).toMatch(/biggest wing is small/);
  });
});

describe("why an hour has fewer stars", () => {
  // A west-facing beach: 225 is cross-onshore, 135 cross-offshore, 90 offshore.
  const hour = (windKn: number, gustKn: number, from = 225) => ({
    time: 0,
    windKn,
    gustKn,
    from,
  });
  const why = (rider: Rider, h: ReturnType<typeof hour>) =>
    hourWhy(
      h,
      rateHour({ ...h, daylight: true }, { facing: 270 }, rider)!,
      rider,
    );
  const rider = draftRider(draftOf(prefs(), []), prefs().rider);
  it("is a gust over the rider's top: too strong, the gust in red", () => {
    expect(why(rider, hour(22, 32))).toEqual({
      gust: "over",
      word: "too strong",
    });
  });
  it("is gusty wind, when it took a star: the gust in orange", () => {
    expect(why(rider, hour(18, 27))).toEqual({ gust: "gusty", word: "gusty" });
    expect(why(rider, hour(18, 24))).toEqual({ gust: null, word: "" });
  });
  it("is the way of wind, by its short name, when it took a star", () => {
    expect(why(rider, hour(18, 22, 135))).toEqual({
      gust: null,
      word: "x-off",
    });
    expect(why(rider, hour(18, 22, 90))).toEqual({
      gust: null,
      word: "offshore",
    });
    // Cross-shore costs nothing.
    expect(why(rider, hour(18, 22, 180))).toEqual({ gust: null, word: "" });
  });
});

describe("the spots near", () => {
  const places = [
    { id: "far", lat: 52.2, lon: -10.0 },
    { id: "near", lat: 53.45, lon: -6.15 },
    { id: "nearer", lat: 53.44, lon: -6.16 },
  ];
  it("lists the nearest first with their distances, whatever is starred", () => {
    const list = nearest(places, { lat: 53.44, lng: -6.16 }, 2);
    expect(list.map((x) => x.place.id)).toEqual(["nearer", "near"]);
    expect(list[0].km).toBe(0);
    expect(Math.round(list[1].km)).toBe(1);
  });
});

describe("saving", () => {
  it("saves no degrees into the wind while they are the level's own", () => {
    const before = prefs({ upwind: 30 });
    const back = { ...draftOf(before, []), upwind: 20 };
    expect(applyDraft(before, back, NOW).rider).not.toHaveProperty("upwind");
    const own = { ...draftOf(before, []), upwind: 0 };
    expect(applyDraft(before, own, NOW).rider.upwind).toBe(0);
  });
  it("rates on the level, saving no rating of the rider's own, when the wind and shore are the level's", () => {
    const before = prefs();
    const draft = {
      ...withLevel(draftOf(before, []), "advanced", 70),
      upwind: 45,
      units: "km/h" as const,
    };
    const next = applyDraft(before, draft, NOW);
    expect(next.rider).toEqual({
      weightKg: 70,
      skill: "advanced",
      upwind: 45,
      wings: [],
    });
    expect(next.units).toBe("km/h");
    expect(next.starsUpdatedAt).toBeNull();
  });
  it("saves a changed band or shore as the rider's own rating, stamped, which the stars then rate with", () => {
    const before = prefs();
    const draft = draftOf(before, []);
    const changed = {
      ...draft,
      custom: {
        ...draft.custom,
        wind: { min: 6, sweetLow: 8, sweetHigh: 12, max: 15 },
      },
    };
    const next = applyDraft(before, changed, NOW);
    expect(next.rider.custom?.wind).toEqual({
      min: 6,
      sweetLow: 8,
      sweetHigh: 12,
      max: 15,
    });
    expect(next.starsUpdatedAt).toBe(NOW.toISOString());
    // Ten knots: nothing on the level, the top of the sweet spot on this one.
    expect(rate(before.rider, 9, 225, 9).stars).toBe(0);
    expect(rate(next.rider, 10, 225, 10).stars).toBe(5);
    // Stored and read back as Display options and the dock read it.
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    savePrefs(next, storage);
    expect(loadPrefs(storage).rider.custom).toEqual(next.rider.custom);
  });
  it("leaves the rider's own rating as it was when nothing changed, and keeps it aside when a level takes over", () => {
    const own = {
      ...standardRating(prefs().rider),
      wind: { min: 10, sweetLow: 13, sweetHigh: 22, max: 28 },
    };
    const before = {
      ...prefs({ custom: own }),
      starsUpdatedAt: "2026-10-01T00:00:00.000Z",
    };
    expect(applyDraft(before, draftOf(before, []), NOW)).toEqual(before);
    const onLevel = applyDraft(
      before,
      withLevel(draftOf(before, []), "beginner", null),
      NOW,
    );
    expect(onLevel.rider.custom).toBeUndefined();
    expect(onLevel.rider.keptCustom).toEqual(own);
  });
  it("in Force, sets the band on whole forces and still saves the level as the level", () => {
    const before = { ...prefs({ skill: "beginner" }), units: "bft" as const };
    const draft = draftOf(before, []);
    // Learning's 13/15/20/24 kn: F4 / F5–F5 / F6, each on a force's edge.
    expect(draft.custom.wind).toEqual({
      min: 11,
      sweetLow: 17,
      sweetHigh: 21,
      max: 27,
    });
    expect(onItsLevel(draft)).toBe(true);
    const next = applyDraft(before, draft, NOW);
    expect(next.rider.custom).toBeUndefined();
    // A new level comes in forces too.
    expect(withLevel(draft, "advanced", 70).custom.wind.min % 1).toBe(0);
    expect(onItsLevel(withLevel(draft, "advanced", 70))).toBe(true);
    // In knots, the same band is the rider's own.
    expect(onItsLevel({ ...draft, units: "kn" })).toBe(false);
  });
  it("keeps gusty wind on the rider, not in a rating of their own", () => {
    const before = prefs();
    const lots = applyDraft(
      before,
      { ...draftOf(before, []), gusty: "lots" },
      NOW,
    );
    expect(lots.rider).toEqual({ ...before.rider, gusty: "lots" });
    expect(lots.rider.custom).toBeUndefined();
    // Some is the default, and not kept.
    const back = applyDraft(lots, { ...draftOf(lots, []), gusty: "some" }, NOW);
    expect(back.rider.gusty).toBeUndefined();
    // And the draft rates with it: 18 gusting 27 is gusty.
    const rider = (gusty: "little" | "lots") =>
      draftRider({ ...draftOf(before, []), gusty }, before.rider);
    expect(rate(rider("little"), 18, 225, 27).stars).toBe(5);
    expect(rate(rider("lots"), 18, 225, 27).stars).toBe(3);
  });
  it("names the spots starred and unstarred", () => {
    expect(spotChanges(["a", "b"], ["c", "a"])).toEqual(["c", "b"]);
  });
});

describe("the sample day", () => {
  const H = 3600000;
  const day0 = Date.parse("2026-10-24T00:00:00Z");
  const times = Array.from({ length: 48 }, (_, i) => day0 + i * H);
  const row = (kn: (i: number) => number): PlaceHour[] =>
    times.map((t, i) => {
      const hour = new Date(t).getUTCHours();
      return {
        windKn: kn(i),
        gustKn: kn(i) + 6,
        from: 225,
        agreement: null,
        daylight: hour >= 7 && hour < 19,
        rating: null,
        model: "harmonie",
      };
    });
  const places = new Map([
    ["calm", { id: "calm", name: "Calm", facing: 270 }],
    ["breezy", { id: "breezy", name: "Breezy", facing: 270 }],
  ]);
  const hours = new Map([
    ["calm", row(() => 3)],
    // Light on the first day, a riding wind on the second.
    ["breezy", row((i) => (i < 24 ? 4 : 16))],
  ]);
  it("takes the liveliest day at the liveliest place, from the morning, nine hours", () => {
    const day = sampleDay(hours, times, places, [])!;
    expect(day.spot.name).toBe("Breezy");
    expect(day.hours).toHaveLength(9);
    expect(new Date(day.hours[0].time).getUTCHours()).toBe(8);
    expect(day.hours[0].windKn).toBe(16);
  });
  it("takes the rider's own spot first, whatever its wind", () => {
    expect(sampleDay(hours, times, places, ["nowhere", "calm"])!.spot.id).toBe(
      "calm",
    );
    expect(sampleDay(new Map(), times, places, ["calm"])).toBeNull();
  });
  it("never mixes three-hourly columns in with the hours", () => {
    // Hourly on the first day, three-hourly on the second, windier.
    const at = [
      ...Array.from({ length: 24 }, (_, i) => day0 + i * H),
      ...Array.from({ length: 8 }, (_, i) => day0 + (24 + i * 3) * H),
    ];
    const rows = at.map((t, i): PlaceHour => {
      const hour = new Date(t).getUTCHours();
      const kn = i < 24 ? 10 : 18;
      return {
        windKn: kn,
        gustKn: kn + 6,
        from: 225,
        agreement: null,
        daylight: hour >= 7 && hour < 19,
        rating: null,
        model: "harmonie",
      };
    });
    const day = sampleDay(new Map([["breezy", rows]]), at, places, [])!;
    expect(day.hours.map((h) => h.time - day.hours[0].time)).toEqual(
      Array.from({ length: 9 }, (_, i) => i * H),
    );
  });
  it("rates every hour of it for the rider", () => {
    const day: SampleDay = sampleDay(hours, times, places, [])!;
    const ratings = rateSample(day, prefs().rider);
    expect(ratings).toHaveLength(9);
    expect(ratings.every((r) => r.stars >= 4)).toBe(true);
  });
});

describe("the tour's offer", () => {
  const storage = (items: Record<string, string>) => ({
    length: Object.keys(items).length,
    key: (i: number) => Object.keys(items)[i] ?? null,
    getItem: (k: string) => items[k] ?? null,
  });
  const person = { webdriver: false, agent: "Mozilla/5.0 (iPhone) Safari" };
  it("is made on a first visit, by a person", () => {
    expect(offerTour({ ...person, storage: storage({}) })).toBe(true);
    expect(offerTour({ ...person, storage: storage({ other: "1" }) })).toBe(
      true,
    );
  });
  it("is never made again, nor to a rider who came before, nor without storage", () => {
    expect(
      offerTour({ ...person, storage: storage({ [TOUR_KEY]: "seen" }) }),
    ).toBe(false);
    expect(
      offerTour({ ...person, storage: storage({ "wingfoil.spots.v1": "{}" }) }),
    ).toBe(false);
    expect(
      offerTour({ ...person, storage: storage({ "force5.prefs.v1": "{}" }) }),
    ).toBe(false);
    expect(offerTour({ ...person, storage: null })).toBe(false);
  });
  it("is never made to automation or a crawler, unless a tour spec asks for it", () => {
    expect(
      offerTour({ webdriver: true, agent: "Chrome", storage: storage({}) }),
    ).toBe(false);
    for (const agent of [
      "Googlebot/2.1",
      "HeadlessChrome/140",
      "bingbot",
      "Chrome-Lighthouse",
    ])
      expect(offerTour({ webdriver: false, agent, storage: storage({}) })).toBe(
        false,
      );
    expect(
      offerTour({
        webdriver: true,
        agent: "HeadlessChrome",
        storage: storage({ [TOUR_TEST_KEY]: "1" }),
      }),
    ).toBe(true);
    expect(
      offerTour({
        webdriver: true,
        agent: "Chrome",
        storage: storage({ [TOUR_TEST_KEY]: "1", [TOUR_KEY]: "seen" }),
      }),
    ).toBe(false);
  });
});
