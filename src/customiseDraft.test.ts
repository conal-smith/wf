import { describe, expect, it } from "vitest";
import {
  defaultPrefs,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "../force5/src/prefs";
import {
  NEVER,
  OURS,
  oursCopy,
  rateHour,
  type CustomRating,
  type Rider,
} from "../force5/src/stars";
import {
  applyDraft,
  differsFromOurs,
  draftOf,
  draftRider,
  inUnits,
  nearest,
  rateSample,
  ratingIsOurs,
  resetToOurs,
  sampleDay,
  spotChanges,
  withDownwind,
  withShore,
  withUpwind,
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
const own = (wind: Partial<CustomRating["wind"]> = {}): CustomRating => ({
  ...oursCopy(),
  wind: { ...OURS.wind, ...wind },
});

describe("the draft", () => {
  it("starts everyone from ours: 11 · 15–22 · 35, straight across, the course to 10° below", () => {
    const draft = draftOf(prefs({ weightKg: 95 }), ["a"]);
    expect(draft.custom).toEqual(oursCopy());
    expect(draft.upwind).toBe(0);
    expect(draft.downwind).toBe(10);
    expect(draft.weightKg).toBe(95);
    expect(draft.starred).toEqual(["a"]);
    expect(differsFromOurs(draft)).toBe(false);
  });
  it("starts from the rider's own rating and angles, when they have them", () => {
    const mine = own({ min: 9, sweetLow: 12, sweetHigh: 26, max: 33 });
    const draft = draftOf(prefs({ custom: mine, upwind: 5, downwind: 30 }), []);
    expect(draft.custom).toEqual(mine);
    expect(draft.upwind).toBe(5);
    expect(draft.downwind).toBe(30);
    expect(differsFromOurs(draft)).toBe(true);
  });
  it("never moves the rating with the weight", () => {
    const draft = draftOf(prefs(), []);
    expect(draftOf(prefs({ weightKg: 120 }), []).custom).toEqual(draft.custom);
  });
});

describe("reset to ours", () => {
  const draft = draftOf(prefs(), []);
  it("shows once the wind, the shore or either angle differs from ours", () => {
    expect(differsFromOurs({ ...draft, custom: own({ max: 30 }) })).toBe(true);
    expect(differsFromOurs(withShore(draft, "onshore", 1))).toBe(true);
    expect(differsFromOurs(withUpwind(draft, 5))).toBe(true);
    expect(differsFromOurs(withDownwind(draft, 20))).toBe(true);
  });
  it("ignores weight and units", () => {
    expect(differsFromOurs({ ...draft, weightKg: 60 })).toBe(false);
    for (const units of ["mph", "km/h", "m/s", "bft"] as const)
      expect(differsFromOurs(inUnits({ ...draft, units }))).toBe(false);
  });
  it("puts the wind, the shore and the course back, and keeps weight and units", () => {
    const changed = withDownwind(
      withUpwind(
        withShore(
          { ...draft, weightKg: 60, units: "mph", custom: own({ min: 8 }) },
          "cross",
          2,
        ),
        20,
      ),
      0,
    );
    const back = resetToOurs(changed);
    expect(back).toEqual({ ...draft, weightKg: 60, units: "mph" });
    expect(differsFromOurs(back)).toBe(false);
  });
});

describe("the shore", () => {
  const draft = draftOf(prefs(), []);
  it("sets a way of wind in whole stars, from none to never, as a dot is dragged", () => {
    expect(withShore(draft, "cross", 1.3).custom.direction.cross).toBe(1);
    expect(withShore(draft, "cross", 7).custom.direction.cross).toBe(NEVER);
    expect(withShore(draft, "crossOff", -1).custom.direction.crossOff).toBe(0);
    // A drag that lands on the same star changes nothing.
    expect(withShore(draft, "crossOff", 1.4)).toBe(draft);
  });
  it("holds offshore at never: no dot moves it", () => {
    expect(withShore(draft, "offshore", 0)).toBe(draft);
    expect(draft.custom.direction.offshore).toBe(NEVER);
  });
  it("rates never as no stars in any wind", () => {
    const never = withShore(draft, "crossOn", NEVER);
    const rider = draftRider(never, prefs().rider);
    for (const kn of [12, 16, 20, 26]) expect(rate(rider, kn).stars).toBe(0);
  });
});

describe("the course", () => {
  const draft = draftOf(prefs(), []);
  it("holds both angles to whole degrees, 0–45", () => {
    expect(withUpwind(draft, 12.4).upwind).toBe(12);
    expect(withUpwind(draft, 60).upwind).toBe(45);
    expect(withDownwind(draft, -3).downwind).toBe(0);
    expect(withDownwind(draft, 99).downwind).toBe(45);
    expect(withUpwind(draft, 0)).toBe(draft);
  });
  it("moves no star", () => {
    const a = draftRider(draft, prefs().rider);
    const b = draftRider(
      withDownwind(withUpwind(draft, 45), 45),
      prefs().rider,
    );
    for (const kn of [9, 12, 16, 22, 28, 33])
      for (const from of [90, 135, 180, 225, 270])
        expect(rate(b, kn, from).stars).toBe(rate(a, kn, from).stars);
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
  it("saves no angles while they are ours", () => {
    const before = prefs({ upwind: 30, downwind: 20 });
    const back = { ...draftOf(before, []), upwind: 0, downwind: 10 };
    const rider = applyDraft(before, back, NOW).rider;
    expect(rider).not.toHaveProperty("upwind");
    expect(rider).not.toHaveProperty("downwind");
    const mine = { ...draftOf(before, []), upwind: 5, downwind: 0 };
    expect(applyDraft(before, mine, NOW).rider).toMatchObject({
      upwind: 5,
      downwind: 0,
    });
  });
  it("saves no rating of the rider's own, and stamps nothing, while the wind and shore are ours", () => {
    const before = prefs({ wings: [4] });
    const draft = {
      ...withUpwind(draftOf(before, []), 45),
      weightKg: 70,
      units: "km/h" as const,
    };
    const next = applyDraft(before, draft, NOW);
    expect(next.rider).toEqual({ weightKg: 70, upwind: 45, wings: [4] });
    expect(next.units).toBe("km/h");
    expect(next.starsUpdatedAt).toBeNull();
  });
  it("saves a changed wind or shore as the rider's own rating, stamped, which the stars then rate with", () => {
    const before = prefs();
    const draft = draftOf(before, []);
    const changed = {
      ...draft,
      custom: own({ min: 6, sweetLow: 8, sweetHigh: 12, max: 15 }),
    };
    const next = applyDraft(before, changed, NOW);
    expect(next.rider.custom?.wind).toEqual({
      min: 6,
      sweetLow: 8,
      sweetHigh: 12,
      max: 15,
    });
    expect(next.starsUpdatedAt).toBe(NOW.toISOString());
    // Ten knots: nothing on ours, the top of the sweet spot on this one.
    expect(rate(before.rider, 10, 225, 10).stars).toBe(0);
    expect(rate(next.rider, 10, 225, 10).stars).toBe(5);
    // Stored and read back as the dock reads it.
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    savePrefs(next, storage);
    expect(loadPrefs(storage).rider.custom).toEqual(next.rider.custom);
  });
  it("leaves the rider's own rating as it was when nothing changed, and goes back to ours on a reset", () => {
    const mine = own({ min: 10, sweetLow: 13, sweetHigh: 22, max: 28 });
    const before = {
      ...prefs({ custom: mine }),
      starsUpdatedAt: "2026-10-01T00:00:00.000Z",
    };
    expect(applyDraft(before, draftOf(before, []), NOW)).toEqual(before);
    const reset = applyDraft(before, resetToOurs(draftOf(before, [])), NOW);
    expect(reset.rider.custom).toBeUndefined();
    expect(reset.starsUpdatedAt).toBe(NOW.toISOString());
  });
  it("in Force, sets the four numbers on whole forces and still saves ours as ours", () => {
    const before = { ...prefs(), units: "bft" as const };
    const draft = draftOf(before, []);
    // Ours' 11/15/22/35 kn on a force's edge: F4 / F5–F6 / F8.
    expect(draft.custom.wind.min % 1).toBe(0);
    expect(ratingIsOurs(draft.custom, "bft")).toBe(true);
    expect(differsFromOurs(draft)).toBe(false);
    const next = applyDraft(before, draft, NOW);
    expect(next.rider.custom).toBeUndefined();
    // In knots, the same numbers are the rider's own.
    expect(ratingIsOurs(draft.custom, "kn")).toBe(false);
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
