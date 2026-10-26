import { describe, expect, it } from "vitest";
import { chartCentre, openingPath, saveChartCentre } from "./lastView";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe("the opening address", () => {
  it("leaves the root, the full chart and a spot's chart as they are", () => {
    expect(openingPath("/", "")).toBeNull();
    expect(openingPath("/", "?map")).toBeNull();
    expect(openingPath("/", "?spot=keel")).toBeNull();
    expect(openingPath("/", "?settings")).toBeNull();
    expect(openingPath("/spot/keel", "")).toBeNull();
  });

  it("sends the spot finder's old address on to the root, with its query", () => {
    expect(openingPath("/spots", "")).toBe("/");
    expect(openingPath("/spots/", "?")).toBe("/");
    expect(openingPath("/spots", "?settings")).toBe("/?settings");
  });

  it("reads the full chart's old word as the new one", () => {
    expect(openingPath("/", "?chart")).toBe("/?map");
    expect(openingPath("/", "?chart&settings")).toBe("/?map&settings=");
    expect(openingPath("/", "?spot=keel&chart")).toBe("/?spot=keel");
  });
});

describe("the chart's centre", () => {
  it("is kept, and nothing broken", () => {
    const store = memory();
    expect(chartCentre(store)).toBeNull();
    saveChartCentre({ lat: 53.412345678, lon: -6.123456789 }, store);
    expect(chartCentre(store)).toEqual({ lat: 53.4123, lon: -6.1235 });
    store.setItem("wingfoil.map.centre.v1", "{");
    expect(chartCentre(store)).toBeNull();
  });
});
