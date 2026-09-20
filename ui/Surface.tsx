import type { HTMLAttributes } from "react";
import { tv } from "./tv";

export const surfaceStyles = tv({
  base: [
    "rounded-surface border border-card/70 bg-glass p-5 text-ink shadow-surface",
    "backdrop-blur-glass backdrop-saturate-150",
    // Glass is a choice the reader can decline.
    "reduced-transparency:bg-solid reduced-transparency:backdrop-filter-none",
  ],
});

/**
 * Glass, for what floats over the moving map. On the content ground a white
 * hairline and a translucent fill vanish: that is a Pane.
 */
export function Surface({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={surfaceStyles({ className })} />;
}
