import { describe, expect, it } from "vitest";
import { THUNDER_CAPE_DRY, THUNDER_CAPE_WET, thunderRisk } from "./thunder";

describe("thunderRisk", () => {
  it("is high wherever the model's code is a thunderstorm", () => {
    for (const code of [13, 17, 29, 91, 95, 96, 99])
      expect(thunderRisk(code, 0)?.risk, String(code)).toBe("high");
    expect(thunderRisk(95, null)?.why).toMatch(/thunderstorm.*code 95/);
  });

  it("is possible with enough CAPE under showers or rain, or a lot of it under any sky", () => {
    expect(thunderRisk(80, THUNDER_CAPE_WET)?.risk).toBe("possible");
    expect(thunderRisk(61, THUNDER_CAPE_WET + 200)?.why).toMatch(
      /CAPE 500 J\/kg with slight rain/,
    );
    expect(thunderRisk(80, THUNDER_CAPE_WET - 1)?.risk).toBe("low");
    expect(thunderRisk(3, THUNDER_CAPE_WET + 200)?.risk).toBe("low");
    expect(thunderRisk(3, THUNDER_CAPE_DRY)?.risk).toBe("possible");
    expect(thunderRisk(null, THUNDER_CAPE_DRY)?.risk).toBe("possible");
  });

  it("is low on a quiet hour, and unknown where the model publishes neither", () => {
    expect(thunderRisk(2, 40)).toEqual({ risk: "low", why: null });
    expect(thunderRisk(61, null)?.risk).toBe("low");
    expect(thunderRisk(null, null)).toBeNull();
  });
});
