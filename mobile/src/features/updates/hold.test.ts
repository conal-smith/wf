import { describe, expect, it } from "vitest";
import { createHold } from "./hold";

describe("holding updates", () => {
  it("is held while any hold is on, and tells listeners when that changes", () => {
    const h = createHold();
    const seen: boolean[] = [];
    h.subscribe(() => seen.push(h.isHeld()));
    expect(h.isHeld()).toBe(false);
    const a = h.hold();
    const b = h.hold();
    expect(h.isHeld()).toBe(true);
    a();
    expect(h.isHeld()).toBe(true);
    b();
    expect(h.isHeld()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("releases each hold once, however often it is called", () => {
    const h = createHold();
    const a = h.hold();
    const b = h.hold();
    a();
    a();
    expect(h.isHeld()).toBe(true);
    b();
    expect(h.isHeld()).toBe(false);
  });

  it("stops telling a listener that unsubscribed", () => {
    const h = createHold();
    let calls = 0;
    const off = h.subscribe(() => (calls += 1));
    off();
    h.hold()();
    expect(calls).toBe(0);
  });
});
