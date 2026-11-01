import { describe, expect, it } from "vitest";
import { besideMark, standIn } from "./report/report";
import { headlineText, warningTitle, warningWhen } from "./Warnings";
import { restrictionShort } from "./WaterQuality";

describe("a warning's notice", () => {
  it("drops the status the title says in words", () => {
    expect(
      headlineText({
        level: "orange",
        headline: "Status Orange - Wind warning for Kerry",
      }),
    ).toBe("Wind warning for Kerry");
    // Another level than its own is left as issued.
    expect(
      headlineText({
        level: "yellow",
        headline: "Status Orange - Wind warning for Kerry",
      }),
    ).toBe("Status Orange - Wind warning for Kerry");
  });

  it("says the level in words, the kind in sentence case, the places as written", () => {
    expect(
      warningTitle({
        level: "orange",
        headline: "Status Orange - Wind warning for Kerry",
      }),
    ).toBe("Orange wind warning for Kerry");
    expect(
      warningTitle({
        level: "yellow",
        headline: "Small Craft warning for all coasts of Ireland",
      }),
    ).toBe("Yellow small craft warning for all coasts of Ireland");
    expect(
      warningTitle({
        level: "red",
        headline:
          "Status Red - Marine Violent Storm warning from Valentia to Loop Head",
      }),
    ).toBe("Red marine violent storm warning from Valentia to Loop Head");
    // A headline that already opens with its level, or names another, as it is.
    expect(
      warningTitle({ level: "yellow", headline: "Yellow rain warning for Cork" }),
    ).toBe("Yellow rain warning for Cork");
    expect(
      warningTitle({
        level: "yellow",
        headline: "Status Orange - Wind warning for Kerry",
      }),
    ).toBe("Status Orange - Wind warning for Kerry");
  });

  it("says when in Irish time, the day once when it ends the same day", () => {
    const same = warningWhen({
      onset: "2026-09-14T12:00:00Z",
      expiry: "2026-09-14T15:00:00Z",
    });
    expect(same.onset).toMatch(/^Mon 14 Sept?, 13:00$/);
    expect(same.expiry).toBe("16:00");
    const over = warningWhen({
      onset: "2026-09-14T21:00:00Z",
      expiry: "2026-09-15T09:00:00Z",
    });
    expect(over.onset).toMatch(/^Mon 14 Sept?, 22:00$/);
    expect(over.expiry).toMatch(/^Tue 15 Sept?, 10:00$/);
  });
});

describe("a bathing water notice, where it stands for the stars", () => {
  it("is said in two or three words", () => {
    expect(restrictionShort({ restriction: "Bathing is prohibited" })).toBe(
      "Bathing prohibited",
    );
    expect(
      restrictionShort({ restriction: "Advice not to swim (bathing)" }),
    ).toBe("Advice not to bathe");
    expect(restrictionShort({ restriction: "Restriction" })).toBe(
      "Bathing restricted",
    );
  });
});

describe("what stands in an hour's stars", () => {
  const warning = (level: "yellow" | "orange" | "red") => ({
    level,
    ids: ["w"],
    replaces_rating: level !== "yellow",
  });
  const water = (replaces_rating: boolean) => ({ ids: ["n"], replaces_rating });

  it("is an orange or red warning first, then a notice against bathing", () => {
    expect(standIn({ warning: warning("orange"), water: water(true) })).toEqual(
      { level: "orange", word: "Orange warning" },
    );
    expect(standIn({ warning: warning("yellow"), water: water(true) })).toEqual(
      { level: "water", word: "Water" },
    );
    expect(standIn({ warning: warning("red") })).toEqual({
      level: "red",
      word: "Red warning",
    });
    expect(standIn({ warning: warning("yellow"), water: water(false) })).toBe(
      null,
    );
    expect(standIn({})).toBe(null);
  });

  it("leaves a yellow warning or an advisory beside the stars", () => {
    expect(besideMark({ warning: warning("yellow") })).toBe("yellow");
    expect(besideMark({ water: water(false) })).toBe("water-advice");
    expect(besideMark({ warning: warning("orange") })).toBe(null);
  });
});
