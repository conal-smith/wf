import { describe, expect, it } from "vitest";
import { hovers, hoverStore } from "./hover";

describe("the time hovered", () => {
  /** A store whose frames are run by hand. */
  function store() {
    const frames: (() => void)[] = [];
    const hover = hoverStore((run) => frames.push(run));
    const flush = () => frames.splice(0).forEach((run) => run());
    return { hover, frames, flush };
  }

  it("is published once a frame, the last one set", () => {
    const { hover, frames, flush } = store();
    let heard = 0;
    hover.subscribe(() => heard++);
    hover.set({ time: 1, over: "a" });
    hover.set({ time: 2, over: "a" });
    hover.set({ time: 3, over: "b" });
    expect(frames).toHaveLength(1);
    expect(hover.get()).toBeNull();
    flush();
    expect(hover.get()).toEqual({ time: 3, over: "b" });
    expect(heard).toBe(1);
  });

  it("says nothing for the same time over the same drawing, and clears", () => {
    const { hover, flush } = store();
    let heard = 0;
    const stop = hover.subscribe(() => heard++);
    hover.set({ time: 3, over: "b" });
    flush();
    hover.set({ time: 3, over: "b" });
    flush();
    expect(heard).toBe(1);
    // Leaving one drawing for another in a frame: the other.
    hover.set(null);
    hover.set({ time: 4, over: "c" });
    flush();
    expect(hover.get()).toEqual({ time: 4, over: "c" });
    hover.set(null);
    flush();
    expect(hover.get()).toBeNull();
    expect(heard).toBe(3);
    stop();
    hover.set({ time: 5, over: "c" });
    flush();
    expect(heard).toBe(3);
  });

  it("follows a mouse or a pen, never a finger", () => {
    expect(hovers({ pointerType: "mouse" })).toBe(true);
    expect(hovers({ pointerType: "pen" })).toBe(true);
    expect(hovers({ pointerType: "touch" })).toBe(false);
  });
});
