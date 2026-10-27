import type { ReactNode } from "react";
import type { SatelliteOption } from "../force5/src/satellite";
import type { ChartLayers } from "../force5/src/WindMap";
import type { FocusStyle } from "../force5/src/focus";
import type { WindLayers } from "../force5/src/windLayer";
import { DEFAULT_WIND } from "../force5/src/windLayers";
import {
  ChartGlyph,
  glyphs,
  ColouredWindGlyph,
  CurrentsGlyph,
  HighTideGlyph,
  LoupeGlyph,
  LowTideGlyph,
  NamesGlyph,
  ParticlesGlyph,
  RainGlyph,
  ReliefGlyph,
  RingGlyph,
  SatelliteGlyph,
  SoundingsGlyph,
  TidalDepthGlyph,
  TintsGlyph,
} from "./chartGlyphs";
// A type alone: the pictures stay in the Layers panel's own chunk.
import type { CuttingId } from "./layerCuttings";
import type { InfoSection } from "./mapInfoContext";

/** What the chart draws, and the way to change each part of it. */
export interface LayerChoices {
  /** The wind's two layers, the coloured wind and the particles, each on or off. */
  wind: WindLayers;
  onWind: (wind: WindLayers) => void;
  layers: ChartLayers;
  onLayersChange: (layers: ChartLayers) => void;
  /** The satellite image under the chart: off, or which tide's. */
  satellite: SatelliteOption;
  onSatellite: (option: SatelliteOption) => void;
  /** What is drawn round the chosen spot: a loupe, a range ring, or nothing. */
  focusStyle: FocusStyle;
  onFocusStyle: (style: FocusStyle) => void;
}

/**
 * The chart a first visit opens on, and what the Layers panel's Reset puts
 * back (src/App.tsx): the particles, tidal depth, the whole chart and the
 * range ring. The panel's foot names them from here (`defaultLayersLine`),
 * so what it says is the default cannot drift from what Reset does.
 */
export const LAYER_DEFAULTS: {
  wind: WindLayers;
  layers: ChartLayers;
  satellite: SatelliteOption;
  focusStyle: FocusStyle;
} = {
  wind: DEFAULT_WIND,
  layers: {
    tints: true,
    soundings: true,
    relief: true,
    names: true,
    foil: true,
    // Off by default: nothing of it is read until a rider asks for it.
    currents: false,
    // Off too, and nothing of it read until asked for.
    rain: false,
  },
  satellite: "off",
  focusStyle: "ring",
};

/** One layer: its name, its glyph, whether it is on, and its switch. */
export interface LayerTile {
  id: string;
  name: string;
  /** A few words under the name, read after it as its description. */
  sub: string;
  /** Its picture in the Layers panel (src/layerCuttings.tsx). */
  cut: CuttingId;
  glyph?: ReactNode;
  on: boolean;
  press: () => void;
  /** The chart part it switches, for the specs and the stored choice. */
  layer?: keyof ChartLayers;
  /** Its key is in the map's information, behind an "i". */
  info?: { label: string; at: InfoSection };
  /** New to the chart: marked so beside its name. */
  isNew?: boolean;
  /**
   * The group's "none of these": a tile of its own in the panel; on the
   * layers' rail, pressing the tile that is on instead.
   */
  none?: boolean;
}

export interface LayerGroup {
  /** For the panel's notes under a group. */
  id: "wind" | "sea" | "weather" | "chart" | "ground" | "focus";
  name: string;
  /** The group's glyph, before its name. */
  glyph: ReactNode;
  /** How its tiles combine, in a word or two at the rule's end. */
  rule: string;
  tiles: LayerTile[];
}

/**
 * Every layer the chart can draw, in the groups and the order the Layers
 * panel (src/LayersPanel.tsx) and the layers' rail (src/LayerRail.tsx) both
 * show them: the wind, the sea, the weather, the chart, the ground under it,
 * and what is drawn round the chosen spot. A layer added here is in both.
 * Round the spot one is always on, as a radio's choice is; a satellite tide
 * pressed again is no image; the rest, the wind's two layers among them, each
 * switch their own part.
 */
export function layerGroups({
  wind,
  onWind,
  layers,
  onLayersChange,
  satellite,
  onSatellite,
  focusStyle,
  onFocusStyle,
}: LayerChoices): LayerGroup[] {
  const windPart = (
    key: keyof WindLayers,
    name: string,
    sub: string,
    glyph: ReactNode,
  ): LayerTile => ({
    id: `wind-${key}`,
    name,
    sub,
    cut: key,
    glyph,
    on: wind[key],
    press: () => onWind({ ...wind, [key]: !wind[key] }),
  });
  const part = (
    key: keyof ChartLayers,
    name: string,
    sub: string,
    cut: CuttingId,
    glyph: ReactNode,
    info?: LayerTile["info"],
  ): LayerTile => ({
    id: key,
    name,
    sub,
    cut,
    glyph,
    on: layers[key],
    press: () => onLayersChange({ ...layers, [key]: !layers[key] }),
    layer: key,
    info,
  });
  const photo = (
    option: Exclude<SatelliteOption, "off">,
    name: string,
    sub: string,
    glyph: ReactNode,
  ): LayerTile => ({
    id: `satellite-${option}`,
    name,
    sub,
    cut: option === "high" ? "sat-high" : "sat-low",
    glyph,
    on: satellite === option,
    press: () => onSatellite(satellite === option ? "off" : option),
  });
  const focus = (
    style: FocusStyle,
    name: string,
    sub: string,
    cut: CuttingId,
    glyph?: ReactNode,
  ): LayerTile => ({
    id: `focus-${style}`,
    name,
    sub,
    cut,
    glyph,
    on: focusStyle === style,
    press: () => onFocusStyle(style),
    none: style === "off",
  });

  return [
    {
      id: "wind",
      name: "Wind",
      glyph: <ChartGlyph glyph={glyphs.wind} size={14} />,
      rule: "either, or both",
      tiles: [
        windPart(
          "wash",
          "Coloured wind",
          "Speed as colour",
          <ColouredWindGlyph size={18} />,
        ),
        windPart(
          "particles",
          "Particles",
          "Lines moving with it",
          <ParticlesGlyph size={18} />,
        ),
      ],
    },
    {
      id: "sea",
      name: "Sea",
      glyph: <ChartGlyph glyph={glyphs.waves} size={14} />,
      rule: "any",
      tiles: [
        part(
          "foil",
          "Tidal depth",
          "Water at this tide",
          "foil",
          <TidalDepthGlyph size={18} />,
          { label: "About tidal depth", at: "foil" },
        ),
        {
          ...part(
            "currents",
            "Currents",
            "Tidal streams",
            "currents",
            <CurrentsGlyph size={18} />,
            { label: "About currents", at: "currents" },
          ),
          isNew: true,
        },
      ],
    },
    {
      id: "weather",
      name: "Weather",
      glyph: <RainGlyph size={14} />,
      rule: "over the chart",
      tiles: [
        {
          ...part(
            "rain",
            "Rain",
            "In the hour shown",
            "rain",
            <RainGlyph size={18} />,
            { label: "About rain", at: "rain" },
          ),
          isNew: true,
        },
      ],
    },
    {
      id: "chart",
      name: "Chart",
      glyph: <ChartGlyph glyph={glyphs.chartMap} size={14} />,
      rule: "any",
      tiles: [
        part(
          "tints",
          "Depth tints",
          "Shallow to deep",
          "tints",
          <TintsGlyph size={18} />,
        ),
        part(
          "soundings",
          "Contours",
          "And soundings",
          "soundings",
          <SoundingsGlyph size={18} />,
        ),
        part(
          "relief",
          "Land relief",
          "Hachures",
          "relief",
          <ReliefGlyph size={18} />,
        ),
        part(
          "names",
          "Spot names",
          "Beside the lights",
          "names",
          <NamesGlyph size={18} />,
        ),
      ],
    },
    {
      id: "ground",
      name: "Ground",
      glyph: <SatelliteGlyph size={14} />,
      rule: "a picture under the chart",
      tiles: [
        photo(
          "high",
          "Satellite, high tide",
          "Sentinel-2",
          <HighTideGlyph size={18} />,
        ),
        photo(
          "low",
          "Satellite, low tide",
          "The sand bared",
          <LowTideGlyph size={18} />,
        ),
      ],
    },
    {
      id: "focus",
      name: "Round your spot",
      glyph: <LoupeGlyph size={14} />,
      rule: "one at a time",
      tiles: [
        focus(
          "loupe",
          "Loupe",
          "Headings you hold",
          "loupe",
          <LoupeGlyph size={18} />,
        ),
        focus(
          "ring",
          "Range ring",
          "A distance round it",
          "ring",
          <RingGlyph size={18} />,
        ),
        focus("off", "Nothing", "Just the light", "focus-off"),
      ],
    },
  ];
}

/** One of the rail's buttons: a layer's glyph, its name, and its switch. */
export interface RailItem {
  id: string;
  name: string;
  glyph: ReactNode;
  on: boolean;
  press: () => void;
}

/**
 * The groups as the layers' rail draws them: a button a layer, with no
 * picture and no words under it. A group's "none of these" has no button of
 * its own there: pressing the layer that is on chooses it instead, as a
 * satellite tide pressed again is no image.
 */
export function railGroups(groups: LayerGroup[]) {
  return groups.map((group) => {
    const none = group.tiles.find((tile) => tile.none);
    return {
      id: group.id,
      name: group.name,
      items: group.tiles
        .filter((tile) => !tile.none)
        .map((tile): RailItem => ({
          id: tile.id,
          name: tile.name,
          glyph: tile.glyph,
          on: tile.on,
          press: tile.on && none ? none.press : tile.press,
        })),
    };
  });
}

/** The choices as they are, against the defaults: the layers alone, not their switches. */
export function isDefaultLayers({
  wind,
  layers,
  satellite,
  focusStyle,
}: Pick<LayerChoices, "wind" | "layers" | "satellite" | "focusStyle">) {
  const d = LAYER_DEFAULTS;
  return (
    wind.wash === d.wind.wash &&
    wind.particles === d.wind.particles &&
    (Object.keys(d.layers) as (keyof ChartLayers)[]).every(
      (key) => !!layers[key] === d.layers[key],
    ) &&
    satellite === d.satellite &&
    focusStyle === d.focusStyle
  );
}

/**
 * The default layers in words, read off the panel's own tiles as they stand
 * at the defaults, in the panel's order: a group whose every layer is on by
 * its group's name ("the chart"), any other by its layers' names.
 */
export function defaultLayerNames(): string[] {
  const none = () => {};
  const groups = layerGroups({
    ...LAYER_DEFAULTS,
    onWind: none,
    onLayersChange: none,
    onSatellite: none,
    onFocusStyle: none,
  });
  return groups.flatMap((group) => {
    const tiles = group.tiles.filter((tile) => !tile.none);
    const on = tiles.filter((tile) => tile.on);
    if (on.length > 1 && on.length === tiles.length)
      return [`the ${group.name.toLowerCase()}`];
    return on.map((tile) => tile.name.toLowerCase());
  });
}

/**
 * The Layers panel's foot: the defaults by name, said as what is on when
 * the chart is at them, and otherwise as what Reset puts back, so a rider
 * with other layers on never reads it as a list of what is on now.
 */
export function defaultLayersLine(atDefault: boolean): string {
  const names = defaultLayerNames().join(", ");
  return atDefault
    ? `The default layers are on: ${names}.`
    : `Reset for the default: ${names}.`;
}
