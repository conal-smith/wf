import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const surfaceStyles = tv({
  base: [
    // Paper, opaque, with its grain and the faintest light from above: over
    // a moving map a translucent panel is a second, blurred map, and the
    // chart draws its boxes solid. A box's corner, and it floats.
    "rounded-surface border border-ink bg-card paper-float p-5 text-ink shadow-float",
  ],
  variants: {
    /*
     * The chart's box is the ink rule with a hairline just inside it: the
     * border, two of paper, and the hairline. `single` for a box that sits
     * inside another, or one small enough that two lines would be most of it.
     */
    rule: {
      double: "inset-shadow-frame",
      single: "",
    },
  },
  defaultVariants: { rule: "double" },
});

export type SurfaceProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof surfaceStyles>;

/**
 * A box laid over the moving map: the search, the layers, a spot's popout.
 * On a page that is read, the box content sits in is a Pane.
 */
export function Surface({ rule, className, ...props }: SurfaceProps) {
  return <div {...props} className={surfaceStyles({ rule, className })} />;
}
