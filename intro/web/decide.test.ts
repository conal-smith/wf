import { describe, expect, it } from "vitest";
import { decideIntro, type IntroEnvironment } from "./decide";

const firstVisit: IntroEnvironment = {
  pathname: "/",
  search: "",
  seen: false,
  webdriver: false,
  coarsePointer: false,
  narrow: false,
  reducedMotion: false,
  webgl2: true,
};

describe("decideIntro", () => {
  it("plays for a first visit to the map on a desktop", () => {
    expect(decideIntro(firstVisit)).toEqual({ play: true, startAt: 0 });
  });

  it.each([
    ["it has been seen", { seen: true }],
    ["the browser is automated", { webdriver: true }],
    ["the pointer is a finger", { coarsePointer: true }],
    ["the window is narrow", { narrow: true }],
    ["the reader asked for less motion", { reducedMotion: true }],
    ["there is no WebGL 2", { webgl2: false }],
    ["the page is the marketplace", { pathname: "/market" }],
    ["the page is a deep link into the map", { pathname: "/spot/brandon-bay" }],
  ])("stays away when %s", (_, change) => {
    expect(decideIntro({ ...firstVisit, ...change }).play).toBe(false);
  });

  it("plays on request even when seen, automated or on a phone", () => {
    const env = {
      ...firstVisit,
      search: "?intro",
      seen: true,
      webdriver: true,
      coarsePointer: true,
      pathname: "/market",
    };
    expect(decideIntro(env)).toEqual({ play: true, startAt: 0 });
  });

  it("starts part-way in when asked", () => {
    expect(decideIntro({ ...firstVisit, search: "?intro=17.5" })).toEqual({
      play: true,
      startAt: 17.5,
    });
  });

  it("ignores a start time that is not a number", () => {
    expect(decideIntro({ ...firstVisit, search: "?intro=soon" }).startAt).toBe(0);
  });

  it("can be turned off from the address", () => {
    expect(decideIntro({ ...firstVisit, search: "?intro=off" }).play).toBe(false);
  });

  it("still needs WebGL 2 on request", () => {
    expect(decideIntro({ ...firstVisit, search: "?intro", webgl2: false }).play).toBe(false);
  });
});
