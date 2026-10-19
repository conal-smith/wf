import { describe, expect, it } from "vitest";
import {
  CUSTOM_RATING_VERSION,
  SKILLS,
  rateHour,
  type Agreement,
  type CustomRating,
  type Rider,
} from "../../force5/src/stars";

const CUSTOM: CustomRating = {
  version: CUSTOM_RATING_VERSION,
  base: "beginner",
  wind: { min: 15, sweetLow: 18, sweetHigh: 23, max: 27 },
  gust: { fine: 24, worst: 30, most: 3 },
  direction: { onshore: 0.5, crossOn: 0, cross: 0, crossOff: 2.5, offshore: 0 },
};
import { ledger } from "./ledger";

describe("the worked example's ledger", () => {
  it("comes to the stars rateHour gives, for every level, shore, gust and agreement, and a custom rating", () => {
    let checked = 0;
    for (const skill of SKILLS)
      for (const weightKg of [null, 60, 110])
        for (const wings of [[], [3], [8]])
          for (const custom of skill === "intermediate"
            ? [null, CUSTOM]
            : [null]) {
            const rider: Rider = { skill, weightKg, wings, custom };
            for (let windKn = 4; windKn <= 38; windKn += 2)
              for (const factor of [null, 1, 1.3, 1.45, 1.6, 2])
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
                      // two expectations made on every one of these hundred
                      // thousand cases took the test past its timeout.
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
    expect(checked).toBeGreaterThan(130000);
  });

  it("shows its working", () => {
    const worked = ledger(
      { windKn: 12.6, gustKn: 18.9, from: 355, agreement: "moderate" },
      101,
      { skill: "intermediate", weightKg: null, wings: [] },
    )!;
    expect(worked.lines[0]).toEqual({
      what: "12.6 kn gusting 18.9 is rated as",
      figure: "12.6 kn",
    });
    expect(worked.lines).toContainEqual({
      what: "The models differ a little: shown, never counted",
      figure: "none",
    });
    expect(worked.lines.find((line) => line.total)?.figure).toMatch(
      /, so \d solid$/,
    );
  });

  it("gives the wind, the gusts by how strong they are, and the direction, line by line", () => {
    const worked = ledger(
      { windKn: 22, gustKn: 34, from: 225, agreement: "high" },
      270,
      { skill: "intermediate", weightKg: null, wings: [] },
    )!;
    expect(worked.lines).toEqual([
      { what: "22.0 kn gusting 34.0 is rated as", figure: "22.0 kn" },
      { what: "Stars for that wind", figure: "4.8, so 5 outlined" },
      {
        what: "Gusts to 34.0 kn, past the 28 kn that costs nothing",
        figure: "−1",
      },
      {
        what: "Wind cross-onshore, 45° from straight onshore",
        figure: "none",
      },
      { what: "Rating", figure: "3.8, so 4 solid", total: true },
      { what: "Wing", figure: "4 m²" },
    ]);
    expect(
      ledger({ windKn: 18, gustKn: 24, from: 90, agreement: null }, 270, {
        skill: "intermediate",
        weightKg: null,
        wings: [],
      })!.lines.slice(2, 4),
    ).toEqual([
      {
        what: "Gusts to 24.0 kn, no more than the 28 kn that costs nothing",
        figure: "none",
      },
      { what: "Wind offshore, 180° from straight onshore", figure: "−4" },
    ]);
  });

  it("says when the rating is the rider's own", () => {
    const rider: Rider = {
      skill: "intermediate",
      weightKg: 95,
      wings: [],
      custom: CUSTOM,
    };
    const worked = ledger(
      { windKn: 18, gustKn: 27, from: 90, agreement: "high" },
      270,
      rider,
    )!;
    expect(worked.lines[0]).toEqual({
      what: "Your own star rating, started from Learning",
      figure: "custom",
    });
    expect(worked.lines.map((line) => line.what)).toContain(
      "Gusts to 27.0 kn, past the 24 kn that costs nothing",
    );
    expect(worked.stars).toBe(3);
  });
});
