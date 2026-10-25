import { describe, expect, it } from "vitest";
import {
  chartCentre,
  openingPath,
  saveChartCentre,
  saveView,
  storedView,
  viewOfPath,
} from "./lastView";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe("the last view", () => {
  it("is kept on the device, and nothing else reads as one", () => {
    const store = memory();
    expect(storedView(store)).toBeNull();
    saveView("finder", store);
    expect(storedView(store)).toBe("finder");
    saveView("chart", store);
    expect(storedView(store)).toBe("chart");
    store.setItem("wingfoil.view.v1", "dock");
    expect(storedView(store)).toBeNull();
  });

  it("opens the root on the spot finder when that was the last one open", () => {
    expect(openingPath("/", "", "finder")).toBe("/spots");
    expect(openingPath("/", "?", "finder")).toBe("/spots");
    expect(openingPath("/", "", "chart")).toBeNull();
    expect(openingPath("/", "", null)).toBeNull();
  });

  it("lets a link that says where to go win", () => {
    expect(openingPath("/", "?spot=keel", "finder")).toBeNull();
    // The menu's Chart, and every way back named Chart (CHART_HREF).
    expect(openingPath("/", "?chart", "finder")).toBeNull();
    expect(openingPath("/spots", "", "chart")).toBeNull();
    expect(openingPath("/spot/keel", "", "finder")).toBeNull();
  });

  it("knows which page a path draws", () => {
    expect(viewOfPath("/spots")).toBe("finder");
    expect(viewOfPath("/spots/")).toBe("finder");
    expect(viewOfPath("/")).toBe("chart");
    expect(viewOfPath("/spot/keel")).toBe("chart");
  });

  it("keeps where the chart was centred, and nothing broken", () => {
    const store = memory();
    expect(chartCentre(store)).toBeNull();
    saveChartCentre({ lat: 53.412345678, lon: -6.123456789 }, store);
    expect(chartCentre(store)).toEqual({ lat: 53.4123, lon: -6.1235 });
    store.setItem("wingfoil.map.centre.v1", "{");
    expect(chartCentre(store)).toBeNull();
  });
});
