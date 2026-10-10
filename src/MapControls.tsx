import { Info, Star } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { RideStop } from "../force5/src/chartStyle";
import { MODELS, type ModelId } from "../force5/src/models";
import type { Rider } from "../force5/src/stars";
import type { ChartLayers } from "../force5/src/WindMap";
import type { WindStyle } from "../force5/src/windLayer";
import { InfoButton } from "./InfoPop";
import { KnotScale } from "./KnotScale";
import type { InfoSection } from "./mapInfoContext";

const WIND_LABEL: Record<WindStyle, string> = {
  ink: "Ink",
  arrows: "Coloured arrows",
  wash: "Faint wash",
};
const CHART_LABEL: Record<keyof ChartLayers, string> = {
  tints: "Depth tints",
  soundings: "Contours, soundings",
  relief: "Land relief",
  names: "Spot names",
  foil: "Foilable depth at the tide (pilot)",
};

/** A panel that opens beside the controls: one at a time. */
export type MapPanel = "layers" | "spots" | null;

/**
 * Top right: zoom, the layers (the wind's style, the chart's
 * parts, and which model the map draws), and under them your spots and the
 * "i" that opens the map's information: its key, the stars, the foil layer
 * and the sources. The layers and your spots open beside the controls, one
 * at a time, and close on their button, on Escape or on a tap anywhere else.
 */
export default function MapControls({
  onZoomIn,
  onZoomOut,
  open,
  onOpen,
  spots,
  infoOpen,
  onInfo,
  windStyle,
  onWindStyle,
  layers,
  onLayersChange,
  rideStops,
  rider,
  model,
  modelDisabled,
  onModel,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  open: MapPanel;
  onOpen: (panel: MapPanel) => void;
  /** Your spots (src/SidePanel.tsx), drawn while their panel is open. */
  spots: () => ReactNode;
  infoOpen: boolean;
  onInfo: (at: InfoSection) => void;
  windStyle: WindStyle;
  onWindStyle: (style: WindStyle) => void;
  layers: ChartLayers;
  onLayersChange: (layers: ChartLayers) => void;
  rideStops: readonly RideStop[];
  rider: Rider;
  model: string | undefined;
  modelDisabled: boolean;
  onModel: (id: ModelId) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const layersButton = useRef<HTMLButtonElement>(null);
  const spotsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const button = open === "layers" ? layersButton : spotsButton;
    const down = (event: PointerEvent) => {
      const t = event.target as Node;
      // A dialog opened from the panel (an "i", the stars' "?") is over the
      // page, not away from the panel: a press in it leaves the panel be.
      if (t instanceof Element && t.closest("dialog[open]")) return;
      if (!panel.current?.contains(t) && !button.current?.contains(t))
        onOpen(null);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  const toggle = (which: Exclude<MapPanel, null>) =>
    onOpen(open === which ? null : which);
  return (
    <div className="map-ctrl">
      <div className="zbox chart-box" role="group" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>
          +
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>
          −
        </button>
        <button
          ref={layersButton}
          type="button"
          aria-label="Layers"
          title="Layers"
          aria-expanded={open === "layers"}
          aria-controls="map-layers"
          onClick={() => toggle("layers")}
        >
          <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
            <path d="M8 1L15 4.5L8 8L1 4.5Z" fill="none" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M1 8L8 11.5L15 8" fill="none" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          ref={spotsButton}
          type="button"
          aria-label="Your spots"
          title="Your spots"
          aria-expanded={open === "spots"}
          aria-controls="map-spots"
          onClick={() => toggle("spots")}
        >
          <Star size={16} strokeWidth={1.3} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Map information"
          title="Map information"
          aria-haspopup="dialog"
          aria-expanded={infoOpen}
          onClick={() => onInfo("key")}
        >
          <Info size={16} strokeWidth={1.3} aria-hidden="true" />
        </button>
      </div>
      {open === "spots" && <div ref={panel}>{spots()}</div>}
      {open === "layers" && (
        <div
          ref={panel}
          id="map-layers"
          className="layers chart-box"
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
              <span>{WIND_LABEL[style]}</span>
              <i className={`sw sw-${style}`} aria-hidden="true" />
            </label>
          ))}
          <KnotScale stops={rideStops} rider={rider} faint={windStyle === "wash"} />
          <h3>Chart</h3>
          {(Object.keys(CHART_LABEL) as (keyof ChartLayers)[]).map((key) => {
            const box = (
              <label key={key}>
                <input
                  type="checkbox"
                  data-layer={key}
                  checked={layers[key]}
                  onChange={(event) =>
                    onLayersChange({ ...layers, [key]: event.target.checked })
                  }
                />
                <span>{CHART_LABEL[key]}</span>
              </label>
            );
            // The foil layer's key is in the map's information, not on the
            // chart: its "i" opens it there, beside the switch.
            return key === "foil" ? (
              <div key={key} className="layer-info">
                {box}
                <InfoButton
                  label="About foilable depth"
                  onOpen={() => onInfo("foil")}
                />
              </div>
            ) : (
              box
            );
          })}
          <h3>Model on the map</h3>
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
    </div>
  );
}
