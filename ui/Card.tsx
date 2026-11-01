import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

/*
 * The soft card: a shade off the ground, a box's corner, no rule and no
 * shadow. Cards are kept apart by space. Over the map a box floats instead
 * (`float`): the ground itself, with the float shadow and, in dark, a faint
 * edge so it separates from the chart.
 */
export const cardStyles = tv({
  base: "min-w-0 rounded-surface text-ink",
  variants: {
    kind: {
      soft: "bg-sunken on-card",
      float: "bg-ground shadow-float dark:ring-1 dark:ring-line",
    },
    pad: {
      none: "",
      md: "p-5 max-wide:p-4",
    },
  },
  defaultVariants: { kind: "soft", pad: "md" },
});

export type CardProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardStyles>;

/** The box content sits in: on a page, or over the map. */
export function Card({ kind, pad, className, ...props }: CardProps) {
  return <div {...props} className={cardStyles({ kind, pad, className })} />;
}
