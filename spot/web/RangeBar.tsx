/**
 * The models' spread for one hour on the rider's own scale, 0 to 30 knots: the
 * sweet spot washed in magenta and the floor dashed, the ensembles' middle 80%
 * as a sea-blue bar, every model's range as a thin ink line through it, the
 * consensus as a dot and its gust as a tick. One glance down a column says how
 * sure the hour is and where it sits for this rider.
 */
import type { Units } from "../../force5/src/units";
import type { HourEnsemble, HourWind } from "../../mcp/api/forecast";
import { tv } from "../../ui/tv";
import { windIn } from "./spot";

const styles = tv({
  slots: {
    svg: "block shrink-0 overflow-visible",
    sweet: "fill-chart-magenta/10",
    floor: "stroke-chart-magenta/60",
    ensemble: "fill-depth/45",
    models: "fill-ink/70",
    gust: "stroke-chart-magenta",
    mean: "fill-ink",
    tick: "stroke-ink/40",
    // Figures, not a label: the column head's capitals are not for them.
    label: "fill-ink-muted font-mono text-eyebrow normal-case",
  },
});

export const RANGE_WIDTH = 112;
const FULL_KN = 30;
const x = (knots: number) =>
  3 + (Math.min(FULL_KN, Math.max(0, knots)) / FULL_KN) * (RANGE_WIDTH - 6);
const r1 = (value: number) => Math.round(value);

export interface Band {
  min: number;
  sweetLow: number;
  sweetHigh: number;
}

/** The words the bar draws: "consensus 12 g20 kn · models 11–15 · ensembles 10–13". */
export function rangeWords(
  wind: HourWind,
  ensemble: HourEnsemble | null | undefined,
): string {
  return [
    `consensus ${r1(wind.wind_kn)}${wind.gust_kn !== null ? ` g${r1(wind.gust_kn)}` : ""} kn`,
    wind.models > 1 ? `models ${r1(wind.min_kn)}–${r1(wind.max_kn)}` : null,
    ensemble ? `ensembles ${r1(ensemble.p10_kn)}–${r1(ensemble.p90_kn)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function RangeBar({
  wind,
  ensemble,
  band,
}: {
  wind: HourWind;
  ensemble: HourEnsemble | null | undefined;
  band: Band;
}) {
  const s = styles();
  const words = rangeWords(wind, ensemble);
  return (
    <svg
      className={s.svg()}
      width={RANGE_WIDTH}
      height={18}
      role="img"
      aria-label={words}
      data-range-bar
    >
      <title>{words}</title>
      <rect
        className={s.sweet()}
        x={x(band.sweetLow)}
        y={0}
        width={x(band.sweetHigh) - x(band.sweetLow)}
        height={18}
      />
      <line
        className={s.floor()}
        x1={x(band.min)}
        x2={x(band.min)}
        y1={2}
        y2={16}
        strokeDasharray="2 2"
      />
      {ensemble && (
        <rect
          className={s.ensemble()}
          x={x(ensemble.p10_kn)}
          y={5.5}
          width={Math.max(1, x(ensemble.p90_kn) - x(ensemble.p10_kn))}
          height={7}
          rx={1}
        />
      )}
      {wind.models > 1 && (
        <rect
          className={s.models()}
          x={x(wind.min_kn)}
          y={8}
          width={Math.max(1, x(wind.max_kn) - x(wind.min_kn))}
          height={2}
        />
      )}
      {wind.gust_kn !== null && (
        <line
          className={s.gust()}
          x1={x(wind.gust_kn)}
          x2={x(wind.gust_kn)}
          y1={3}
          y2={15}
          strokeWidth={1.7}
        />
      )}
      <circle className={s.mean()} cx={x(wind.wind_kn)} cy={9} r={3} />
    </svg>
  );
}

/**
 * The bar's scale, for its column's head: 0, the floor and the sweet spot.
 * The floor and the sweet spot's low end are often only four knots apart,
 * a dozen pixels, so their figures are not centred on their ticks but set
 * away from each other: the floor's ends at its tick, the sweet spot's
 * "14–24" starts at its own. The figures are in the reader's units, as the
 * Wind column beside it is, whose head names them; the bar itself is drawn in
 * knots underneath, which the reader never sees.
 */
export function RangeAxis({ band, units }: { band: Band; units: Units }) {
  const s = styles();
  const say = (knots: number) => Math.round(windIn(knots, units));
  return (
    <svg className={s.svg()} width={RANGE_WIDTH} height={20} aria-hidden="true">
      <rect
        className={s.sweet()}
        x={x(band.sweetLow)}
        y={12}
        width={x(band.sweetHigh) - x(band.sweetLow)}
        height={6}
      />
      {[0, band.min, band.sweetLow, band.sweetHigh].map((k, i) => (
        <line
          key={i}
          className={s.tick()}
          x1={x(k)}
          x2={x(k)}
          y1={12}
          y2={18}
        />
      ))}
      <text className={s.label()} x={x(0)} y={9} textAnchor="start">
        0
      </text>
      <text className={s.label()} x={x(band.min) - 2} y={9} textAnchor="end">
        {say(band.min)}
      </text>
      <text
        className={s.label()}
        x={x(band.sweetLow) + 1}
        y={9}
        textAnchor="start"
      >
        {say(band.sweetLow)}–{say(band.sweetHigh)}
      </text>
    </svg>
  );
}
