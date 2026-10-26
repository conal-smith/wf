import { describe, expect, it } from "vitest";
import { defaultPrefs, loadPrefs, savePrefs } from "../../../../force5/src/prefs";
import { DEFAULT_RIDER, OURS, oursCopy, type CustomRating } from "../../../../force5/src/stars";
import { WIND_KEYS, polar, starRuns, unitScale, webRadius } from "../../../../spot/web/yourStars";
import {
  UP,
  UP_ANSWERS,
  answerOf,
  degAtX,
  differsFromOurs,
  dotAt,
  edgeAngle,
  edgeAt,
  grabHandle,
  knAtX,
  offWind,
  oursStars,
  stripWords,
  upPoint,
  windLabels,
  withYourStars,
  yourStarsOf,
} from "./yourStarsLogic";

const mine = (): CustomRating => {
  const r = oursCopy();
  r.wind.max = 30;
  r.direction.crossOff = 2;
  return r;
};

describe("what is saved", () => {
  it("opens on ours, with the angles ours, for a rider who has none of their own", () => {
    expect(yourStarsOf(DEFAULT_RIDER, "kn")).toEqual({ rating: OURS, upwind: 0, downwind: 10 });
    expect(differsFromOurs(yourStarsOf(DEFAULT_RIDER, "kn"), "kn")).toBe(false);
    expect(differsFromOurs(oursStars("kn"), "kn")).toBe(false);
  });

  it("opens on the rider's own, a copy to edit", () => {
    const rider = { ...DEFAULT_RIDER, custom: mine(), upwind: 20, downwind: 25 };
    const yours = yourStarsOf(rider, "kn");
    expect(yours).toEqual({ rating: mine(), upwind: 20, downwind: 25 });
    yours.rating.wind.min = 9;
    expect(rider.custom.wind.min).toBe(11);
  });

  it("offers Reset to ours once anything differs from ours, the weight aside", () => {
    expect(differsFromOurs({ ...oursStars("kn"), rating: mine() }, "kn")).toBe(true);
    expect(differsFromOurs({ ...oursStars("kn"), upwind: 5 }, "kn")).toBe(true);
    expect(differsFromOurs({ ...oursStars("kn"), downwind: 0 }, "kn")).toBe(true);
  });

  it("keeps a rating and the angles only while they are not ours", () => {
    const own = withYourStars(defaultPrefs(), { rating: mine(), upwind: 20, downwind: 15 });
    expect(own.rider).toEqual({ ...DEFAULT_RIDER, custom: mine(), upwind: 20, downwind: 15 });
    expect(own.starsUpdatedAt).not.toBeNull();
    const back = withYourStars(own, oursStars("kn"));
    expect(back.rider).toEqual(DEFAULT_RIDER);
  });

  it("stamps the account's copy only when the rating itself changes", () => {
    const then = new Date("2026-10-25T10:00:00Z");
    const own = withYourStars(defaultPrefs(), { rating: mine(), upwind: 0, downwind: 10 }, then);
    const angles = withYourStars(own, { rating: mine(), upwind: 20, downwind: 10 }, new Date());
    expect(angles.starsUpdatedAt).toBe(own.starsUpdatedAt);
    expect(angles.rider.upwind).toBe(20);
  });

  it("in Force, opens on ours in whole forces and still counts it as ours", () => {
    const yours = yourStarsOf(DEFAULT_RIDER, "bft");
    expect(yours.rating).not.toEqual(OURS);
    expect(differsFromOurs(yours, "bft")).toBe(false);
    expect(differsFromOurs(yours, "kn")).toBe(true);
    const prefs = { ...defaultPrefs(), units: "bft" as const };
    expect(withYourStars(prefs, yours).rider).toEqual(DEFAULT_RIDER);
  });

  it("keeps the weight, wings and model through a save", () => {
    const prefs = { ...defaultPrefs(), rider: { ...DEFAULT_RIDER, weightKg: 72, wings: [4, 5] } };
    expect(withYourStars(prefs, { rating: mine(), upwind: 0, downwind: 10 }).rider).toEqual({
      weightKg: 72,
      wings: [4, 5],
      custom: mine(),
    });
  });

  it("survives the device's storage, and an old level's settings come back as ours", () => {
    let stored = "";
    const storage = { getItem: () => stored, setItem: (_: string, v: string) => void (stored = v) };
    savePrefs(withYourStars(defaultPrefs(), { rating: mine(), upwind: 5, downwind: 30 }), storage);
    expect(loadPrefs(storage).rider).toMatchObject({ custom: mine(), upwind: 5, downwind: 30 });
    stored = JSON.stringify({
      version: 2,
      rider: { weightKg: 70, wings: [], skill: "advanced", gusty: "a-lot", upwind: 30, keptCustom: {} },
    });
    expect(loadPrefs(storage).rider).toEqual({ ...DEFAULT_RIDER, weightKg: 70 });
    expect(yourStarsOf(loadPrefs(storage).rider, "kn")).toEqual(oursStars("kn"));
  });
});

describe("the wind slider", () => {
  it("reads knots along it, snapped to the rider's unit and kept inside it", () => {
    const kn = unitScale("kn");
    expect(knAtX(180, 360, 40, kn)).toBe(20);
    expect(knAtX(-30, 360, 40, kn)).toBe(0);
    expect(knAtX(999, 360, 40, kn)).toBe(40);
    // Half a metre per second at a time, kept in knots to the tenth.
    const ms = unitScale("m/s");
    const got = knAtX(100, 360, 40, ms);
    expect(Number((got * ms.perKn).toFixed(1)) % 0.5).toBe(0);
    expect(knAtX(10, 0, 40, kn)).toBe(0);
  });

  it("takes the nearest handle, and of two together the one the finger pulls", () => {
    const values = { min: 11, sweetLow: 12, sweetHigh: 24, max: 30 };
    expect(grabHandle(WIND_KEYS, values, 23, 0, 1.5)).toBe("sweetHigh");
    expect(grabHandle(WIND_KEYS, values, 11.5, 4, 1.5)).toBe("sweetLow");
    expect(grabHandle(WIND_KEYS, values, 11.5, -4, 1.5)).toBe("min");
    // Apart, the direction does not matter.
    expect(grabHandle(WIND_KEYS, values, 29, -4, 1.5)).toBe("max");
  });

  it("keeps its names clear of their handles and inside the slider", () => {
    const sizes = { light: 60, much: 120, none: 100 };
    expect(windLabels(340, 100, 200, sizes)).toEqual({ light: 16, much: 220, none: 206 });
    // Pressed to the ends, they stay on the slider.
    expect(windLabels(340, 20, 330, sizes)).toEqual({ light: 0, much: 220, none: 240 });
  });

  it("says the strip in words: ours, one star at 11 kn to none from 32", () => {
    const words = stripWords(starRuns(OURS.wind), unitScale("kn"));
    expect(words).toMatch(/^Your stars by steady wind: 1 at 11 kn, /);
    expect(words).toContain("5 from 15 kn to 22 kn");
    expect(words).toContain("1 from 30 kn to 31 kn");
    expect(words).toMatch(/none from 32 kn$/);
  });
});

describe("the web under a finger", () => {
  it("finds a dot within reach, the nearest", () => {
    const off = OURS.direction;
    const [x, y] = polar(50, webRadius(off.crossOff));
    expect(dotAt(x + 3, y, off, 12)).toBe("crossOff");
    expect(dotAt(x + 30, y + 30, off, 12)).toBeNull();
    const [cx, cy] = polar(90, webRadius(0));
    expect(dotAt(cx, cy + 6, off, 30)).toBe("cross");
  });

  it("never takes offshore's dot: it is locked at never", () => {
    expect(dotAt(0, 0, OURS.direction, 12)).toBeNull();
    const deep = { ...OURS.direction, crossOff: 5 };
    expect(dotAt(0, 0, deep, 12)).toBe("crossOff");
  });
});

describe("can you ride upwind?", () => {
  it("has three answers, Not yet the default", () => {
    expect(UP_ANSWERS.map((a) => a.name)).toEqual(["Not yet", "A little", "Yes"]);
    expect(answerOf(0)?.name).toBe("Not yet");
    expect(answerOf(20)?.name).toBe("Yes");
    expect(answerOf(12)).toBeNull();
  });

  it("reads a handle on the picture as its angle", () => {
    // Straight across is 90° off the wind on either side.
    const [ax, ay] = upPoint(90, UP.r);
    expect(Math.round(offWind(ax, ay))).toBe(90);
    const [bx, by] = upPoint(-70, UP.r);
    expect(Math.round(offWind(bx, by))).toBe(70);
    expect(edgeAngle("upwind", 70)).toBe(20);
    expect(edgeAngle("upwind", 100)).toBe(0);
    expect(edgeAngle("upwind", 10)).toBe(45);
    expect(edgeAngle("downwind", 100)).toBe(10);
    expect(edgeAngle("downwind", 170)).toBe(45);
  });

  it("finds the handle under a finger", () => {
    const yours = { upwind: 20, downwind: 10 };
    const [ux, uy] = upPoint(-70, UP.r);
    expect(edgeAt(ux + 2, uy, yours, 16)).toBe("upwind");
    const [dx, dy] = upPoint(100, UP.r);
    expect(edgeAt(dx, dy - 2, yours, 16)).toBe("downwind");
    expect(edgeAt(UP.cx, UP.cy, yours, 16)).toBeNull();
  });

  it("reads whole degrees along a slider", () => {
    expect(degAtX(150, 300, 45)).toBe(23);
    expect(degAtX(-10, 300, 45)).toBe(0);
    expect(degAtX(400, 300, 45)).toBe(45);
    expect(degAtX(10, 0, 45)).toBe(0);
  });
});
