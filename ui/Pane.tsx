import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const paneStyles = tv({
  base: "rounded-surface p-5 text-ink",
  variants: {
    kind: {
      // A box ruled in ink, on paper with its grain.
      card: "border border-ink bg-card paper-grain",
      // The paper's second sheet, with no rule: a well, an aside.
      sunken: "bg-sunken",
      /*
       * The broadsheet's section: a heavy rule above, nothing at the sides,
       * and no inset of its own, so it lines up with the column it is in.
       * Most of a page is this rather than a box.
       */
      ruled: "border-t-2 border-ink px-0 pt-3 pb-0",
    },
    /** A second rule inside the first: the chart's box, for one that matters. */
    double: { true: "inset-shadow-frame" },
    /**
     * A pane that stands on the page on its own, rather than sitting in a
     * column of panes: it lifts off the paper a little, and takes the wider
     * inset where the width is there to pay for it.
     */
    standing: { true: "p-6 shadow-surface max-wide:p-5" },
  },
  defaultVariants: { kind: "card" },
});

export type PaneProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof paneStyles>;

/** The box content sits in on a page. Over the map it is a Surface. */
export function Pane({
  kind,
  double,
  standing,
  className,
  ...props
}: PaneProps) {
  return (
    <div
      {...props}
      className={paneStyles({ kind, double, standing, className })}
    />
  );
}
