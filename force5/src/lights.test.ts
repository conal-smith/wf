import { describe, expect, it } from "vitest";
import { dotWords, type LightState } from "./lights";

const state = (over: Partial<LightState> = {}): LightState => ({
  stars: 2,
  pending: false,
  dark: false,
  from: 225,
  windKn: 12,
  gustKn: 18,
  compass: "SW",
  mark: null,
  wedge: null,
  ...over,
});

describe("what a dot's card says", () => {
  const when = "at 13:00 today";

  it("gives the wind, the gust and the stars at the hour", () => {
    expect(dotWords(state(), when, "kn")).toEqual({
      calm: false,
      speed: "12",
      gust: "18",
      line: "2 stars at 13:00 today",
    });
    expect(dotWords(state({ stars: 1 }), when, "kn").line).toBe(
      "1 star at 13:00 today",
    );
  });

  it("reads as calm under a knot", () => {
    const words = dotWords(
      state({ windKn: 0.4, gustKn: 0.9, stars: 0 }),
      when,
      "kn",
    );
    expect(words.calm).toBe(true);
    expect(words.line).toBe("0 stars at 13:00 today");
  });

  it("says a light wind's figures, not calm", () => {
    expect(dotWords(state({ windKn: 3, stars: 0 }), when, "kn").calm).toBe(
      false,
    );
  });

  it("says offshore in place of the stars, and cross-offshore beside them", () => {
    expect(dotWords(state({ mark: "struck" }), when, "kn").line).toBe(
      "Offshore at 13:00 today",
    );
    expect(dotWords(state({ mark: "cross-off" }), when, "kn").line).toBe(
      "2 stars, cross-offshore at 13:00 today",
    );
  });

  it("says a dark hour, and keeps its wind", () => {
    const words = dotWords(state({ dark: true, stars: null }), when, "kn");
    expect(words.line).toBe("Dark at 13:00 today");
    expect(words.speed).toBe("12");
  });

  it("never reads a spot not read yet, or an hour with no forecast, as calm", () => {
    expect(dotWords(undefined, when, "kn").calm).toBe(false);
    expect(dotWords(state({ pending: true }), when, "kn")).toMatchObject({
      calm: false,
      speed: null,
      line: "Not read yet",
    });
    expect(dotWords(state({ windKn: null }), when, "kn")).toMatchObject({
      calm: false,
      speed: null,
      line: "No forecast at this hour",
    });
  });
});
