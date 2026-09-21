import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const paneStyles = tv({
  base: "rounded-surface p-5 text-ink",
  variants: {
    kind: {
      card: "border border-line bg-card",
      sunken: "bg-sunken",
    },
    /**
     * A pane that stands on the content ground on its own, rather than sitting
     * in a column of panes: it lifts off the ground, and takes the wider inset
     * where the width is there to pay for it.
     */
    standing: { true: "p-6 shadow-control max-wide:p-5" },
  },
  defaultVariants: { kind: "card" },
});

export type PaneProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof paneStyles>;

/** The box content sits in on the content ground. Over the map it is a Surface. */
export function Pane({ kind, standing, className, ...props }: PaneProps) {
  return (
    <div {...props} className={paneStyles({ kind, standing, className })} />
  );
}
