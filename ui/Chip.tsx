import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const chipStyles = tv({
  base: "inline-flex items-center gap-1 rounded-full px-3 py-1 font-sans text-caption whitespace-nowrap",
  variants: {
    tone: {
      neutral: "bg-sunken text-ink-2",
      // Warm means now or degraded. A chip that is only a category is neutral.
      warn: "bg-warn-ground text-warn",
    },
    eyebrow: { true: "text-eyebrow uppercase" },
  },
  defaultVariants: { tone: "neutral" },
});

export type ChipProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof chipStyles>;

/** A label on a thing: a category, a condition, a status. Never pressable. */
export function Chip({ tone, eyebrow, className, ...props }: ChipProps) {
  return (
    <span {...props} className={chipStyles({ tone, eyebrow, className })} />
  );
}
