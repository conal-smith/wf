import type { ReactNode } from "react";
import type { SatelliteOption } from "../force5/src/satellite";
import type { ChartLayers } from "../force5/src/WindMap";
import type { FocusStyle } from "../force5/src/focus";
import type { WindStyle } from "../force5/src/windLayer";
import {
  ArrowsWindGlyph,
  ChartGlyph,
  glyphs,
  ColouredWindGlyph,
  CurrentsGlyph,
  HighTideGlyph,
  InkWindGlyph,
  LoupeGlyph,
  LowTideGlyph,
  NamesGlyph,
  ReliefGlyph,
  RingGlyph,
  SatelliteGlyph,
  SoundingsGlyph,
  SurveyGlyph,
  TidalDepthGlyph,
  TintsGlyph,
} from "./chartGlyphs";
// A type alone: the pictures stay in the Layers panel's own chunk.
import type { CuttingId } from "./layerCuttings";
import type { InfoSection } from "./mapInfoContext";

/** What the chart draws, and the way to change each part of it. */
export interface LayerChoices {
  windStyle: WindStyle;
  onWindStyle: (style: WindStyle) => void;
  layers: ChartLayers;
  onLayersChange: (layers: ChartLayers) => void;
  /** The satellite image under the chart: off, or which tide's. */
  satellite: SatelliteOption;
  onSatellite: (option: SatelliteOption) => void;
  /** What is drawn round the chosen spot: a loupe, a range ring, or nothing. */
  focusStyle: FocusStyle;
  onFocusStyle: (style: FocusStyle) => void;
}

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
  id: "wind" | "sea" | "chart" | "ground" | "focus";
  name: string;
  /** The group's glyph, before its name. */
  glyph: ReactNode;
  /** How its tiles combine, in a word or two at the rule's end. */
  rule: string;
  tiles: LayerTile[];
}

/**
 * Every layer the chart can draw, in the groups and the order the Layers
 * panel (src/LayersPanel.tsx) shows them: the wind, the sea, the chart, the
 * ground under it, and what is drawn round the chosen spot. In the wind and
 * round the spot one is always on, as a radio's choice is; a satellite tide
 * pressed again is no image; the rest each switch their own part.
 */
export function layerGroups({
  windStyle,
  onWindStyle,
  layers,
  onLayersChange,
  satellite,
  onSatellite,
  focusStyle,
  onFocusStyle,
}: LayerChoices): LayerGroup[] {
  const wind = (
    style: WindStyle,
    name: string,
    sub: string,
    glyph: ReactNode,
  ): LayerTile => ({
    id: `wind-${style}`,
    name,
    sub,
    cut: style,
    glyph,
    on: windStyle === style,
    press: () => onWindStyle(style),
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
      rule: "one at a time",
      tiles: [
        wind("ink", "Ink", "Streaks, the default", <InkWindGlyph size={18} />),
        wind(
          "wash",
          "Coloured wind",
          "Speed as colour",
          <ColouredWindGlyph size={18} />,
        ),
        wind(
          "arrows",
          "Coloured arrows",
          "Speed and way",
          <ArrowsWindGlyph size={18} />,
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
        {
          ...part(
            "lidar",
            "LiDAR",
            "The foreshore's shape",
            "lidar",
            <SurveyGlyph size={18} />,
            { label: "About the LiDAR data", at: "lidar" },
          ),
          isNew: true,
        },
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
