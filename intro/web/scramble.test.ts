import { describe, expect, it } from "vitest";
import { scramble } from "./scramble";

describe("scramble", () => {
  it("is the text itself once fully revealed", () => {
    expect(scramble("wingfoil.ie", 1, 3)).toBe("wingfoil.ie");
  });

  it("keeps the length, and holds punctuation and spaces still", () => {
    const s = scramble("Brandon Bay, Co. Kerry", 0, 7);
    expect(s).toHaveLength("Brandon Bay, Co. Kerry".length);
    expect(s[7]).toBe(" ");
    expect(s[11]).toBe(",");
    expect(s[15]).toBe(".");
  });

  it("reveals from the left as it progresses", () => {
    const s = scramble("wingfoil", 0.5, 1);
    expect(s.slice(0, 4)).toBe("wing");
  });

  it("keeps capitals capital while they are stand-ins", () => {
    const s = scramble("Kerry", 0, 2);
    expect(s[0]).toBe(s[0].toUpperCase());
  });

  it("changes its stand-ins with the tick", () => {
    expect(scramble("wingfoil", 0, 1)).not.toBe(scramble("wingfoil", 0, 2));
  });
});
