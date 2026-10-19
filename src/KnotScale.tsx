import { PALETTE, windColor } from "../force5/src/weather";

/** The bar runs from calm to this, in knots: the storm stops past it are rare. */
const TOP = 60;
const TICKS = [10, 20, 30, 40, 50];

/**
 * The wind scale the wash and the coloured arrows are drawn on: the same for
 * every rider, generated from PALETTE stop for stop, with its knots under it.
 */
export function KnotScale({ faint = false }: { faint?: boolean }) {
  const rgb = (kn: number) =>
    `rgb(${windColor(kn).join(" ")}${faint ? " / 0.55" : ""})`;
  const gradient = `linear-gradient(90deg, ${[
    ...PALETTE.map(([kn]) => kn).filter((kn) => kn < TOP),
    TOP,
  ]
    .map((kn) => `${rgb(kn)} ${((kn / TOP) * 100).toFixed(1)}%`)
    .join(", ")})`;
  return (
    <figure
      className="knot-scale"
      aria-label="Wind scale: blue under 10 kn, green 10 to 20, yellow by 30, red by 40, purple from 50"
    >
      <div className="ks-bar" style={{ background: gradient }} />
      <div className="ks-ticks" aria-hidden="true">
        {TICKS.map((kn) => (
          <span key={kn} style={{ left: `${(kn / TOP) * 100}%` }}>
            {kn}
          </span>
        ))}
        <i>kn</i>
      </div>
    </figure>
  );
}
