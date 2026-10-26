import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  DEFAULT_RIDER,
  rateHour,
  type Agreement,
  type CustomRating,
  type Rider,
} from "../../force5/src/stars";
import { fourNumbers, ledger } from "./ledger";

const CUSTOM: CustomRating = {
  version: CUSTOM_RATING_VERSION,
  wind: { min: 13, sweetLow: 16, sweetHigh: 20, max: 28 },
  direction: { onshore: 1, crossOn: 0, cross: 0, crossOff: 2, offshore: 5 },
};
/** One that never rides cross-offshore either. */
const NO_CROSS_OFF: CustomRating = {
  ...CUSTOM,
  direction: { ...CUSTOM.direction, crossOff: 5 },
};

describe("the worked example's ledger", () => {
  it("comes to the stars rateHour gives, for every wind, gust, shore and agreement, ours and a rider's own", () => {
    let checked = 0;
    for (const custom of [null, CUSTOM, NO_CROSS_OFF])
      for (const weightKg of [null, 60, 110])
        for (const wings of [[], [3], [8]]) {
          const rider: Rider = { weightKg, wings, custom };
          for (let windKn = 4; windKn <= 38; windKn += 1)
            for (const factor of [null, 1, 1.2, 1.4, 1.6, 1.8, 2])
              for (let from = 0; from < 360; from += 30)
                for (const agreement of [
                  null,
                  "high",
                  "moderate",
                  "low",
                ] as (Agreement | null)[])
                  for (const facing of [null, 95]) {
                    const gustKn = factor === null ? null : windKn * factor;
                    const hour = { windKn, gustKn, from, agreement };
                    const rated = rateHour(
                      { ...hour, daylight: true },
                      { facing },
                      rider,
                    )!;
                    const worked = ledger(hour, facing, rider)!;
                    // Asserted only where they differ: a message built and
                    // two expectations made on every one of these cases would
                    // take the test past its timeout.
                    if (
                      worked.stars !== rated.stars ||
                      worked.potential !== rated.potential
                    ) {
                      const where = JSON.stringify({ rider, hour, facing });
                      expect(worked.stars, where).toBe(rated.stars);
                      expect(worked.potential, where).toBe(rated.potential);
                    }
                    checked++;
                  }
        }
    expect(checked).toBeGreaterThan(200000);
  });

  it("gives whose stars, the steady wind, the gusts and the direction, line by line", () => {
    const worked = ledger(
      { windKn: 20, gustKn: 30, from: 225, agreement: "high" },
      270,
      DEFAULT_RIDER,
    )!;
    expect(worked.lines).toEqual([
      { what: "Ours", figure: "11 · 15–22 · 35 kn" },
      { what: "Steady wind 20.0 kn", figure: "5.0, so 5" },
      {
        what: "Gusts to 30.0 kn, read 5 kn lighter: 25.0 kn",
        figure: "−1",
      },
      {
        what: "Wind cross-onshore, 45° from straight onshore",
        figure: "none",
      },
      { what: "Rating", figure: "4 solid, 1 outlined", total: true },
      { what: "Wing, which never moves a star", figure: "4.5 m²" },
    ]);
    expect([worked.stars, worked.potential]).toEqual([4, 5]);
  });

  it("takes a star off cross-offshore, and says the models' disagreement costs nothing", () => {
    const worked = ledger(
      { windKn: 18, gustKn: 24, from: 135, agreement: "moderate" },
      0,
      DEFAULT_RIDER,
    )!;
    expect(worked.lines.slice(2)).toEqual([
      {
        what: "Gusts to 24.0 kn, read 5 kn lighter: 19.0 kn",
        figure: "none",
      },
      {
        what: "Wind cross-offshore, 135° from straight onshore",
        figure: "−1",
      },
      {
        what: "The models differ a little: shown, never counted",
        figure: "none",
      },
      { what: "Rating", figure: "4 solid, 1 outlined", total: true },
      { what: "Wing, which never moves a star", figure: "4.5 m²" },
    ]);
  });

  it("stops at a gust past too much: no stars", () => {
    const worked = ledger(
      { windKn: 22, gustKn: 36, from: 225, agreement: "high" },
      270,
      DEFAULT_RIDER,
    )!;
    expect([worked.stars, worked.potential]).toEqual([0, 0]);
    expect(worked.lines.slice(1, 3)).toEqual([
      { what: "Gusts to 36.0 kn, past too much (35 kn)", figure: "no stars" },
      { what: "Rating", figure: "no stars", total: true },
    ]);
  });

  it("stops at an offshore wind: never", () => {
    const worked = ledger(
      { windKn: 18, gustKn: 22, from: 90, agreement: null },
      270,
      DEFAULT_RIDER,
    )!;
    expect([worked.stars, worked.potential]).toEqual([0, 0]);
    expect(worked.lines.slice(1, 3)).toEqual([
      { what: "Wind offshore, 180° from straight onshore", figure: "never" },
      { what: "Rating", figure: "no stars", total: true },
    ]);
  });

  it("says when the stars are the rider's own, with their four numbers", () => {
    const worked = ledger(
      { windKn: 18, gustKn: 27, from: 135, agreement: "high" },
      0,
      { weightKg: 95, wings: [], custom: CUSTOM },
    )!;
    expect(worked.lines[0]).toEqual({
      what: "Your own stars",
      figure: "13 · 16–20 · 28 kn",
    });
    expect(worked.lines.map((line) => line.what)).toContain(
      "Gusts to 27.0 kn, read 5 kn lighter: 22.0 kn",
    );
    expect(worked.stars).toBe(
      rateHour(
        { windKn: 18, gustKn: 27, from: 135, daylight: true },
        { facing: 0 },
        { weightKg: 95, wings: [], custom: CUSTOM },
      )!.stars,
    );
  });

  it("never moves a star for weight or wings", () => {
    const hour = { windKn: 16, gustKn: 23, from: 200, agreement: null };
    const stars = (rider: Rider) => ledger(hour, 270, rider)!.stars;
    expect(stars({ weightKg: 55, wings: [] })).toBe(
      stars({ weightKg: 120, wings: [9] }),
    );
  });

  it("writes the four numbers as the slider does", () => {
    expect(
      fourNumbers({ min: 11, sweetLow: 15, sweetHigh: 22.5, max: 35 }),
    ).toBe("11 · 15–22.5 · 35 kn");
  });
});
