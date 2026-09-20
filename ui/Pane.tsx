import type { HTMLAttributes } from "react";
import { tv, type VariantProps } from "./tv";

export const paneStyles = tv({
  base: "rounded-surface p-5 text-ink",
  variants: {
    kind: {
      card: "border border-line bg-card",
      sunken: "bg-sunken",
    },
  },
  defaultVariants: { kind: "card" },
});

export type PaneProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof paneStyles>;

/** The box content sits in on the content ground. Over the map it is a Surface. */
export function Pane({ kind, className, ...props }: PaneProps) {
  return <div {...props} className={paneStyles({ kind, className })} />;
}
