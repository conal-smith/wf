import type { ReactNode } from "react";
import { Minimize2 } from "lucide-react";
import { Button } from "../ui/Button";
import type { SatelliteOption } from "../force5/src/satellite";
import type { ChartLayers } from "../force5/src/WindMap";
import type { FocusStyle } from "../force5/src/focus";
import type { WindLayers } from "../force5/src/windLayer";
import { useFadeOut } from "../ui/Backdrop";
import { Dialog } from "../ui/Dialog";
import { LayersGlyph } from "./chartGlyphs";
import LayerRail from "./LayerRail";
import { layerGroups, type LayerChoices } from "./layerGroups";

/** A panel that opens over the dimmed map: the display options. */
export type MapPanel = "options" | null;

const PANEL_TITLE: Record<Exclude<MapPanel, null>, string> = {
  options: "Display options",
};

/**
 * Top right: zoom, and under it Layers, which opens the layers' rail beside
 * the zoom (src/LayerRail.tsx), a column of round switches with no panel
 * behind them, and shuts it again; it stays as it was left on this device.
 * Where the rail would run into the dock it scrolls in the room there is.
 *
 * The display options (units, the model, the blend's models) open from the
 * site menu, in a dialog over the dimmed map, as the map's information is.
 * They close on their X, on Escape or on a tap on the backdrop, and the focus
 * goes back to where it was when they opened.
 */
export default function MapControls({
  onZoomIn,
  onZoomOut,
  open,
  onOpen,
  options,
  wind,
  onWind,
  layers,
  onLayersChange,
  satellite,
  onSatellite,
  focusStyle,
  onFocusStyle,
  notes,
  rail,
  onLayers,
  layoutKey,
  onCollapse,
}: {
  /**
   * Back to the list, the chart beside it again: on a wide screen, where
   * the chart was opened out from beside the list. None on a phone.
   */
  onCollapse?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  open: MapPanel;
  onOpen: (panel: MapPanel) => void;
  /** What a layer that is on cannot draw just now (`layerGroups`). */
  notes?: LayerChoices["notes"];
  /** The rail is open. */
  rail: boolean;
  /** Layers pressed: the rail opens or shuts. */
  onLayers: () => void;
  /** Changes as the dock opens, grows or goes, for the rail to fit again. */
  layoutKey: string;
  /** The display options (src/DisplayFilter.tsx), given a way to close. */
  options: (close: () => void) => ReactNode;
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
}) {
  const close = () => onOpen(null);
  // The panel drawn: the open one, or the one fading out after it closed.
  const shown = useFadeOut(open);
  return (
    <div className="map-ctrl">
      <div className="zbox chart-box" role="group" aria-label="Map controls">
        {onCollapse && (
          <>
            <Button
              variant="quiet"
              size="sm"
              icon
              aria-label="Back to the list"
              title="Back to the list"
              onClick={onCollapse}
              data-collapse-chart
            >
              <Minimize2 size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
            <span className="zbox-rule" aria-hidden="true" />
          </>
        )}
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
          aria-expanded={rail}
          aria-controls="map-rail"
          onClick={onLayers}
        >
          <LayersGlyph size={18} />
        </button>
      </div>
      <LayerRail
        id="map-rail"
        shown={rail}
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
          notes,
        })}
      />
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
