import { describe, expect, it } from "vitest";
import { tipShoreText } from "./ratingTipLogic";

describe("tipShoreText", () => {
  it("names the shore angle where there is one", () => {
    expect(tipShoreText("cross-off", true, false)).toBe("cross-offshore");
    expect(tipShoreText(null, true, false)).toBe(
      "Shore angle unknown for this hour",
    );
  });

  it("says nothing at a spot on the water, and that the facing is unknown at a beach", () => {
    expect(tipShoreText(null, false, true)).toBeNull();
    expect(tipShoreText(null, false, false)).toBe(
      "Facing unknown: the wind alone is rated",
    );
  });
});
