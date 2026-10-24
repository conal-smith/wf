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
    windStyle: "ink",
    onWindStyle: vi.fn(),
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

  it("keeps the wind's one style on when it is pressed again", () => {
    const set = choices({ windStyle: "wash" });
    const rail = railGroups(layerGroups(set));
    item(rail, "wind-wash").press();
    expect(set.onWindStyle).toHaveBeenLastCalledWith("wash");
    item(rail, "wind-arrows").press();
    expect(set.onWindStyle).toHaveBeenLastCalledWith("arrows");
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
