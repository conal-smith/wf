import { FOIL_CLEARANCE_METRES } from "../force5/src/foilDepth";

/**
 * The tidal depth's scale, under the layer's name in the rail: the map's own
 * colours from a dry bottom to six metres of water, with the depth a foil
 * needs marked. The full key is in the map's information (src/FoilLegend.tsx).
 */
export function DepthScale() {
  const need = (FOIL_CLEARANCE_METRES / 6) * 100;
  return (
    <figure
      className="depth-scale"
      aria-label={`Tidal depth scale: too shallow under ${FOIL_CLEARANCE_METRES} metres, deep enough from there, six metres and over the deepest`}
    >
      <div
        className="ds-bar"
        style={{
          background: `linear-gradient(to right, var(--map-foil-edge) 0%, var(--map-foil-shallow) ${need - 0.3}%, var(--map-foil-enough) ${need}%, var(--map-foil-deep) 50%, var(--map-foil-deeper) 100%)`,
        }}
      />
      <div className="ks-ticks" aria-hidden="true">
        <span style={{ left: `${need}%` }}>{FOIL_CLEARANCE_METRES}</span>
        <span style={{ left: "50%" }}>3</span>
        <i>6 m</i>
      </div>
    </figure>
  );
}
