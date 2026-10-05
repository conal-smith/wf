import type { ReactNode } from "react";
import { tv, type VariantProps } from "./tv";

/*
 * A figure: the number first and large, in the mono face's tabular digits, its
 * unit small beside it and, where there is one, a second figure raised after
 * it the way the chart writes a gust over the mean (14 g22 -> 14²²). The site
 * says things in these rather than in sentences.
 */
export const figureStyles = tv({
  slots: {
    base: "inline-flex items-baseline gap-0.5 font-mono whitespace-nowrap text-ink tabular-nums",
    value: "",
    sup: "self-start font-mono text-caption font-medium text-ink-muted",
    unit: "font-mono text-caption text-ink-muted",
  },
  variants: {
    size: {
      sm: { value: "text-body font-semibold" },
      md: { value: "text-figure" },
      lg: { value: "text-reading font-semibold" },
    },
    // The raised figure is the one to watch: a gust well over the mean.
    alarm: { true: { sup: "font-semibold text-pen-ink" } },
  },
  defaultVariants: { size: "md" },
});

export type FigureProps = VariantProps<typeof figureStyles> & {
  value: ReactNode;
  /** Small, after the number: kn, m, €, %. */
  unit?: ReactNode;
  /** Raised after the number: the gust over the mean. */
  sup?: ReactNode;
  /** What the figure is, for a screen reader, where the digits alone are not. */
  label?: string;
  className?: string;
};

export function Figure({
  value,
  unit,
  sup,
  label,
  size,
  alarm,
  className,
}: FigureProps) {
  const styles = figureStyles({ size, alarm });
  return (
    <span
      className={styles.base({ className })}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <span className={styles.value()}>{value}</span>
      {sup !== undefined && <span className={styles.sup()}>{sup}</span>}
      {unit !== undefined && <span className={styles.unit()}>{unit}</span>}
    </span>
  );
}
