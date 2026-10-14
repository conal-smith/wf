import { describe, expect, it } from "vitest";
import {
  SKILLS,
  rateHour,
  type Agreement,
  type Rider,
} from "../../force5/src/stars";
import { ledger } from "./ledger";

describe("the worked example's ledger", () => {
  it("comes to the stars rateHour gives, for every level, shore, gust and agreement", () => {
    let checked = 0;
    for (const skill of SKILLS)
      for (const weightKg of [null, 60, 110])
        for (const wings of [[], [3], [8]]) {
          const rider: Rider = { skill, weightKg, wings };
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
    expect(checked).toBeGreaterThan(100000);
  });

  it("shows its working", () => {
    const worked = ledger(
      { windKn: 12.6, gustKn: 18.9, from: 355, agreement: "moderate" },
      101,
      { skill: "intermediate", weightKg: null, wings: [] },
    )!;
    expect(worked.lines[0]).toEqual({
      what: "12.6 kn gusting 18.9 is rated as",
      figure: "14.1 kn",
    });
    expect(worked.lines.map((line) => line.what)).toContain(
      "The models differ a little",
    );
    expect(worked.lines.find((line) => line.total)?.figure).toMatch(
      /, so \d solid$/,
    );
  });
});
