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
  /**
   * What a layer that is on cannot draw just now, in a few words: the tidal
   * depth out too far, the currents at an hour they do not reach.
   */
  notes?: Partial<Record<"foil" | "currents", string | null>>;
}

/**
 * The chart a first visit opens on (src/App.tsx): the particles, tidal
 * depth, the whole chart and the range ring.
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
  glyph?: ReactNode;
  on: boolean;
  press: () => void;
  /** The chart part it switches, for the specs and the stored choice. */
  layer?: keyof ChartLayers;
  /** Its key is in the map's information, behind an "i". */
  info?: { label: string; at: InfoSection };
  /** What it cannot draw just now, while it is on. */
  note?: string | null;
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
 * Every layer the chart can draw, in the groups and the order the layers'
 * rail (src/LayerRail.tsx) shows them: the wind, the sea, the weather, the
 * chart, the ground under it, and what is drawn round the chosen spot.
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
  notes = {},
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
    glyph,
    on: wind[key],
    press: () => onWind({ ...wind, [key]: !wind[key] }),
  });
  const part = (
    key: keyof ChartLayers,
    name: string,
    sub: string,
    glyph: ReactNode,
    info?: LayerTile["info"],
  ): LayerTile => ({
    id: key,
    name,
    sub,
    glyph,
    on: layers[key],
    press: () => onLayersChange({ ...layers, [key]: !layers[key] }),
    layer: key,
    note:
      layers[key] && (key === "foil" || key === "currents") ? notes[key] : null,
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
    glyph,
    on: satellite === option,
    press: () => onSatellite(satellite === option ? "off" : option),
  });
  const focus = (
    style: FocusStyle,
    name: string,
    sub: string,
    glyph?: ReactNode,
  ): LayerTile => ({
    id: `focus-${style}`,
    name,
    sub,
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
          <TidalDepthGlyph size={18} />,
          { label: "About tidal depth", at: "foil" },
        ),
        {
          ...part(
            "currents",
            "Currents",
            "Tidal streams",
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
          <TintsGlyph size={18} />,
        ),
        part(
          "soundings",
          "Contours",
          "And soundings",
          <SoundingsGlyph size={18} />,
        ),
        part("relief", "Land relief", "Hachures", <ReliefGlyph size={18} />),
        part(
          "names",
          "Spot names",
          "Beside the lights",
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
        focus("loupe", "Loupe", "Headings you hold", <LoupeGlyph size={18} />),
        focus(
          "ring",
          "Range ring",
          "A distance round it",
          <RingGlyph size={18} />,
        ),
        focus("off", "Nothing", "Just the light"),
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
  /** What it cannot draw just now, said beside its name. */
  note?: string | null;
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
          note: tile.note,
          press: tile.on && none ? none.press : tile.press,
        })),
    };
  });
}
