import type { HTMLAttributes } from "react";
import { tv } from "./tv";

export const surfaceStyles = tv({
  base: [
    "rounded-surface border border-card/70 bg-glass p-5 text-ink shadow-surface",
    // The map's own glass is saturated by 1.45 (src/styles.css), as the
    // design bundle's surface was; a panel over it matches it exactly.
    "backdrop-blur-glass backdrop-saturate-145",
    // Glass is a choice the reader can decline.
    "reduced-transparency:bg-solid reduced-transparency:backdrop-filter-none",
  ],
});

export type SurfaceProps = HTMLAttributes<HTMLDivElement>;

/**
 * Glass, for what floats over the moving map. On the content ground a white
 * hairline and a translucent fill vanish: that is a Pane.
 */
export function Surface({ className, ...props }: SurfaceProps) {
  return <div {...props} className={surfaceStyles({ className })} />;
}
