import { describe, expect, it } from "vitest";
import { placeLabels } from "./DayTide";

const label = (x: number, tide: "high" | "low" = "high") => ({
  x,
  width: 80,
  tide,
});

describe("where a turn's time and height are written", () => {
  it("centres a label on its turn", () => {
    expect(placeLabels([label(200)], 30, 400, null)).toEqual([160]);
  });

  it("keeps a turn near midnight inside the chart", () => {
    expect(placeLabels([label(35), label(395)], 30, 400, null)).toEqual([
      30, 320,
    ]);
  });

  it("moves a label off the now-line, to the nearer side", () => {
    const [x0] = placeLabels([label(200)], 30, 400, 210);
    expect(x0 + 80).toBeLessThanOrEqual(206);
    const [x1] = placeLabels([label(200)], 30, 400, 190);
    expect(x1).toBeGreaterThanOrEqual(194);
  });

  it("goes the other way when the near side is the chart's edge", () => {
    const [x0] = placeLabels([label(60)], 30, 400, 70);
    expect(x0).toBeGreaterThanOrEqual(74);
  });

  it("parts two labels of a kind, and lets a high and a low share a column", () => {
    expect(placeLabels([label(200), label(230)], 30, 400, null)).toEqual([
      160, 248,
    ]);
    expect(placeLabels([label(200), label(230, "low")], 30, 400, null)).toEqual(
      [160, 190],
    );
  });
});
