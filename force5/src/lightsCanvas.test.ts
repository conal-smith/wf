import { afterEach, describe, expect, it, vi } from "vitest";
import { lookOf, shadows } from "./lightsCanvas";

describe("shadows", () => {
  it("reads a computed text-shadow list, colours with commas in them", () => {
    expect(
      shadows(
        "rgb(245, 240, 230) 0px 0px 2px, color(srgb 0.9 0.9 0.9 / 0.5) 0px 0px 8px",
      ),
    ).toEqual([
      { color: "rgb(245, 240, 230)", blur: 2 },
      { color: "color(srgb 0.9 0.9 0.9 / 0.5)", blur: 8 },
    ]);
  });
  it("is empty with none", () => {
    expect(shadows("none")).toEqual([]);
    expect(shadows("")).toEqual([]);
  });
});

describe("a muted dot's picture", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** An element as `lookOf` reads one: its styles by name, and what it holds. */
  const part = (style: Record<string, string>, inner: object = {}) => ({
    style,
    textContent: "",
    getAttribute: () => null,
    querySelector: () => null,
    ...inner,
  });

  it("is the ring alone, drawn small in the stylesheet's colour", () => {
    const fills: string[] = [];
    const drawing = {
      setTransform() {},
      scale() {},
      beginPath() {},
      arc() {},
      stroke() {},
      setLineDash() {},
      set fillStyle(colour: string) {
        fills.push(colour);
      },
      fill() {},
    };
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext = () => drawing;
        transferToImageBitmap = () => ({});
      },
    );
    vi.stubGlobal(
      "getComputedStyle",
      (el: { style: Record<string, string> }) => el.style,
    );
    const hidden = { display: "none" };
    const ring = part({
      fill: "rgb(139, 139, 148)",
      stroke: "none",
      strokeWidth: "0px",
      strokeDasharray: "none",
    });
    const strike = part(hidden);
    const figure = part(hidden);
    const wind = part(hidden);
    const svg = part(
      { transform: "matrix(0.34, 0, 0, 0.34, 0, 0)" },
      {
        querySelector: (at: string) =>
          ({
            ".lt-ring": ring,
            ".lt-strike": strike,
            ".lt-n": figure,
            ".lt-wind": wind,
          })[at],
      },
    );
    const label = part(hidden);
    const pill = part(hidden);
    const el = part(
      {},
      {
        querySelector: (at: string) =>
          ({
            ".lt-lab": label,
            ":scope > .lt-pill": pill,
            ":scope > svg": svg,
          })[at],
      },
    );
    const look = lookOf(el as unknown as HTMLElement, { x: 0, y: 0 }, 1, true);
    expect(look.arrow).toBeNull();
    expect(look.label).toBeNull();
    expect(look.ring.w).toBeLessThan(10);
    expect(fills).toEqual(["rgb(139, 139, 148)"]);
  });
});
