import { describe, expect, it } from "vitest";
import { arrowsFree, hourStep } from "./hourKeys";

const key = (
  k: string,
  more: Partial<Parameters<typeof hourStep>[0]> = {},
) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...more,
});

/** An element that matches the selectors its own keys are named in. */
const at = (owns: boolean) => ({
  closest: (selectors: string) => (owns && selectors ? {} : null),
});

describe("the arrow keys and the dock's hour", () => {
  it("steps an hour each way, and nothing for other keys or a chord", () => {
    expect(hourStep(key("ArrowRight"))).toBe(1);
    expect(hourStep(key("ArrowLeft"))).toBe(-1);
    expect(hourStep(key("ArrowUp"))).toBe(0);
    expect(hourStep(key("ArrowRight", { shiftKey: true }))).toBe(0);
    expect(hourStep(key("ArrowLeft", { metaKey: true }))).toBe(0);
  });

  it("takes them with nothing focused, but not from a control that uses them", () => {
    expect(arrowsFree(null)).toBe(true);
    expect(arrowsFree(at(false) as unknown as Element)).toBe(true);
    expect(arrowsFree(at(true) as unknown as Element)).toBe(false);
  });

  it("names text fields, sliders, lists, menus and the chart among their owners", () => {
    let asked = "";
    arrowsFree({
      closest: (s: string) => ((asked = s), null),
    } as unknown as Element);
    for (const owner of [
      "textarea",
      "select",
      "[role=slider]",
      "[role=listbox]",
      "[role=menu]",
      "[contenteditable]",
      ".maplibregl-canvas",
    ])
      expect(asked).toContain(owner);
    expect(asked).toMatch(/^input:not\(\[type=checkbox\]\)/);
  });
});
