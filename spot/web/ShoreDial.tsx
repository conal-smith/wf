/**
 * The shore as a compass: the sea on the side the beach faces, the land behind
 * it, the arcs of wind the stars like best (cross and cross-on) around the
 * rim, and the wind blowing now. The words beside it say the same thing; the
 * dial is the glance.
 */
import { tv } from "../../ui/tv";
import { compass, goodWindArcs, type WindArc } from "./spot";

const styles = tv({
  slots: {
    svg: "block size-28 shrink-0 overflow-visible max-wide:size-22",
    land: "fill-basemap-land",
    sea: "fill-basemap-water",
    rim: "fill-none stroke-line-strong/50",
    shoreline: "stroke-ink-2",
    arc: "fill-none stroke-ok",
    tick: "fill-ink-muted text-caption font-semibold",
    arrow: "fill-ink stroke-card",
    unknown: "fill-ink-muted text-lead",
  },
});

const R = 44;
const C = 56;
const RIM = 50;

/** A point on the dial for a compass bearing (0 = up, clockwise). */
const at = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)] as const;
};

/** An arc along the rim from one bearing clockwise to another, inclusive. */
function arcPath(arc: WindArc, r: number): string {
  // Each compass point stands for 22.5°: the arc covers half a point either side.
  const from = arc.fromDeg - 11.25;
  let to = arc.toDeg + 11.25;
  if (to <= from) to += 360;
  const [x1, y1] = at(from, r);
  const [x2, y2] = at(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function ShoreDial({
  facing,
  windFrom,
}: {
  facing: number | null;
  /** The wind now, for its arrow; null hides it. */
  windFrom: number | null;
}) {
  const s = styles();
  const arcs = facing === null ? [] : goodWindArcs(facing);
  // The sea half: a half-disc centred on the bearing the shore looks out along.
  const seaPath =
    facing === null
      ? null
      : (() => {
          const [x1, y1] = at(facing - 90, R);
          const [x2, y2] = at(facing + 90, R);
          return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2} Z`;
        })();
  const shore =
    facing === null ? null : [at(facing - 90, R), at(facing + 90, R)];
  const label =
    facing === null
      ? "Shore direction not known"
      : `Shore faces ${compass(facing)}; the green arcs are the winds it likes best${
          windFrom === null ? "" : `; wind now from ${compass(windFrom)}`
        }`;
  return (
    <svg
      className={s.svg()}
      viewBox="0 0 112 112"
      role="img"
      aria-label={label}
    >
      <circle className={s.land()} cx={C} cy={C} r={R} />
      {seaPath && <path className={s.sea()} d={seaPath} />}
      <circle className={s.rim()} cx={C} cy={C} r={R} strokeWidth={1} />
      {shore && (
        <line
          className={s.shoreline()}
          x1={shore[0][0]}
          y1={shore[0][1]}
          x2={shore[1][0]}
          y2={shore[1][1]}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
      {arcs.map((arc) => (
        <path
          key={`${arc.from}-${arc.to}`}
          className={s.arc()}
          d={arcPath(arc, RIM)}
          strokeWidth={5}
          strokeLinecap="round"
        />
      ))}
      {(["N", "E", "S", "W"] as const).map((point, i) => {
        const [x, y] = at(i * 90, 30);
        return (
          <text
            key={point}
            className={s.tick()}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            aria-hidden="true"
          >
            {point}
          </text>
        );
      })}
      {facing === null && (
        <text
          className={s.unknown()}
          x={C}
          y={C}
          textAnchor="middle"
          dominantBaseline="central"
          aria-hidden="true"
        >
          ?
        </text>
      )}
      {windFrom !== null && (
        // From the rim the wind comes from, across the middle, the way it blows.
        <g transform={`rotate(${Math.round(windFrom)} ${C} ${C})`}>
          <path
            className={s.arrow()}
            d={`M ${C - 3} ${C - 40} L ${C + 3} ${C - 40} L ${C + 3} ${C + 8} L ${C + 9} ${C + 8} L ${C} ${C + 22} L ${C - 9} ${C + 8} L ${C - 3} ${C + 8} Z`}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
}
