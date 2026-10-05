import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const countStyles = tv({
  slots: {
    // The chart's light: a figure in a ring, as a spot's stars are drawn.
    base: "inline-grid h-5 min-w-5 place-items-center rounded-full border px-1 font-mono text-caption leading-none font-semibold tabular-nums",
    label: "sr-only",
  },
  variants: {
    tone: {
      // Unread. Said in fill and weight together, never in colour alone.
      strong: { base: "border-ink bg-inverse text-ink-inverse" },
      quiet: { base: "border-ink bg-card text-ink" },
    },
  },
  defaultVariants: { tone: "strong" },
});

/** Past this the number stops being read, so it stops being counted. */
const MOST = 99;

export type CountProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> &
  VariantProps<typeof countStyles> & {
    value: number;
    /**
     * What is being counted, for a screen reader: `"unread"` reads "4 unread".
     * Without it the badge is hidden from one, for a control whose own label
     * already says the number.
     */
    label?: string;
  };

/** A number in a badge. Nothing is drawn for zero. */
export function Count({ value, label, tone, className, ...props }: CountProps) {
  if (value <= 0) return null;
  const styles = countStyles({ tone });
  return (
    <span
      {...props}
      className={styles.base({ className })}
      aria-hidden={label ? undefined : true}
    >
      {value > MOST ? `${MOST}+` : value}
      {label && <span className={styles.label()}> {label}</span>}
    </span>
  );
}
