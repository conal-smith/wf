/**
 * The small marks the spot page repeats on every row: the wind bar, the arrow
 * a wind or a swell travels along, and how far the models agree.
 */
import { ArrowDown } from "lucide-react";
import type { Agreement } from "../../mcp/api/forecast";
import { windStop } from "../../shared/web/windStops";
import { tv } from "../../ui/tv";

export const windBarStyles = tv({
  slots: {
    track: "relative block h-1.5 w-full overflow-hidden rounded-full bg-sunken",
    // The gust: the same hue, faded, under the mean.
    gust: "absolute inset-y-0 left-0 rounded-full opacity-35",
    mean: "absolute inset-y-0 left-0 rounded-full",
  },
  variants: {
    // The theme's ramp, written out: a class put together at run time is one
    // the stylesheet never gets.
    wind: {
      k00: { gust: "bg-wind-k00", mean: "bg-wind-k00" },
      k05: { gust: "bg-wind-k05", mean: "bg-wind-k05" },
      k09: { gust: "bg-wind-k09", mean: "bg-wind-k09" },
      k10: { gust: "bg-wind-k10", mean: "bg-wind-k10" },
      k15: { gust: "bg-wind-k15", mean: "bg-wind-k15" },
      k20: { gust: "bg-wind-k20", mean: "bg-wind-k20" },
      k25: { gust: "bg-wind-k25", mean: "bg-wind-k25" },
      k30: { gust: "bg-wind-k30", mean: "bg-wind-k30" },
      k35: { gust: "bg-wind-k35", mean: "bg-wind-k35" },
      k40: { gust: "bg-wind-k40", mean: "bg-wind-k40" },
      k45: { gust: "bg-wind-k45", mean: "bg-wind-k45" },
      k50: { gust: "bg-wind-k50", mean: "bg-wind-k50" },
      k60: { gust: "bg-wind-k60", mean: "bg-wind-k60" },
      k65: { gust: "bg-wind-k65", mean: "bg-wind-k65" },
    },
  },
});

/** The bar runs to this many knots; anything stronger fills it. */
const BAR_FULL_KN = 40;
const share = (knots: number) =>
  `${Math.min(100, (Math.max(0, knots) / BAR_FULL_KN) * 100)}%`;

/**
 * The mean wind as a bar in the ramp's colour, with the gust behind it in the
 * same hue, faded. The number beside it says the value; the bar is the glance
 * down a column of hours. Decorative to a screen reader.
 */
export function WindBar({
  knots,
  gust,
  className,
}: {
  knots: number;
  gust: number | null;
  className?: string;
}) {
  const s = windBarStyles({ wind: windStop(knots) });
  return (
    <span className={s.track({ className })} aria-hidden="true">
      {gust !== null && gust > knots && (
        <span className={s.gust()} style={{ width: share(gust) }} />
      )}
      <span className={s.mean()} style={{ width: share(knots) }} />
    </span>
  );
}

/**
 * An arrow pointing the way a wind or a swell travels, for a bearing it comes
 * FROM: wind from the north points down the page.
 */
export function FromArrow({
  from,
  size = 14,
  className,
}: {
  from: number;
  size?: number;
  className?: string;
}) {
  return (
    <ArrowDown
      size={size}
      aria-hidden="true"
      className={className}
      style={{ transform: `rotate(${Math.round(from)}deg)` }}
    />
  );
}

const agreementStyles = tv({
  slots: {
    base: "inline-flex items-center gap-0.5",
    dot: "size-1.5 rounded-full",
  },
  variants: {
    on: { true: { dot: "bg-ink-2" }, false: { dot: "bg-line-strong/40" } },
  },
});

export const AGREEMENT_WORDS: Record<Agreement, string> = {
  high: "Models agree closely",
  moderate: "Models differ a little",
  low: "Models disagree",
};

const LEVEL: Record<Agreement, number> = { high: 3, moderate: 2, low: 1 };

/**
 * How far the models agree, as three dots: all three closely, two a little,
 * one not at all. Null agreement — one model only — draws nothing.
 */
export function AgreementDots({
  agreement,
  models,
  min,
  max,
}: {
  agreement: Agreement | null;
  models: number;
  min: number;
  max: number;
}) {
  if (!agreement) return null;
  const words = `${AGREEMENT_WORDS[agreement]}: ${models} models, ${Math.round(min)}–${Math.round(max)} kn`;
  return (
    <span
      className={agreementStyles().base()}
      role="img"
      aria-label={words}
      title={words}
    >
      {[1, 2, 3].map((dot) => (
        <span
          key={dot}
          className={agreementStyles({ on: dot <= LEVEL[agreement] }).dot()}
        />
      ))}
    </span>
  );
}
