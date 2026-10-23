import type { ReactNode } from "react";
import { MODELS, type ModelId } from "../force5/src/models";
import {
  SATELLITE_LABEL,
  SATELLITE_OPTIONS,
  SATELLITE_TIDES_NOTE,
  satelliteTidesLine,
  type SatelliteOption,
} from "../force5/src/satellite";
import type { SiteMenuTool } from "../force5/src/SiteMenu";
import type { ChartLayers } from "../force5/src/WindMap";
import { FOCUS_STYLES, type FocusStyle } from "../force5/src/focus";
import type { WindStyle } from "../force5/src/windLayer";
import { Dialog } from "../ui/Dialog";
import { Segmented } from "../ui/Segmented";
import {
  AboutGlyph,
  ArrowsWindGlyph,
  ColouredWindGlyph,
  CurrentsGlyph,
  HighTideGlyph,
  InkWindGlyph,
  LayersGlyph,
  LoupeGlyph,
  LowTideGlyph,
  NamesGlyph,
  OptionsGlyph,
  ReliefGlyph,
  RingGlyph,
  SatelliteGlyph,
  SoundingsGlyph,
  SpotsGlyph,
  TidalDepthGlyph,
  TintsGlyph,
} from "./chartGlyphs";
import { InfoButton } from "./InfoPop";
import { KnotScale } from "./KnotScale";
import type { InfoSection } from "./mapInfoContext";

const WIND_LABEL: Record<WindStyle, string> = {
  ink: "Ink",
  arrows: "Coloured arrows",
  wash: "Coloured wind",
};
const WIND_GLYPH: Record<WindStyle, ReactNode> = {
  ink: <InkWindGlyph />,
  arrows: <ArrowsWindGlyph />,
  wash: <ColouredWindGlyph />,
};
const CHART_LABEL: Record<keyof ChartLayers, string> = {
  tints: "Depth tints",
  soundings: "Contours, soundings",
  relief: "Land relief",
  names: "Spot names",
  foil: "Tidal depth",
  currents: "Currents, a rough guide",
};
/** Each part's glyph, drawn as the chart draws the part; a row without one still reads. */
const CHART_GLYPH: Partial<Record<keyof ChartLayers, ReactNode>> = {
  tints: <TintsGlyph />,
  soundings: <SoundingsGlyph />,
  relief: <ReliefGlyph />,
  names: <NamesGlyph />,
  foil: <TidalDepthGlyph />,
  currents: <CurrentsGlyph />,
};
const SATELLITE_GLYPH: Partial<Record<SatelliteOption, ReactNode>> = {
  high: <HighTideGlyph size={16} />,
  low: <LowTideGlyph size={16} />,
};
const FOCUS_LABEL: Record<FocusStyle, string> = {
  loupe: "Loupe",
  ring: "Range ring",
  off: "Off",
};
const FOCUS_GLYPH: Partial<Record<FocusStyle, ReactNode>> = {
  loupe: <LoupeGlyph size={16} />,
  ring: <RingGlyph size={16} />,
};

/** A panel that opens over the dimmed map: one at a time. */
export type MapPanel = "layers" | "spots" | "options" | null;

const PANEL_TITLE: Record<Exclude<MapPanel, null>, string> = {
  layers: "Layers",
  spots: "Your spots",
  options: "Display options",
};

/**
 * The chart's own rows in the site menu (force5/src/SiteMenu.tsx), the one
 * way in to them: the layers, your spots, the display options, and what the
 * map means. Each row is named as the dialog it opens is titled.
 */
export function chartTools(
  onOpen: (panel: Exclude<MapPanel, null>) => void,
  onInfo: (at: InfoSection) => void,
): SiteMenuTool[] {
  const panel = (id: Exclude<MapPanel, null>, glyph: ReactNode) => ({
    id,
    label: PANEL_TITLE[id],
    glyph,
    onSelect: () => onOpen(id),
  });
  return [
    panel("layers", <LayersGlyph />),
    panel("spots", <SpotsGlyph />),
    panel("options", <OptionsGlyph />),
    {
      id: "about",
      label: "About the map",
      glyph: <AboutGlyph />,
      onSelect: () => onInfo("key"),
    },
  ];
}

/**
 * Top right: zoom, and nothing else, for the chart is moved there. The
 * layers (the wind's style, the chart's parts, the satellite image under it,
 * what is drawn round the chosen spot, and which model the map draws), your
 * spots and the display options (units, the rider, the blend's models) are
 * opened from the site menu (`chartTools`), one at a time in a dialog over
 * the dimmed map, as the map's information is: four buttons here, beside a
 * menu that held more, were too many ways in. They close on their X, on
 * Escape or on a tap on the backdrop, and the focus goes back to where it was
 * when they opened: the menu's trigger, or the dock's button.
 */
export default function MapControls({
  onZoomIn,
  onZoomOut,
  open,
  onOpen,
  spots,
  options,
  onInfo,
  windStyle,
  onWindStyle,
  layers,
  onLayersChange,
  satellite,
  onSatellite,
  satelliteTides,
  satelliteLoading = false,
  focusStyle,
  onFocusStyle,
  model,
  modelNote,
  modelDisabled,
  onModel,
  currentsNote = null,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  open: MapPanel;
  onOpen: (panel: MapPanel) => void;
  /** Your spots (src/SidePanel.tsx), drawn while their panel is open. */
  spots: () => ReactNode;
  /** The display options (src/DisplayFilter.tsx), given a way to close. */
  options: (close: () => void) => ReactNode;
  /** The map's information, at the tidal depth's part from its "i". */
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
  /** The chosen image's tiles are still coming in: it shows whole, once they are. */
  satelliteLoading?: boolean;
  /** What is drawn round the chosen spot: a loupe, a range ring, or nothing. */
  focusStyle: FocusStyle;
  onFocusStyle: (style: FocusStyle) => void;
  model: string | undefined;
  /**
   * Why the map draws no wind at the hour shown: its model's run does not
   * reach it. Null when it does.
   */
  modelNote?: string | null;
  modelDisabled: boolean;
  onModel: (id: ModelId) => void;
  /** What the Currents layer cannot draw at the hour shown, while it is on. */
  currentsNote?: string | null;
}) {
  const close = () => onOpen(null);
  return (
    <div className="map-ctrl">
      <div className="zbox chart-box" role="group" aria-label="Map controls">
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={onZoomIn}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={onZoomOut}
        >
          −
        </button>
      </div>
      {open && (
        <Dialog
          open
          title={PANEL_TITLE[open]}
          className="map-panel-dialog"
          onClose={close}
        >
          {open === "spots" && spots()}
          {open === "options" && options(close)}
          {open === "layers" && (
            <div
              id="map-layers"
              className="layers"
              role="group"
              aria-label="Layers"
            >
              <h3>Wind</h3>
              {(Object.keys(WIND_LABEL) as WindStyle[]).map((style) => (
                <label key={style}>
                  <input
                    type="radio"
                    name="wind-style"
                    value={style}
                    checked={windStyle === style}
                    onChange={() => onWindStyle(style)}
                  />
                  {WIND_GLYPH[style]}
                  <span>{WIND_LABEL[style]}</span>
                </label>
              ))}
              <KnotScale />
              <h3>Chart</h3>
              {(Object.keys(CHART_LABEL) as (keyof ChartLayers)[]).map(
                (key) => {
                  const box = (
                    <label key={key}>
                      <input
                        type="checkbox"
                        data-layer={key}
                        checked={layers[key]}
                        onChange={(event) =>
                          onLayersChange({
                            ...layers,
                            [key]: event.target.checked,
                          })
                        }
                      />
                      {CHART_GLYPH[key]}
                      <span>{CHART_LABEL[key]}</span>
                    </label>
                  );
                  // The tidal depth's and the currents' keys are in the map's
                  // information, not on the chart: their "i" opens it there,
                  // beside the switch.
                  if (key !== "foil" && key !== "currents") return box;
                  return (
                    <div key={key} className="layer-info">
                      {box}
                      <InfoButton
                        label={
                          key === "foil" ? "About tidal depth" : "About currents"
                        }
                        onOpen={() => onInfo(key)}
                      />
                      {key === "currents" && layers.currents && (
                        <small data-currents-note>
                          {currentsNote ?? "Not for safety."}
                        </small>
                      )}
                    </div>
                  );
                },
              )}
              <h3>
                <SatelliteGlyph size={16} />
                Satellite at tide
              </h3>
              <div className="layer-sat">
                <Segmented
                  aria-label="Satellite at tide"
                  options={SATELLITE_OPTIONS.map((option) => ({
                    value: option,
                    label: (
                      <>
                        {SATELLITE_GLYPH[option]}
                        {SATELLITE_LABEL[option]}
                      </>
                    ),
                  }))}
                  value={satellite}
                  onChange={onSatellite}
                />
                {satellite !== "off" && satelliteLoading && (
                  <small role="status" data-satellite-loading>
                    Loading the {SATELLITE_LABEL[satellite].toLowerCase()}{" "}
                    image…
                  </small>
                )}
                {satellite !== "off" && satelliteTides && (
                  <>
                    <small data-satellite-tides>
                      {satelliteTidesLine(satelliteTides)}
                    </small>
                    <small>{SATELLITE_TIDES_NOTE}</small>
                  </>
                )}
              </div>
              <h3>Round the chosen spot</h3>
              <Segmented
                aria-label="Round the chosen spot"
                options={FOCUS_STYLES.map((style) => ({
                  value: style,
                  label: (
                    <>
                      {FOCUS_GLYPH[style]}
                      {FOCUS_LABEL[style]}
                    </>
                  ),
                }))}
                value={focusStyle}
                onChange={onFocusStyle}
              />
              <h3>Model on the map</h3>
              {modelNote && <p className="models-note">{modelNote}</p>}
              <div className="models" role="group" aria-label="Weather model">
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
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
