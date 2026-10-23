import { useId, type ReactNode } from "react";
import { MODELS, type ModelId } from "../force5/src/models";
import {
  SATELLITE_LABEL,
  SATELLITE_TIDES_NOTE,
  satelliteTidesLine,
  type SatelliteOption,
} from "../force5/src/satellite";
import type { ChartLayers } from "../force5/src/WindMap";
import type { FocusStyle } from "../force5/src/focus";
import type { WindStyle } from "../force5/src/windLayer";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
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
import { InfoButton } from "./InfoPop";
import { KnotScale } from "./KnotScale";
import { Cutting, CuttingDefs, type CuttingId } from "./layerCuttings";
import type { InfoSection } from "./mapInfoContext";
import "./layers.css";

export interface LayersPanelProps {
  /** False while it fades out after closing (ui/Backdrop.tsx `useFadeOut`). */
  open: boolean;
  onClose: () => void;
  /** The map's information, at a layer's own part from its "i". */
  onInfo: (at: InfoSection) => void;
  windStyle: WindStyle;
  onWindStyle: (style: WindStyle) => void;
  layers: ChartLayers;
  onLayersChange: (layers: ChartLayers) => void;
  /** The satellite image under the chart: off, or which tide's. */
  satellite: SatelliteOption;
  onSatellite: (option: SatelliteOption) => void;
  /** The images' tides at the station nearest the map's centre, once known. */
  satelliteTides: { name: string; high: number; low: number } | null;
  /** The chosen image's tiles are still coming in. */
  satelliteLoading: boolean;
  /** What is drawn round the chosen spot: a loupe, a range ring, or nothing. */
  focusStyle: FocusStyle;
  onFocusStyle: (style: FocusStyle) => void;
  model: string | undefined;
  /** Why the map draws no wind at the hour shown, or null when it does. */
  modelNote: string | null;
  modelDisabled: boolean;
  onModel: (id: ModelId) => void;
  /** What the Currents layer cannot draw at the hour shown, while it is on. */
  currentsNote: string | null;
  /** Why the tidal depth is not drawn, while it is on: the chart is out too far. */
  foilNote: string | null;
  /** Back to the defaults: ink wind, the chart and tidal depth, the range ring. */
  onReset: () => void;
}

/** One tile: a picture of the layer, its glyph and name, and a switch. */
interface Tile {
  id: string;
  name: string;
  /** A few words under the name, read after it as its description. */
  sub: string;
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
}

interface Group {
  name: string;
  /** The group's glyph, before its name. */
  glyph: ReactNode;
  /** How its tiles combine, in a word or two at the rule's end. */
  rule: string;
  tiles: Tile[];
  /** Under the tiles: a scale, or what a layer that is on cannot draw. */
  foot?: ReactNode;
}

function TileButton({
  tile,
  onInfo,
}: {
  tile: Tile;
  onInfo: (at: InfoSection) => void;
}) {
  const subId = useId();
  return (
    <div className="lp-tile">
      {/* A toggle: "worded", for the tile says it is on itself (the second
          rule round its picture, ON, the name in bold) and keeps no fill. */}
      <Button
        className="lp-press"
        pressed={tile.on ? "worded" : false}
        aria-describedby={subId}
        data-layer={tile.layer}
        onClick={tile.press}
      >
        <span className="lp-cut">
          <Cutting id={tile.cut} />
          {tile.glyph && <span className="lp-badge">{tile.glyph}</span>}
          <span className="lp-on" aria-hidden="true">
            On
          </span>
        </span>
        <span className="lp-name">
          {tile.name}
          {tile.isNew && (
            <span className="lp-new" aria-hidden="true">
              New
            </span>
          )}
        </span>
        <small id={subId} className="lp-sub" aria-hidden="true">
          {tile.sub}
        </small>
      </Button>
      {tile.info && (
        <InfoButton
          label={tile.info.label}
          onOpen={() => onInfo(tile.info!.at)}
        />
      )}
    </div>
  );
}

function TileGroup({
  group,
  onInfo,
}: {
  group: Group;
  onInfo: (at: InfoSection) => void;
}) {
  const headId = useId();
  return (
    <section className="lp-group">
      <header className="lp-head">
        <h3 id={headId}>
          {group.glyph}
          {group.name}
        </h3>
        <span className="lp-rule">{group.rule}</span>
      </header>
      <div className="lp-tiles" role="group" aria-labelledby={headId}>
        {group.tiles.map((tile) => (
          <TileButton key={tile.id} tile={tile} onInfo={onInfo} />
        ))}
      </div>
      {group.foot}
    </section>
  );
}

/**
 * The Layers panel: every layer the chart can draw, as a tile with a picture
 * of it (src/layerCuttings.tsx), under ruled headings: the wind, the sea, the
 * chart, the ground under it, and what is drawn round the chosen spot; then
 * which model draws the wind. Each tile is a toggle button. In the wind and
 * round the spot one is always on, as a radio's choice is. A satellite tide
 * pressed again is no image. The rest each switch their own part.
 *
 * Opened from the site menu (src/MapControls.tsx), and only then loaded: this
 * file, its pictures and its stylesheet are a chunk of their own. On a phone
 * the dialog is a sheet that slides up from the foot, three tiles across.
 */
export default function LayersPanel({
  open,
  onClose,
  onInfo,
  windStyle,
  onWindStyle,
  layers,
  onLayersChange,
  satellite,
  onSatellite,
  satelliteTides,
  satelliteLoading,
  focusStyle,
  onFocusStyle,
  model,
  modelNote,
  modelDisabled,
  onModel,
  currentsNote,
  foilNote,
  onReset,
}: LayersPanelProps) {
  const wind = (
    style: WindStyle,
    name: string,
    sub: string,
    glyph: ReactNode,
  ): Tile => ({
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
    info?: Tile["info"],
  ): Tile => ({
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
  ): Tile => ({
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
  ): Tile => ({
    id: `focus-${style}`,
    name,
    sub,
    cut,
    glyph,
    on: focusStyle === style,
    press: () => onFocusStyle(style),
  });

  const groups: Group[] = [
    {
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
      // What the colours mean, while the wind is drawn in them.
      foot: windStyle !== "ink" && <KnotScale />,
    },
    {
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
      foot: ((layers.foil && foilNote) || layers.currents) && (
        <>
          {layers.foil && foilNote && (
            <p className="lp-note">
              <b>Tidal depth:</b> <span data-foil-note>{foilNote}</span>
            </p>
          )}
          {layers.currents && (
            <p className="lp-note">
              <b>Currents:</b>{" "}
              <span data-currents-note>
                {currentsNote ?? "Not for safety."}
              </span>
            </p>
          )}
        </>
      ),
    },
    {
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
      foot: satellite !== "off" && (satelliteLoading || satelliteTides) && (
        <div className="lp-note">
          {satelliteLoading && (
            <small role="status" data-satellite-loading>
              Loading the {SATELLITE_LABEL[satellite].toLowerCase()} image…
            </small>
          )}
          {satelliteTides && (
            <>
              <small data-satellite-tides>
                {satelliteTidesLine(satelliteTides)}
              </small>
              <small>{SATELLITE_TIDES_NOTE}</small>
            </>
          )}
        </div>
      ),
    },
    {
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

  return (
    <Dialog
      open={open}
      title="Layers"
      className="map-panel-dialog layers-dialog"
      onClose={onClose}
      actions={
        <>
          <span className="lp-default">
            Ink wind, the chart, tidal depth, the range ring: the default.
          </span>
          <Button variant="quiet" size="sm" onClick={onReset}>
            Reset
          </Button>
        </>
      }
    >
      <div id="map-layers" className="lp" role="group" aria-label="Layers">
        <CuttingDefs />
        {groups.map((group) => (
          <TileGroup key={group.name} group={group} onInfo={onInfo} />
        ))}
        <section className="lp-group">
          <header className="lp-head">
            <h3>Model, for the map and the stars</h3>
            <span className="lp-rule">ECMWF past its run</span>
          </header>
          {modelNote && <p className="models-note">{modelNote}</p>}
          <div className="lp-models" role="group" aria-label="Weather model">
            {MODELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-model={entry.id}
                aria-label={`Use ${entry.name} model`}
                aria-pressed={model === entry.id}
                disabled={modelDisabled}
                onClick={() => onModel(entry.id)}
              >
                <span>{entry.name}</span>
                <small>{entry.detail}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
