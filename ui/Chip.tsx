import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const chipStyles = tv({
  base: "inline-flex items-center gap-1 rounded-full px-3 py-1 font-sans text-caption whitespace-nowrap",
  variants: {
    tone: {
      neutral: "bg-sunken text-ink-2",
      // Warm means now or degraded. A chip that is only a category is neutral.
      warn: "bg-warn-ground text-warn",
      // Glass, for a badge laid over a photograph: sunken is a flat grey patch
      // there, and a fill opaque enough to read would hide the picture it is
      // labelling. The same choice a Surface makes over the moving map, and
      // the same way out of it for a reader who has declined transparency.
      glass: [
        "border border-card/70 bg-glass text-ink-muted shadow-control backdrop-blur-glass",
        "reduced-transparency:bg-solid reduced-transparency:backdrop-filter-none",
      ],
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
