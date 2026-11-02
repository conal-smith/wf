import { describe, expect, it, vi } from "vitest";
import type { ChartLayers } from "../force5/src/WindMap";
import { layerGroups, railGroups, type LayerChoices } from "./layerGroups";

const LAYERS: ChartLayers = {
  tints: true,
  soundings: true,
  relief: true,
  names: true,
  foil: true,
  currents: false,
  rain: false,
};

function choices(over: Partial<LayerChoices> = {}): LayerChoices {
  return {
    wind: { wash: false, particles: true },
    onWind: vi.fn(),
    layers: LAYERS,
    onLayersChange: vi.fn(),
    satellite: "off",
    onSatellite: vi.fn(),
    focusStyle: "ring",
    onFocusStyle: vi.fn(),
    ...over,
  };
}

const item = (rail: ReturnType<typeof railGroups>, id: string) =>
  rail.flatMap((group) => group.items).find((entry) => entry.id === id)!;

describe("railGroups", () => {
  it("is the panel's groups and layers, in its order, without a group's none", () => {
    const groups = layerGroups(choices());
    const rail = railGroups(groups);
    expect(rail.map((group) => group.name)).toEqual(
      groups.map((group) => group.name),
    );
    for (const [i, group] of rail.entries())
      expect(group.items.map((entry) => entry.id)).toEqual(
        groups[i].tiles.filter((tile) => !tile.none).map((tile) => tile.id),
      );
    expect(item(rail, "focus-off")).toBeUndefined();
    expect(
      rail.every((group) => group.items.every((entry) => entry.glyph)),
    ).toBe(true);
  });

  it("switches a chart part on and off", () => {
    const set = choices();
    const rail = railGroups(layerGroups(set));
    item(rail, "currents").press();
    expect(set.onLayersChange).toHaveBeenCalledWith({
      ...LAYERS,
      currents: true,
    });
  });

  it("switches the wind's two layers each by itself, either, both or neither", () => {
    const set = choices();
    const rail = railGroups(layerGroups(set));
    expect(rail[0].items.map((entry) => [entry.name, entry.on])).toEqual([
      ["Coloured wind", false],
      ["Particles", true],
    ]);
    item(rail, "wind-wash").press();
    expect(set.onWind).toHaveBeenLastCalledWith({
      wash: true,
      particles: true,
    });
    item(rail, "wind-particles").press();
    expect(set.onWind).toHaveBeenLastCalledWith({
      wash: false,
      particles: false,
    });
    const both = choices({ wind: { wash: true, particles: true } });
    const panel = layerGroups(both)[0];
    expect(panel.tiles.every((tile) => tile.on)).toBe(true);
    panel.tiles[0].press();
    expect(both.onWind).toHaveBeenLastCalledWith({
      wash: false,
      particles: true,
    });
  });

  it("switches the loupe on, and off to the range ring", () => {
    const off = choices({ focusStyle: "ring" });
    item(railGroups(layerGroups(off)), "focus-loupe").press();
    expect(off.onFocusStyle).toHaveBeenLastCalledWith("loupe");
    const on = choices({ focusStyle: "loupe" });
    const loupe = item(railGroups(layerGroups(on)), "focus-loupe");
    expect(loupe.on).toBe(true);
    loupe.press();
    expect(on.onFocusStyle).toHaveBeenLastCalledWith("ring");
  });

  it("goes from high tide to low tide to no satellite on one button", () => {
    const steps = [
      ["off", "high", "Satellite, high tide"],
      ["high", "low", "Satellite, high tide"],
      ["low", "off", "Satellite, low tide"],
    ] as const;
    for (const [now, next, name] of steps) {
      const set = choices({ satellite: now });
      const button = item(railGroups(layerGroups(set)), "satellite");
      expect(button.name).toBe(name);
      expect(button.on).toBe(now !== "off");
      button.press();
      expect(set.onSatellite).toHaveBeenLastCalledWith(next);
    }
  });

  it("leaves the chart's own parts out: they are always drawn", () => {
    const ids = railGroups(layerGroups(choices())).flatMap((group) =>
      group.items.map((entry) => entry.id),
    );
    expect(ids).toEqual([
      "wind-wash",
      "wind-particles",
      "foil",
      "currents",
      "rain",
      "satellite",
      "focus-loupe",
    ]);
  });
});
