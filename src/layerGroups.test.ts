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

  it("chooses nothing round the spot when the one on is pressed again", () => {
    const set = choices({ focusStyle: "loupe" });
    const rail = railGroups(layerGroups(set));
    item(rail, "focus-loupe").press();
    expect(set.onFocusStyle).toHaveBeenLastCalledWith("off");
    item(rail, "focus-ring").press();
    expect(set.onFocusStyle).toHaveBeenLastCalledWith("ring");
  });

  it("takes the satellite away when its tide is pressed again", () => {
    const set = choices({ satellite: "high" });
    const rail = railGroups(layerGroups(set));
    item(rail, "satellite-high").press();
    expect(set.onSatellite).toHaveBeenLastCalledWith("off");
    item(rail, "satellite-low").press();
    expect(set.onSatellite).toHaveBeenLastCalledWith("low");
  });
});
