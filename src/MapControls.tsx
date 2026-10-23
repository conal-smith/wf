import { lazy, Suspense, type ReactNode } from "react";
import type { ModelId } from "../force5/src/models";
import type { SatelliteOption } from "../force5/src/satellite";
import type { SiteMenuTool } from "../force5/src/SiteMenu";
import type { ChartLayers } from "../force5/src/WindMap";
import type { FocusStyle } from "../force5/src/focus";
import type { WindStyle } from "../force5/src/windLayer";
import { useFadeOut } from "../ui/Backdrop";
import { Dialog } from "../ui/Dialog";
import {
  AboutGlyph,
  LayersGlyph,
  OptionsGlyph,
  SpotsGlyph,
} from "./chartGlyphs";
import type { InfoSection } from "./mapInfoContext";

/**
 * The layers' tiles, their pictures and their stylesheet: loaded the first
 * time Layers is opened, and not before (src/LayersPanel.tsx).
 */
const LayersPanel = lazy(() => import("./LayersPanel"));

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
  modelNote = null,
  modelDisabled,
  onModel,
  currentsNote = null,
  foilNote = null,
  onResetLayers,
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
      </div>
      {shown === "layers" && (
        // Nothing until its chunk is in: then the dialog opens whole, its
        // tiles and their stylesheet with it.
        <Suspense fallback={null}>
          <LayersPanel
            open={open === "layers"}
            onClose={close}
            onInfo={onInfo}
            windStyle={windStyle}
            onWindStyle={onWindStyle}
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
      {(shown === "spots" || shown === "options") && (
        <Dialog
          open={open !== null}
          title={PANEL_TITLE[shown]}
          className="map-panel-dialog"
          onClose={close}
        >
          {shown === "spots" && spots()}
          {shown === "options" && options(close)}
        </Dialog>
      )}
    </div>
  );
}
