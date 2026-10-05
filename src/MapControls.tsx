import { useEffect, useRef } from "react";
import type { RideStop } from "../force5/src/chartStyle";
import { MODELS, type ModelId } from "../force5/src/models";
import type { Rider } from "../force5/src/stars";
import type { ChartLayers } from "../force5/src/WindMap";
import type { WindStyle } from "../force5/src/windLayer";
import { KnotScale } from "./KnotScale";

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
};

/**
 * Top right: zoom, all of Ireland, and the layers (the wind's style, the
 * chart's parts, and which model the map draws). On a phone, the key too.
 */
export default function MapControls({
  onZoomIn,
  onZoomOut,
  onIreland,
  layersOpen,
  onLayers,
  phone,
  keyOpen,
  onKey,
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
  onIreland: () => void;
  layersOpen: boolean;
  onLayers: (open: boolean) => void;
  phone: boolean;
  keyOpen: boolean;
  onKey: () => void;
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
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!layersOpen) return;
    const down = (event: PointerEvent) => {
      const t = event.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t))
        onLayers(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [layersOpen]);
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
          type="button"
          className="txt"
          aria-label="Show all of Ireland"
          title="All of Ireland"
          onClick={onIreland}
        >
          IRL
        </button>
        <button
          ref={button}
          type="button"
          aria-label="Layers"
          title="Layers"
          aria-expanded={layersOpen}
          aria-controls="map-layers"
          onClick={() => onLayers(!layersOpen)}
        >
          <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
            <path d="M8 1L15 4.5L8 8L1 4.5Z" fill="none" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M1 8L8 11.5L15 8" fill="none" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
        {phone && (
          <button
            type="button"
            className="txt"
            aria-label="Your spots and the key"
            aria-pressed={keyOpen}
            onClick={onKey}
          >
            KEY
          </button>
        )}
      </div>
      {layersOpen && (
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
          {(Object.keys(CHART_LABEL) as (keyof ChartLayers)[]).map((key) => (
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
          ))}
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
