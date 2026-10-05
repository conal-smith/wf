import type { RideStop } from "../force5/src/chartStyle";
import { windBand, type Rider } from "../force5/src/stars";

/**
 * The wind scale the wash and the coloured arrows are drawn on, for this
 * rider: a bar with the knots where it turns green, where the sweet spot
 * starts and ends, and where it becomes too much.
 */
export function KnotScale({
  stops,
  rider,
  faint = false,
}: {
  stops: readonly RideStop[];
  rider: Rider;
  faint?: boolean;
}) {
  if (!stops.length) return null;
  const top = 40;
  const b = windBand(rider);
  const ticks = [b.min, b.sweetLow, b.sweetHigh, b.max].map(Math.round);
  const gradient = `linear-gradient(90deg, ${stops
    .filter((s) => s.kn <= top)
    .map(
      (s) =>
        `rgb(${s.rgb.join(" ")}${faint ? " / 0.55" : ""}) ${((s.kn / top) * 100).toFixed(1)}%`,
    )
    .join(", ")}, rgb(${stops[stops.length - 1].rgb.join(" ")}${faint ? " / 0.55" : ""}) 100%)`;
  return (
    <figure className="knot-scale" aria-label={`Wind scale: green from ${ticks[0]} kn, best ${ticks[1]}–${ticks[2]} kn, too much from ${ticks[3]} kn`}>
      <div className="ks-bar" style={{ background: gradient }} />
      <div className="ks-ticks" aria-hidden="true">
        {ticks.map((kn, i) => (
          <span key={i} style={{ left: `${(kn / top) * 100}%` }}>
            {kn}
          </span>
        ))}
        <i>kn</i>
      </div>
    </figure>
  );
}
