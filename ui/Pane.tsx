import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const paneStyles = tv({
  base: "rounded-surface p-5 text-ink",
  variants: {
    kind: {
      // A card on the page: ruled in ink with the hairline inside, on paper
      // with its grain, a box's corner, and only a contact shadow under it.
      card: "border border-ink bg-card paper-grain inset-shadow-frame shadow-card",
      // The paper's second sheet, with no rule: a well, an aside.
      sunken: "bg-sunken",
      /*
       * The broadsheet's section: a heavy rule above, nothing at the sides,
       * and no inset of its own, so it lines up with the column it is in.
       * Most of a page is this rather than a box. A print rule: square, and
       * no shadow.
       */
      ruled: "rounded-none border-t-2 border-ink px-0 pt-3 pb-0",
    },
    /**
     * The hairline inside the rule. A card has it already; this is for a
     * sunken pane that is to read as a box.
     */
    double: { true: "inset-shadow-frame" },
    /**
     * A pane that stands on the page on its own, rather than sitting in a
     * column of panes: it takes the wider inset where the width is there to
     * pay for it. It is still a card: it casts the contact shadow, no more.
     */
    standing: { true: "p-6 shadow-card max-wide:p-5" },
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
