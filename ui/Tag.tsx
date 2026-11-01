import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

/*
 * A word that describes something and cannot be pressed: Offshore, Unsure,
 * now, coming. A small capsule in sentence case, never in capitals.
 */
export const tagStyles = tv({
  base: "inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full px-2 font-body text-label font-medium whitespace-nowrap",
  variants: {
    tone: {
      neutral: "bg-well text-ink-2",
      // Offshore, a warning, something wrong: the pen's red on its tint.
      off: "bg-warn-ground text-pen-ink",
      ok: "bg-well text-ok",
      // Over a photograph: the ground that lets a little through, solid for
      // a reader who has declined transparency.
      glass: [
        "bg-glass text-ink backdrop-blur-glass",
        "reduced-transparency:bg-solid reduced-transparency:backdrop-filter-none",
      ],
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type TagProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof tagStyles>;

/** A label on a thing: a condition, a status, a category. Never pressable. */
export function Tag({ tone, className, ...props }: TagProps) {
  return <span {...props} className={tagStyles({ tone, className })} />;
}
