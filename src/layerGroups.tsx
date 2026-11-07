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
  LiveWindGlyph,
  LoupeGlyph,
  LowTideGlyph,
  ParticlesGlyph,
  RainGlyph,
  SatelliteGlyph,
  SoundingsGlyph,
  TidalDepthGlyph,
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
 * depth, the names and the range ring.
 */
export const LAYER_DEFAULTS: {
  wind: WindLayers;
  layers: ChartLayers;
  satellite: SatelliteOption;
  focusStyle: FocusStyle;
} = {
  wind: DEFAULT_WIND,
  layers: {
    // Off by default (the owner's ruling of 2026-11-03): a first visit's
    // eye went to the figures in the water, and the chart is lighter without.
    depths: false,
    names: true,
    foil: true,
    // Off by default: nothing of it is read until a rider asks for it.
    currents: false,
    // Off too, and nothing of it read until asked for.
    rain: false,
    // The measured wind at the weather stations and buoys. On the Spot
    // finder's plain map always (src/App.tsx); on the full chart off until
    // asked for, so the forecast's own wind is the chart's first word there.
    live: false,
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
  /** A word on what it is drawing, under its name: not a fault, so no dot. */
  hint?: string | null;
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
 * The layers a rider switches, in the groups and the order the layers' rail
 * (src/LayerRail.tsx) shows them: the wind, the sea, the weather, the ground
 * under the chart, and the loupe round the chosen spot. Few enough to stand
 * in a column on a phone (the owner's ruling of 2026-11-02): the names are
 * always drawn, the depths (their tints, contours, soundings and the land's
 * relief) are one switch under the Sea, off until asked for (the ruling of
 * 2026-11-03), the satellite is one button that goes from high tide to low
 * tide to none, and the loupe is on or off, the range ring standing in for it
 * when off. The rest, the wind's two layers among them, each switch their own
 * part.
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
  return [
    {
      id: "wind",
      name: "Wind",
      glyph: <ChartGlyph glyph={glyphs.wind} size={14} />,
      rule: "any",
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
        {
          ...part(
            "live",
            "Live wind",
            "Measured at stations",
            <LiveWindGlyph size={18} />,
            { label: "About live wind", at: "wind" },
          ),
          isNew: true,
        },
      ],
    },
    {
      id: "sea",
      name: "Sea",
      glyph: <ChartGlyph glyph={glyphs.waves} size={14} />,
      rule: "any",
      tiles: [
        {
          ...part(
            "foil",
            "Tidal depth",
            "Water at this tide",
            <TidalDepthGlyph size={18} />,
            { label: "About tidal depth", at: "foil" },
          ),
          note: null,
          hint: layers.foil ? notes.foil : null,
        },
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
        part(
          "depths",
          "Depths",
          "Contours and soundings",
          <SoundingsGlyph size={18} />,
          { label: "About the depths", at: "key" },
        ),
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
      id: "ground",
      name: "Ground",
      glyph: <SatelliteGlyph size={14} />,
      rule: "a picture under the chart",
      tiles: [
        {
          id: "satellite",
          name:
            satellite === "low"
              ? "Satellite, low tide"
              : "Satellite, high tide",
          sub: satellite === "low" ? "The sand bared" : "Sentinel-2",
          glyph:
            satellite === "low" ? (
              <LowTideGlyph size={18} />
            ) : (
              <HighTideGlyph size={18} />
            ),
          on: satellite !== "off",
          // Off, then high tide, then low, then off again: one button.
          press: () =>
            onSatellite(
              satellite === "off"
                ? "high"
                : satellite === "high"
                  ? "low"
                  : "off",
            ),
        },
      ],
    },
    {
      id: "focus",
      name: "Round your spot",
      glyph: <LoupeGlyph size={14} />,
      rule: "the loupe, or the range ring",
      tiles: [
        {
          id: "focus-loupe",
          name: "Loupe",
          sub: "Headings you hold",
          glyph: <LoupeGlyph size={18} />,
          on: focusStyle === "loupe",
          press: () => onFocusStyle(focusStyle === "loupe" ? "ring" : "loupe"),
        },
      ],
    },
  ];
}

/**
 * Coloured wind and the tidal depth exclude each other: each paints the sea,
 * and the one reads through neither. Turning either on turns the other off.
 * Turning one off leaves the other as it was.
 */
export function excludeWashFoil(
  wind: WindLayers,
  layers: ChartLayers,
  nextWind: WindLayers,
  nextLayers: ChartLayers,
): { wind: WindLayers; layers: ChartLayers } {
  if (nextWind.wash && !wind.wash && nextLayers.foil)
    return { wind: nextWind, layers: { ...nextLayers, foil: false } };
  if (nextLayers.foil && !layers.foil && nextWind.wash)
    return { wind: { ...nextWind, wash: false }, layers: nextLayers };
  return { wind: nextWind, layers: nextLayers };
}

/** One of the rail's buttons: a layer's glyph, its name, and its switch. */
export interface RailItem {
  id: string;
  name: string;
  glyph: ReactNode;
  on: boolean;
  /** What it cannot draw just now, said beside its name. */
  note?: string | null;
  /** A word on what it is drawing, under its name: not a fault, so no dot. */
  hint?: string | null;
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
          hint: tile.hint,
          press: tile.on && none ? none.press : tile.press,
        })),
    };
  });
}
