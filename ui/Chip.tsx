import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

/*
 * A tag in the figures' face: mono, in a capsule ruled with a hairline, on the
 * paper it stands on. It labels; it is never pressed.
 */
export const chipStyles = tv({
  base: "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-caption whitespace-nowrap",
  variants: {
    tone: {
      neutral: "border-line bg-sunken text-ink-2",
      // Warm means now or degraded. A chip that is only a category is neutral.
      warn: "border-warn bg-warn-ground text-warn",
      // Paper over a photograph: a badge has to read on whatever the picture
      // is, so it takes the ink rule and paper that lets a little through, and
      // goes solid for a reader who has declined transparency.
      glass: [
        "border-ink bg-glass text-ink backdrop-blur-glass",
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
