import { tv, type VariantProps } from "./tv";

/*
 * An hour's stars, as the chart draws them: solid for what the hour is worth
 * for this rider, an outline for what the wind alone would have given, and a
 * small dot for each of the five it does not reach. Shape carries the
 * difference; the tone only repeats it. The dark is not rated: an empty slot
 * of the same width, so a row of hours stays in line.
 */
export const starGlyphsStyles = tv({
  slots: {
    base: "inline-block shrink-0 overflow-visible align-middle",
    solid: "fill-current",
    faded: "fill-none stroke-current opacity-50",
    dot: "fill-current opacity-25",
  },
  variants: {
    // Whatever the text around it is, by default.
    tone: {
      ink: { base: "text-ink" },
      // On an ink fill: a selected column, a light.
      inverse: { base: "text-ink-inverse" },
      // The best of the week, where magenta marks it.
      magenta: { base: "text-chart-magenta" },
    },
  },
});

/** The chart's star, a five-point at radius 5 round the origin. */
const STAR =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

/** "3 of 5 stars, 4 on the wind alone", or "Dark: not rated". */
export function starsLabel(stars: number | null, potential?: number): string {
  if (stars == null) return "Dark: not rated";
  const pot = Math.max(potential ?? stars, stars);
  return (
    `${stars} of 5 stars` + (pot > stars ? `, ${pot} on the wind alone` : "")
  );
}

export type StarGlyphsProps = VariantProps<typeof starGlyphsStyles> & {
  /** Solid stars, 0 to 5. Null for a dark hour, which is not rated. */
  stars: number | null;
  /** What the wind alone would give: the outlines after the solid ones. */
  potential?: number;
  /** Pixels per star. */
  size?: number;
  /**
   * `"five"` draws all five places, dots where the hour falls short: the
   * chart's way, and the default. `"potential"` stops at the last outline,
   * for a cell too narrow to hold five.
   */
  slots?: "five" | "potential";
  /**
   * What a screen reader hears. `starsLabel` by default. An empty string says
   * the words are already beside it (a button that names the day's stars):
   * the stars are then decoration, hidden, not an image with no name.
   */
  label?: string;
  className?: string;
};

export function StarGlyphs({
  stars,
  potential,
  size = 12,
  slots = "five",
  tone,
  label,
  className,
}: StarGlyphsProps) {
  const styles = starGlyphsStyles({ tone });
  // The mockup's 2px at 12px, and 1px at the dock's 10px, where five stars
  // and their gaps must stay inside a 73px column's padding.
  const gap = Math.max(1, Math.floor(size / 6));
  const solid = stars ?? 0;
  const pot = Math.max(potential ?? solid, solid);
  const count = slots === "five" ? 5 : Math.max(pot, stars == null ? 5 : 1);
  const width = count * size + (count - 1) * gap;
  const k = size / 10.4;
  return (
    <svg
      className={styles.base({ className })}
      width={width}
      height={size}
      viewBox={`0 0 ${width} ${size}`}
      {...(label === ""
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label ?? starsLabel(stars, potential) })}
    >
      {stars != null &&
        Array.from({ length: count }, (_, i) => {
          const x = i * (size + gap) + size / 2;
          const y = size / 2;
          if (i < solid)
            return (
              <path
                key={i}
                className={styles.solid()}
                d={STAR}
                transform={`translate(${x} ${y + 0.4}) scale(${k})`}
              />
            );
          if (i < pot)
            return (
              <path
                key={i}
                className={styles.faded()}
                d={STAR}
                strokeWidth={0.95 / k}
                transform={`translate(${x} ${y + 0.4}) scale(${k})`}
              />
            );
          return (
            <circle
              key={i}
              className={styles.dot()}
              cx={x}
              cy={y}
              r={size * 0.07}
            />
          );
        })}
    </svg>
  );
}
