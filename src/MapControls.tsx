import { lazy, Suspense, type ReactNode } from "react";
import type { ModelId } from "../force5/src/models";
import type { SatelliteOption } from "../force5/src/satellite";
import type { SiteMenuTool } from "../force5/src/SiteMenu";
import type { ChartLayers } from "../force5/src/WindMap";
import type { FocusStyle } from "../force5/src/focus";
import type { WindLayers } from "../force5/src/windLayer";
import { useFadeOut } from "../ui/Backdrop";
import { Dialog } from "../ui/Dialog";
import { AboutGlyph, LayersGlyph, OptionsGlyph } from "./chartGlyphs";
import LayerRail from "./LayerRail";
import { layerGroups } from "./layerGroups";
import type { InfoSection } from "./mapInfoContext";

/**
 * The layers' tiles, their pictures and their stylesheet: loaded the first
 * time Layers is opened, and not before (src/LayersPanel.tsx).
 */
const LayersPanel = lazy(() => import("./LayersPanel"));

/** A panel that opens over the dimmed map: one at a time. */
export type MapPanel = "layers" | "options" | null;

const PANEL_TITLE: Record<Exclude<MapPanel, null>, string> = {
  layers: "Layers",
  options: "Display options",
};

/**
 * The chart's own rows in the site menu (force5/src/SiteMenu.tsx), under
 * "This chart" below the site's navigation, the one way in to them: the
 * layers, the display options, and what the map means. Each row is named as
 * the dialog it opens is titled. (The spot finder and Customise are the
 * navigation's, the same on every page: force5/src/siteNav.ts.)
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
 * Top right: zoom, and under it Layers. On a desktop, Layers opens the
 * layers' rail beside the zoom (src/LayerRail.tsx), a column of round
 * switches with no panel behind them, and shuts it again; it stays as it was
 * left on this device. On a phone, or where the rail would run into the dock,
 * it opens the Layers panel, as the site menu's row does.
 *
 * The panel (the wind's style, the chart's parts, the satellite image under
 * it, what is drawn round the chosen spot, and which model the map draws)
 * and the display options (units, the model, the blend's models) open from
 * the site menu (`chartTools`), one at a time in a dialog over the
 * dimmed map, as the map's information is. They close on their X, on Escape
 * or on a tap on the backdrop, and the focus goes back to where it was when
 * they opened: the menu's trigger, Layers, or the dock's button.
 */
export default function MapControls({
  onZoomIn,
  onZoomOut,
  open,
  onOpen,
  options,
  onInfo,
  wind,
  onWind,
  layers,
  onLayersChange,
  satellite,
  onSatellite,
  satelliteTides,
  satelliteLoading = false,
  focusStyle,
  onFocusStyle,
  model,
  modelNote = null,
  modelDisabled,
  onModel,
  currentsNote = null,
  foilNote = null,
  onResetLayers,
  desktop,
  rail,
  onLayers,
  onRailFits,
  layoutKey,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  open: MapPanel;
  onOpen: (panel: MapPanel) => void;
  /** A fine pointer and the width for the layers' rail. */
  desktop: boolean;
  /** The rail is open, and there is room for it. */
  rail: boolean;
  /** Layers pressed: the rail, or the panel where there is none. */
  onLayers: () => void;
  /** Whether the rail would fit above the dock, as that changes. */
  onRailFits: (fits: boolean) => void;
  /** Changes as the dock opens, grows or goes, for the rail to fit again. */
  layoutKey: string;
  /** The display options (src/DisplayFilter.tsx), given a way to close. */
  options: (close: () => void) => ReactNode;
  /** The map's information, at the tidal depth's part from its "i". */
  onInfo: (at: InfoSection) => void;
  /** The wind's two layers, the coloured wind and the particles, each on or off. */
  wind: WindLayers;
  onWind: (wind: WindLayers) => void;
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
  /** Why the tidal depth is not drawn, while it is on: the chart is out too far. */
  foilNote?: string | null;
  /** The layers' Reset: the wind, the chart's parts and the focus as at first. */
  onResetLayers: () => void;
}) {
  const close = () => onOpen(null);
  // The panel drawn: the open one, or the one fading out after it closed.
  const shown = useFadeOut(open);
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
        {/* The chart is moved above the rule, and drawn below it. */}
        <span className="zbox-rule" aria-hidden="true" />
        <button
          type="button"
          aria-label="Layers"
          title="Layers"
          aria-expanded={rail || open === "layers"}
          aria-controls={desktop ? "map-rail" : undefined}
          onClick={onLayers}
        >
          <LayersGlyph size={18} />
        </button>
      </div>
      {desktop && (
        <LayerRail
          id="map-rail"
          shown={rail}
          onFits={onRailFits}
          layoutKey={layoutKey}
          groups={layerGroups({
            wind,
            onWind,
            layers,
            onLayersChange,
            satellite,
            onSatellite,
            focusStyle,
            onFocusStyle,
          })}
        />
      )}
      {shown === "layers" && (
        // Nothing until its chunk is in: then the dialog opens whole, its
        // tiles and their stylesheet with it.
        <Suspense fallback={null}>
          <LayersPanel
            open={open === "layers"}
            onClose={close}
            onInfo={onInfo}
            wind={wind}
            onWind={onWind}
            layers={layers}
            onLayersChange={onLayersChange}
            satellite={satellite}
            onSatellite={onSatellite}
            satelliteTides={satelliteTides}
            satelliteLoading={satelliteLoading}
            focusStyle={focusStyle}
            onFocusStyle={onFocusStyle}
            model={model}
            modelNote={modelNote}
            modelDisabled={modelDisabled}
            onModel={onModel}
            currentsNote={currentsNote}
            foilNote={foilNote}
            onReset={onResetLayers}
          />
        </Suspense>
      )}
      {shown === "options" && (
        <Dialog
          open={open !== null}
          title={PANEL_TITLE[shown]}
          className="map-panel-dialog"
          onClose={close}
        >
          {options(close)}
        </Dialog>
      )}
    </div>
  );
}
