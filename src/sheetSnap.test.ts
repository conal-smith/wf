import { describe, expect, it } from "vitest";
import { follow, isSheetDrag, settle, speed, step } from "./sheetSnap";

const heights = { peek: 40, half: 140, full: 220 };

describe("isSheetDrag", () => {
  it("leaves a tap and a sideways slide through the hours alone", () => {
    expect(isSheetDrag(2, 5)).toBe(false);
    expect(isSheetDrag(30, 12)).toBe(false);
    expect(isSheetDrag(10, -10)).toBe(false);
  });
  it("takes a move mostly up or down", () => {
    expect(isSheetDrag(3, 12)).toBe(true);
    expect(isSheetDrag(-6, -20)).toBe(true);
  });
});

describe("settle", () => {
  it("goes back where it was for a short slow pull", () => {
    expect(settle("half", 20, 0, heights)).toBe("half");
    expect(settle("half", -30, 0.1, heights)).toBe("half");
  });
  it("goes to the nearest snap for a long slow pull", () => {
    expect(settle("half", 80, 0, heights)).toBe("peek");
    expect(settle("half", -60, 0, heights)).toBe("full");
    expect(settle("peek", -150, 0, heights)).toBe("full");
  });
  it("moves one snap for a fling, however short", () => {
    expect(settle("half", 10, 0.9, heights)).toBe("peek");
    expect(settle("half", -10, -0.9, heights)).toBe("full");
    expect(settle("full", 12, 1.5, heights)).toBe("half");
    expect(settle("full", -12, -1.5, heights)).toBe("full");
  });
  it("closes only from peek", () => {
    expect(settle("peek", 12, 0.8, heights)).toBe("close");
    expect(settle("peek", 60, 0, heights)).toBe("close");
    expect(settle("peek", 30, 0, heights)).toBe("peek");
    expect(settle("half", 200, 0, heights)).toBe("peek");
    expect(settle("half", 200, 2, heights)).toBe("peek");
  });
  it("does not take a fling against the pull's own direction", () => {
    // Pulled well down, then flicked back up a little at the end.
    expect(settle("half", 90, -0.6, heights)).toBe("half");
  });
});

describe("step", () => {
  it("steps one snap and stops at the ends", () => {
    expect(step("peek", 1)).toBe("half");
    expect(step("full", 1)).toBe("full");
    expect(step("half", -1)).toBe("peek");
    expect(step("peek", -1)).toBe("peek");
  });
});

describe("follow", () => {
  it("follows the finger between the snaps, and gives a quarter past them", () => {
    expect(follow(-50, 80, 100)).toBe(-50);
    expect(follow(-120, 80, 100)).toBe(-90);
    expect(follow(140, 80, 100)).toBe(110);
  });
});

describe("speed", () => {
  it("reads the last 100 ms of moves", () => {
    expect(
      speed([
        { t: 0, y: 0 },
        { t: 200, y: 10 },
        { t: 250, y: 40 },
        { t: 300, y: 70 },
      ]),
    ).toBeCloseTo(0.6);
  });
  it("is nothing for a finger held still or a single move", () => {
    expect(speed([{ t: 0, y: 5 }])).toBe(0);
    expect(speed([])).toBe(0);
    expect(
      speed([
        { t: 0, y: 0 },
        { t: 300, y: 80 },
      ]),
    ).toBe(0);
  });
});
